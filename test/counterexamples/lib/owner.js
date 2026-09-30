// Per-owner conservation and immutable identity evidence for the oracle.
//
// An owner is an identified element: under clay the case's sid is the
// lineage token, falling back to a unique authored id. It owns the content
// down to the next owner. Element checks cover identified owners, new
// unlabelled textless leaves, and anonymous slot certificates: a unique
// same-tag, same-content child between the same stable anchors on every
// input side. Anonymous structure with no certificate is out of scope.
// Count bounds are necessary conditions, not a proof of which occurrence is
// which.

import { createHash } from "node:crypto";

// A child shape enters its parent's shape as a fixed-length digest, so deep
// nesting costs linear time instead of doubling the escaping at every level.
const digest = (s) => createHash("sha1").update(s).digest("base64");

const BLOCK_TAGS = Object.freeze(
  new Set(
    "ADDRESS ARTICLE ASIDE AUDIO BLOCKQUOTE BODY CANVAS CAPTION CENTER COL COLGROUP DD DETAILS DIALOG DIR DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM FRAME FRAMESET H1 H2 H3 H4 H5 H6 HEAD HEADER HGROUP HR HTML IFRAME LEGEND LI MAIN MATH MENU NAV NOSCRIPT OBJECT OL OPTGROUP OPTION P PRE SCRIPT SECTION SELECT STYLE SUMMARY SVG TABLE TBODY TD TEMPLATE TEXTAREA TFOOT TH THEAD TITLE TR UL VIDEO".split(
      " ",
    ),
  ),
);

const MISSING = null;

const tokens = (s) => s.split(/\s+/).filter(Boolean);

export function three(b, l, r) {
  if (l === b) return r;
  if (r === b) return l;
  if (l === r) return l;
  return undefined;
}

/** Necessary count bounds for one owner/word: [lower, upper], or null when
 * the two sides moved the count in opposite directions. */
export function countBounds(b, l, r) {
  if (l === b) return [r, r];
  if (r === b) return [l, l];
  if (l >= b && r >= b) return [Math.max(l, r), l + r - b];
  if (l <= b && r <= b) return [Math.max(0, l + r - b), Math.min(l, r)];
  return null;
}

const authoredOf = (el) => el.getAttribute("data-id") || el.getAttribute("id");

export function allElements(root) {
  const out = [];
  const start = root && root.nodeType === 9 ? root.documentElement : root;
  if (!start) return out;
  const go = (el) => {
    out.push(el);
    const parent = el.localName === "template" && el.content ? el.content : el;
    for (let k = parent.firstElementChild; k; k = k.nextElementSibling) go(k);
  };
  go(start);
  return out;
}

function uniqueAuthored(root) {
  const counts = new Map();
  for (const el of allElements(root)) {
    const a = authoredOf(el);
    if (a) counts.set(a, (counts.get(a) || 0) + 1);
  }
  return (el) => {
    const a = authoredOf(el);
    return a && counts.get(a) === 1 ? a : null;
  };
}

/** Authored values the clay identity certifies as one effective identity even
 * though the sides name them with different synthetic lineages. Input graphs
 * decide this, never the output: a value duplicated on any side is excluded. */
function clayAliases(c, p) {
  const aliases = new Set();
  if (c.identity !== "clay") return aliases;
  const baseLocal = c.shape === "clean" || !!c.options.twoWay;
  const inputs = [
    [baseLocal ? p.cap : p.base, baseLocal ? p.sidCap : p.sidB],
    [p.cap, p.sidCap],
    [p.remote, p.sidR],
  ];
  const entries = new Map(),
    duplicated = new Set();
  for (const [root, sids] of inputs) {
    const counts = new Map();
    for (const el of allElements(root)) {
      const a = authoredOf(el);
      if (a) counts.set(a, (counts.get(a) || 0) + 1);
    }
    for (const [a, n] of counts) if (n > 1) duplicated.add(a);
    for (const el of allElements(root)) {
      const a = authoredOf(el);
      if (!a || counts.get(a) !== 1) continue;
      if (!entries.has(a)) entries.set(a, new Set());
      entries.get(a).add(sids.has(el) ? "$" + sids.get(el) : "@" + a);
    }
  }
  for (const [a, keys] of entries)
    if (keys.size > 1 && !duplicated.has(a)) aliases.add(a);
  return aliases;
}

/** Logical parents, with template fragments crossed: a fragment child's parent
 * is its template, and the fragment itself is never the logical parent. */
function parentReader(scope) {
  const links = new WeakMap();
  for (const el of allElements(scope)) {
    if (el.content?.nodeType === 11) links.set(el.content, el);
    for (const child of el.content?.childNodes || el.childNodes)
      links.set(child, el);
  }
  return (node) => links.get(node) || node?.parentNode || null;
}

function headURL(href, baseURI) {
  try {
    const url = new URL(href, baseURI || undefined);
    return url.origin + url.pathname + url.search;
  } catch {
    return href;
  }
}

/** The structural key of a direct HEAD child: the documented head signature,
 * kept independent of the merge's own helpers. */
function headKey(el, baseURI) {
  if (!el || el.nodeType !== 1 || el.parentElement?.tagName !== "HEAD")
    return null;
  const tag = el.tagName;
  if (tag === "TITLE" || tag === "BASE")
    return "#head:" + JSON.stringify([tag]);
  if (tag === "META") {
    for (const name of [
      "charset",
      "name",
      "property",
      "http-equiv",
      "itemprop",
    ])
      if (el.hasAttribute(name))
        return "#head:" + JSON.stringify(["META", name, el.getAttribute(name)]);
    return null;
  }
  if (tag === "LINK") {
    const href = el.getAttribute("href");
    if (href === null) return null;
    const rel = el.getAttribute("rel") || "";
    return "#head:" + JSON.stringify(["LINK", rel, headURL(href, baseURI)]);
  }
  return null;
}

/** The same key only where the side establishes it exactly once: an ambiguous
 * repeated metadata key receives no certificate. */
function headKeyOf(root, baseURI) {
  const counts = new Map();
  for (const el of allElements(root)) {
    const k = headKey(el, baseURI);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return (el) => {
    const k = headKey(el, baseURI);
    return k && counts.get(k) === 1 ? k : null;
  };
}

const sidAllowed = (identity) => identity === "clay" || identity === "plain";
const authoredAllowed = (identity) =>
  identity === "default" || identity === "authored" || identity === "clay";

function keyOfFor(c, sids, root, config) {
  const sid = sidAllowed(c.identity);
  const auth = authoredAllowed(c.identity);
  const clay = c.identity === "clay";
  const unique = auth ? uniqueAuthored(root) : () => null;
  const head = headKeyOf(root, config.baseURI);
  return (el) => {
    if (!el || el.nodeType !== 1) return null;
    const natural = head(el);
    if (natural) return natural;
    if (clay) {
      const a = unique(el);
      if (a && config.aliases.has(a)) return "@" + a;
    }
    if (sid) {
      const s = sids.get(el);
      if (s) return "$" + s;
    }
    if (auth) {
      const a = unique(el);
      if (a) return "@" + a;
    }
    return null;
  };
}

function outputKey(c, p, report, liveRoot, config) {
  const sid = sidAllowed(c.identity);
  const auth = authoredAllowed(c.identity);
  const clay = c.identity === "clay";
  const plain = c.identity === "plain";
  const unique = auth ? uniqueAuthored(liveRoot) : () => null;
  const head = headKeyOf(liveRoot, config.baseURI);
  const known = new Set([
    ...p.sidB.values(),
    ...p.sidCap.values(),
    ...p.sidR.values(),
  ]);
  const headKnown = new Set();
  for (const root of [p.base, p.cap, p.remote]) {
    const read = headKeyOf(root, config.baseURI);
    for (const el of allElements(root)) {
      const k = read(el);
      if (k) headKnown.add(k);
    }
  }
  const naturalKey = (el) => {
    const k = head(el);
    return k && headKnown.has(k) ? k : null;
  };
  const baseKnown = new Set(p.sidB.values());
  const assigned = new Map(report.identities || []);
  const authoredAliases = new Map();
  if (auth)
    for (const [root, sids] of [
      [p.base, p.sidB],
      [p.cap, p.sidCap],
      [p.remote, p.sidR],
    ]) {
      const read = uniqueAuthored(root);
      for (const el of allElements(root)) {
        const a = read(el),
          s = sids.get(el);
        if (!a || !s) continue;
        if (!authoredAliases.has(a)) authoredAliases.set(a, new Set());
        authoredAliases.get(a).add(s);
      }
    }
  const provReaders = new Map();
  const provReader = (sids, root) => {
    let byRoot = provReaders.get(sids);
    if (!byRoot) provReaders.set(sids, (byRoot = new Map()));
    let read = byRoot.get(root);
    if (!read) byRoot.set(root, (read = keyOfFor(c, sids, root, config)));
    return read;
  };
  const relabelled = [];
  if (sid)
    for (const [el, orig] of p.sidL) {
      if (naturalKey(el)) continue;
      const a = assigned.get(el);
      if (
        a !== undefined &&
        a !== orig &&
        !(auth && a === authoredOf(el)) &&
        (plain || (baseKnown.has(a) && baseKnown.has(orig)))
      )
        relabelled.push({
          prop: "identity-relabelled",
          owner: "$" + orig,
          from: "$" + orig,
          got: "$" + a,
        });
    }
  const key = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const natural = naturalKey(el);
    if (natural) return natural;
    if (clay) {
      const a = unique(el);
      if (a && config.aliases.has(a)) return "@" + a;
    }
    if (plain) {
      const s = p.sidL.get(el);
      if (s) return "$" + s;
    }
    const prov = report.provenance?.get(el);
    if (prov)
      for (const [source, sids] of [
        [prov.local, p.sidCap],
        [prov.remote, p.sidR],
        [prov.base, p.sidB],
      ]) {
        if (!source) continue;
        const k = provReader(sids, source.ownerDocument)(source);
        if (k) return k;
      }
    if (sid) {
      const a = assigned.get(el),
        s = p.sidL.get(el);
      if (
        s &&
        (plain || a === undefined || a === s || (auth && a === authoredOf(el)))
      )
        return "$" + s;
      if (a !== undefined && known.has(a)) return "$" + a;
      if (a !== undefined && !(auth && a === authoredOf(el))) return null;
    }
    if (auth) {
      const a = unique(el);
      if (a) {
        const aliases = authoredAliases.get(a);
        if (sid && aliases?.size === 1) return "$" + [...aliases][0];
        return "@" + a;
      }
    }
    return null;
  };
  return { key, relabelled };
}

