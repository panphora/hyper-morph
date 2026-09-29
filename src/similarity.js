/**
 * similarity.js — per-node metadata the aligner and merger share.
 *
 * `createAnalyzer` returns memoized accessors over any number of trees:
 *
 *   meta(node)      { hash, hint, sig, tokens() }  computed bottom-up, once
 *   unitsOf(parent) the parent's children as alignment units: non-ignored
 *                   elements as themselves, adjacent text nodes coalesced into
 *                   one run object, comments as single-node runs
 *   similar(a, b)   overlap coefficient of the two hints' token sets (>= 0.5),
 *                   with empty-vs-empty similar and empty-vs-nonempty not
 *
 * Hashes let identical subtrees be recognized in O(1) and skipped; hints
 * are the first 64 characters of collapsed text, built from children's hints
 * so no node's full textContent is ever materialized.
 */

const HINT_LENGTH = 64;
const SIG_ATTRS = new Set(["href", "src", "name", "type", "role"]);

/** Elements whose text is code or data: never paired by text similarity. */
export const CODE_LIKE = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "svg",
  "SVG",
]);

function djb2(str, seed = 5381) {
  let h = seed;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return h >>> 0;
}

function collapse(s) {
  return s.replace(/\s+/g, " ");
}

/**
 * @param {object} [options]
 * @param {(n: Node) => boolean} [options.ignored]
 * @param {(el: Element, name: string) => boolean} [options.ignoreAttribute]
 */
