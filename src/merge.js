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
import { merge3Text, diff } from "./text-merge.js";
import { mergeInline, isInlineUnit } from "./inline-merge.js";
import { indexByIdentity, defaultIdentity } from "./identity.js";
import { headSignature } from "./head-merge.js";
import { isHtmlScript, mergeIdentityOf } from "./scripts.js";
import { mergeScriptText } from "./hyper-morph-json-merge.js";

const isEl = (u) => !!u && u.nodeType === 1;

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

  // A weak pair (made with no content evidence) whose side element the
  // other side inserted verbatim is an echo of that insertion, not a rewrite
  // of the base element: unpaired, the two copies pair with each other and
  // the base element reads as deleted on that side.
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
    segments.push(res.segment);
    for (const n of res.nodes) el.appendChild(n);
    return el;
  }

  // ---------------------------------------------------------------------
  // Insertions: a clone of one side's unit, with provenance on every node.
  // ---------------------------------------------------------------------
  function cloneUnit(su, side) {
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
      : Lv.units.filter((u) => !Lv.baseOf(u) && !segUnits.has(u));
    const rIns = Rv.asBase
      ? []
      : Rv.units.filter((u) => !Rv.baseOf(u) && !segUnits.has(u));
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

    function mergeSegments() {
      if (
        (Lv.asBase || L.identical.has(b)) &&
        (Rv.asBase || R.identical.has(b))
      )
        return;
      const inlineOpts = { ignored, remoteWins: o.remoteWins, inlineCache };
      const isInline = (u) =>
        isEl(u) ? isInlineUnit(u, inlineOpts) : u.kind === "text";
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
        segments.push(res.segment);
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