function scopeOf(c, doc) {
  if (!doc) return null;
  if (c.shape === "element")
    return (doc.body && doc.body.firstElementChild) || null;
  return doc.documentElement || doc;
}

const residualOf = (c, n) => {
  if (c.shape === "element") return "(element)";
  for (let x = n; x; x = x.parentNode)
    if (x.nodeType === 1 && (x.tagName === "HEAD" || x.tagName === "BODY"))
      return x.tagName === "HEAD" ? "(head)" : "(body)";
  return "(body)";
};

function indexSide(c, sids, root, scope, config) {
  const key = keyOfFor(c, sids, root, config);
  const map = new Map();
  const dup = new Set();
  const nodeOwner = new WeakMap();
  for (const el of allElements(scope)) {
    const k = key(el);
    if (!k) continue;
    nodeOwner.set(el, k);
    if (map.has(k)) dup.add(k);
    map.set(k, el);
  }
  for (const k of dup) map.delete(k);
  const present = new Set([...map.keys(), ...dup]);
  if (c.shape === "element") present.add("(element)");
  else {
    present.add("(body)");
    present.add("(head)");
  }
  return {
    key,
    map,
    dup,
    present,
    nodeOwner,
    scope,
    parent: parentReader(scope),
  };
}

function certifySlots(views, skip) {
  const original = views.map((s) => s.key),
    extras = views.map(() => new WeakMap());
  const roots = views.map((s) => s.scope),
    seen = new Set();
  let serial = 0;
  views.forEach((side, i) => {
    side.key = (el) => extras[i].get(el) || original[i](el);
  });
  const kids = (el) => {
    const out = [];
    for (
      let k = (el?.content || el)?.firstElementChild;
      k;
      k = k.nextElementSibling
    )
      out.push(k);
    return out;
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const sigOf = (el) => JSON.stringify([el.namespaceURI, el.localName]);
  const walk = (nodes, owner) => {
    const seed = nodes.slice(0, 3).find(Boolean);
    if (!seed || seen.has(seed) || nodes.some((n) => n && skip(n))) return;
    seen.add(seed);
    const lists = nodes.map(kids);
    const evidence = new Map();
    for (let i = 0; i < 3; i++) {
      if (!nodes[i]) continue;
      for (const el of lists[i]) {
        if (original[i](el) || extras[i].get(el)) continue;
        const sig = sigOf(el);
        if (!evidence.has(sig)) evidence.set(sig, [[], [], []]);
        evidence.get(sig)[i].push(el);
      }
    }
    for (const [sig, arrays] of evidence) {
      if (arrays.some((a) => a.length !== 1)) continue;
      const [b, l, r] = arrays.map((a) => a[0]);
      if ([b, l, r].some((el) => skip(el))) continue;
      const text = b.textContent;
      if (!text || l.textContent !== text || r.textContent !== text) continue;
      const id = "^slot:" + ++serial;
      extras[0].set(b, id);
      extras[1].set(l, id);
      extras[2].set(r, id);
      let g = null;
      for (const el of lists[3]) {
        if (original[3](el) || extras[3].get(el) || sigOf(el) !== sig) continue;
        extras[3].set(el, id);
        if (!g) g = el;
      }
      walk([b, l, r, g], id);
    }
    const anchors = lists
      .slice(0, 3)
      .map((list, i) => list.map(original[i]).filter(Boolean));
    const activeAnchors = anchors.filter((_, i) => nodes[i]);
    if (!activeAnchors.every((a) => same(a, activeAnchors[0]))) return;
    const stable = new Set(activeAnchors[0] || []);
    const groups = lists.map((list, i) => {
      const m = new Map();
      for (let at = 0; at < list.length; at++) {
        const el = list[at];
        if (original[i](el) || extras[i].get(el)) continue;
        let before = null,
          after = null;
        for (let j = at - 1; j >= 0; j--) {
          const id = original[i](list[j]);
          if (stable.has(id)) {
            before = id;
            break;
          }
        }
        for (let j = at + 1; j < list.length; j++) {
          const id = original[i](list[j]);
          if (stable.has(id)) {
            after = id;
            break;
          }
        }
        const key = JSON.stringify([
          el.namespaceURI,
          el.localName,
          before,
          after,
        ]);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(el);
      }
      return m;
    });
    for (const signature of new Set(
      groups.slice(0, 3).flatMap((m) => [...m.keys()]),
    )) {
      const arrays = groups.map((m) => m.get(signature) || []);
      if (arrays.slice(0, 3).some((a) => a.length > 1)) continue;
      const [b, l, r] = arrays.map((a) => a[0]);
      if (!b && l && r && l.textContent !== r.textContent) continue;
      const exemplar = b || l || r;
      if (!exemplar || [b, l, r].some((el) => el && skip(el))) continue;
      const id = "^slot:" + ++serial;
      arrays.forEach((els, i) => {
        for (const el of els) extras[i].set(el, id);
      });
      walk(
        arrays.map((a) => a[0]),
        id,
      );
    }
  };
  walk(roots, "(scope)");
  const natural = new Set(views.slice(0, 3).flatMap((s) => [...s.map.keys()]));
  for (const id of natural)
    walk(
      views.map((s) => s.map.get(id)),
      id,
    );
  views.forEach((side, i) => {
    for (const el of allElements(side.scope)) {
      const id = extras[i].get(el);
      if (!id) continue;
      side.nodeOwner.set(el, id);
      side.present.add(id);
      if (side.map.has(id)) side.dup.add(id);
      else side.map.set(id, el);
    }
    for (const id of side.dup) side.map.delete(id);
  });
}

/** Collect per-owner word counts: text in document order, joined at block and
 * owner boundaries but not between adjacent text nodes, so a word split
 * across nodes keeps its count. */
function streamsFor(c, side, skip) {
  const items = [];
  const walk = (node, owner) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (n.nodeValue)
          items.push({ owner: owner || residualOf(c, n), text: n.nodeValue });
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (skip(n)) continue;
      const k = side.key(n) || owner;
      const block = BLOCK_TAGS.has(n.tagName);
      if (block) items.push({ sep: true });
      if (n.localName === "template" && n.content) walk(n.content, k);
      else walk(n, k);
      if (block) items.push({ sep: true });
    }
  };
  if (side.scope && !skip(side.scope))
    walk(side.scope, side.key(side.scope) || null);
  // An owner's next text joins its previous text directly unless a block separator came between them (the generation changed).
  const counts = new Map();
  const lastGen = new Map();
  let gen = 0;
  for (const it of items) {
    if (it.sep) {
      gen++;
      continue;
    }
    if (!counts.has(it.owner)) counts.set(it.owner, it.text);
    else {
      // Another owner's inline text between two runs does not split them:
      // the words read the same once that owner is gone. Only a block does.
      const apart = lastGen.get(it.owner) !== gen;
      counts.set(it.owner, counts.get(it.owner) + (apart ? " " : "") + it.text);
    }
    lastGen.set(it.owner, gen);
  }
  const words = new Map();
  const seq = new Map();
  for (const [k, text] of counts) {
    const t = tokens(text);
    const m = new Map();
    for (const w of t) m.set(w, (m.get(w) || 0) + 1);
    words.set(k, m);
    seq.set(k, t);
  }
  words.seq = seq;
  return words;
}

