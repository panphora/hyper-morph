/**
 * merge.js — three-way merge of parsed HTML documents.
 *
 * merge3(base, local, remote) aligns base with each side, then builds a
 * fresh output document. Every output node records provenance (which base,
 * local and remote nodes it came from), so the apply step can keep live
 * nodes without guessing. Nothing here touches a live document.
 *
 * Rules, in the order they matter:
 *   - identity first, then content: alignment (align.js) decides which nodes
 *     correspond; this file decides what the corresponding nodes become
 *   - edits beat deletes; moves beat deletes; the order side (remote unless
 *     only local reordered) decides sibling order
 *   - insertions anchor on the nearest preceding sibling that produced output
 *   - a local insertion echoed back by remote under the same identity pairs
 *     with it and takes local's version
 *   - a block's inline content (text, formatting elements, br and img between
 *     block children) merges as one sequence (inline-merge.js): text by word,
 *     formatting per character as sets; attributes merge per name, with class
 *     and style merged as sets; executable script text is never merged by word
 */

import { createAnalyzer } from "./similarity.js";
import { align } from "./align.js";
import { merge3Text, diff, words } from "./text-merge.js";
import { mergeInline, isInlineUnit, MARK_TAGS } from "./inline-merge.js";
import { indexByIdentity, defaultIdentity } from "./identity.js";
import { headSignature } from "./head-merge.js";
import { isHtmlScript, mergeIdentityOf } from "./scripts.js";
import { mergeScriptText } from "./hyper-morph-json-merge.js";

const isEl = (u) => !!u && u.nodeType === 1;

/**
 * Blocks a paragraph split or join can produce or consume: when one side's
 * copy of such a block holds most of the words of a block or text run the
 * other tree has beside it, the two merge as one word sequence with block
 * breaks (see inline-merge.js, BREAK).
 */
const TEXT_BLOCK_TAGS = new Set(
  "P H1 H2 H3 H4 H5 H6 DIV LI DD DT BLOCKQUOTE FIGCAPTION SUMMARY ADDRESS".split(
    " ",
  ),
);
const SPLIT_SCAN_MAX = 50000;

/**
 * @typedef {object} MergeResult
 * @property {Document} doc
 * @property {WeakMap<Node, { base: any, local: any, remote: any }>} provenance
 * @property {WeakMap<Node, (n: number) => number>} textMappers
 * @property {Array<object>} decisions
 * @property {Array<object>} conflicts
 * @property {boolean} localDiverged
 * @property {Set<Node>} mergedScripts - output scripts produced by a JSON merge
 * @property {(el: Element) => string | null} remoteIdOf
 */

/**
 * @param {Document} baseDoc
 * @param {Document} localDoc
 * @param {Document} remoteDoc
 * @param {object} o
 * @param {{ base: Function, local: Function, remote: Function }} o.identity
 * @param {{ base: Function, local: Function, remote: Function }} [o.authored] - the authored part of each identity; elements whose authored identities differ never pair (default: o.identity)
 * @param {(n: Node) => boolean} o.ignored
 * @param {(el: Element) => boolean} o.remoteWins
 * @param {(el: Element, name: string) => boolean} o.ignoreAttribute
 * @param {"remote" | "local" | "both"} o.conflicts
 * @param {Array} o.mergeTags
 * @param {string} o.baseURI
 * @param {boolean} [o.localIsBase] - two-way mode: local is the base document
 * @returns {MergeResult}
 */