export function createAnalyzer({
  ignored = () => false,
  ignoreAttribute = () => false,
} = {}) {
  const metaCache = new WeakMap();
  const unitsCache = new WeakMap();

  /** One pass over the attributes yields both the hash input and the signature. */
  function attrParts(el) {
    const attrs = el.attributes;
    const n = attrs.length;
    if (n === 0) return { all: "", sig: el.tagName + "|" };
    const parts = [];
    let classes = "";
    const sigParts = [];
    for (let i = 0; i < n; i++) {
      const a = attrs[i];
      const name = a.name;
      if (!ignoreAttribute(el, name)) parts.push(name + "=" + a.value);
      if (name === "class")
        classes =
          a.value.indexOf(" ") < 0
            ? a.value
            : a.value.split(/\s+/).filter(Boolean).sort().join(" ");
      else if (SIG_ATTRS.has(name)) sigParts.push(name + "=" + a.value);
    }
    if (parts.length > 1) parts.sort();
    if (sigParts.length > 1) sigParts.sort();
    return {
      all: parts.join("\u0001"),
      sig:
        el.tagName +
        "|" +
        classes +
        (sigParts.length ? "|" + sigParts.join("|") : ""),
    };
  }

  function childrenOf(node) {
    if (node.nodeType === 1 && node.tagName === "TEMPLATE" && node.content)
      return node.content.childNodes;
    return node.childNodes;
  }

  /**
   * @param {Node} node
   * @returns {{ hash: string, hint: string, sig: string | null, tokens: () => Set<string> }}
   */
  function meta(node) {
    let m = metaCache.get(node);
    if (m) return m;
    if (node.nodeType === 3) {
      m = {
        hash: "T" + djb2(node.nodeValue),
        hint: collapse(node.nodeValue).slice(0, HINT_LENGTH),
        sig: null,
        tok: null,
      };
    } else if (node.nodeType === 8) {
      m = { hash: "C" + djb2(node.nodeValue), hint: "", sig: null, tok: null };
    } else if (node.nodeType === 1) {
      const ap = attrParts(node);
      let h = djb2(node.tagName + "\u0002" + ap.all);
      let hint = "";
      // Children are consumed as units, so a text run is hashed once and
      // reused by the aligner, and the unit list itself is built once.
      for (const u of unitsOf(node)) {
        if (u.nodeType === 1) {
          const cm = meta(u);
          h = djb2(cm.hash, h);
          if (hint.length < HINT_LENGTH) hint += " " + cm.hint;
        } else {
          h = djb2(unitHash(u), h);
          if (u.kind === "text" && hint.length < HINT_LENGTH)
            hint += u.value.slice(0, HINT_LENGTH);
        }
      }
      m = {
        hash: "E" + h,
        hint: collapse(hint).trim().slice(0, HINT_LENGTH),
        sig: ap.sig,
        tok: null,
      };
    } else {
      m = { hash: "N" + node.nodeType, hint: "", sig: null, tok: null };
    }
    metaCache.set(node, m);
    return m;
  }

  /** Lowercased word tokens of a node's hint, computed on first use. */
  function tokensOf(m) {
    if (!m.tok) {
      m.tok = new Set();
      for (const w of m.hint.toLowerCase().split(/[^\p{L}\p{N}]+/u))
        if (w) m.tok.add(w);
    }
    return m.tok;
  }

  /**
   * @typedef {object} Run
   * @property {"text" | "comment"} kind
   * @property {Node[]} nodes
   * @property {string} value
   * @property {Node} parent
   */

  /**
   * Alignment units of a parent: elements as themselves, text as runs.
   * @param {Node} parent
   * @returns {Array<Element | Run>}
   */
  function unitsOf(parent) {
    let units = unitsCache.get(parent);
    if (units) return units;
    units = [];
    let run = null;
    const flush = () => {
      if (run) {
        run.value = run.nodes.map((n) => n.nodeValue).join("");
        units.push(run);
        run = null;
      }
    };
    for (const child of childrenOf(parent)) {
      if (child.nodeType === 3) {
        if (!run)
          run = { kind: "text", nodes: [], value: "", parent, hash: undefined };
        run.nodes.push(child);
        continue;
      }
      flush();
      if (child.nodeType === 8)
        units.push({
          kind: "comment",
          nodes: [child],
          value: child.nodeValue,
          parent,
          hash: undefined,
        });
      else if (child.nodeType === 1 && !ignored(child)) units.push(child);
    }
    flush();
    unitsCache.set(parent, units);
    return units;
  }

  function unitHash(u) {
    if (u.nodeType === 1) return meta(u).hash;
    if (u.hash === undefined)
      u.hash = (u.kind === "text" ? "T" : "C") + djb2(u.value);
    return u.hash;
  }

  /**
   * How alike two nodes' hints are: `coef`, the overlap coefficient (shared
   * tokens over the smaller set), and `share`, the same over the larger
   * set. Jaccard alone would reject a container that merely gained content
   * ("Team" vs "Team Pricing plans"), which is the normal shape of a
   * concurrent insertion; `share` still ranks the fuller match first when
   * two candidates contain the same tokens. Null when only one side has
   * tokens.
   */
  function score(a, b) {
    const ta = tokensOf(meta(a)),
      tb = tokensOf(meta(b));
    if (ta.size === 0 && tb.size === 0) return { coef: 1, share: 1 };
    if (ta.size === 0 || tb.size === 0) return null;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return {
      coef: inter / Math.min(ta.size, tb.size),
      share: inter / Math.max(ta.size, tb.size),
    };
  }

  function similar(a, b) {
    const s = score(a, b);
    return !!s && s.coef >= 0.5;
  }

  const tupleCache = new WeakMap();
  function attrTuples(el) {
    let t = tupleCache.get(el);
    if (t) return t;
    t = [];
    for (const a of el.attributes)
      if (!ignoreAttribute(el, a.name))
        t.push([a.namespaceURI || "", a.localName, a.value]);
    t.sort((x, y) =>
      x[0] < y[0]
        ? -1
        : x[0] > y[0]
          ? 1
          : x[1] < y[1]
            ? -1
            : x[1] > y[1]
              ? 1
              : 0,
    );
    tupleCache.set(el, t);
    return t;
  }

  const eqCache = new WeakMap();
  function equalUnits(a, b) {
    if (a === b) return true;
    if (unitHash(a) !== unitHash(b)) return false;
    let row = eqCache.get(a);
    if (row && row.has(b)) return row.get(b);
    const eq = equalUncached(a, b);
    if (!row) eqCache.set(a, (row = new WeakMap()));
    row.set(b, eq);
    return eq;
  }

  function equalUncached(a, b) {
    if (a.nodeType === 1) {
      if (b.nodeType !== 1 || a.tagName !== b.tagName) return false;
      if (a.namespaceURI !== b.namespaceURI) return false;
      const ta = attrTuples(a),
        tb = attrTuples(b);
      if (ta.length !== tb.length) return false;
      for (let i = 0; i < ta.length; i++)
        if (
          ta[i][0] !== tb[i][0] ||
          ta[i][1] !== tb[i][1] ||
          ta[i][2] !== tb[i][2]
        )
          return false;
      const ua = unitsOf(a),
        ub = unitsOf(b);
      if (ua.length !== ub.length) return false;
      for (let i = 0; i < ua.length; i++)
        if (!equalUnits(ua[i], ub[i])) return false;
      return true;
    }
    if (b.nodeType === 1) return false;
    return a.kind === b.kind && a.value === b.value;
  }

  const keyCache = new WeakMap();
  const keyBuckets = new Map();
  let nextKey = 0;
  function exactUnitKey(u) {
    let k = keyCache.get(u);
    if (k) return k;
    const h = unitHash(u);
    let bucket = keyBuckets.get(h);
    if (!bucket) keyBuckets.set(h, (bucket = []));
    const rep = bucket.find((x) => equalUnits(x.unit, u));
    k = rep ? rep.key : "K" + nextKey++;
    if (!rep) bucket.push({ unit: u, key: k });
    keyCache.set(u, k);
    return k;
  }

  return {
    meta,
    unitsOf,
    unitHash,
    similar,
    score,
    childrenOf,
    equalUnits,
    exactUnitKey,
  };
}