const EMPTY = new Map();
const wordCount = (streams, key, word) => {
  const m = streams.get(key);
  return (m && m.get(word)) || 0;
};

function attrValue(el, name) {
  if (!el || !el.hasAttribute(name)) return MISSING;
  return el.getAttribute(name);
}

function attrNames(el) {
  const out = [];
  if (!el || !el.attributes) return out;
  for (const a of el.attributes) out.push(a.name);
  return out;
}

function isSubsequence(a, b) {
  const A = [...a];
  let i = 0;
  for (const ch of b) if (ch === A[i]) i++;
  return i === A.length;
}

/** A necessary non-extension certificate for two copies of one inserted
 * element with text-only content: neither copy's text can be typed out of
 * the other by insertions, so the engine cannot merge them as inline
 * content and must pick one whole copy. */
function simpleInsertCollision(l, r) {
  if (
    !l ||
    !r ||
    l.namespaceURI !== r.namespaceURI ||
    l.localName !== r.localName
  )
    return false;
  if (![...l.childNodes, ...r.childNodes].every((n) => n.nodeType === 3))
    return false;
  const a = l.textContent,
    b = r.textContent;
  return !!a && !!b && !isSubsequence(a, b) && !isSubsequence(b, a);
}

const SCAFFOLD = new Set(["HTML", "HEAD", "BODY"]);

/** Attribute names a form control keeps in a property, and the tags that
 * carry them: the merge still syncs form state, so an identical subtree is
 * not a licence to keep a runtime attribute of these names. */
const FORM_STATE = new Set(["value", "checked", "selected", "disabled"]);
const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "OPTION", "SELECT"]);

const tagOf = (html) => {
  const m = /^<([^\s/>]+)/.exec(html);
  return m ? m[1].toUpperCase() : "";
};

/** Unlabelled textless leaf elements: canonical outerHTML counted per nearest
 * identified owner. */
function leafCounts(c, side, skip) {
  const out = new Map();
  const add = (owner, html) => {
    if (!out.has(owner)) out.set(owner, new Map());
    const m = out.get(owner);
    m.set(html, (m.get(html) || 0) + 1);
  };
  const walk = (node, owner) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (skip(n)) continue;
      const k = side.key(n) || owner;
      if (
        !side.key(n) &&
        !SCAFFOLD.has(n.tagName) &&
        n.children.length === 0 &&
        !n.textContent.trim()
      )
        add(owner || residualOf(c, n), n.outerHTML);
      if (n.localName === "template" && n.content) walk(n.content, k);
      else walk(n, k);
    }
  };
  if (side.scope && !skip(side.scope))
    walk(side.scope, side.key(side.scope) || null);
  for (const e of side.extraLeaves || []) {
    if (e.tag === "SCRIPT" || e.tag === "STYLE") continue;
    if (e.parentCap && skip(e.parentCap)) continue;
    add(e.owner, e.html);
  }
  return out;
}

/**
 * Ancestor-aware, operation-specific policy masks, built from the certified
 * views and the frozen pre-merge records only. A mask applies to a genuine
 * operation: ignore/remoteWins regions, a morph/remove/add the hooks promise
 * to veto. Nothing here reads the engine report.
 */
function policyEvidence(c, p, views) {
  const [B, L, R] = views;
  const h = c.options.hooks || {};
  const masked = new WeakSet();
  const vetoed = new WeakSet();
  const checks = [];
  const notes = [];
  const mark = (root, isVeto = false) => {
    if (!root) return;
    for (const el of allElements(root)) {
      masked.add(el);
      if (isVeto) vetoed.add(el);
    }
  };
  const nearest = (side, el) => {
    for (let x = el; x && x.nodeType === 1; x = side.parent(x)) {
      const k = side.key(x);
      if (k) return k;
    }
    return residualOf(c, el);
  };
  const register = (side, root, kind, full = false) => {
    const nodes = allElements(root);
    const keys = new Set(nodes.map(side.key).filter(Boolean));
    const isVeto = kind.startsWith("veto");
    mark(root, isVeto);
    for (const view of views)
      for (const el of allElements(view.scope))
        if (keys.has(view.key(el))) mark(el, isVeto);
    if (side === L) for (const n of nodes) mark(p.capToLive.get(n), isVeto);
    const key = side.key(root);
    const live = side === L ? p.capToLive.get(root) : null;
    const frozen = live && p.preMerge.get(live);
    if (frozen) checks.push({ kind, key, live, frozen, full });
    if (kind === "veto-add")
      checks.push({
        kind,
        key,
        newKeys: [...keys].filter(
          (k) => !B.present.has(k) && !L.present.has(k),
        ),
      });
  };
  const scopeMask = (sel, owner) => {
    for (const view of views)
      for (const el of allElements(view.scope))
        if (el.matches(sel) && nearest(view, el) === owner) {
          mark(el, true);
          if (view === L) mark(p.capToLive.get(el), true);
        }
  };
  for (const [kind, sel] of [
    ["ignore", c.options.ignore],
    ["remote", c.options.remoteWins],
  ]) {
    if (!sel) continue;
    for (const side of views)
      for (const el of allElements(side.scope)) if (el.matches(sel)) mark(el);
    if (kind === "ignore")
      for (const el of allElements(L.scope)) {
        const live = p.capToLive.get(el);
        const f = live && p.preMerge.get(live);
        if (f?.selectors.has(sel)) register(L, el, "ignore", true);
      }
  }
  if (c.options.ignore) {
    const sel = c.options.ignore;
    const known = new Set(
      checks.filter((chk) => chk.kind === "ignore").map((chk) => chk.live),
    );
    for (const [live, frozen] of p.preMerge)
      if (
        frozen.selectors.has(sel) &&
        p.scopeBefore.has(live) &&
        !known.has(live)
      )
        checks.push({ kind: "ignore", key: null, live, frozen, full: true });
  }
  const selected = (el, sel) => {
    const f = p.preMerge.get(p.capToLive.get(el));
    return f ? f.selectors.has(sel) : el.matches(sel);
  };
  const markupIndex = (side) => {
    const m = new Map();
    for (const el of allElements(side.scope))
      m.set(el.outerHTML, (m.get(el.outerHTML) || 0) + 1);
    return m;
  };
  const needsMarkup = h.vetoMorph || h.vetoRemove || h.vetoAdd;
  const MB = needsMarkup ? markupIndex(B) : null;
  const ML = needsMarkup ? markupIndex(L) : null;
  const MR = needsMarkup ? markupIndex(R) : null;
  const newKey = (side, el) => {
    const keys = new Set(allElements(el).map(side.key).filter(Boolean));
    return [...keys].some((k) => !B.present.has(k) && !L.present.has(k));
  };
  const removedKey = (el) => {
    const keys = new Set(allElements(el).map(L.key).filter(Boolean));
    return [...keys].some(
      (k) => (B.present.has(k) || L.present.has(k)) && !R.present.has(k),
    );
  };
  const morphingKey = (el) => {
    const keys = new Set(allElements(el).map(L.key).filter(Boolean));
    return [...keys].some((k) => R.present.has(k));
  };
  for (const el of allElements(L.scope)) {
    const key = L.key(el);
    const be = key && B.map.get(key);
    const re = key && R.map.get(key);
    const desc = allElements(el).slice(1).map(L.key).filter(Boolean);
    const remoteMembers = new Set(re ? allElements(re) : []);
    const external = desc.some(
      (k) => R.map.has(k) && !remoteMembers.has(R.map.get(k)),
    );
    if (h.morph && h.vetoMorph && selected(el, h.vetoMorph)) {
      if (re) {
        register(L, el, "veto-morph", !external);
        if (external) notes.push({ kind: "veto-children", owner: key });
      } else if (!key && (morphingKey(el) || !MR.has(el.outerHTML))) {
        scopeMask(h.vetoMorph, nearest(L, el));
        notes.push({ kind: "veto-scope", owner: nearest(L, el) });
      }
    }
    if (h.vetoRemove && selected(el, h.vetoRemove)) {
      if (be && !re && be.outerHTML === el.outerHTML) {
        register(L, el, "veto-remove", !external);
        if (external) notes.push({ kind: "veto-children", owner: key });
      } else if (
        !key &&
        (removedKey(el) || (MB.has(el.outerHTML) && !MR.has(el.outerHTML)))
      ) {
        scopeMask(h.vetoRemove, nearest(L, el));
        notes.push({ kind: "veto-scope", owner: nearest(L, el) });
      }
    }
  }
  if (h.vetoAdd)
    for (const el of allElements(R.scope)) {
      const key = R.key(el);
      if (
        key &&
        el.matches(h.vetoAdd) &&
        !B.present.has(key) &&
        !L.present.has(key)
      )
        register(R, el, "veto-add");
      else if (
        !key &&
        el.matches(h.vetoAdd) &&
        (newKey(R, el) || (!ML.has(el.outerHTML) && !MB.has(el.outerHTML)))
      ) {
        scopeMask(h.vetoAdd, nearest(R, el));
        notes.push({ kind: "veto-scope", owner: nearest(R, el) });
      }
    }
  return {
    skip: (el) => !!el && masked.has(el),
    veto: (el) => !!el && vetoed.has(el),
    checks,
    notes,
  };
}