export function merge3(baseDoc, localDoc, remoteDoc, o) {
  const ignored = o.ignored;
  const analyzer = createAnalyzer({
    ignored,
    ignoreAttribute: o.ignoreAttribute,
  });
  const { unitsOf, meta } = analyzer;
  const baseURI = o.baseURI;

  // Head children identify by their head signature; mergeable JSON scripts by
  // their merge identity, so a content change never reads as a new script.
  const mergeOn = o.mergeTags !== null;
  const withHead = (idOf) => (el) => {
    if (mergeOn && el.tagName === "SCRIPT") {
      const m = mergeIdentityOf(el, o.mergeTags);
      if (m) return "merge:" + m.key;
    }
    if (el.parentElement && el.parentElement.tagName === "HEAD")
      return headSignature(el, baseURI);
    return idOf(el);
  };
  const idBase = withHead(o.identity.base),
    idLocal = withHead(o.identity.local),
    idRemote = withHead(o.identity.remote);
  // What keeps two elements apart in alignment: the identity the page
  // authored, never a merge key or a head signature (those pair, and a
  // changed one is a rewrite in place) and never a synthetic id.
  const authored = o.authored || o.identity;

  const rootOf = (x) => (x && x.nodeType === 9 ? x.documentElement : x);
  const bRoot = rootOf(baseDoc),
    lRoot = rootOf(localDoc),
    rRoot = rootOf(remoteDoc);
  const prof = globalThis.__hyperMorphProfile;
  let t0 = prof ? performance.now() : 0;
  const fastSel = "[id],[data-id],script,head>*";
  const fast = (fn) => (fn === defaultIdentity ? fastSel : null);
  const bIndex = indexByIdentity(bRoot, idBase, ignored, fast(o.identity.base));
  const L = o.localIsBase
    ? identityAlignment()
    : align(bRoot, lRoot, {
        analyzer,
        baseIndex: bIndex,
        sideIndex: indexByIdentity(
          lRoot,
          idLocal,
          ignored,
          fast(o.identity.local),
        ),
        baseId: authored.base,
        sideId: authored.local,
      });
  const R = align(bRoot, rRoot, {
    analyzer,
    baseIndex: bIndex,
    sideIndex: indexByIdentity(
      rRoot,
      idRemote,
      ignored,
      fast(o.identity.remote),
    ),
    baseId: authored.base,
    sideId: authored.remote,
  });
  resolveSlotEchoes(L, R);
  resolveSlotEchoes(R, L);
  splitCrossRewrites();
  demoteEchoes(L, R);
  demoteEchoes(R, L);
  if (prof) {
    prof.alignTotal = (prof.alignTotal || 0) + (performance.now() - t0);
    t0 = performance.now();
  }

  const out = bRoot.ownerDocument.implementation.createHTMLDocument("");
  const provenance = new WeakMap();
  const textMappers = new WeakMap();
  const decisions = [],
    conflicts = [];
  const mergedScripts = new Set();
  const segments = []; // inline segment records for apply (typing after the snapshot)
  const emitted = new Set(); // base units and side units that produced output
  const placed = new Set(); // base elements merged into the output
  const building = new Set(); // base elements whose output is under construction
  const inlineCache = new WeakMap(); // element -> its subtree is inline-only

  const policy = o.conflicts || "remote";
  const localDecision = (d) => decisions.push(d);
  const remoteDecision = (d) => decisions.push(d);
  const conflict = (c) => conflicts.push(c);
  const crossEcho = pairCrossEchoes();

  const html = mergeElement(
    bRoot,
    L.map.get(bRoot),
    R.map.get(bRoot),
    !!o.localIsBase,
    !!o.childrenOnly,
  );
  if (html.tagName === "HTML") out.replaceChild(html, out.documentElement);
  else out.body.appendChild(html);
  if (prof) prof.build = (prof.build || 0) + (performance.now() - t0);
  const localDiverged = o.childrenOnly
    ? !sameChildren(kidsOf(html), kidsOf(rRoot))
    : !sameElement(html, rRoot);

  return {
    doc: out,
    root: html,
    provenance,
    textMappers,
    decisions,
    conflicts,
    localDiverged,
    mergedScripts,
    segments,
    remoteIdOf: o.identity.remote,
    customIdentity: o.identity.remote !== defaultIdentity,
    L,
    R,
  };

  // A base element the other side paired only by its slot, left unpaired on
  // this side beside inserts in the same gap: when one of those inserts is
  // this side's copy of the slot's new content (the same markup, or alike
  // text), the count mismatch that kept the slot pass from pairing them was
  // an insertion elsewhere in the gap, and the copy is the element's twin.
  function resolveSlotEchoes(A, O) {
    if (!A.adopt || !O.weak || !O.weak.size) return;
    const sideId = A === L ? authored.local : authored.remote;
    for (const bk of Array.from(O.weak)) {
      if (!isEl(bk) || A.map.has(bk)) continue;
      const e = O.map.get(bk);
      if (!isEl(e)) continue;
      const bParent = bk.parentNode,
        sParent = bParent && A.map.get(bParent);
      if (!sParent) continue;
      let anchor = null;
      for (const u of unitsOf(bParent)) {
        if (u === bk) break;
        if (isEl(u) && A.map.has(u)) anchor = u;
      }
      const sAnchor = anchor ? A.map.get(anchor) : null;
      if (sAnchor && sAnchor.parentNode !== sParent) continue;
      const kb = authored.base(bk);
      let inGap = sAnchor === null,
        hit = null;
      for (const u of unitsOf(sParent)) {
        if (!isEl(u)) continue;
        if (u === sAnchor) {
          inGap = true;
          continue;
        }
        if (!inGap) continue;
        if (A.reverse.has(u)) break;
        const ks = sideId(u);
        if (
          u.tagName === e.tagName &&
          !(kb && ks && kb !== ks) &&
          (analyzer.unitHash(u) === analyzer.unitHash(e) ||
            analyzer.similar(u, e))
        ) {
          hit = u;
          break;
        }
      }
      if (hit) A.adopt(bk, hit);
    }
  }

  // A block both sides inserted (an echo) whose copies sit under parents
  // that do not correspond: one side moved the block or its neighbour, or
  // the alignment paired the containers apart. The copies pair by identical
  // markup, outermost first; the per-parent echo step handles copies under
  // one parent, and of the rest the policy side's copy lands (with both
  // copies in its provenance, so apply moves the live one there) and the
  // other is dropped, recorded as a both-moved conflict.
  function pairCrossEchoes() {
    const partner = new Map(),
      drop = new Set();
    if (o.localIsBase || !L.insertedByHash) return { partner, drop };
    const lIns = L.insertedByHash(),
      rIns = R.insertedByHash();
    if (!lIns.size || !rIns.size) return { partner, drop };
    const inlineOpts = { ignored, remoteWins: o.remoteWins, inlineCache };
    const depth = (el) => {
      let d = 0;
      for (let p = el.parentNode; p; p = p.parentNode) d++;
      return d;
    };
    const cands = [];
    // Identical inserts under different parents are one insertion only
    // with evidence: two people adding an empty paragraph, a "Done" item or
    // an <hr> in two sections made two blocks. The markup must appear once
    // on each side, and either carry real text, or sit where something
    // moved (a sibling one side moved, a block the other side deleted).
    const telling = (el) => {
      const t = el.textContent.trim();
      return t.split(/\s+/).length >= 3 || t.replace(/\s/g, "").length >= 12;
    };
    const movedBase = (b) => {
      const lt = L.map.get(b),
        rt = R.map.get(b);
      return (
        (lt && L.reverse.get(lt.parentNode) !== b.parentNode) ||
        (rt && R.reverse.get(rt.parentNode) !== b.parentNode)
      );
    };
    const unsettled = (A, O, x) => {
      for (const sib of x.parentNode.children) {
        const b = sib !== x && A.reverse.get(sib);
        if (b && movedBase(b)) return true;
      }
      const bp = A.reverse.get(x.parentNode);
      if (bp)
        for (const b of bp.children)
          if (!O.map.has(b) && !ignored(b)) return true;
      return false;
    };
    for (const [h, ls] of lIns) {
      const rs = rIns.get(h);
      if (!rs) continue;
      const unique = ls.length === 1 && rs.length === 1;
      for (const lu of ls)
        if (!isInlineUnit(lu, inlineOpts))
          cands.push([
            lu,
            rs,
            depth(lu),
            unique &&
              (telling(lu) || unsettled(L, R, lu) || unsettled(R, L, rs[0])),
          ]);
    }
    if (!cands.length) return { partner, drop };
    cands.sort((a, b) => a[2] - b[2]);
    const covered = new Set(),
      taken = new Set();
    const cover = (el) => {
      for (const d of el.querySelectorAll("*")) covered.add(d);
    };
    const baseParentOf = (A, el) => A.reverse.get(el.parentNode) || null;
    for (const [lu, rs, , crossable] of cands) {
      if (covered.has(lu)) continue;
      const bp = baseParentOf(L, lu);
      const free = (x) =>
        !taken.has(x) && !covered.has(x) && x.tagName === lu.tagName;
      const ru =
        rs.find((x) => free(x) && bp && baseParentOf(R, x) === bp) ||
        (crossable ? rs.find(free) : null);
      if (!ru) continue;
      taken.add(ru);
      cover(lu);
      cover(ru);
      if (bp && baseParentOf(R, ru) === bp) continue;
      partner.set(lu, ru);
      partner.set(ru, lu);
      drop.add(policy === "local" ? ru : lu);
    }
    return { partner, drop };
  }

  function emitCrossEcho(su, side, partner) {
    emitted.add(su);
    if (crossEcho.drop.has(su)) return null;
    emitted.add(partner);
    const lu = side === "local" ? su : partner,
      ru = side === "local" ? partner : su;
    let node;
    if (analyzer.unitHash(lu) === analyzer.unitHash(ru)) {
      node = cloneUnit(lu, "local", true);
      provenance.get(node).remote = ru;
    } else node = mergeEchoPair(lu, ru);
    conflict({
      kind: "structure",
      el: node,
      detail: "both-moved",
      base: null,
      local: lu,
      remote: ru,
    });
    localDecision({ kind: "insert", el: node, source: "both" });
    return node;
  }

  // A weak pair (made with no content evidence) whose side element the
  // other side inserted verbatim is an echo of that insertion, not a rewrite
  // of the base element: unpaired, the two copies pair with each other and
  // the base element reads as deleted on that side.
  // Both sides paired a base element with the same new block only by its
  // slot, and not the same base element: local read the block as a rewrite
  // of one paragraph, remote as a rewrite of its neighbour. It is one
  // block both inserted, and each read would land it again.
  function splitCrossRewrites() {
    if (!L.weak || !R.weak || !L.weak.size || !R.weak.size || !L.unpair) return;
    const lBy = new Map();
    for (const b of L.weak) {
      const x = L.map.get(b);
      if (isEl(b) && isEl(x)) lBy.set(analyzer.unitHash(x), b);
    }
    let any = false;
    for (const b of Array.from(R.weak)) {
      const y = R.map.get(b);
      if (!isEl(b) || !isEl(y)) continue;
      const lb = lBy.get(analyzer.unitHash(y));
      if (!lb || lb === b || !L.weak.has(lb)) continue;
      if (L.map.get(lb).tagName !== y.tagName) continue;
      L.unpair(lb);
      R.unpair(b);
      any = true;
    }
    if (any) {
      L.rematch();
      R.rematch();
    }
  }

  function demoteEchoes(A, O) {
    if (!A.weak || !A.weak.size || !O.insertedByHash) return;
    const ins = O.insertedByHash();
    if (!ins.size) return;
    let any = false;
    for (const bk of Array.from(A.weak)) {
      const su = A.map.get(bk);
      if (!su) continue;
      const list = ins.get(analyzer.unitHash(su));
      if (list && list.some((x) => x.tagName === su.tagName)) {
        A.unpair(bk);
        any = true;
      }
    }
    if (any) A.rematch();
  }

  // An element a side moved into content that merges as one sequence (or
  // out of it): merged at that destination with both sides' versions,
  // unless another destination already placed it.
  // A side's twin of a base element inside a subtree that side left
  // identical: the alignment pairs such children only on demand.
  function twinIn(A, bk) {
    if (A.map.has(bk)) return A.map.get(bk);
    const chain = [];
    for (let p = bk.parentNode; p && !A.map.has(p); p = p.parentNode)
      chain.push(p);
    const top = chain.length
      ? chain[chain.length - 1].parentNode
      : bk.parentNode;
    if (!top || !A.identical.has(top)) return null;
    A.pairIdenticalChildren(top);
    for (let i = chain.length - 1; i >= 0; i--)
      A.pairIdenticalChildren(chain[i]);
    return A.map.get(bk) || null;
  }

  function moveInto(bk, side, sideEl) {
    if (placed.has(bk) || building.has(bk)) {
      conflict({ kind: "structure", el: null, detail: "both-moved", base: bk });
      return placed.has(bk) ? null : cloneUnit(sideEl, side);
    }
    const lk = twinIn(L, bk),
      rk = twinIn(R, bk);
    if (!lk || !rk)
      conflict({
        kind: "structure",
        el: null,
        detail: "move-beats-delete",
        base: bk,
      });
    const node = mergeElement(bk, lk, rk, false);
    (side === "local" ? localDecision : remoteDecision)({
      kind: "move",
      el: node,
      source: side,
    });
    return node;
  }

  // ---------------------------------------------------------------------
  // Side views: a side that lacks an element, or a remoteWins region, reads
  // as base for content while provenance still points at the real node.
  // ---------------------------------------------------------------------
  function view(A, sideEl, bEl, asBase) {
    // A resurrected subtree hands its base nodes down as the side: they read
    // as base at every depth, not only at the level the deletion happened.
    if (asBase || !sideEl || sideEl === bEl) {
      return {
        el: bEl,
        asBase: true,
        twin: (bk) => bk,
        baseOf: (su) => su,
        units: unitsOf(bEl),
        here: () => true,
        parentOfTwin: () => bEl,
      };
    }
    return {
      el: sideEl,
      asBase: false,
      twin: (bk) => A.map.get(bk),
      baseOf: (su) => A.reverse.get(su),
      units: unitsOf(sideEl),
      here: (su) =>
        isEl(su)
          ? su.parentNode === sideEl ||
            (sideEl.tagName === "TEMPLATE" && su.parentNode === sideEl.content)
          : su.parent === sideEl ||
            (sideEl.tagName === "TEMPLATE" && su.parent === sideEl.content),
    };
  }

  function changed(bk, su, A) {
    if (!su) return false;
    if (A && A.identical.has(bk)) return false;
    if (isEl(bk)) return meta(bk).hash !== meta(su).hash;
    return bk.value !== su.value;
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------
  function mergeElement(b, l, r, localAsBase, childrenOnly = false) {
    const asBase = localAsBase || o.remoteWins(b);
    const el =
      b.namespaceURI && b.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ? out.createElementNS(b.namespaceURI, b.tagName)
        : out.createElement(b.tagName);
    const prov = { base: b, local: l || null, remote: r || null };
    provenance.set(el, prov);
    emitted.add(b);
    placed.add(b);
    if (l) emitted.add(l);
    if (r) emitted.add(r);
    // Unchanged on both sides: nothing to merge below this element. The
    // output carries the element alone, flagged, and apply leaves the live
    // subtree untouched.
    if (
      o.skipUnchanged &&
      !childrenOnly &&
      (o.localIsBase || L.identical.has(b)) &&
      r &&
      R.identical.has(b) &&
      !o.remoteWins(b)
    ) {
      prov.unchanged = true;
      for (const a of b.attributes) {
        if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, a.name, a.value);
        else el.setAttribute(a.name, a.value);
      }
      return el;
    }
    building.add(b);
    if (!childrenOnly) mergeAttrs(b, asBase ? b : l, r, el);
    const tag = b.tagName;
    if (isHtmlScript(b)) {
      mergeScriptElement(b, asBase ? b : l, r, el);
    } else if (tag === "TEXTAREA") {
      el.textContent = wholeText(
        b.textContent,
        (asBase ? b : l) ? (asBase ? b : l).textContent : b.textContent,
        r ? r.textContent : b.textContent,
        el,
        "text",
      );
    } else {
      const kids = mergeChildren(b, l, r, asBase, el);
      const target = tag === "TEMPLATE" && el.content ? el.content : el;
      for (const k of kids) target.appendChild(k);
    }
    building.delete(b);
    return el;
  }

  function wholeText(bv, lv, rv, node, kind) {
    if (lv === rv) return lv;
    if (lv === bv) {
      if (rv !== bv) remoteDecision({ kind, node, source: "remote" });
      return rv;
    }
    if (rv === bv) {
      localDecision({ kind, node, source: "local" });
      return lv;
    }
    const resolved = policy === "local" ? lv : rv;
    conflict({ kind, node, base: bv, local: lv, remote: rv, resolved });
    decisions.push({ kind, node, source: "both" });
    return resolved;
  }

  function mergeScriptElement(b, l, r, el) {
    const bt = b.textContent,
      lt = l ? l.textContent : bt,
      rt = r ? r.textContent : bt;
    const found = mergeOn ? mergeIdentityOf(b, o.mergeTags, true) : null;
    if (found && lt !== rt) {
      const keyAttr =
        (r && r.getAttribute("merge-key")) || b.getAttribute("merge-key");
      // Two-way mode has no separate base: a JSON merge then keeps local-only
      // keys rather than letting remote overwrite the whole tag.
      const { text, warnings } = mergeScriptText(
        o.localIsBase ? undefined : bt,
        lt,
        rt,
        {
          parse: found.recognizer.parse,
          keyCandidates: keyAttr
            ? keyAttr.split(/[\s,]+/).filter(Boolean)
            : undefined,
        },
      );
      for (const w of warnings)
        console.warn(`[hyper-morph] merge "${found.raw}": ${w}`);
      el.textContent = text;
      mergedScripts.add(el);
      if (text !== rt)
        localDecision({
          kind: "text",
          node: el,
          source: text === lt ? "local" : "both",
        });
      else if (text !== bt)
        remoteDecision({ kind: "text", node: el, source: "remote" });
      return;
    }
    el.textContent = wholeText(bt, lt, rt, el, "text");
  }

  // ---------------------------------------------------------------------
  // Attributes
  // ---------------------------------------------------------------------
  function mergeAttrs(b, l, r, el) {
    const names = new Map();
    for (const src of [b, l, r]) {
      if (!src) continue;
      for (const a of src.attributes)
        if (!o.ignoreAttribute(src, a.name)) names.set(a.name, a);
    }
    for (const [name, sample] of names) {
      const bv = b ? b.getAttribute(name) : null,
        lv = l ? l.getAttribute(name) : bv,
        rv = r ? r.getAttribute(name) : bv;
      let v;
      if (lv === rv) v = lv;
      else if (lv === bv) {
        v = rv;
        remoteDecision({ kind: "attr", el, name, source: "remote" });
      } else if (rv === bv) {
        v = lv;
        localDecision({ kind: "attr", el, name, source: "local" });
      } else {
        v = mergeTokenAttr(name, bv, lv, rv);
        if (v === undefined) {
          v = policy === "local" ? lv : rv;
          conflict({
            kind: "attr",
            el,
            name,
            base: bv,
            local: lv,
            remote: rv,
            resolved: v,
          });
        }
        decisions.push({ kind: "attr", el, name, source: "both" });
      }
      if (v != null) {
        if (sample.namespaceURI)
          el.setAttributeNS(sample.namespaceURI, sample.name, v);
        else el.setAttribute(name, v);
      }
    }
  }

  function mergeTokenAttr(name, bv, lv, rv) {
    if (name === "class") {
      const set = (s) => new Set((s || "").split(/\s+/).filter(Boolean));
      const B = set(bv),
        Lc = set(lv),
        Rc = set(rv);
      const outSet = new Set();
      for (const t of new Set([...B, ...Lc, ...Rc])) {
        const inB = B.has(t),
          inL = Lc.has(t),
          inR = Rc.has(t);
        if (inL === inR ? inL : inL === inB ? inR : inL) outSet.add(t);
      }
      return [...outSet].join(" ");
    }
    if (name === "style") {
      const parse = (s) => {
        const m = new Map();
        if (!s) return m;
        let depth = 0,
          quote = null,
          cur = "";
        const push = () => {
          const i = cur.indexOf(":");
          if (i > 0) m.set(cur.slice(0, i).trim(), cur.slice(i + 1).trim());
          cur = "";
        };
        for (const ch of s) {
          if (quote) {
            cur += ch;
            if (ch === quote) quote = null;
            continue;
          }
          if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
            continue;
          }
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          if (ch === ";" && depth === 0) {
            push();
            continue;
          }
          cur += ch;
        }
        if (cur.trim()) push();
        return m;
      };
      const B = parse(bv),
        Lm = parse(lv),
        Rm = parse(rv);
      const outMap = new Map();
      let hadConflict = false;
      for (const k of new Set([...B.keys(), ...Lm.keys(), ...Rm.keys()])) {
        const b = B.get(k) ?? null,
          lc = Lm.get(k) ?? null,
          rc = Rm.get(k) ?? null;
        let v;
        if (lc === rc) v = lc;
        else if (lc === b) v = rc;
        else if (rc === b) v = lc;
        else {
          v = policy === "local" ? lc : rc;
          hadConflict = true;
        }
        if (v != null) outMap.set(k, v);
      }
      if (hadConflict) return undefined;
      return [...outMap].map(([k, v]) => `${k}: ${v}`).join("; ");
    }
    return undefined;
  }

  // ---------------------------------------------------------------------
  // Text runs
  // ---------------------------------------------------------------------
  function mergeRun(bRun, lRun, rRun, lAsBase) {
    const bv = bRun.value;
    const lv = lAsBase ? bv : lRun ? lRun.value : "";
    const rv = rRun ? rRun.value : "";
    emitted.add(bRun);
    if (lRun) emitted.add(lRun);
    if (rRun) emitted.add(rRun);
    const res = merge3Text(bv, lv, rv, policy);
    const node = res.text === "" ? null : out.createTextNode(res.text);
    if (node) {
      provenance.set(node, {
        base: bRun.nodes,
        local: lRun ? lRun.nodes : null,
        remote: rRun ? rRun.nodes : null,
      });
      textMappers.set(node, res.mapLocalOffset);
    }
    if (lv !== bv && rv !== bv) {
      decisions.push({ kind: "text", node, source: "both" });
    } else if (lv !== bv)
      localDecision({ kind: "text", node, source: "local" });
    else if (rv !== bv)
      remoteDecision({ kind: "text", node, source: "remote" });
    for (const c of res.conflicts)
      conflict({
        kind: "text",
        node,
        base: bv.slice(c.bs, c.be),
        local: c.local,
        remote: c.remote,
        resolved: c.resolved,
      });
    return node;
  }

  // One text extends another when it differs by insertions alone: the shape
  // of typing carried on after a copy was taken.
  function extendsText(from, to) {
    return diff(from, to).every((h) => h.bs === h.be);
  }

  function insertedRunPair(lRun, rRun) {
    // Both sides inserted text at the same anchor with no base run.
    const lv = lRun ? lRun.value : "",
      rv = rRun ? rRun.value : "";
    let text;
    if (lv === rv || !rv) text = lv;
    else if (!lv) text = rv;
    else if (extendsText(lv, rv)) text = rv;
    else if (extendsText(rv, lv)) text = lv;
    else {
      text = policy === "local" ? lv : policy === "both" ? lv + rv : rv;
      conflict({
        kind: "structure",
        el: null,
        detail: "insert-collision",
        local: lv,
        remote: rv,
        resolved: text,
      });
    }
    if (lRun) emitted.add(lRun);
    if (rRun) emitted.add(rRun);
    if (text === "") return null;
    const node = out.createTextNode(text);
    provenance.set(node, {
      base: null,
      local: lRun ? lRun.nodes : null,
      remote: rRun ? rRun.nodes : null,
    });
    if (lv)
      localDecision({
        kind: "insert",
        el: node,
        source: rv && lv === rv ? "both" : "local",
      });
    else remoteDecision({ kind: "insert", el: node, source: "remote" });
    return node;
  }

  /**
   * Two copies of one inserted element that differ. With inline content
   * whose texts differ by insertions alone (or not at all), the copy the
   * other extends serves as base and the two merge as inline content, so
   * typing carried on after the copy and formatting added to it both land.
   * Otherwise the copies collide and the policy picks one.
   */
  function mergeEchoPair(lu, ru) {
    const inlineOpts = { ignored, remoteWins: o.remoteWins, inlineCache };
    const inline = (el) =>
      unitsOf(el).every((u) =>
        isEl(u) ? isInlineUnit(u, inlineOpts) : u.kind === "text",
      );
    let base = null;
    if (inline(lu) && inline(ru)) {
      const lt = lu.textContent,
        rt = ru.textContent;
      if (lt === rt || extendsText(rt, lt)) base = ru;
      else if (extendsText(lt, rt)) base = lu;
    }
    if (!base) {
      const fromLocal = policy === "local";
      const node = cloneUnit(
        fromLocal ? lu : ru,
        fromLocal ? "local" : "remote",
        true,
      );
      const p = provenance.get(node);
      if (fromLocal) p.remote = ru;
      else p.local = lu;
      conflict({
        kind: "structure",
        el: node,
        detail: "insert-collision",
        local: lu,
        remote: ru,
        resolved: fromLocal ? lu : ru,
      });
      return node;
    }
    const el =
      lu.namespaceURI && lu.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ? out.createElementNS(lu.namespaceURI, lu.tagName)
        : out.createElement(lu.tagName);
    mergeAttrs(null, lu, ru, el);
    provenance.set(el, { base: null, local: lu, remote: ru });
    emitted.add(lu);
    emitted.add(ru);
    const res = mergeInline({
      base: Array.from(base.childNodes),
      local: Array.from(lu.childNodes),
      remote: Array.from(ru.childNodes),
      out,
      policy,
      idOf: { local: idLocal, remote: idRemote },
      ignored,
      ignoreAttribute: o.ignoreAttribute,
      remoteWins: o.remoteWins,
      provenance,
      textMappers,
      conflicts,
      decisions,
      node: el,
    });
    segments.push(...res.segments);
    for (const n of res.nodes) el.appendChild(n);
    return el;
  }

  // ---------------------------------------------------------------------
  // Insertions: a clone of one side's unit, with provenance on every node.
  // ---------------------------------------------------------------------
  function cloneUnit(su, side, plain = false) {
    if (!plain && isEl(su)) {
      const partner = crossEcho.partner.get(su);
      if (partner) return emitCrossEcho(su, side, partner);
    }
    if (!isEl(su)) {
      if (su.value === "") return null;
      const t =
        su.kind === "comment"
          ? out.createComment(su.value)
          : out.createTextNode(su.value);
      provenance.set(t, {
        base: null,
        local: side === "local" ? su.nodes : null,
        remote: side === "remote" ? su.nodes : null,
      });
      emitted.add(su);
      return t;
    }
    const el =
      su.namespaceURI && su.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ? out.createElementNS(su.namespaceURI, su.tagName)
        : out.createElement(su.tagName);
    for (const a of su.attributes) {
      if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, a.name, a.value);
      else el.setAttribute(a.name, a.value);
    }
    provenance.set(el, {
      base: null,
      local: side === "local" ? su : null,
      remote: side === "remote" ? su : null,
    });
    emitted.add(su);
    const target = su.tagName === "TEMPLATE" && el.content ? el.content : el;
    const A = side === "local" ? L : R;
    for (const child of unitsOf(su)) {
      // A descendant of an inserted container may correspond to a base
      // node (an element moved into a new wrapper, or a wrapper whose tag
      // changed). Merge it rather than cloning it, so apply keeps the live
      // node and the other side's edits are not lost.
      const bk = isEl(child) ? A.reverse.get(child) : null;
      if (bk && placed.has(bk)) {
        // Already merged elsewhere: both sides moved it, the first place
        // wins.
        conflict({
          kind: "structure",
          el: null,
          detail: "both-moved",
          base: bk,
        });
        continue;
      }
      if (bk && !building.has(bk)) {
        const lk = L.map.get(bk) || null,
          rk = R.map.get(bk) || null;
        if (lk || rk) {
          const node = mergeElement(bk, lk, rk, false);
          if (side === "local")
            localDecision({ kind: "move", el: node, source: "local" });
          else remoteDecision({ kind: "move", el: node, source: "remote" });
          target.appendChild(node);
          continue;
        }
      }
      const c = cloneUnit(child, side);
      if (c) target.appendChild(c);
    }
    return el;
  }

  // ---------------------------------------------------------------------
  // Children
  // ---------------------------------------------------------------------
  function mergeChildren(b, l, r, localAsBase, el) {
    // Identical subtrees are paired even under a side read as base, so the
    // twins reach provenance and apply keeps the live nodes.
    if (l && L.identical.has(b)) L.pairIdenticalChildren(b);
    if (r && R.identical.has(b)) R.pairIdenticalChildren(b);
    const Lv = view(L, l, b, localAsBase);
    const Rv = view(R, r, b, false);
    const bUnits = unitsOf(b);
    const bSet = new Set(bUnits);
    const bPos = new Map();
    for (let i = 0; i < bUnits.length; i++) bPos.set(bUnits[i], i);

    // Output list with bookkeeping for anchors.
    const result = [];
    const inResult = new Set();
    const outputOfUnit = new Map(); // side/base unit -> output node
    const oInserted = new Set(); // output nodes that are O-side insertions

    // Inline segments: maximal runs of text, marks and atoms between block
    // units. A segment changed on either side merges as one flat sequence;
    // its output is one fragment that the walks below place like any other
    // unit, and every unit of the three segments anchors on it.
    const segUnits = new Set();
    const segFrags = [];
    mergeSegments();

    // Kept children on each side, in that side's order, as base indices.
    const keptOrder = (V) => {
      const idx = [];
      for (const su of V.units) {
        if (segUnits.has(su)) continue;
        const bk = V.baseOf(su);
        if (bk && bSet.has(bk)) idx.push(bPos.get(bk));
      }
      return idx;
    };
    const mono = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
    const lRe = !Lv.asBase && !mono(keptOrder(Lv)),
      rRe = !Rv.asBase && !mono(keptOrder(Rv));
    if (lRe && rRe)
      conflict({
        kind: "structure",
        el: null,
        detail: "both-reordered",
        base: b,
      });
    const O =
      rRe || !lRe
        ? {
            V: Rv,
            A: R,
            side: "remote",
            other: Lv,
            otherA: L,
            otherSide: "local",
          }
        : {
            V: Lv,
            A: L,
            side: "local",
            other: Rv,
            otherA: R,
            otherSide: "remote",
          };
    if (lRe)
      localDecision({
        kind: "move",
        el: null,
        source: rRe ? "both" : "local",
        base: b,
      });
    else if (rRe)
      remoteDecision({ kind: "move", el: null, source: "remote", base: b });

    // Step 1: pair insertions across sides (echoes), by identity then hash.
    const lIns = Lv.asBase
      ? []
      : Lv.units.filter(
          (u) => !Lv.baseOf(u) && !segUnits.has(u) && !crossEcho.partner.has(u),
        );
    const rIns = Rv.asBase
      ? []
      : Rv.units.filter(
          (u) => !Rv.baseOf(u) && !segUnits.has(u) && !crossEcho.partner.has(u),
        );
    const echo = new Map(); // remote unit -> local unit (and reverse)
    if (lIns.length && rIns.length) {
      const rById = new Map(),
        rByHash = new Map();
      for (const ru of rIns) {
        if (isEl(ru)) {
          const id = idRemote(ru);
          if (id) rById.set(id, ru);
        }
        const h = analyzer.unitHash(ru);
        if (!rByHash.has(h)) rByHash.set(h, []);
        rByHash.get(h).push(ru);
      }
      // Text runs inserted by both sides pair by anchor: the base unit of
      // the nearest preceding unit that has one (or the start).
      const anchorOf = (V, u) => {
        const i = V.units.indexOf(u);
        for (let j = i - 1; j >= 0; j--) {
          const bk = V.baseOf(V.units[j]);
          if (bk) return bk;
        }
        return "start";
      };
      const rRunsByAnchor = new Map(),
        rElsByAnchor = new Map();
      for (const ru of rIns) {
        const a = anchorOf(Rv, ru);
        if (isEl(ru)) {
          if (!rElsByAnchor.has(a)) rElsByAnchor.set(a, []);
          rElsByAnchor.get(a).push(ru);
        } else if (ru.kind === "text" && !rRunsByAnchor.has(a))
          rRunsByAnchor.set(a, ru);
      }
      for (const lu of lIns) {
        let ru = null;
        if (isEl(lu)) {
          const id = idLocal(lu);
          if (id && rById.has(id) && !echo.has(rById.get(id)))
            ru = rById.get(id);
        } else if (lu.kind === "text") {
          const c = rRunsByAnchor.get(anchorOf(Lv, lu));
          if (c && !echo.has(c)) ru = c;
        }
        if (!ru) {
          const cands = rByHash.get(analyzer.unitHash(lu));
          if (cands)
            ru =
              cands.find(
                (x) =>
                  !echo.has(x) &&
                  isEl(x) === isEl(lu) &&
                  (isEl(x) ? x.tagName === lu.tagName : x.kind === lu.kind),
              ) || null;
        }
        if (!ru && isEl(lu)) {
          // Same tag at the same anchor with alike content: one element both
          // sides inserted, edited on one of them since. Two authored ids
          // that differ name two elements, however alike.
          const la = authored.local(lu);
          const cands = (rElsByAnchor.get(anchorOf(Lv, lu)) || []).filter(
            (x) => {
              const ra = authored.remote(x);
              return (
                !echo.has(x) &&
                x.tagName === lu.tagName &&
                !(la && ra && la !== ra) &&
                analyzer.similar(lu, x)
              );
            },
          );
          if (cands.length === 1) ru = cands[0];
        }
        if (ru) {
          echo.set(ru, lu);
          echo.set(lu, ru);
        }
      }
    }

    const emitBaseKid = (bk) => {
      if (emitted.has(bk)) return outputOfUnit.get(bk) || null;
      const lk = Lv.twin(bk),
        rk = Rv.twin(bk);
      // Moved out by a side: that side's destination emits it (with the
      // other side's edits merged in), unless the destination can never be
      // built because the moves form a cycle; then it stays here.
      const lOut = lk && !Lv.asBase && !Lv.here(lk),
        rOut = rk && !Rv.asBase && !Rv.here(rk);
      if (lOut || rOut) {
        if (!lk || !rk)
          conflict({
            kind: "structure",
            el: null,
            detail: "move-beats-delete",
            base: bk,
          });
        if (!moveCycle(bk)) {
          emitted.add(bk);
          return null;
        }
        conflict({
          kind: "structure",
          el: null,
          detail: "both-moved",
          base: bk,
        });
      }
      // Deleted by a side: gone unless the other side edited it.
      if (!lk && !rk) {
        emitted.add(bk);
        remoteDecision({ kind: "remove", source: "both", base: bk });
        return null;
      }
      if (!lk && !changed(bk, rk, R)) {
        emitted.add(bk);
        localDecision({ kind: "remove", source: "local", base: bk });
        return null;
      }
      if (!rk && !changed(bk, lk, L)) {
        emitted.add(bk);
        remoteDecision({ kind: "remove", source: "remote", base: bk });
        return null;
      }
      const resurrected = !lk || !rk;
      // A side read as base still hands its real twin to provenance, so
      // apply keeps the live nodes of a remoteWins region instead of
      // rebuilding them on every frame.
      const lTwin = Lv.asBase ? L.map.get(bk) || null : lk;
      let node;
      if (isEl(bk)) node = mergeElement(bk, lTwin, rk, Lv.asBase);
      else if (bk.kind === "comment")
        node = mergeComment(bk, lTwin, rk, Lv.asBase);
      else node = mergeRun(bk, lTwin, rk, Lv.asBase);
      emitted.add(bk);
      if (node) {
        outputOfUnit.set(bk, node);
        if (lk) outputOfUnit.set(lk, node);
        if (rk) outputOfUnit.set(rk, node);
        if (resurrected) {
          conflict({
            kind: "structure",
            el: node,
            detail: "edit-beats-delete",
            base: bk,
          });
          if (!lk)
            remoteDecision({ kind: "insert", el: node, source: "remote" });
          else localDecision({ kind: "insert", el: node, source: "local" });
        }
      }
      return node;
    };

    const emitSideUnit = (su, V, A, side) => {
      // Returns the output node or null; handles kept, moved-in, echo, insertion.
      if (emitted.has(su)) return outputOfUnit.get(su) || null;
      const bk = V.baseOf(su);
      if (bk && bSet.has(bk)) {
        // Its base twin merged inline while this unit stayed outside that
        // content: the side moved it out, and it lands here.
        if (segUnits.has(bk) && !segUnits.has(su))
          return emitOutOfSegment(bk, su, side);
        return emitBaseKid(bk);
      }
      if (bk) return emitMovedIn(bk, su, side);
      const partner = echo.get(su);
      if (partner) {
        // Echoed insertion: identical copies are one insert, kept from
        // local; copies that differ collide, and the policy picks one.
        // Provenance covers both either way.
        const lu = side === "local" ? su : partner,
          ru = side === "local" ? partner : su;
        let node;
        if (isEl(lu)) {
          if (analyzer.unitHash(lu) === analyzer.unitHash(ru)) {
            node = cloneUnit(lu, "local");
            provenance.get(node).remote = ru;
          } else node = mergeEchoPair(lu, ru);
        } else node = insertedRunPair(lu, ru);
        emitted.add(lu);
        emitted.add(ru);
        if (node) {
          outputOfUnit.set(lu, node);
          outputOfUnit.set(ru, node);
          if (isEl(lu))
            localDecision({ kind: "insert", el: node, source: "both" });
        }
        return node;
      }
      const node = cloneUnit(su, side);
      if (node) {
        outputOfUnit.set(su, node);
        if (side === "local")
          localDecision({ kind: "insert", el: node, source: "local" });
        else remoteDecision({ kind: "insert", el: node, source: "remote" });
      }
      return node;
    };

    const emitOutOfSegment = (bk, su, side) => {
      let node;
      if (isEl(bk)) {
        node = moveInto(bk, side, su);
        if (node) emitted.add(su);
      } else {
        node = cloneUnit(su, side);
        emitted.add(su);
        if (node)
          (side === "local" ? localDecision : remoteDecision)({
            kind: "insert",
            el: node,
            source: side,
          });
      }
      if (node) outputOfUnit.set(su, node);
      return node;
    };

    const emitMovedIn = (bk, su, side) => {
      // su is a side unit whose base twin lives under another base parent.
      const otherA = side === "local" ? R : L;
      const otherTwin = otherA.map.get(bk);
      const myTwin = su;
      const otherParentIsHere = otherTwin
        ? isSameParent(
            otherTwin,
            side === "local" ? r : l,
            side === "local" ? R : L,
          )
        : false;
      const otherMovedElsewhere =
        otherTwin && !otherParentIsHere && !isAtBaseParent(bk, otherTwin);
      if (otherMovedElsewhere && side === O.otherSide) {
        // Both moved to different parents: the order side's destination wins.
        conflict({
          kind: "structure",
          el: null,
          detail: "both-moved",
          base: bk,
        });
        return null;
      }
      if (otherMovedElsewhere)
        conflict({
          kind: "structure",
          el: null,
          detail: "both-moved",
          base: bk,
        });
      if (!otherTwin)
        conflict({
          kind: "structure",
          el: null,
          detail: "move-beats-delete",
          base: bk,
        });
      if (building.has(bk)) {
        // Moving an ancestor into its own descendant: keep a copy here instead.
        conflict({
          kind: "structure",
          el: null,
          detail: "both-moved",
          base: bk,
        });
        const node = cloneUnit(myTwin, side);
        if (node) outputOfUnit.set(su, node);
        return node;
      }
      const node = isEl(bk)
        ? mergeElement(
            bk,
            side === "local" ? myTwin : L.map.get(bk) || null,
            side === "remote" ? myTwin : R.map.get(bk) || null,
            false,
          )
        : null;
      if (node) {
        outputOfUnit.set(bk, node);
        outputOfUnit.set(su, node);
        if (otherTwin) outputOfUnit.set(otherTwin, node);
        if (side === "local")
          localDecision({ kind: "move", el: node, source: "local" });
        else remoteDecision({ kind: "move", el: node, source: "remote" });
      }
      return node;
    };

    // Step 2: walk the order side.
    for (const su of O.V.units) {
      if (segUnits.has(su)) {
        // The order side's place for its segment: the merged fragment.
        const frag = outputOfUnit.get(su);
        if (!inResult.has(frag)) {
          result.push(frag);
          inResult.add(frag);
        }
        continue;
      }
      if (
        emitted.has(su) &&
        !(outputOfUnit.get(su) && inResult.has(outputOfUnit.get(su)))
      ) {
        const bk = O.V.baseOf(su);
        if (bk && !bSet.has(bk))
          conflict({
            kind: "structure",
            el: null,
            detail: "both-moved",
            base: bk,
          });
        continue;
      }
      const node = emitSideUnit(su, O.V, O.A, O.side);
      if (node && !inResult.has(node)) {
        result.push(node);
        inResult.add(node);
        if (!O.V.baseOf(su) && !echo.has(su) && !segUnits.has(su))
          oInserted.add(node);
      }
    }

    // A segment the order side emptied still has output when the other side
    // edited it: it goes after the nearest preceding base unit with output.
    for (const s of segFrags) {
      if (inResult.has(s.frag)) continue;
      result.splice(afterBase(s.at), 0, s.frag);
      inResult.add(s.frag);
    }

    // Other side's insertions and move-ins, anchored on the nearest preceding
    // unit of its own list that produced output here.
    if (!O.other.asBase) {
      const P = O.other,
        pSide = O.otherSide,
        pA = O.otherA;
      let anchor = null; // output node
      let insertAt = 0; // position in result for start-anchored nodes
      let pendingAfter = null;
      for (const su of P.units) {
        const existing = outputOfUnit.get(su);
        if (existing && inResult.has(existing)) {
          anchor = existing;
          pendingAfter = null;
          continue;
        }
        if (emitted.has(su)) {
          // Already produced output elsewhere: this side moved it here, the
          // order side kept or moved it somewhere else.
          const bk = P.baseOf(su);
          if (bk && !bSet.has(bk))
            conflict({
              kind: "structure",
              el: null,
              detail: "both-moved",
              base: bk,
            });
          continue;
        }
        const node = emitSideUnit(su, P, pA, pSide);
        if (!node) continue;
        let pos;
        if (pendingAfter) pos = result.indexOf(pendingAfter) + 1;
        else if (anchor) {
          pos = result.indexOf(anchor) + 1;
          if (pSide === "remote")
            while (pos < result.length && oInserted.has(result[pos])) pos++;
        } else pos = insertAt++;
        result.splice(pos, 0, node);
        inResult.add(node);
        pendingAfter = node;
      }
    }

    // Step 3: base children nobody emitted (deleted by the order side and
    // edited by the other, when the other side is read as base and has no
    // walk of its own). emitBaseKid decides between gone and resurrected.
    for (let i = 0; i < bUnits.length; i++) {
      const bk = bUnits[i];
      if (emitted.has(bk)) continue;
      const node = emitBaseKid(bk);
      if (!node) continue;
      result.splice(afterBase(i), 0, node);
    }

    return result;

    // The position after the output of the nearest base unit before index i.
    function afterBase(i) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = outputOfUnit.get(bUnits[j]);
        if (prev) {
          const k = result.indexOf(prev);
          if (k >= 0) return k + 1;
        }
      }
      return 0;
    }

    // The text blocks under this parent that a side split or joined, with
    // their twins: they merge as one word sequence with block breaks.
    // Evidence is an orphan text block (a side one with no base twin, or a
    // base one with no twin on that side) whose words are mostly held by a
    // text block or text run on the other tree in the same gap: the gap's
    // inside, or the paired blocks that bound it. A block a side moved to
    // another parent never qualifies: its destination merges it.
    function splitJoinBlocks(inline0) {
      // An inline remote-wins region inside the block is one atom of its
      // text, which the remote's copy fills.
      const plainOpts = { ignored, remoteWins: () => false };
      const inlineIn = (c) =>
        inline0(c) ||
        (isEl(c) &&
          o.remoteWins(c) &&
          MARK_TAGS.has(c.tagName) &&
          isInlineUnit(c, plainOpts));
      const textBlock = (u) =>
        isEl(u) &&
        TEXT_BLOCK_TAGS.has(u.tagName) &&
        !ignored(u) &&
        !o.remoteWins(u) &&
        unitsOf(u).every(inlineIn);
      const isText = (u) => !isEl(u) && u.kind === "text";
      let out = null;
      const tokCache = new Map();
      const tokens = (u) => {
        let t = tokCache.get(u);
        if (t) return t;
        const text = isEl(u) ? u.textContent : u.value;
        t = new Set();
        const low = text.toLowerCase();
        if (text.length > SPLIT_SCAN_MAX);
        else if (/^[\x00-\x7f]*$/.test(low))
          for (const w of low.split(/[^\p{L}\p{N}]+/u)) {
            if (w) t.add(w);
          }
        else for (const w of words(low)) if (!/^[\s\p{P}]+$/u.test(w)) t.add(w);
        tokCache.set(u, t);
        return t;
      };
      // The text with its whitespace collapsed: a piece split inside a word
      // shares no whole word with its block, only its start or its end.
      const flatText = (u) =>
        (isEl(u) ? u.textContent : u.value)
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
      // A block's words together with its twins' words: a split right at a
      // word one side changed still shows the half as part of the block.
      const famCache = new Map();
      const family = (u) => {
        let f = famCache.get(u);
        if (f) return f;
        f = new Set(tokens(u));
        const addAll = (x) => {
          if (x) for (const w of tokens(x)) f.add(w);
        };
        const bk = bSet.has(u)
          ? u
          : (!Lv.asBase && Lv.baseOf(u)) || (!Rv.asBase && Rv.baseOf(u));
        if (bk) {
          addAll(bk);
          addAll(L.map.get(bk));
          addAll(R.map.get(bk));
        }
        famCache.set(u, f);
        return f;
      };
      const holdsMost = (whole, part) => {
        const pt = tokens(part);
        const wt = family(whole);
        let n = 0;
        for (const w of pt) if (wt.has(w)) n++;
        if (pt.size && n * 2 >= pt.size) return true;
        const piece = flatText(part);
        if (!piece || piece.length > SPLIT_SCAN_MAX) return false;
        const bk = bSet.has(whole)
          ? whole
          : (!Lv.asBase && Lv.baseOf(whole)) ||
            (!Rv.asBase && Rv.baseOf(whole));
        const kin = bk ? [whole, bk, L.map.get(bk), R.map.get(bk)] : [whole];
        return kin.some((x) => {
          const t = x && flatText(x);
          return (
            !!t && t !== piece && (t.startsWith(piece) || t.endsWith(piece))
          );
        });
      };
      const add = (u) => {
        if (!out) out = new Set();
        out.add(u);
      };
      // A base block brings its twins here on both sides: they are units
      // of the same sequence.
      const addBase = (bk) => {
        add(bk);
        for (const [A, V2] of [
          [L, Lv],
          [R, Rv],
        ]) {
          if (V2.asBase) continue;
          const t = A.map.get(bk);
          if (t && V2.here(t)) add(t);
        }
      };
      // A side that kept every block of this parent as it was, and added
      // none, split and joined nothing here.
      const untouched = (V, A) =>
        V.asBase ||
        (bUnits.every(
          (u) => !isEl(u) || (A.identical.has(u) && V.here(A.map.get(u))),
        ) &&
          V.units.every((u) => !isEl(u) || V.baseOf(u)));
      if (untouched(Lv, L) && untouched(Rv, R)) return null;
      // A side that reordered the blocks here: a split or join beside the
      // move merges block by block, since the kept order is the anchor the
      // sequence needs.
      const reordered = (V) => {
        if (V.asBase) return false;
        let last = -1;
        for (const u of V.units) {
          const bk = isEl(u) ? V.baseOf(u) : null;
          if (!bk || !bSet.has(bk)) continue;
          const at = bPos.get(bk);
          if (at < last) return true;
          last = at;
        }
        return false;
      };
      if (reordered(Lv) || reordered(Rv)) return null;
      for (const [V, A] of [
        [Lv, L],
        [Rv, R],
      ]) {
        if (V.asBase || untouched(V, A)) continue;
        const su = V.units;
        const sideId = A === L ? authored.local : authored.remote;
        // Two authored identities that differ name two elements, however
        // alike their words.
        const keysAgree = (bk, sk) => {
          const kb = isEl(bk) && authored.base(bk),
            ks = isEl(sk) && sideId(sk);
          return !kb || !ks || kb === ks;
        };
        const here = (t) => !!t && (isEl(t) ? V.here(t) : su.includes(t));
        const twinHere = (bk) => {
          const t = V.twin(bk);
          return here(t) ? t : null;
        };
        // Base text blocks with no twin here on this side (deleted or moved
        // out), and side text blocks with no base twin (inserted).
        const bOrphans = bUnits.filter((u) => textBlock(u) && !V.twin(u));
        const sOrphans = su.filter((u) => textBlock(u) && !V.baseOf(u));
        const pairedHere = (u, list) =>
          list === bUnits ? !!twinHere(u) : bSet.has(V.baseOf(u));
        // The gap around index i in a list: the nearest paired units before
        // and after it, and everything strictly between them.
        const gap = (list, i) => {
          let lo = i - 1,
            hi = i + 1;
          while (lo >= 0 && !pairedHere(list[lo], list)) lo--;
          while (hi < list.length && !pairedHere(list[hi], list)) hi++;
          return {
            lo: lo >= 0 ? list[lo] : null,
            hi: hi < list.length ? list[hi] : null,
            from: lo + 1,
            to: hi,
          };
        };
        const qualify = (bk, sk) => {
          addBase(bk);
          add(sk);
        };
        for (const y of sOrphans) {
          const g = gap(su, su.indexOf(y));
          const bLo = g.lo ? V.baseOf(g.lo) : null,
            bHi = g.hi ? V.baseOf(g.hi) : null;
          const from = bLo ? bPos.get(bLo) : -1,
            to = bHi ? bPos.get(bHi) : bUnits.length;
          for (
            let i = Math.max(0, from);
            i <= Math.min(to, bUnits.length - 1);
            i++
          ) {
            const x = bUnits[i];
            if (!(textBlock(x) || isText(x))) continue;
            if (!keysAgree(x, y) || !holdsMost(x, y)) continue;
            if (isText(x)) add(y);
            else qualify(x, y);
          }
        }
        // A join or a split moves words between neighbours, and the slot
        // pass may still have paired both blocks: a twin that gained the
        // words its base neighbour holds, or lost the words its own
        // neighbour holds, joins the sequence with that neighbour.
        const nextText = (list, i, dir) => {
          for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
            const u = list[j];
            if (textBlock(u)) return u;
            if (isEl(u) || u.value.trim()) return null;
          }
          return null;
        };
        // Only words in the block's own text count as moved between
        // blocks: words inside an inline element move with that element,
        // which the structural merge pairs on its own.
        const plainTokens = (u) => {
          const t = new Set();
          for (const c of unitsOf(u))
            if (!isEl(c) && c.kind === "text")
              for (const w of tokens(c)) t.add(w);
          return t;
        };
        const gainedBy = (to, from) => {
          const ft = tokens(from),
            g = new Set();
          for (const w of plainTokens(to)) if (!ft.has(w)) g.add(w);
          return g;
        };
        const mostIn = (set, u) => {
          if (!set.size) return false;
          const t = tokens(u);
          let n = 0;
          for (const w of set) if (t.has(w)) n++;
          return n * 2 >= set.size;
        };
        for (const x of bUnits) {
          if (A.identical.has(x) || !textBlock(x)) continue;
          const y = twinHere(x);
          if (!y || !textBlock(y)) continue;
          const gained = gainedBy(y, x),
            lost = gainedBy(x, y);
          for (const dir of [-1, 1]) {
            const x2 = nextText(bUnits, bPos.get(x), dir);
            if (x2 && mostIn(gained, x2)) {
              qualify(x, y);
              addBase(x2);
            }
            const y2 = nextText(su, su.indexOf(y), dir);
            if (y2 && mostIn(lost, y2)) {
              qualify(x, y);
              const bk = V.baseOf(y2);
              if (bk) qualify(bk, y2);
              else add(y2);
            }
          }
        }
        for (const x of bOrphans) {
          const i = bPos.get(x);
          let lo = i - 1,
            hi = i + 1;
          while (lo >= 0 && !twinHere(bUnits[lo])) lo--;
          while (hi < bUnits.length && !twinHere(bUnits[hi])) hi++;
          const sLo = lo >= 0 ? twinHere(bUnits[lo]) : null,
            sHi = hi < bUnits.length ? twinHere(bUnits[hi]) : null;
          const from = sLo ? su.indexOf(sLo) : -1,
            to = sHi ? su.indexOf(sHi) : su.length;
          for (
            let j = Math.max(0, from);
            j <= Math.min(to, su.length - 1);
            j++
          ) {
            const y = su[j];
            if (!(textBlock(y) || isText(y))) continue;
            if (!keysAgree(x, y) || !holdsMost(y, x)) continue;
            addBase(x);
            if (!isText(y)) {
              const bk = V.baseOf(y);
              if (bk) qualify(bk, y);
              else add(y);
            }
          }
        }
      }
      if (!out) return null;
      // A block one side moved to another parent stays a unit of its own.
      for (const u of Array.from(out)) {
        if (!bSet.has(u)) continue;
        for (const A of [L, R]) {
          const t = A.map.get(u);
          if (
            t &&
            t.parentNode !== (A === L ? l : r) &&
            !(A === L ? Lv : Rv).asBase
          )
            out.delete(u);
        }
      }
      return out.size ? out : null;
    }

    function mergeSegments() {
      if (
        (Lv.asBase || L.identical.has(b)) &&
        (Rv.asBase || R.identical.has(b))
      )
        return;
      const inlineOpts = { ignored, remoteWins: o.remoteWins, inlineCache };
      const inline0 = (u) =>
        isEl(u) ? isInlineUnit(u, inlineOpts) : u.kind === "text";
      const blocks = splitJoinBlocks(inline0);
      const isInline = (u) => (blocks && blocks.has(u)) || inline0(u);
      const bInline = bUnits.map(isInline);
      if (!bInline.includes(true)) return;
      // A side's anchors are the blocks it kept here, in base order. Between
      // two anchors lies a stretch, and a stretch's base and side units
      // correspond as a whole, whatever blocks the side deleted or inserted
      // among them: text on both sides of a block the side deleted is one
      // run on that side, and a block it inserted splits one run in two.
      const stretchesOf = (V) => {
        const units = V.units;
        const sPos = new Map();
        for (let j = 0; j < units.length; j++) sPos.set(units[j], j);
        const anchors = [];
        let last = -1;
        for (let i = 0; i < bUnits.length; i++) {
          if (bInline[i]) continue;
          const t = V.twin(bUnits[i]);
          const j = t ? sPos.get(t) : undefined;
          if (j === undefined || j <= last || isInline(t)) continue;
          anchors.push([i, j]);
          last = j;
        }
        const list = [];
        let pb = -1,
          ps = -1;
        for (let k = 0; k <= anchors.length; k++) {
          const [nb, ns] =
            k < anchors.length ? anchors[k] : [bUnits.length, units.length];
          const st = { bLo: -1, bHi: -1, sLo: -1, sHi: -1, next: ns };
          for (let i = pb + 1; i < nb; i++)
            if (bInline[i]) {
              if (st.bLo < 0) st.bLo = i;
              st.bHi = i;
            }
          for (let j = ps + 1; j < ns; j++)
            if (isInline(units[j])) {
              if (st.sLo < 0) st.sLo = j;
              st.sHi = j;
            }
          list.push(st);
          pb = nb;
          ps = ns;
        }
        return { units, list };
      };
      const Ls = stretchesOf(Lv),
        Rs = stretchesOf(Rv);
      // A group is the base inline content that merges as one sequence: the
      // union of every stretch, on either side, that holds base text. The
      // blocks inside a group join it as atoms.
      const spans = [];
      for (const S of [Ls, Rs])
        for (const st of S.list) if (st.bLo >= 0) spans.push([st.bLo, st.bHi]);
      spans.sort((x, y) => x[0] - y[0]);
      const groups = [];
      for (const [lo, hi] of spans) {
        const g = groups[groups.length - 1];
        if (g && lo <= g.hi) g.hi = Math.max(g.hi, hi);
        else groups.push({ lo, hi });
      }
      // The side units of a group: from its first to its last stretch, the
      // side's inline units and the anchors between those stretches.
      const sideRange = (S, g) => {
        let k0 = -1,
          k1 = -1;
        for (let k = 0; k < S.list.length; k++) {
          const st = S.list[k];
          if (st.bLo < g.lo || st.bLo > g.hi) continue;
          if (k0 < 0) k0 = k;
          k1 = k;
        }
        let from = Infinity,
          to = -1;
        for (let k = k0; k >= 0 && k <= k1; k++) {
          const st = S.list[k];
          if (st.sLo >= 0) {
            from = Math.min(from, st.sLo);
            to = Math.max(to, st.sHi);
          }
          if (k < k1) {
            from = Math.min(from, st.next);
            to = Math.max(to, st.next);
          }
        }
        return to < 0 ? [] : S.units.slice(from, to + 1);
      };
      const sameUnits = (a, s) =>
        a.length === s.length &&
        a.every((u, i) => analyzer.unitHash(u) === analyzer.unitHash(s[i]));
      const isComment = (u) => !isEl(u) && u.kind === "comment";
      // The segment's nodes as they sit in the DOM: the units' nodes plus the
      // ignored elements among and beside them, which the inline merge pins.
      const nodesOf = (units) => {
        if (!units.length) return [];
        const nodeOf = (u, last) =>
          isEl(u) ? u : u.nodes[last ? u.nodes.length - 1 : 0];
        let first = nodeOf(units[0]),
          last = nodeOf(units[units.length - 1], true);
        const pin = (n) => n && isEl(n) && ignored(n);
        while (pin(first.previousSibling)) first = first.previousSibling;
        while (pin(last.nextSibling)) last = last.nextSibling;
        const out = [];
        for (let n = first; n; n = n.nextSibling) {
          out.push(n);
          if (n === last) break;
        }
        return out;
      };
      const hasPins = (nodes) => nodes.some((n) => isEl(n) && ignored(n));
      for (const g of groups) {
        const units = bUnits.slice(g.lo, g.hi + 1);
        const lu = Lv.asBase ? null : sideRange(Ls, g),
          ru = Rv.asBase ? null : sideRange(Rs, g);
        // A comment has no place in an inline sequence: such a group stays
        // on the per-unit path.
        if (
          units.some(isComment) ||
          (lu && lu.some(isComment)) ||
          (ru && ru.some(isComment))
        )
          continue;
        const lNodes = nodesOf(lu || units),
          rNodes = nodesOf(ru || units);
        if (
          (!lu || sameUnits(units, lu)) &&
          (!ru || sameUnits(units, ru)) &&
          !(lu && hasPins(lNodes))
        )
          continue;
        const res = mergeInline({
          base: nodesOf(units),
          local: lNodes,
          remote: rNodes,
          out,
          policy,
          blocks,
          L: lu ? L : baseAlignment(L, b),
          R: ru ? R : baseAlignment(R, b),
          idOf: { local: idLocal, remote: idRemote },
          ignored,
          ignoreAttribute: o.ignoreAttribute,
          remoteWins: o.remoteWins,
          mergeElement: (bk, lk, rk) => mergeElement(bk, lk, rk, false),
          cloneUnit,
          mergeAttrs,
          atomKey: analyzer.unitHash,
          moveIn: moveInto,
          provenance,
          textMappers,
          conflicts,
          decisions,
          node: el,
        });
        segments.push(...res.segments);
        const frag = out.createDocumentFragment();
        for (const n of res.nodes) frag.appendChild(n);
        for (const u of [...units, ...(lu || []), ...(ru || [])]) {
          emitted.add(u);
          segUnits.add(u);
          outputOfUnit.set(u, frag);
        }
        segFrags.push({ frag, at: g.lo });
      }
    }
  }

  // -------------------------------------------------------------------
  // localDiverged: does the output differ from remote? Compared directly,
  // so it is exact by definition: a decision the remote side already
  // carries (an echoed insert, a collision remote won, both sides
  // reordering to the same order) does not count, and one that no decision
  // records (a comment edit) does. What the merge ignores is left out on
  // both sides: ignored remote elements, the pins standing in for them in
  // the output, and ignored attributes.
  function sameElement(a, r) {
    const p = provenance.get(a);
    if (p && p.unchanged) return true;
    if (a.tagName !== r.tagName) return false;
    if (!sameAttrs(a, r)) return false;
    return sameChildren(kidsOf(a), kidsOf(r));
  }

  function kidsOf(el) {
    return el.tagName === "TEMPLATE" && el.content ? el.content : el;
  }

  function sameAttrs(a, r) {
    let n = 0;
    for (const attr of a.attributes) {
      if (o.ignoreAttribute(a, attr.name)) continue;
      n++;
      if (r.getAttribute(attr.name) !== attr.value) return false;
    }
    for (const attr of r.attributes) if (!o.ignoreAttribute(r, attr.name)) n--;
    return n === 0;
  }

  function sameChildren(a, r) {
    const A = childItems(a, (el) => {
      const p = provenance.get(el);
      return !!(p && p.pinned);
    });
    const Rr = childItems(r, ignored);
    if (A.length !== Rr.length) return false;
    for (let i = 0; i < A.length; i++) {
      const x = A[i],
        y = Rr[i];
      if (typeof x === "string" || typeof y === "string") {
        if (x !== y) return false;
      } else if (x.nodeType !== y.nodeType) return false;
      else if (x.nodeType === 1) {
        if (!sameElement(x, y)) return false;
      } else if (x.nodeValue !== y.nodeValue) return false;
    }
    return true;
  }

  // Child nodes as items: adjacent text nodes fold into one string so a
  // split the merge made does not read as a difference; skipped elements
  // vanish; comments and elements stand as they are.
  function childItems(parent, skip) {
    const items = [];
    let text = null;
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        text = text === null ? c.nodeValue : text + c.nodeValue;
        continue;
      }
      if (c.nodeType === 1 && skip(c)) continue;
      if (text !== null) {
        if (text !== "") items.push(text);
        text = null;
      }
      items.push(c);
    }
    if (text !== null && text !== "") items.push(text);
    return items;
  }

  function mergeComment(bRun, lRun, rRun, lAsBase) {
    const bv = bRun.value,
      lv = lAsBase ? bv : lRun ? lRun.value : "",
      rv = rRun ? rRun.value : "";
    emitted.add(bRun);
    if (lRun) emitted.add(lRun);
    if (rRun) emitted.add(rRun);
    const text =
      lv === rv
        ? lv
        : lv === bv
          ? rv
          : rv === bv
            ? lv
            : policy === "local"
              ? lv
              : rv;
    if (lv !== bv && rv !== bv && lv !== rv)
      conflict({
        kind: "text",
        node: null,
        base: bv,
        local: lv,
        remote: rv,
        resolved: text,
      });
    if (!lRun && !rRun) return null;
    const node = out.createComment(text);
    provenance.set(node, {
      base: bRun.nodes,
      local: lRun ? lRun.nodes : null,
      remote: rRun ? rRun.nodes : null,
    });
    return node;
  }

  /** Base counterpart of the parent a side moved `x` into, or null when x was not moved by that side. */
  function destOf(x, A) {
    const tw = A.map.get(x);
    if (!tw) return null;
    const p = isEl(tw) ? tw.parentNode : tw.parent;
    const bParent = isEl(x) ? x.parentNode : x.parent;
    if (A.map.get(bParent) === p) return null; // still under its base parent
    return A.reverse.get(p) || null; // null: an inserted container
  }

  /** True when following the moves out of `bk` leads back into `bk`. */
  function moveCycle(bk) {
    const seen = new Set([bk]);
    let cur = bk;
    for (let i = 0; i < 64; i++) {
      const d = destOf(cur, L) || destOf(cur, R);
      if (!d) return false;
      if (d === bk || (isEl(bk) && isEl(d) && bk.contains(d)) || seen.has(d))
        return true;
      seen.add(d);
      cur = d;
    }
    return true;
  }

  function isSameParent(sideUnit, sideParentEl, A) {
    if (!sideParentEl) return false;
    const p = isEl(sideUnit) ? sideUnit.parentNode : sideUnit.parent;
    return (
      p === sideParentEl ||
      (sideParentEl.tagName === "TEMPLATE" && p === sideParentEl.content)
    );
  }

  function isAtBaseParent(bk, sideTwin) {
    // True when the side twin's parent corresponds to bk's base parent.
    const bParent = isEl(bk) ? bk.parentNode : bk.parent;
    const sParent = isEl(sideTwin) ? sideTwin.parentNode : sideTwin.parent;
    const A =
      L.map.get(bParent) === sParent
        ? L
        : R.map.get(bParent) === sParent
          ? R
          : null;
    return !!A;
  }
}

/**
 * The alignment of a tree with itself, used when local is base (two-way).
 */
// A side read as base pairs each base node with itself. Under a block that
// side deleted, a base element it moved elsewhere first pairs with that
// twin instead, so the inline merge sees it moved out, not kept.
function baseAlignment(A, b) {
  if (A.map.get(b)) return identityAlignment();
  const twin = (x) => (x && x.nodeType === 1 && A.map.get(x)) || x;
  return {
    map: { get: twin, has: () => true },
    reverse: { get: (y) => A.reverse.get(y) || y, has: () => true },
    moved: new Set(),
    identical: { has: () => true },
    pairIdenticalChildren: () => {},
  };
}

function identityAlignment() {
  const self = { get: (x) => x, has: () => true };
  return {
    map: self,
    reverse: self,
    moved: new Set(),
    identical: { has: () => true },
    pairIdenticalChildren: () => {},
  };
}
