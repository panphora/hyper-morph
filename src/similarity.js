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
const SIG_ATTRS = ["href", "src", "name", "type", "role"];

/** Elements whose text is code or data: never paired by text similarity. */
export const CODE_LIKE = new Set(["SCRIPT", "STYLE", "TEXTAREA", "TEMPLATE", "IFRAME", "OBJECT", "CANVAS", "VIDEO", "AUDIO", "svg", "SVG"]);

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
export function createAnalyzer({ ignored = () => false, ignoreAttribute = () => false } = {}) {
  const metaCache = new WeakMap();
  const unitsCache = new WeakMap();

  function attrString(el) {
    const parts = [];
    for (const a of el.attributes) {
      if (ignoreAttribute(el, a.name)) continue;
      parts.push(a.name + "=" + a.value);
    }
    parts.sort();
    return parts.join("\u0001");
  }

  function signature(el) {
    const classes = el.classList && el.classList.length ? Array.from(el.classList).sort().join(" ") : "";
    let s = el.tagName + "|" + classes;
    for (const name of SIG_ATTRS) {
      const v = el.getAttribute(name);
      if (v != null) s += "|" + name + "=" + v;
    }
    return s;
  }

  function childrenOf(node) {
    if (node.nodeType === 1 && node.tagName === "TEMPLATE" && node.content) return node.content.childNodes;
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
      m = { hash: "T" + djb2(node.nodeValue), hint: collapse(node.nodeValue).slice(0, HINT_LENGTH), sig: null };
    } else if (node.nodeType === 8) {
      m = { hash: "C" + djb2(node.nodeValue), hint: "", sig: null };
    } else if (node.nodeType === 1) {
      let h = djb2(node.tagName + "\u0002" + attrString(node));
      let hint = "";
      for (const child of childrenOf(node)) {
        if (child.nodeType === 1 && ignored(child)) continue;
        if (child.nodeType !== 1 && child.nodeType !== 3 && child.nodeType !== 8) continue;
        const cm = meta(child);
        h = djb2(cm.hash, h);
        // Element boundaries separate words for similarity even though
        // textContent would run them together.
        if (hint.length < HINT_LENGTH && child.nodeType !== 8) hint += (child.nodeType === 1 ? " " : "") + cm.hint;
      }
      m = { hash: "E" + h, hint: collapse(hint).trim().slice(0, HINT_LENGTH), sig: signature(node) };
    } else {
      m = { hash: "N" + node.nodeType, hint: "", sig: null };
    }
    let tok = null;
    m.tokens = () => {
      if (!tok) {
        tok = new Set();
        for (const w of m.hint.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) tok.add(w);
      }
      return tok;
    };
    metaCache.set(node, m);
    return m;
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
    const flush = () => { if (run) { run.value = run.nodes.map((n) => n.nodeValue).join(""); units.push(run); run = null; } };
    for (const child of childrenOf(parent)) {
      if (child.nodeType === 3) {
        if (!run) run = { kind: "text", nodes: [], value: "", parent };
        run.nodes.push(child);
        continue;
      }
      flush();
      if (child.nodeType === 8) units.push({ kind: "comment", nodes: [child], value: child.nodeValue, parent });
      else if (child.nodeType === 1 && !ignored(child)) units.push(child);
    }
    flush();
    unitsCache.set(parent, units);
    return units;
  }

  function unitHash(u) {
    if (u.nodeType === 1) return meta(u).hash;
    return (u.kind === "text" ? "T" : "C") + djb2(u.value);
  }

  function similar(a, b) {
    const ta = meta(a).tokens(), tb = meta(b).tokens();
    if (ta.size === 0 && tb.size === 0) return true;
    if (ta.size === 0 || tb.size === 0) return false;
    // Overlap coefficient: shared tokens over the smaller set. Jaccard would
    // reject a container that merely gained content ("Team" vs "Team Pricing
    // plans"), which is the normal shape of a concurrent insertion.
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / Math.min(ta.size, tb.size) >= 0.5;
  }

  return { meta, unitsOf, unitHash, similar, childrenOf };
}