/** The side indexes, streams and policy masks one case needs: the raw
 * evidence ownerChecks reads. */
export function ownerSnapshot(c, obs) {
  if (obs.ownerEvidence) return obs.ownerEvidence;
  const { p: rawP, report } = obs.raw;
  const p = rawP.elementLocal ? { ...rawP, ...rawP.elementLocal } : rawP;
  const liveRoot = obs.raw.liveRoot;
  const h = c.options.hooks || {};

  const regionSels = [c.options.ignore, c.options.remoteWins].filter(Boolean);

  const config = {
    aliases: clayAliases(c, p),
    baseURI: c.options.pass?.baseURI || p.baseURI,
  };

  const bAsLocal = c.shape === "clean" || !!c.options.twoWay;
  const B = indexSide(
    c,
    bAsLocal ? p.sidCap : p.sidB,
    bAsLocal ? p.cap : p.base,
    scopeOf(c, bAsLocal ? p.cap : p.base),
    config,
  );
  const L = indexSide(c, p.sidCap, p.cap, scopeOf(c, p.cap), config);
  const R = indexSide(c, p.sidR, p.remote, scopeOf(c, p.remote), config);
  const inputScope = new WeakSet();
  for (const side of [B, L, R])
    for (const el of allElements(side.scope)) inputScope.add(el);
  const inRegion = (el) => {
    const parentOf = (x) => B.parent(x) || L.parent(x) || R.parent(x);
    for (let x = el; x; x = parentOf(x))
      if (
        x.nodeType === 1 &&
        inputScope.has(x) &&
        regionSels.some((s) => x.matches(s))
      )
        return true;
    return false;
  };
  const certSkip = (el) =>
    el.tagName === "SCRIPT" || el.tagName === "STYLE" || inRegion(el);
  const out = outputKey(c, p, report, liveRoot, config);
  const gScope = scopeOf(c, liveRoot);
  const G = {
    key: out.key,
    map: new Map(),
    dup: new Set(),
    nodeOwner: new WeakMap(),
    scope: gScope,
    parent: parentReader(gScope),
  };
  for (const el of allElements(G.scope)) {
    const k = out.key(el);
    if (!k) continue;
    G.nodeOwner.set(el, k);
    if (G.map.has(k)) G.dup.add(k);
    G.map.set(k, el);
  }
  for (const k of G.dup) G.map.delete(k);
  G.present = new Set([...G.map.keys(), ...G.dup]);
  for (const k of B.present) if (k.startsWith("(")) G.present.add(k);
  certifySlots([B, L, R, G], certSkip);
  const policies = policyEvidence(c, p, [B, L, R, G]);
  const skip = (el) =>
    !!el &&
    (el.tagName === "SCRIPT" || el.tagName === "STYLE" || policies.skip(el));
  const textSkip = (el) =>
    skip(el) || (h.vetoAttr === "value" && el?.tagName === "TEXTAREA");
  const capOwner = (el) => {
    for (let x = el; x && x.nodeType === 1; x = L.parent(x)) {
      const k = L.key(x);
      if (k) return k;
    }
    return null;
  };
  L.extraLeaves = (p.liveHeadLeaves || []).map(({ parentCap, html, tag }) => ({
    owner: capOwner(parentCap) || "(head)",
    html,
    tag,
    parentCap,
  }));

  const snapshot = {
    p,
    report,
    liveRoot,
    h,
    policies,
    skip,
    B,
    L,
    R,
    G,
    out,
    Bw: streamsFor(c, B, textSkip),
    Lw: streamsFor(c, L, textSkip),
    Rw: streamsFor(c, R, textSkip),
    Gw: streamsFor(c, G, textSkip),
  };
  obs.ownerEvidence = snapshot;
  return snapshot;
}

export function ownerChecks(c, obs) {
  const { p, policies, report, h, skip, B, L, R, G, out, Bw, Lw, Rw, Gw } =
    ownerSnapshot(c, obs);

  const violations = [];
  const ambiguous = [];
  const elementScope = (side, el) => {
    if (c.shape === "element") return "element";
    for (let x = el; x; x = side.parent(x)) {
      if (x.nodeType !== 1) continue;
      if (x.tagName === "HEAD") return "head";
      if (x.tagName === "BODY") return "body";
    }
    return null;
  };
  const ownerScope = (owner) => {
    if (owner === "(head)") return "head";
    if (owner === "(body)") return "body";
    if (owner === "(element)") return "element";
    if (owner == null) return null;
    for (const side of [B, L, R, G]) {
      const el = side.map.get(owner);
      if (el) return elementScope(side, el);
    }
    return null;
  };
  const note = (o) => {
    if (o.scope === undefined && o.owner !== undefined) {
      const scope = ownerScope(o.owner);
      if (scope) o = { ...o, scope };
    }
    ambiguous.push(o);
  };

  violations.push(...out.relabelled);

  const containsNode = (root, node) => {
    if (!root) return false;
    if (root === node) return true;
    const kids = root.content ? root.content.childNodes : root.childNodes;
    if (kids) for (const c of kids) if (containsNode(c, node)) return true;
    return false;
  };
  if (report.provenance)
    for (const el of allElements(G.scope)) {
      const prov = report.provenance.get(el);
      if (!prov) continue;
      for (const [field, root] of [
        ["base", p.base],
        ["local", p.cap],
        ["remote", p.remote],
      ]) {
        const source = prov[field];
        if (!source || source.nodeType !== 1) continue;
        // A side that lacks the element (or a remoteWins region) is read as
        // base for content, so that side's provenance is the base node.
        const standIn =
          field !== "base" &&
          source === prov.base &&
          containsNode(p.base, source);
        const foreign = !containsNode(root, source) && !standIn;
        if (
          foreign ||
          source.namespaceURI !== el.namespaceURI ||
          source.localName !== el.localName
        )
          violations.push({
            prop: "provenance",
            owner: G.nodeOwner.get(el) || null,
            field,
            why: foreign ? "foreign" : "tag",
            want: [source.namespaceURI, source.localName],
            got: [el.namespaceURI, el.localName],
          });
      }
    }

  const ownerStep = (x) => {
    for (const side of [B, L, R, G]) {
      const logical = side.parent(x);
      if (logical) return logical;
    }
    return null;
  };
  const ownerOf = (node) => {
    for (let x = node; x; x = ownerStep(x)) {
      for (const side of [B, L, R, G]) {
        const k = side.nodeOwner.get(x);
        if (k) return k;
      }
    }
    return null;
  };

  const textOwners = new Set();
  const residualText = new Set();
  const conflictTokens = new Map();
  const addConflictTokens = (where, cf) => {
    if (!conflictTokens.has(where)) conflictTokens.set(where, new Set());
    const set = conflictTokens.get(where);
    for (const s of [cf.base, cf.local, cf.remote])
      for (const w of tokens((s || "").replace(/<[^>]*>/g, " "))) set.add(w);
  };
  for (const cf of report.conflicts || []) {
    if (cf.kind !== "text") continue;
    const node = cf.node || cf.el;
    const owner = node ? ownerOf(node) : null;
    if (owner) {
      textOwners.add(owner);
      addConflictTokens(owner, cf);
    } else if (node) {
      const where = residualOf(c, node);
      residualText.add(where);
      addConflictTokens(where, cf);
    }
  }
  if (textOwners.size)
    for (const k of textOwners) note({ kind: "text-conflict", owner: k });
  if (residualText.size)
    for (const k of residualText) note({ kind: "text-conflict", owner: k });

  const sameBag = (a = EMPTY, b = EMPTY) => {
    if (a.size !== b.size) return false;
    for (const [w, n] of a) if (b.get(w) !== n) return false;
    return true;
  };
  // A text-conflict record is a claim: it earns wider bounds only where both
  // inputs changed that owner's words, and the policy still decides the floor.
  const bothChanged = (key) =>
    !sameBag(Bw.get(key), Lw.get(key)) && !sameBag(Bw.get(key), Rw.get(key));
  // Base token positions a side changed: tokens it removed or replaced, and
  // gaps where it inserted. Null when the texts are too long to diff.
  const changedBase = (b, s) => {
    const n = b.length,
      m = s.length;
    if (n * m > 4e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] =
          b[i] === s[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const tok = new Uint8Array(n),
      gap = new Uint8Array(n + 1);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && b[i] === s[j]) {
        i++;
        j++;
      } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
        gap[i] = 1;
        j++;
      } else {
        tok[i] = 1;
        i++;
      }
    }
    return { tok, gap };
  };
  // A conflict record is credible only where the two sides' edits overlap
  // or touch in base; adjacent edits count, since a merge may join them.
  const editsOverlap = (key) => {
    const b = Bw.seq?.get(key) || [];
    const lc = changedBase(b, Lw.seq?.get(key) || []);
    const rc = changedBase(b, Rw.seq?.get(key) || []);
    if (!lc || !rc) return true;
    const near = (x, i) => x.tok[i] || x.gap[i] || x.gap[i + 1];
    for (let i = 0; i < b.length; i++)
      if ((lc.tok[i] && near(rc, i)) || (rc.tok[i] && near(lc, i))) return true;
    for (let i = 0; i <= b.length; i++) if (lc.gap[i] && rc.gap[i]) return true;
    return false;
  };
  const policy = c.options.conflicts || "remote";
  const conflictBounds = (b, l, r) => {
    const [win, lose] = policy === "local" ? [l, r] : [r, l];
    const lo =
      policy === "both"
        ? l >= b && r >= b
          ? Math.max(l, r)
          : Math.min(l, r)
        : lose === b
          ? win
          : Math.min(l, r);
    // A conflict record covers only the overlapping hunk; clean edits
    // outside it still apply, so the floor is never above a clean merge's.
    const clean = countBounds(b, l, r);
    return [clean ? Math.min(lo, clean[0]) : lo, l + r];
  };

  const present = (side, key) => side.present.has(key);
  const states = new Map();
  const logicalParent = (side, el) => {
    for (let x = el ? side.parent(el) : null; x; x = side.parent(x)) {
      if (x.nodeType !== 1) continue;
      const key = side.key(x);
      if (key) return key;
    }
    return "(root)";
  };
  const textOnly = (el) =>
    !!el && [...el.childNodes].every((n) => n.nodeType === 3);
  // Two differing copies of one new id where either has element children:
  // the engine may keep either copy whole. Decided from this key's own
  // copies only, so ancestry never recurses.
  const unsettledOwn = (k) => {
    if (B.map.has(k) || B.dup.has(k)) return false;
    const le = L.map.get(k),
      re = R.map.get(k);
    return (
      !!le &&
      !!re &&
      !simpleInsertCollision(le, re) &&
      !(textOnly(le) && textOnly(re)) &&
      le.outerHTML !== re.outerHTML
    );
  };
  const existence = (key) => {
    if (states.has(key)) return states.get(key);
    const b = present(B, key),
      l = present(L, key),
      r = present(R, key);
    const save = (value) => {
      states.set(key, value);
      return value;
    };
    if (b && l && r) return save({ state: true });
    if (!b) {
      // An owner nested inside one copy of an unsettled same-id insertion
      // inherits that uncertainty: the engine may keep the other copy.
      const under = (side) => {
        const el = side.map.get(key);
        if (!el) return null;
        for (let a = side.parent(el); a; a = side.parent(a)) {
          if (a.nodeType !== 1) continue;
          const k = side.key(a);
          if (!k || k === key || B.map.has(k)) continue;
          if (unsettledOwn(k)) return true;
        }
        return false;
      };
      // Relieved only when every side that has it has it inside such a
      // copy; a side that places it elsewhere settles it.
      const placed = [L, R].map(under).filter((x) => x !== null);
      if (placed.length && placed.every(Boolean))
        return save({ state: null, reason: "unsettled-collision" });
      if (l && r && simpleInsertCollision(L.map.get(key), R.map.get(key)))
        return save({
          state: true,
          source: c.options.conflicts === "local" ? "local" : "remote",
          collision: true,
        });
      if (unsettledOwn(key)) return save({ state: true, unsettled: true });
      return save({ state: l || r });
    }
    if (!l && !r) return save({ state: false });
    const survivor = l ? L : R,
      missing = l ? R : L;
    const be = B.map.get(key),
      se = survivor.map.get(key);
    if (!be || !se) return save({ state: null, reason: "ambiguous-identity" });
    const source = l ? "local" : "remote";
    for (let a = survivor.parent(se); a; a = survivor.parent(a)) {
      if (a.nodeType !== 1) continue;
      const ancestor = survivor.key(a);
      if (!ancestor || ancestor === key) continue;
      if (B.map.has(ancestor) && !missing.map.has(ancestor)) {
        const parent = existence(ancestor);
        if (parent.state === true && parent.source === source)
          return save({ state: true, source });
      }
      break;
    }
    const edited =
      be.outerHTML !== se.outerHTML ||
      carrierShape(be, B) !== carrierShape(se, survivor);
    const moved = logicalParent(B, be) !== logicalParent(survivor, se);
    if (!edited && !moved) return save({ state: false });
    if (c.identity === "clay" && l && !r) {
      const descendantIds = new Set(
        allElements(se).slice(1).map(L.key).filter(Boolean),
      );
      const candidates = allElements(R.scope).filter(
        (el) =>
          !R.key(el) &&
          el.tagName === se.tagName &&
          logicalParent(R, el) === logicalParent(L, se),
      );
      if (
        candidates.some((el) =>
          allElements(el)
            .slice(1)
            .some((n) => descendantIds.has(R.key(n))),
        )
      )
        return save({ state: null, reason: "unconverged-container" });
    }
    return save({ state: true, source });
  };

  const keys = new Set([
    ...B.map.keys(),
    ...B.dup,
    ...L.map.keys(),
    ...L.dup,
    ...R.map.keys(),
    ...R.dup,
    ...G.map.keys(),
    ...G.dup,
    ...Bw.keys(),
    ...Lw.keys(),
    ...Rw.keys(),
    ...Gw.keys(),
  ]);

  for (const key of keys) states.set(key, existence(key));
  obs.ownerEvidence.states = states;
  const definite = [...keys].filter((k) => states.get(k).state === true);
  const transfer = new Set();
  for (const side of [Lw, Rw]) {
    const per = new Map();
    const touch = (w) => {
      if (!per.has(w)) per.set(w, { down: new Set(), up: new Set() });
      return per.get(w);
    };
    for (const key of definite) {
      const bw = Bw.get(key) || EMPTY;
      const sw = side.get(key) || EMPTY;
      for (const [w, n] of bw) if ((sw.get(w) || 0) < n) touch(w).down.add(key);
      for (const [w, n] of sw) if ((bw.get(w) || 0) < n) touch(w).up.add(key);
    }
    for (const [w, { down, up }] of per)
      if (down.size && up.size)
        for (const key of [...down, ...up]) transfer.add(key + "\u0000" + w);
  }
  const transferWords = new Map();
  for (const entry of transfer) {
    const at = entry.indexOf("\u0000");
    const key = entry.slice(0, at),
      word = entry.slice(at + 1);
    if (!transferWords.has(word)) transferWords.set(word, new Set());
    transferWords.get(word).add(key);
  }
  for (const [word, owners] of transferWords) {
    let bSum = 0,
      lSum = 0,
      rSum = 0,
      gSum = 0,
      lSame = true,
      rSame = true;
    for (const owner of owners) {
      const ost = states.get(owner);
      if (!ost || ost.state !== true) continue;
      const b = wordCount(Bw, owner, word);
      const l = ost.source === "remote" ? b : wordCount(Lw, owner, word);
      const r = ost.source === "local" ? b : wordCount(Rw, owner, word);
      lSum += l;
      rSum += r;
      bSum += b;
      lSame &&= l === b;
      rSame &&= r === b;
      gSum += wordCount(Gw, owner, word);
    }
    // One side moved the word and the other left every owner alone: the
    // total is exact. Both sides moved it: either move may survive.
    const bounds =
      lSame || rSame
        ? countBounds(bSum, lSum, rSum)
        : [Math.max(0, lSum + rSum - bSum), lSum + rSum];
    const ownerList = [...owners];
    if (gSum < bounds[0])
      violations.push({
        prop: "loss",
        atom: "text",
        word,
        owners: ownerList,
        got: gSum,
        bounds,
      });
    else if (gSum > bounds[1])
      violations.push({
        prop: "duplication",
        atom: "text",
        word,
        owners: ownerList,
        got: gSum,
        bounds,
      });
  }

  const isElementOwner = (key) =>
    B.map.has(key) ||
    L.map.has(key) ||
    R.map.has(key) ||
    G.map.has(key) ||
    B.dup.has(key) ||
    L.dup.has(key) ||
    R.dup.has(key);

  const vetoedOwner = (key) =>
    [B, L, R, G].some((side) => policies.veto(side.map.get(key)));

  for (const key of keys) {
    const st = states.get(key);
    if (st.state === null) {
      if (!st.absent)
        note({ kind: "existence", owner: key, reason: st.reason || null });
      continue;
    }
    const dupKey =
      B.dup.has(key) || L.dup.has(key) || R.dup.has(key) || G.dup.has(key);
    if (dupKey) {
      if (
        G.dup.has(key) &&
        !B.dup.has(key) &&
        !L.dup.has(key) &&
        !R.dup.has(key)
      )
        violations.push({
          prop: "identity-duplicated",
          owner: key,
          got: 2,
          want: 1,
        });
      else note({ kind: "duplicate", owner: key });
      continue;
    }
    const isEl = isElementOwner(key);
    if ([B, L, R, G].some((side) => policies.skip(side.map.get(key)))) continue;
    if (isEl && vetoedOwner(key)) continue;
    const words = new Set([
      ...(Bw.get(key) || EMPTY).keys(),
      ...(Lw.get(key) || EMPTY).keys(),
      ...(Rw.get(key) || EMPTY).keys(),
      ...(Gw.get(key) || EMPTY).keys(),
    ]);
    for (const w of words) {
      if (transfer.has(key + "\u0000" + w)) {
        note({ kind: "transfer", owner: key, word: w });
        continue;
      }
      const b = wordCount(Bw, key, w);
      const l = st.source === "remote" ? b : wordCount(Lw, key, w);
      const r = st.source === "local" ? b : wordCount(Rw, key, w);
      const g = wordCount(Gw, key, w);
      if (st.state === false) {
        if (g > 0)
          violations.push({
            prop: "duplication",
            atom: "text",
            owner: key,
            word: w,
            b,
            l,
            r,
            got: g,
            want: 0,
          });
        continue;
      }
      const be = B.map.get(key),
        le = L.map.get(key),
        re = R.map.get(key);
      let bounds;
      if (st.unsettled && l !== r) {
        bounds = [Math.min(l, r), l + r];
        note({ kind: "collision", owner: key, word: w, b, l, r, bounds });
      } else if (
        conflictTokens.get(key)?.has(w) &&
        (l !== b || r !== b) &&
        bothChanged(key) &&
        editsOverlap(key)
      ) {
        bounds = conflictBounds(b, l, r);
        note({ kind: "conflict", owner: key, word: w, b, l, r, bounds });
      } else if (!be && le && re && l === r) {
        bounds = [l, l];
      } else if (
        b > 0 &&
        be &&
        le &&
        re &&
        textCarrierShape(le, L) !== textCarrierShape(be, B) &&
        textCarrierShape(re, R) !== textCarrierShape(be, B) &&
        (l === b || r === b)
      ) {
        note({ kind: "neutral-count", owner: key, word: w, b, l, r });
        bounds = [Math.max(0, l + r - b), l + r];
      } else {
        bounds = countBounds(b, l, r);
      }
      if (!bounds) {
        note({ kind: "conflict", owner: key, word: w, b, l, r });
        continue;
      }
      if (bounds[0] !== bounds[1])
        note({ kind: "count", owner: key, word: w, b, l, r, bounds });
      const [lo, hi] = bounds;
      if (g < lo)
        violations.push({
          prop: "loss",
          atom: "text",
          owner: key,
          word: w,
          b,
          l,
          r,
          got: g,
          want: lo,
          bounds,
        });
      else if (g > hi)
        violations.push({
          prop: "duplication",
          atom: "text",
          owner: key,
          word: w,
          b,
          l,
          r,
          got: g,
          want: hi,
          bounds,
        });
    }
    if (isEl) {
      const want = st.state ? 1 : 0;
      const got = G.map.has(key) ? 1 : G.dup.has(key) ? 2 : 0;
      if (got < want)
        violations.push({
          prop: "loss",
          atom: "element",
          owner: key,
          got,
          want,
          html: (B.map.get(key) || L.map.get(key) || R.map.get(key) || {})
            .outerHTML,
        });
      else if (got > want)
        violations.push({
          prop: "duplication",
          atom: "element",
          owner: key,
          got,
          want,
          html: (G.map.get(key) || {}).outerHTML,
        });
    }
  }

  // Anonymous content: unidentified elements inside an owner, down to the
  // next owner. When no input changed their structure they correspond by
  // position, so the output keeps that structure and each one's words obey
  // the three-way bounds. When an input changed it, which element should
  // receive what is not decidable from the inputs.
  const scopeChild = (side, tag) => {
    for (let k = side.scope?.firstElementChild; k; k = k.nextElementSibling)
      if (k.tagName === tag) return k;
    return null;
  };
  // Live-only head leaves (runtime tags the page carried before the merge)
  // belong in the output but come from no input, so they are not anonymous
  // content. Match each recorded leaf to one output child of its recorded parent.
  const liveExtras = new Set();
  const gHead = scopeChild(G, "HEAD");
  for (const e of L.extraLeaves || []) {
    const parent =
      e.parentCap && e.parentCap !== p.cap.head
        ? p.capToLive?.get(e.parentCap)
        : gHead;
    if (!parent || !gHead || !gHead.contains(parent)) continue;
    for (let el = parent.firstElementChild; el; el = el.nextElementSibling)
      if (!liveExtras.has(el) && !G.key(el) && el.outerHTML === e.html) {
        liveExtras.add(el);
        break;
      }
  }
  const ownerEl = (side, key) =>
    key === "(element)"
      ? side.scope
      : key === "(body)"
        ? scopeChild(side, "BODY")
        : key === "(head)"
          ? scopeChild(side, "HEAD")
          : side.map.get(key) || null;
  const kidsOf = (node) => node.content || node;
  const anonSlots = (el, side) => {
    const slots = [];
    const walk = (node) => {
      for (
        let k = kidsOf(node).firstElementChild;
        k;
        k = k.nextElementSibling
      ) {
        if (skip(k) || side.key(k) || liveExtras.has(k)) continue;
        slots.push(k);
        walk(k);
      }
    };
    walk(el);
    return slots;
  };
  const anonShape = (el, side) => {
    const walk = (node, root) => {
      const attrs = root
        ? []
        : [...node.attributes].map((a) => [a.name, a.value]).sort();
      const kids = [];
      for (let k = kidsOf(node).firstElementChild; k; k = k.nextElementSibling)
        if (!skip(k) && !side.key(k) && !liveExtras.has(k))
          kids.push(walk(k, false));
      return digest(
        JSON.stringify([node.namespaceURI, node.localName, attrs, kids]),
      );
    };
    return walk(el, true);
  };
  const textSkip = (el) =>
    skip(el) || (h.vetoAttr === "value" && el?.tagName === "TEXTAREA");
  // Whether an identified child keeps the words on either side of it apart, by the same rule as streamsFor: only when it is or holds a block.
  const separates = (n) => {
    if (BLOCK_TAGS.has(n.tagName)) return true;
    for (let k = kidsOf(n).firstElementChild; k; k = k.nextElementSibling)
      if (!textSkip(k) && separates(k)) return true;
    return false;
  };
  const slotTokens = (el, side) => {
    let text = "";
    const walk = (node) => {
      for (let n = kidsOf(node).firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) text += n.nodeValue;
        else if (n.nodeType !== 1 || skip(n)) continue;
        else if (side.key(n)) text += separates(n) ? " " : "";
        else if (BLOCK_TAGS.has(n.tagName)) {
          text += " ";
          walk(n);
          text += " ";
        } else walk(n);
      }
    };
    walk(el);
    return tokens(text);
  };
  const bagOf = (words) => {
    const m = new Map();
    for (const w of words) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const slotWords = (el, side) => bagOf(slotTokens(el, side));
  const views = [B, L, R, G];
  const anonOwners = new Set([
    ...keys,
    ...(c.shape === "element" ? ["(element)"] : ["(body)", "(head)"]),
  ]);
  for (const key of anonOwners) {
    if (
      (key === "(head)" || key === "(body)") &&
      G.key(ownerEl(G, key) || null)
    )
      continue;
    const st = states.get(key);
    if (st && (st.state !== true || st.unsettled)) continue;
    if (st && isElementOwner(key) && vetoedOwner(key)) continue;
    const els = views.map((side) => ownerEl(side, key));
    if (!els[3] || els.some((el) => el && skip(el))) continue;
    const slots = els.map((el, i) => (el ? anonSlots(el, views[i]) : []));
    if (!slots.some((s) => s.length)) continue;
    const shapes = els.map((el, i) => (el ? anonShape(el, views[i]) : null));
    const bagsOf = (i) => slots[i].map((el) => slotWords(el, views[i]));
    const sameBags = (x, y) =>
      x.length === y.length && x.every((m, i) => sameBag(m, y[i]));
    const matches = (s) =>
      shapes[3] === shapes[s] && sameBags(bagsOf(3), bagsOf(s));
    // One input decides this owner's anonymous content: a collision winner,
    // a survivor of the other side's delete, or an owner only one side has or two identical copies.
    const one = st?.source
      ? st.source === "local"
        ? 1
        : 2
      : !els[0] && els[1] && !els[2]
        ? 1
        : !els[0] && !els[1] && els[2]
          ? 2
          : !els[0] &&
              els[1] &&
              els[2] &&
              shapes[1] === shapes[2] &&
              sameBags(bagsOf(1), bagsOf(2))
            ? 1
            : 0;
    if (one) {
      if (!matches(one)) note({ kind: "anonymous", owner: key });
      continue;
    }
    if (!els[0] || !els[1] || !els[2]) {
      note({ kind: "anonymous", owner: key });
      continue;
    }
    const lMoved = shapes[1] !== shapes[0],
      rMoved = shapes[2] !== shapes[0];
    if (lMoved || rMoved) {
      // One side restructured and the other left the anonymous content as
      // base: the answer is that side's content. Anything else, or an output
      // that differs from it, is not decidable from the inputs.
      const s = lMoved && !rMoved ? 1 : rMoved && !lMoved ? 2 : 0;
      const settled =
        s > 0 && sameBags(bagsOf(s === 1 ? 2 : 1), bagsOf(0)) && matches(s);
      if (!settled) note({ kind: "anonymous", owner: key });
      continue;
    }
    if (shapes[3] !== shapes[0]) {
      const brief = (el) => (el ? el.cloneNode(false).outerHTML : "(none)");
      let at = 0;
      const most = Math.max(slots[0].length, slots[3].length);
      while (at < most && brief(slots[0][at]) === brief(slots[3][at])) at++;
      violations.push({
        prop: "anonymous-structure",
        owner: key,
        slot: at < most ? at : null,
        want:
          at < most ? brief(slots[0][at]) : "same elements, nested differently",
        got:
          at < most ? brief(slots[3][at]) : "same elements, nested differently",
        slots: [slots[0].length, slots[3].length],
      });
      continue;
    }
    slots[0].forEach((_, i) => {
      const seqs = views.map((side, j) =>
        slotTokens(slots[j][i], side).join(" "),
      );
      // Both sides changed this slot's text differently: which words the
      // output keeps depends on how the engine resolves the overlap, so
      // the slot is not decided here. Anything else is a clean merge.
      const bags = views.map((side, j) => slotWords(slots[j][i], side));
      if (seqs[1] !== seqs[0] && seqs[2] !== seqs[0] && seqs[1] !== seqs[2]) {
        note({ kind: "anonymous", owner: key, slot: i, why: "both-edited" });
        // Whatever the resolution, a slot never holds a word more times
        // than both sides' copies of it did together.
        for (const [w, g] of bags[3]) {
          if (transfer.has(key + "\u0000" + w)) continue;
          const cap = (bags[1].get(w) || 0) + (bags[2].get(w) || 0);
          if (g > cap)
            violations.push({
              prop: "duplication",
              atom: "text",
              owner: key,
              slot: i,
              word: w,
              got: g,
              bounds: [0, cap],
            });
        }
        return;
      }
      const words = new Set(bags.flatMap((m) => [...m.keys()]));
      for (const w of words) {
        if (transfer.has(key + "\u0000" + w)) continue;
        const [b, l, r, g] = bags.map((m) => m.get(w) || 0);
        const bounds = countBounds(b, l, r);
        if (!bounds) {
          note({ kind: "conflict", owner: key, slot: i, word: w });
          continue;
        }
        if (g < bounds[0] || g > bounds[1])
          violations.push({
            prop: g < bounds[0] ? "loss" : "duplication",
            atom: "text",
            owner: key,
            slot: i,
            word: w,
            b,
            l,
            r,
            got: g,
            bounds,
          });
      }
    });
  }

  for (const n of policies.notes) note(n);
  checkAttributes(c, { B, L, R, G, h, skip, p }, states, violations, note);
  checkPolicies(c, { p, h, L, G, policies }, violations);
  checkLeaves(c, B, L, R, G, skip, states, violations, note);
  return { violations, ambiguous };
}

function checkLeaves(c, B, L, R, G, skip, states, violations, note) {
  const bl = leafCounts(c, B, skip);
  const ll = leafCounts(c, L, skip);
  const rl = leafCounts(c, R, skip);
  const gl = leafCounts(c, G, skip);
  const byTag = (m) => {
    const t = new Map();
    for (const [html, n] of m) {
      const tag = tagOf(html);
      t.set(tag, (t.get(tag) || 0) + n);
    }
    return t;
  };
  const owners = new Set([
    ...bl.keys(),
    ...ll.keys(),
    ...rl.keys(),
    ...gl.keys(),
  ]);
  for (const owner of owners) {
    const st = states.get(owner);
    if (st && (st.state !== true || st.unsettled)) continue;
    const bm = bl.get(owner) || EMPTY;
    const lm = ll.get(owner) || EMPTY;
    const rm = rl.get(owner) || EMPTY;
    const gm = gl.get(owner) || EMPTY;
    const be = B.map.get(owner),
      le = L.map.get(owner),
      re = R.map.get(owner);
    const widened = !!(
      be &&
      le &&
      re &&
      carrierShape(le, L) !== carrierShape(be, B) &&
      carrierShape(re, R) !== carrierShape(be, B)
    );
    const effective = (b, l, r) => [
      b,
      st?.source === "remote" ? b : l,
      st?.source === "local" ? b : r,
    ];
    const boundsFor = (b, l, r) => {
      const [eb, el, er] = effective(b, l, r);
      return widened
        ? [Math.max(0, el + er - eb), el + er]
        : countBounds(eb, el, er);
    };
    const tb = byTag(bm),
      tl = byTag(lm),
      tr = byTag(rm),
      tg = byTag(gm);
    for (const tag of new Set([
      ...tb.keys(),
      ...tl.keys(),
      ...tr.keys(),
      ...tg.keys(),
    ])) {
      const b = tb.get(tag) || 0,
        l = tl.get(tag) || 0,
        r = tr.get(tag) || 0,
        got = tg.get(tag) || 0;
      const bounds = boundsFor(b, l, r);
      if (!bounds) continue;
      if (bounds[0] !== bounds[1])
        note({ kind: "leaf-count", owner, tag, bounds });
      const [lo, hi] = bounds;
      if (got < lo)
        violations.push({
          prop: "loss",
          atom: "element",
          owner,
          tag,
          got,
          want: lo,
          bounds,
        });
      else if (got > hi)
        violations.push({
          prop: "duplication",
          atom: "element",
          owner,
          tag,
          got,
          want: hi,
          bounds,
        });
    }
    const baseTags = new Set([...tb.keys()]);
    for (const html of new Set([
      ...bm.keys(),
      ...lm.keys(),
      ...rm.keys(),
      ...gm.keys(),
    ])) {
      if ((bm.get(html) || 0) !== 0) continue;
      if (baseTags.has(tagOf(html))) continue;
      const l = lm.get(html) || 0,
        r = rm.get(html) || 0;
      if (l > 0 && r > 0) continue;
      if (l === 0 && r === 0) continue;
      const bounds = boundsFor(0, l, r);
      if (!bounds) continue;
      if (bounds[0] !== bounds[1])
        note({ kind: "leaf-count", owner, html, bounds });
      const [lo, hi] = bounds;
      const got = gm.get(html) || 0;
      if (got < lo)
        violations.push({
          prop: "loss",
          atom: "element",
          owner,
          html,
          got,
          want: lo,
          bounds,
        });
      else if (got > hi)
        violations.push({
          prop: "duplication",
          atom: "element",
          owner,
          html,
          got,
          want: hi,
          bounds,
        });
    }
  }
}

function declarations(text) {
  const result = new Map();
  let quote = null,
    depth = 0,
    escaped = false,
    start = 0;
  const put = (chunk) => {
    if (!chunk.trim()) return true;
    const at = chunk.indexOf(":");
    if (at < 1) return false;
    const name = chunk.slice(0, at).trim();
    result.set(
      name.startsWith("--") ? name : name.toLowerCase(),
      chunk.slice(at + 1).trim(),
    );
    return true;
  };
  const value = text || "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) return null;
    if (ch === ";" && depth === 0) {
      if (!put(value.slice(start, i))) return null;
      start = i + 1;
    }
  }
  if (quote || depth || escaped || !put(value.slice(start))) return null;
  return result;
}

/** The policy promises, verified against the frozen pre-merge records: an
 * ignored root keeps its own node, html and parent; a vetoed morph/remove
 * keeps its node, attributes and (when the region was fully certified) its
 * members; a vetoed add never appears; a live property a hook or a full
 * region protects survives an attribute sync that cannot see it. */
function checkPolicies(c, view, violations) {
  const { p, h, G, policies } = view;
  const scope = new Set(allElements(G.scope));
  const protectedBy = new Map();
  const protect = (frozen, key) => {
    for (const m of frozen.members)
      if (!protectedBy.has(m)) protectedBy.set(m, key);
  };
  const membersUnchanged = (chk, prop, extra = {}) => {
    for (const member of chk.frozen.members) {
      if (member === chk.live) continue;
      const before = p.preMerge.get(member);
      if (
        scope.has(member) &&
        member.parentNode === before.parent &&
        member.nextSibling === before.nextSibling
      )
        continue;
      violations.push({
        prop,
        ...extra,
        owner: chk.key,
        why: "member",
        want: chk.frozen.html,
        got: member.outerHTML,
      });
    }
  };
  for (const chk of policies.checks) {
    const { kind, key, frozen } = chk;
    if (kind === "ignore") {
      protect(frozen, key);
      if (c.shape === "pure") continue;
      if (!scope.has(chk.live))
        violations.push({
          prop: "ignored-changed",
          owner: key,
          want: frozen.html,
          got: null,
        });
      else if (chk.live.parentNode !== frozen.parent)
        violations.push({
          prop: "ignored-changed",
          owner: key,
          want: frozen.html,
          got: chk.live.outerHTML,
          moved: true,
        });
      else if (chk.live.outerHTML !== frozen.html)
        violations.push({
          prop: "ignored-changed",
          owner: key,
          want: frozen.html,
          got: chk.live.outerHTML,
        });
      membersUnchanged(chk, "ignored-changed");
      continue;
    }
    if (kind === "veto-add") {
      for (const added of chk.newKeys)
        if (G.present.has(added))
          violations.push({ prop: "veto-added", owner: key, got: added });
      continue;
    }
    if (kind !== "veto-morph" && kind !== "veto-remove") continue;
    const { live } = chk;
    if (!scope.has(live)) {
      violations.push({
        prop: "veto-changed",
        kind,
        owner: key,
        why: "detached",
        want: frozen.html,
        got: null,
      });
      continue;
    }
    for (const name of new Set([...frozen.attrs.keys(), ...attrNames(live)])) {
      const want = frozen.attrs.get(name) ?? null;
      const got = live.getAttribute(name);
      if (got !== want)
        violations.push({
          prop: "veto-changed",
          kind,
          owner: key,
          attr: name,
          want,
          got,
        });
    }
    if (!chk.full) continue;
    protect(frozen, key);
    if (live.outerHTML !== frozen.html)
      violations.push({
        prop: "veto-changed",
        kind,
        owner: key,
        why: "html",
        want: frozen.html,
        got: live.outerHTML,
      });
    membersUnchanged(chk, "veto-changed", { kind });
  }
  for (const [el, frozen] of p.preMerge) {
    if (!frozen.props.size || !scope.has(el)) continue;
    const owner = protectedBy.get(el);
    const vetoAttr = h.vetoAttr && frozen.props.has(h.vetoAttr);
    if (owner === undefined && !vetoAttr) continue;
    for (const [name, want] of frozen.props) {
      const gated =
        name === h.vetoAttr ||
        (name === "textContent" &&
          h.vetoAttr === "value" &&
          el.tagName === "TEXTAREA");
      if (!gated && owner === undefined) continue;
      const got = el[name];
      if (got !== want)
        violations.push({
          prop: "live-property",
          owner: owner ?? null,
          property: name,
          attr: gated ? h.vetoAttr : null,
          selectors: [...frozen.selectors],
          want,
          got,
        });
    }
  }
}

function checkAttributes(c, view, states, violations, note) {
  const { B, L, R, G, h, skip, p } = view;
  const visited = new Set();
  const attrCheck = (bEl, lEl, rEl, gEl, owner) => {
    if (!gEl || [bEl, lEl, rEl, gEl].some((el) => el && skip(el))) return;
    const frozen = lEl ? p?.preMerge.get(p.capToLive.get(lEl)) : undefined;
    const names = new Set([bEl, lEl, rEl, gEl].flatMap(attrNames));
    if (frozen) for (const name of frozen.attrs.keys()) names.add(name);
    for (const name of names) {
      if (name === "sid") continue;
      const b = attrValue(bEl, name),
        l = attrValue(lEl, name),
        r = attrValue(rEl, name),
        got = attrValue(gEl, name);
      const live = frozen ? (frozen.attrs.get(name) ?? null) : l;
      const protectedRoot =
        c.shape === "element" && c.options.children && lEl === L.scope;
      const bypasses =
        !!bEl &&
        !!lEl &&
        !!rEl &&
        !h.morph &&
        bEl.outerHTML === lEl.outerHTML &&
        rEl.outerHTML === lEl.outerHTML &&
        !(FORM_STATE.has(name) && FORM_TAGS.has(lEl.tagName));
      if (protectedRoot || h.vetoAttr === name || bypasses) {
        if (got !== live)
          violations.push({
            prop: "attr",
            owner,
            attr: name,
            got,
            want: live,
            protected: true,
          });
        continue;
      }
      const resolve = (x, y, z) => {
        const merged = three(x, y, z);
        return merged === undefined
          ? c.options.conflicts === "local"
            ? y
            : z
          : merged;
      };
      if (name === "class") {
        const sets = [b, l, r, got].map((v) => new Set(tokens(v || "")));
        for (const value of new Set(sets.flatMap((s) => [...s]))) {
          const want = three(
            sets[0].has(value),
            sets[1].has(value),
            sets[2].has(value),
          );
          if (sets[3].has(value) !== want)
            violations.push({
              prop: "attr",
              owner,
              attr: name,
              token: value,
              got: sets[3].has(value),
              want,
            });
        }
      } else if (name === "style") {
        const maps = [b, l, r, got].map(declarations);
        if (maps.some((m) => m === null)) {
          note({ kind: "style-syntax", owner });
          continue;
        }
        for (const property of new Set(maps.flatMap((m) => [...m.keys()]))) {
          const values = maps.map((m) => m.get(property) ?? null);
          const want = resolve(...values.slice(0, 3));
          if (values[3] !== want)
            violations.push({
              prop: "attr",
              owner,
              attr: name,
              property,
              got: values[3],
              want,
            });
        }
      } else {
        const want = resolve(b, l, r);
        if (got !== want)
          violations.push({
            prop: "attr",
            owner,
            attr: name,
            b,
            l,
            r,
            got,
            want,
          });
      }
    }
  };
  const walk = (b, l, r, g, owner) => {
    if (!l || visited.has(l)) return;
    visited.add(l);
    if ([b, l, r, g].some((el) => el && skip(el))) return;
    attrCheck(b, l, r, g, owner);
  };
  for (const [key, l] of L.map) {
    const st = states.get(key);
    if (st?.state !== true) continue;
    const b = B.map.get(key),
      r = R.map.get(key),
      g = G.map.get(key);
    if (st.collision) {
      const winner = st.source === "local" ? l : r;
      attrCheck(winner, winner, winner, g, key);
      continue;
    }
    if (st.unsettled) {
      visited.add(l);
      note({ kind: "collision", owner: key });
      continue;
    }
    if (r) walk(b, l, r, g, key);
    else if (g) attrCheck(l, l, l, g, key);
  }
  for (const [key, r] of R.map)
    if (!L.map.has(key) && states.get(key)?.state === true && G.map.has(key))
      attrCheck(r, r, r, G.map.get(key), key);
  if (B.scope && L.scope && R.scope && !visited.has(L.scope))
    walk(B.scope, L.scope, R.scope, G.scope, "(scope)");
}

const shapeMemo = new WeakMap();
const memoShape = (kind, fn) => (el, side) => {
  if (!el) return "";
  let bySide = shapeMemo.get(side);
  if (!bySide)
    shapeMemo.set(
      side,
      (bySide = { carrier: new WeakMap(), text: new WeakMap() }),
    );
  const m = bySide[kind];
  if (!m.has(el)) m.set(el, fn(el, side));
  return m.get(el);
};

function carrierShapeRaw(el, side) {
  if (!el) return "";
  const walk = (node, root = false) => {
    if (node.nodeType === 3) return "#text";
    if (node.nodeType !== 1) return "";
    const id = !root && side.key(node);
    if (id) return JSON.stringify(["owner", id]);
    const attrs = root
      ? []
      : [...node.attributes].map((a) => [a.name, a.value]).sort();
    const children = node.content?.childNodes || node.childNodes;
    return digest(
      JSON.stringify([
        node.namespaceURI,
        node.localName,
        attrs,
        [...children].map((n) => walk(n)),
      ]),
    );
  };
  return walk(el, true);
}

function textCarrierShapeRaw(el, side) {
  if (!el) return "";
  const walk = (node, root = false) => {
    if (node.nodeType === 3) return "#text";
    if (node.nodeType !== 1) return "";
    const id = !root && side.key(node);
    if (id) return JSON.stringify(["owner", id]);
    const attrs = root
      ? []
      : [...node.attributes].map((a) => [a.name, a.value]).sort();
    const children = node.content?.childNodes || node.childNodes;
    return digest(
      JSON.stringify([
        node.namespaceURI,
        node.localName,
        attrs,
        [...children]
          .filter((n) => !(n.nodeType === 1 && !n.textContent))
          .map((n) => walk(n)),
      ]),
    );
  };
  return walk(el, true);
}

const carrierShape = memoShape("carrier", carrierShapeRaw);
const textCarrierShape = memoShape("text", textCarrierShapeRaw);
