/**
 * recovery.js — the `recovery` object on every conflict record.
 *
 * A conflict names a unit (an element, a text run, a comment) or a clash
 * inside one. Recovery locates that unit in each input tree as a path into
 * the immutable tree the merge read (childNodes indexes, "content" into a
 * template), gives the text of a clash on every side with exact offsets, the
 * attribute's namespace and names, the structural placement and order on
 * each side, and whether the local operation survived. The merge emitters
 * hand in the units they already hold (`note`); everything else is derived
 * once per merge, only when a conflict was recorded, from the output tree's
 * provenance (`finish`). The live side is filled by run() after apply.
 */

import { BREAK } from "./text-merge.js";
import { MARK_TAGS, sliceHtml } from "./inline-merge.js";
import { projectSpan, orderedSpan, resolvePoint } from "./recovery-dom.js";
import { localPreserved } from "./recovery-local.js";

export const RECOVERY_VERSION = 1;

const isEl = (u) => !!u && u.nodeType === 1;
const isTemplate = (n) => isEl(n) && n.tagName === "TEMPLATE" && !!n.content;

/**
 * Path lookups into one tree. `[]` is the root; an integer indexes
 * childNodes; "content" enters a template's fragment. Memoized per node.
 * Template owners are found by one walk on the first path into content, so
 * a tree without templates never pays for it.
 */
export function pathsInto(root, owners = null, via = null) {
  const memo = new Map();
  const indexes = new Map();
  const ownerOf = (frag) => {
    if (!owners) {
      owners = new WeakMap();
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        if (isTemplate(n)) {
          owners.set(n.content, n);
          stack.push(n.content);
        }
        for (let c = n.firstChild; c; c = c.nextSibling)
          if (c.nodeType === 1) stack.push(c);
      }
    }
    return owners.get(frag) || null;
  };
  const indexIn = (parent, node) => {
    let m = indexes.get(parent);
    if (!m) {
      m = new Map();
      let i = 0;
      for (let c = parent.firstChild; c; c = c.nextSibling) m.set(c, i++);
      indexes.set(parent, m);
    }
    return m.get(node);
  };
  const pathOf = (node) => {
    if (!node) return null;
    if (via && via.has(node)) return pathOf(via.get(node));
    if (node === root) return [];
    const hit = memo.get(node);
    if (hit !== undefined) return hit;
    const parent = node.parentNode;
    let path = null;
    if (parent && parent.nodeType === 11) {
      const t = ownerOf(parent);
      const up = t ? pathOf(t) : null;
      if (up) path = up.concat(["content", indexIn(parent, node)]);
    } else if (parent) {
      const up = pathOf(parent);
      if (up) path = up.concat([indexIn(parent, node)]);
    }
    memo.set(node, path);
    return path;
  };
  const logicalParent = (node) => {
    const p = node.parentNode;
    return p && p.nodeType === 11 ? ownerOf(p) : p;
  };
  /** The path of a container as a Point addresses it: a template's content, not the template. */
  const containerPath = (c) => {
    if (c.nodeType === 11) {
      const t = ownerOf(c);
      const p = pathOf(t);
      return p ? p.concat(["content"]) : null;
    }
    const p = pathOf(c);
    return p && isTemplate(c) ? p.concat(["content"]) : p;
  };
  return { root, pathOf, logicalParent, indexIn, containerPath, ownerOf };
}

const kidsOf = (n) => (isTemplate(n) ? n.content : n);

/**
 * @param {object} ctx
 * @param {{ base: Element, local: Element, remote: Element }} ctx.roots
 * @param {object} ctx.L - base to local alignment
 * @param {object} ctx.R - base to remote alignment
 * @param {(parent: Node) => Array} ctx.unitsOf
 * @param {WeakMap} ctx.provenance
 * @param {"remote" | "local" | "both"} ctx.policy
 */
export function createRecovery(ctx) {
  const { L, R, unitsOf, provenance, policy } = ctx;
  const metas = [];
  const note = (rec, meta) => {
    metas.push([rec, meta]);
  };
  const finish = (outRoot) => (metas.length ? resolve(outRoot) : null);
  return { note, finish };

  function resolve(outRoot) {
    const P = {
      base: pathsInto(ctx.roots.base),
      local: pathsInto(ctx.roots.local),
      remote: pathsInto(ctx.roots.remote),
    };
    const A = (side) => (side === "local" ? L : R);
    // A base unit's twin on one side, read from the alignment: for a unit
    // inside a subtree that side left identical, the alignment pairs children
    // only on demand, so follow the same child positions without pairing
    // (pairing would count in stats and change the alignment for a report).
    const twin = (Al, bk) => {
      if (!bk) return null;
      if (Al.map.has(bk)) return Al.map.get(bk);
      const chain = [];
      let p = isEl(bk) ? P.base.logicalParent(bk) : bk.parent;
      for (; p && !Al.map.has(p); p = P.base.logicalParent(p)) chain.push(p);
      if (!p || !Al.identical.has(p)) return null;
      let t = Al.map.get(p);
      for (let i = chain.length - 1; i >= 0 && t; i--)
        t = kidsOf(t).childNodes[P.base.indexIn(chain[i].parentNode, chain[i])];
      if (!t) return null;
      if (isEl(bk))
        return kidsOf(t).childNodes[P.base.indexIn(bk.parentNode, bk)] || null;
      return unitsOf(t)[unitsOf(bk.parent).indexOf(bk)] || null;
    };

    // Reverse provenance: every input node an output node came from, in
    // output order, so a unit's outputs (all of them, a cycle copy included)
    // are one lookup.
    const outputs = new Map();
    const order = new Map();
    const outOwners = new WeakMap();
    let seq = 0;
    const add = (src, n) => {
      let list = outputs.get(src);
      if (!list) outputs.set(src, (list = []));
      list.push(n);
    };
    (function walk(n) {
      order.set(n, seq++);
      const p = provenance.get(n);
      if (p && !p.pinned)
        for (const v of [p.base, p.local, p.remote]) {
          if (!v) continue;
          if (Array.isArray(v)) for (const x of v) add(x, n);
          else add(v, n);
        }
      if (isTemplate(n)) {
        outOwners.set(n.content, n);
        for (let c = n.content.firstChild; c; c = c.nextSibling) walk(c);
      }
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
    })(outRoot);
    // Nodes read through an unchanged stand-in (remote subtree -> stand-in):
    // they have no output of their own and address as the stand-in's.
    const via = new Map();
    P.out = pathsInto(outRoot, outOwners, via);
    const links = {
      refs: new Map(), // ref -> output nodes
      spans: new Map(), // text side -> merged points
      anchors: new Map(), // recovery -> the output node that decides `applied`
      via,
      outOwners,
      outRoot,
      localRoot: ctx.roots.local,
    };

    // ---- units: { b, l, r }, each an element or a run, or null ----------
    const nodesOf = (u) => (isEl(u) ? [u] : u.nodes);
    const runOfNode = (node, side) => {
      const lp = P[side].logicalParent(node);
      if (!lp) return null;
      for (const u of unitsOf(lp))
        if (!isEl(u) && u.nodes.includes(node)) return u;
      return null;
    };
    const asUnit = (v, side) =>
      v == null
        ? null
        : Array.isArray(v)
          ? v.length
            ? runOfNode(v[0], side)
            : null
          : v;
    const outputsOfNodes = (nodes) => {
      const seen = new Set();
      const out = [];
      for (const n of nodes)
        for (const o of outputs.get(n) || [])
          if (!seen.has(o)) {
            seen.add(o);
            out.push(o);
          }
      return out.sort((x, y) => order.get(x) - order.get(y));
    };
    const outCache = new Map();
    const outputsOfUnit = (U) => {
      const k = U.b || U.l || U.r;
      let hit = outCache.get(k);
      if (hit) return hit;
      const nodes = [];
      for (const u of [U.b, U.l, U.r]) if (u) nodes.push(...nodesOf(u));
      hit = outputsOfNodes(nodes);
      outCache.set(k, hit);
      return hit;
    };
    const fromBase = (b) => ({ b, l: twin(L, b), r: twin(R, b) });
    const fromSide = (su, side) => {
      const b = A(side).reverse.get(su);
      if (b) return fromBase(b);
      for (const n of outputsOfNodes(nodesOf(su))) {
        const p = provenance.get(n);
        if (p && !p.base && p.local && p.remote)
          return {
            b: null,
            l: asUnit(p.local, "local"),
            r: asUnit(p.remote, "remote"),
          };
      }
      return side === "local"
        ? { b: null, l: su, r: null }
        : { b: null, l: null, r: su };
    };
    const outputUnits = new Map();
    const readOutput = (n) => {
      const p = provenance.get(n);
      if (!p || p.pinned) return null;
      const b = asUnit(p.base, "base");
      if (b) return fromBase(b);
      const l = asUnit(p.local, "local"),
        r = asUnit(p.remote, "remote");
      if (l) {
        const bl = L.reverse.get(l);
        if (bl) return fromBase(bl);
      }
      if (r) {
        const br = R.reverse.get(r);
        if (br) return fromBase(br);
      }
      return l || r ? { b: null, l, r } : null;
    };
    const fromOutput = (n) => {
      if (!outputUnits.has(n)) outputUnits.set(n, readOutput(n));
      return outputUnits.get(n);
    };

    const unitParent = (u, side) =>
      isEl(u) ? P[side].logicalParent(u) : u.parent;

    // ---- refs, one per key --------------------------------------------
    const refs = new Map();
    const refsByUnit = new Map();
    const pathsOf = (u, side) =>
      (isEl(u)
        ? [P[side].pathOf(u)]
        : u.nodes.map((n) => P[side].pathOf(n))
      ).filter(Boolean);
    const refOf = (U) => {
      const unit = U.b || U.l || U.r;
      const side = U.b ? "base" : U.l ? "local" : "remote";
      const cached = refsByUnit.get(unit);
      if (cached) return cached;
      const run = !isEl(unit);
      const first = pathsOf(unit, side)[0];
      const key = `${side[0]}:${JSON.stringify(first === undefined ? null : first)}${run ? ":run" : ""}`;
      let ref = refs.get(key);
      if (ref) {
        refsByUnit.set(unit, ref);
        return ref;
      }
      const outs = outputsOfUnit(U);
      ref = {
        key,
        nodeType: isEl(unit) ? 1 : unit.kind === "comment" ? 8 : 3,
        base: U.b ? pathsOf(U.b, "base") : [],
        local: U.l ? pathsOf(U.l, "local") : [],
        remote: U.r ? pathsOf(U.r, "remote") : [],
        merged: outs.map((n) => P.out.pathOf(n)).filter(Boolean),
        live: [],
      };
      refs.set(key, ref);
      refsByUnit.set(unit, ref);
      links.refs.set(ref, outs);
      return ref;
    };

    // ---- placements ----------------------------------------------------
    const inputSiblings = {
      base: new Map(),
      local: new Map(),
      remote: new Map(),
    };
    const outputSiblings = new Map();
    const placementIn = (u, side) => {
      const parent = unitParent(u, side);
      if (!parent || parent.nodeType !== 1) return null;
      let data = inputSiblings[side].get(parent);
      if (!data) {
        const units = unitsOf(parent);
        const ref = (x) =>
          side === "base" ? refOf(fromBase(x)) : refOf(fromSide(x, side));
        data = {
          parent: ref(parent),
          refs: units.map(ref),
          index: new Map(units.map((x, i) => [x, i])),
        };
        inputSiblings[side].set(parent, data);
      }
      const i = data.index.get(u) ?? -1;
      return {
        parent: data.parent,
        before: data.refs.slice(i + 1),
        after: data.refs.slice(0, Math.max(0, i)).reverse(),
      };
    };
    const placementOut = (n) => {
      const parent = n.parentNode;
      if (!parent) return null;
      let data = outputSiblings.get(parent);
      if (!data) {
        const lp = parent.nodeType === 11 ? outOwners.get(parent) : parent;
        const pu = lp && lp.nodeType === 1 ? fromOutput(lp) : null;
        if (!pu) return null;
        const refs = [],
          entries = [],
          index = new Map();
        for (const k of parent.childNodes) {
          const U = fromOutput(k);
          const ref = U && refOf(U);
          const after = refs.length;
          let group = refs.length - 1;
          if (ref && ref !== refs[group]) {
            refs.push(ref);
            group++;
          }
          const entry = { ref, group, after };
          entries.push(entry);
          index.set(k, entry);
        }
        let next = refs.length;
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          e.before = next;
          if (e.ref) next = e.group;
        }
        data = { parent: refOf(pu), refs, index };
        outputSiblings.set(parent, data);
      }
      const at = data.index.get(n);
      return {
        parent: data.parent,
        before: data.refs.slice(at.before),
        after: data.refs.slice(0, at.after).reverse(),
      };
    };
    const serialize = (u) => (isEl(u) ? u.outerHTML : u.value);
    const kindOf = (u) =>
      isEl(u) ? "element" : u.kind === "comment" ? "comment" : "text";

    // ---- points ------------------------------------------------------------
    const point = (path, offset) => ({ path, offset });
    const gapAt = (parent, prev, side) => {
      if (!parent) return null;
      const PS = P[side];
      let idx = 0;
      if (prev) {
        const last = isEl(prev) ? prev : prev.nodes[prev.nodes.length - 1];
        if (last.parentNode) idx = PS.indexIn(last.parentNode, last) + 1;
      }
      return point(PS.containerPath(parent), idx);
    };
    /** Where a base unit's side twin would sit: after the twin of its nearest preceding sibling. */
    const gapIn = (bk, side) => {
      const bParent = unitParent(bk, "base");
      const sParent = bParent ? twin(A(side), bParent) : null;
      if (!isEl(sParent)) return null;
      const units = unitsOf(bParent);
      let prev = null;
      for (let i = units.indexOf(bk) - 1; i >= 0 && !prev; i--) {
        const t = twin(A(side), units[i]);
        if (t && unitParent(t, side) === sParent) prev = t;
      }
      return gapAt(sParent, prev, side);
    };
    const runPoint = (u, k, edge, side) => {
      const PS = P[side];
      let cum = 0;
      for (let i = 0; i < u.nodes.length; i++) {
        const n = u.nodes[i],
          len = n.nodeValue.length,
          last = i === u.nodes.length - 1;
        if ((edge === "start" ? k < cum + len : k <= cum + len) || last)
          return point(PS.pathOf(n), Math.max(0, Math.min(k - cum, len)));
        cum += len;
      }
      return null;
    };
    const wholeSpan = (el, side) => {
      const PS = P[side];
      const f = el.firstChild,
        l = el.lastChild;
      if (f && f.nodeType === 3 && l.nodeType === 3)
        return {
          start: point(PS.pathOf(f), 0),
          end: point(PS.pathOf(l), l.nodeValue.length),
        };
      return {
        start: point(PS.pathOf(el), 0),
        end: point(PS.pathOf(el), el.childNodes.length),
      };
    };
    // A flat offset as a point in that flat's DOM: inside a text node, at
    // an atom's edge, at a block's edge, or nowhere (an empty flat).
    const rawPoint = (f, i, edge) => {
      for (const n of f.nodes)
        if (edge === "start" ? n.s <= i && i < n.e : n.s < i && i <= n.e)
          return { kind: "text", node: n.node, offset: i - n.s };
      const at = edge === "start" ? i : i - 1;
      const touching = () => {
        for (const n of f.nodes)
          if (n.s === i || n.e === i)
            return { kind: "text", node: n.node, offset: i - n.s };
        return null;
      };
      const a = f.atomAt.get(at);
      if (a) return { kind: edge === "start" ? "before" : "after", node: a.el };
      if (f.text[at] === BREAK) {
        const closing = f.marks.find((m) => m.block && m.to === at + 1);
        if (closing)
          return edge === "start"
            ? { kind: "end", node: closing.el }
            : { kind: "after", node: closing.el };
        const opening = f.marks.find((m) => m.block && m.from === at + 1);
        if (opening)
          return edge === "start"
            ? { kind: "before", node: opening.el }
            : { kind: "startOf", node: opening.el };
      }
      return touching();
    };
    const rawBoundary = (f, i) =>
      rawPoint(f, i, "end") || rawPoint(f, i, "start");
    const pointIn = (PS, pt) => {
      switch (pt.kind) {
        case "text":
          return point(PS.pathOf(pt.node), pt.offset);
        case "end":
          return point(
            PS.containerPath(pt.node),
            kidsOf(pt.node).childNodes.length,
          );
        case "startOf":
          return point(PS.containerPath(pt.node), 0);
        default: {
          const p = pt.node.parentNode;
          return point(
            PS.containerPath(p),
            PS.indexIn(p, pt.node) + (pt.kind === "after" ? 1 : 0),
          );
        }
      }
    };
    const flatPoint = (f, i, edge, side, gap) => {
      const r = rawPoint(f, i, edge);
      return r ? pointIn(P[side], r) : gap();
    };
    const mergedPoint = (M, i, edge, gap) => {
      const pieces = M.textNodes.map((t) => ({
        s: t.ms,
        e: t.me,
        start: { kind: "text", node: t.node, offset: 0 },
        end: { kind: "text", node: t.node, offset: t.me - t.ms },
      }));
      for (const [at, node] of M.atomOut)
        pieces.push({
          s: at,
          e: at + 1,
          start: { kind: "before", node },
          end: { kind: "after", node },
        });
      for (const [at, node] of M.breakOut)
        pieces.push({
          s: at,
          e: at + 1,
          start: { kind: "end", node },
          end: { kind: "after", node },
        });
      for (const p of pieces)
        if (p.start.kind === "text" && p.s < i && i < p.e)
          return { kind: "text", node: p.start.node, offset: i - p.s };
      if (edge !== "empty") {
        const hit = pieces.find((p) =>
          edge === "start" ? p.s === i : p.e === i,
        );
        if (hit) return edge === "start" ? hit.start : hit.end;
      }
      const ending = pieces.find((p) => p.e === i);
      if (ending) return ending.end;
      const starting = pieces.find((p) => p.s === i);
      if (starting) return starting.start;
      let previous = null,
        next = null;
      for (const p of pieces) {
        if (p.e <= i && (!previous || p.e > previous.e)) previous = p;
        if (p.s >= i && (!next || p.s < next.s)) next = p;
      }
      return previous ? previous.end : next ? next.start : gap();
    };
    // The same boundary as an offset in the final output's flat, `fo`:
    // the rebuild may have dropped a duplicate atom, rescued one or glued
    // a break, so the merged side is measured on what was built.
    const measure = (fo, pt) => {
      if (!pt) return null;
      if (pt.kind === "text") {
        const n = fo.nodes.find((x) => x.node === pt.node);
        return n ? n.s + Math.min(pt.offset, n.e - n.s) : null;
      }
      const a = fo.atoms.find((x) => x.el === pt.node);
      if (a) return pt.kind === "after" ? a.i + 1 : a.i;
      const m = fo.marks.find((x) => x.el === pt.node);
      if (!m) return null;
      if (
        pt.kind === "before" &&
        m.block &&
        fo.text[m.from - 1] === BREAK &&
        !fo.marks.some((other) => other.block && other.to === m.from)
      )
        return m.from - 1;
      if (pt.kind === "startOf" || pt.kind === "before") return m.from;
      return pt.kind === "end" && m.block ? m.to - 1 : m.to;
    };
    const outDesc = (fo, i, edge, fallback) => {
      for (const n of fo.nodes)
        if (edge === "start" ? n.s <= i && i < n.e : n.s < i && i <= n.e)
          return { kind: "text", node: n.node, offset: i - n.s };
      const at = edge === "start" ? i : i - 1;
      if (!fo.atomAt.has(at) && fo.text[at] !== BREAK)
        for (const n of fo.nodes)
          if (n.s === i || n.e === i)
            return { kind: "text", node: n.node, offset: i - n.s };
      const a = fo.atomAt.get(at);
      if (a) return { kind: edge === "start" ? "before" : "after", node: a.el };
      if (fo.text[at] === BREAK) {
        const closing = fo.marks.find((m) => m.block && m.to === at + 1);
        if (closing)
          return edge === "start"
            ? { kind: "end", node: closing.el }
            : { kind: "after", node: closing.el };
        const opening = fo.marks.find((m) => m.block && m.from === at + 1);
        if (opening)
          return edge === "start"
            ? { kind: "before", node: opening.el }
            : { kind: "startOf", node: opening.el };
      }
      const opening = fo.marks.find((m) => m.block && m.from === i);
      if (opening) return { kind: "startOf", node: opening.el };
      return fallback
        ? { kind: edge === "start" ? "startOf" : "end", node: fallback }
        : null;
    };
    const staticPoint = (pt) => {
      if (!pt) return null;
      if (pt.kind === "wholeStart" || pt.kind === "wholeEnd") {
        const s = wholeSpanOut(pt.node);
        return pt.kind === "wholeStart" ? s.start : s.end;
      }
      return pointIn(P.out, pt);
    };
    const wholeSpanOut = (el) => {
      const f = el.firstChild,
        l = el.lastChild;
      if (f && f.nodeType === 3 && l.nodeType === 3)
        return {
          start: point(P.out.pathOf(f), 0),
          end: point(P.out.pathOf(l), l.nodeValue.length),
        };
      return {
        start: point(P.out.pathOf(el), 0),
        end: point(P.out.pathOf(el), el.childNodes.length),
      };
    };
    /** The merged insertion point of a base unit whose output is empty. */
    const gapOut = (bk) => {
      const bParent = unitParent(bk, "base");
      const parentOut = bParent ? outputsOfUnit(fromBase(bParent))[0] : null;
      if (!parentOut) return null;
      const container = kidsOf(parentOut);
      const units = unitsOf(bParent);
      for (let i = units.indexOf(bk) - 1; i >= 0; i--) {
        const prev = outputsOfUnit(fromBase(units[i])).filter(
          (o) => o.parentNode === container,
        );
        if (prev.length) return { kind: "after", node: prev[prev.length - 1] };
      }
      return { kind: "startOf", node: parentOut };
    };
    const side = (text, start, end, fragment, span, scope) => ({
      text,
      start,
      end,
      fragment,
      span,
      scope,
    });
    const plain = (text, start, end, span, scope) =>
      side(text, start, end, text.slice(start, end), span, scope);
    const link = (textSide, start, end, scopeStart, scopeEnd) => {
      links.spans.set(textSide, { start, end, scopeStart, scopeEnd });
      return textSide;
    };

    // ---- the three record kinds -------------------------------------------
    const commentKeys = new Map();
    const counts = new Map();
    const textKey = (subject, bs, be) => {
      const prefix = `text:${subject.key}:${bs}:${be}`;
      const n = counts.get(prefix) || 0;
      counts.set(prefix, n + 1);
      return `${prefix}:${n}`;
    };

    const text = (rec, meta) => {
      let U,
        bs,
        be,
        encoding = "plain",
        base,
        local,
        remote,
        merged,
        anchor;
      const runSide = (u, k0, k1, sd, bk) => {
        if (!u) {
          const g = gapIn(bk, sd);
          return plain("", 0, 0, { start: g, end: g }, { start: g, end: g });
        }
        return plain(
          u.value,
          k0,
          k1,
          {
            start: runPoint(u, k0, k0 === k1 ? "end" : "start", sd),
            end: runPoint(u, k1, "end", sd),
          },
          {
            start: runPoint(u, 0, "start", sd),
            end: runPoint(u, u.value.length, "end", sd),
          },
        );
      };
      if (meta.site === "run") {
        const { bRun, lRun, rRun, node, c } = meta;
        U = fromBase(bRun);
        bs = c.bs;
        be = c.be;
        base = runSide(bRun, c.bs, c.be, "base", bRun);
        local = runSide(lRun, c.ls, c.le, "local", bRun);
        remote = runSide(rRun, c.rs, c.re, "remote", bRun);
        const mv = node ? node.nodeValue : "";
        const pt = (k) =>
          node ? { kind: "text", node, offset: k } : gapOut(bRun);
        merged = link(
          plain(
            mv,
            c.ms,
            c.me,
            { start: staticPoint(pt(c.ms)), end: staticPoint(pt(c.me)) },
            { start: staticPoint(pt(0)), end: staticPoint(pt(mv.length)) },
          ),
          pt(c.ms),
          pt(c.me),
          pt(0),
          pt(mv.length),
        );
        anchor = node || (gapOut(bRun) || {}).node || null;
      } else if (meta.site === "whole") {
        const el = meta.el,
          p = provenance.get(el);
        U = fromBase(p.base);
        bs = 0;
        be = rec.base.length;
        const whole = (v, src, sd) => {
          const s = wholeSpan(src, sd);
          return plain(v, 0, v.length, s, s);
        };
        base = whole(rec.base, p.base, "base");
        local = whole(rec.local, p.local, "local");
        remote = whole(rec.remote, p.remote, "remote");
        const s = wholeSpanOut(el);
        merged = link(
          plain(rec.resolved, 0, rec.resolved.length, s, s),
          { kind: "wholeStart", node: el },
          { kind: "wholeEnd", node: el },
          { kind: "wholeStart", node: el },
          { kind: "wholeEnd", node: el },
        );
        anchor = el;
      } else if (meta.site === "comment") {
        const { bRun, lRun, rRun, node } = meta;
        U = fromBase(bRun);
        bs = 0;
        be = rec.base.length;
        const one = (u, sd) => {
          if (!u) {
            const g = gapIn(bRun, sd);
            return plain("", 0, 0, { start: g, end: g }, { start: g, end: g });
          }
          const n = u.nodes[0];
          const s = {
            start: point(P[sd].pathOf(n), 0),
            end: point(P[sd].pathOf(n), u.value.length),
          };
          return plain(u.value, 0, u.value.length, s, s);
        };
        base = one(bRun, "base");
        local = one(lRun, "local");
        remote = one(rRun, "remote");
        const v = rec.resolved;
        const pt = (k) =>
          node ? { kind: "text", node, offset: k } : gapOut(bRun);
        const s = { start: staticPoint(pt(0)), end: staticPoint(pt(v.length)) };
        merged = link(
          plain(v, 0, v.length, s, s),
          pt(0),
          pt(v.length),
          pt(0),
          pt(v.length),
        );
        anchor = node || (gapOut(bRun) || {}).node || null;
      } else {
        // inline: a clash inside one flattened sequence
        const { fb, fl, fr, scope } = meta;
        const M = meta.merged;
        encoding = "html";
        U = scope.base ? fromBase(scope.base) : fromSide(scope.local, "local");
        bs = rec.bs;
        be = rec.be;
        const prevOn = (sd) => {
          const parent = scope[sd];
          for (let i = scope.at - 1; i >= 0; i--) {
            const u = scope.units[i];
            const t = sd === "base" ? u : twin(A(sd), u);
            if (t && unitParent(t, sd) === parent) return t;
          }
          return null;
        };
        const gap = (sd) => () => gapAt(scope[sd], prevOn(sd), sd);
        // A side with an atom the other side moved out of the segment: the
        // engine's flat leaves it out, the report reads the whole segment
        // (`meta.full`), the clash re-measured in it through its DOM points.
        const inline = (f, s, e, frag, sd) => {
          const pt = (r) => (r ? pointIn(P[sd], r) : gap(sd)());
          const rs = s === e ? rawBoundary(f, s) : rawPoint(f, s, "start"),
            re = s === e ? rawBoundary(f, s) : rawPoint(f, e, "end");
          const start = pt(rs);
          const span = { start, end: s === e ? start : pt(re) };
          const F = meta.full ? meta.full(sd) : null;
          if (!F)
            return side(f.text, s, e, frag, span, {
              start: pt(rawPoint(f, 0, "start")),
              end: pt(rawPoint(f, f.text.length, "end")),
            });
          const ks = rs ? measure(F, rs) : null,
            ke = re ? measure(F, re) : null;
          const S = ks === null ? 0 : ks;
          const E = Math.max(S, ke === null ? F.text.length : ke);
          const s0 = pt(rawPoint(F, 0, "start"));
          return side(F.text, S, E, sliceHtml(F, S, E), span, {
            start: s0,
            end: F.text.length ? pt(rawPoint(F, F.text.length, "end")) : s0,
          });
        };
        base = meta.synthetic
          ? null
          : inline(fb, rec.bs, rec.be, rec.base, "base");
        local = inline(fl, rec.lss, rec.lse, rec.local, "local");
        remote = inline(fr, rec.rss, rec.rse, rec.remote, "remote");
        const [ms, me] = rec.range || [0, 0];
        const fo = M.out;
        const segmentGap = () => {
          const parent = kidsOf(M.node);
          for (let i = scope.at - 1; i >= 0; i--) {
            const outs = outputsOfUnit(fromBase(scope.units[i])).filter(
              (n) => n.parentNode === parent,
            );
            if (outs.length)
              return { kind: "after", node: outs[outs.length - 1] };
          }
          for (let i = scope.at; i < scope.units.length; i++) {
            const outs = outputsOfUnit(fromBase(scope.units[i])).filter(
              (n) => n.parentNode === parent,
            );
            if (outs.length) return { kind: "before", node: outs[0] };
          }
          return { kind: "startOf", node: M.node };
        };
        if (fo.via) for (const [t, s] of fo.via) via.set(t, s);
        const Ds = mergedPoint(
            M,
            ms,
            ms === me ? "empty" : "start",
            segmentGap,
          ),
          De = ms === me ? Ds : mergedPoint(M, me, "end", segmentGap);
        const S0 = fo.text.length
            ? outDesc(fo, 0, "start", M.node)
            : segmentGap(),
          S1 = fo.text.length ? outDesc(fo, fo.text.length, "end", M.node) : S0;
        const ks = measure(fo, Ds),
          ke = measure(fo, De);
        const s = ks === null ? 0 : ks;
        const e = Math.max(s, ke === null ? fo.text.length : ke);
        merged = link(
          side(
            fo.text,
            s,
            e,
            sliceHtml(fo, s, e),
            { start: staticPoint(Ds), end: staticPoint(De) },
            { start: staticPoint(S0), end: staticPoint(S1) },
          ),
          Ds,
          De,
          S0,
          S1,
        );
        const linked = links.spans.get(merged);
        linked.flat = fo;
        if (!fo.text.length) {
          const p = staticPoint(S0);
          const resolved = resolvePoint(outRoot, p);
          const container = resolved[0],
            at = resolved[1];
          linked.empty = {
            parent:
              container.nodeType === 11 ? outOwners.get(container) : container,
            previous: container.childNodes[at - 1] || null,
            next: container.childNodes[at] || null,
          };
        }
        anchor = Ds ? Ds.node : M.node;
      }
      const subject = refOf(U);
      const localLost =
        meta.site === "whole" || meta.site === "comment"
          ? rec.resolved !== rec.local
          : policy !== "both" && rec.resolved !== rec.local;
      return {
        key:
          (meta.site === "comment" && commentKeys.get(U.b || U.l || U.r)) ||
          textKey(subject, bs, be),
        subject,
        localLost,
        anchor,
        text: {
          encoding,
          base,
          local,
          remote,
          merged,
          liveSpan: null,
          liveScope: null,
        },
      };
    };

    const attr = (rec, meta) => {
      const U = fromOutput(meta.el);
      const subject = refOf(U);
      const a = meta.sample;
      return {
        key: `attr:${subject.key}:${a.namespaceURI || ""}:${a.localName}`,
        subject,
        localLost: rec.resolved !== rec.local,
        anchor: meta.el,
        attribute: {
          namespaceURI: a.namespaceURI || null,
          localName: a.localName,
          qualifiedName: a.name,
        },
      };
    };

    const structure = (rec, meta) => {
      const detail = rec.detail;
      const U = meta.unit || fromBase(meta.subject);
      const subject = refOf(U);
      const outs = links.refs.get(subject);
      const lp = U.l ? placementIn(U.l, "local") : null;
      const rp = U.r ? placementIn(U.r, "remote") : null;
      const mp = outs.length ? placementOut(outs[0]) : null;
      let localAction,
        remoteAction,
        localLost,
        localOrder = null,
        mergedOrder = null;
      const deleted = meta.deleted;
      switch (detail) {
        case "both-reordered": {
          localAction = remoteAction = "reordered";
          const has = new Set(meta.rKept);
          const parts = meta.lKept.filter(
            (u) => has.has(u) && outputsOfUnit(fromBase(u)).length,
          );
          const at = (u) => order.get(outputsOfUnit(fromBase(u))[0]);
          localOrder = parts.map((u) => refOf(fromBase(u)));
          mergedOrder = parts
            .slice()
            .sort((x, y) => at(x) - at(y))
            .map((u) => refOf(fromBase(u)));
          localLost = localOrder.some((r, i) => r !== mergedOrder[i]);
          break;
        }
        case "both-moved":
          localAction = remoteAction = "moved";
          localLost =
            !lp ||
            !outs.some((n) => {
              const pl = n === outs[0] ? mp : placementOut(n);
              return pl && pl.parent === lp.parent;
            });
          break;
        case "edit-beats-delete":
          localAction = deleted === "local" ? "deleted" : "edited";
          remoteAction = deleted === "remote" ? "deleted" : "edited";
          localLost = deleted === "local";
          break;
        case "move-beats-delete":
          localAction = deleted === "local" ? "deleted" : "moved";
          remoteAction = deleted === "remote" ? "deleted" : "moved";
          localLost = deleted === "local";
          break;
        default:
          localAction = remoteAction = "inserted";
          localLost = meta.localLost;
      }
      return {
        key: `structure:${subject.key}:${detail}`,
        subject,
        localLost,
        anchor: outs[0] || null,
        structure: {
          localAction,
          remoteAction,
          localPlacement: lp,
          remotePlacement: rp,
          mergedPlacement: mp,
          localOrder,
          mergedOrder,
          localFragment:
            detail === "both-reordered" || !U.l ? null : serialize(U.l),
          fragmentKind: kindOf(U.b || U.l || U.r),
        },
      };
    };

    for (const [rec, meta] of metas) {
      if (rec.kind !== "structure") continue;
      const U = meta.unit || fromBase(meta.subject);
      const unit = U.b || U.l || U.r;
      if (!isEl(unit) && unit.kind === "comment")
        commentKeys.set(unit, `structure:${refOf(U).key}:${rec.detail}`);
    }

    const byKey = new Map();
    for (const [rec, meta] of metas) {
      if (rec.kind === "structure") {
        const subject = refOf(meta.unit || fromBase(meta.subject));
        const key = `structure:${subject.key}:${rec.detail}`;
        const previous = byKey.get(key);
        if (previous && previous.structure) {
          rec.recovery = previous;
          const outs = links.refs.get(subject);
          if (rec.el == null && outs.length)
            rec.el = isEl(outs[0]) ? outs[0] : P.out.logicalParent(outs[0]);
          continue;
        }
      }
      const built =
        rec.kind === "text"
          ? text(rec, meta)
          : rec.kind === "attr"
            ? attr(rec, meta)
            : structure(rec, meta);
      let rv = byKey.get(built.key);
      if (!rv) {
        rv = {
          version: RECOVERY_VERSION,
          key: built.key,
          localLost: built.localLost,
          subject: built.subject,
          applied: false,
          unavailable: null,
        };
        byKey.set(built.key, rv);
        links.anchors.set(rv, built.anchor);
      }
      if (built.text) rv.text = built.text;
      if (built.attribute) rv.attribute = built.attribute;
      if (built.structure) rv.structure = built.structure;
      if (built.text) rv.localLost = built.localLost;
      rec.recovery = rv;
      const outs = links.refs.get(built.subject);
      if (rec.kind === "structure" && rec.el == null && outs.length)
        rec.el = isEl(outs[0]) ? outs[0] : P.out.logicalParent(outs[0]);
      if (
        rec.kind === "text" &&
        rec.node == null &&
        outs.length &&
        built.subject.nodeType === 8
      )
        rec.node = outs[0];
    }
    return links;
  }
}

/**
 * After apply: fill every ref's live nodes, the text spans' live endpoints,
 * and whether the conflict's output reached the live DOM. `lookup(m)` maps an
 * output node to its live node (or the live nodes of a run left split).
 */
export function resolveLive(conflicts, links, o) {
  if (!links) return;
  const { lookup, vetoed, vetoedAttrs, liveAttr } = o;
  const ignored = o.ignored || (() => false);
  const livePaths = pathsInto(o.liveRoot);
  const contained = (n) => !!n && livePaths.containerPath(n) !== null;
  const parentOut = (n) => {
    const p = n.parentNode;
    return p && p.nodeType === 11 ? links.outOwners.get(p) || null : p;
  };
  const vetoedAbove = (m) => {
    for (let x = m; x; x = parentOut(x)) {
      if (links.via.has(x)) x = links.via.get(x);
      if (vetoed.has(x)) return true;
      if (o.vetoedLive?.has(one(x))) return true;
    }
    return false;
  };
  // A node read through an unchanged stand-in has no output of its own.
  // Apply kept the live subtree (or filled a copy from the remote twin), and
  // the merge called the two identical: the same element positions, ignored
  // elements aside, lead to it, and a text node is the live text run between
  // its neighbouring elements, which the live DOM may hold split.
  const elements = (c) =>
    Array.from(kidsOf(c).children).filter((x) => !ignored(x));
  const counterpart = (lc, n) =>
    elements(lc)[elements(n.parentNode).indexOf(n)];
  const textRun = (lc, t) => {
    let pe = null,
      ne = null,
      lead = 0;
    for (let x = t.previousSibling; x; x = x.previousSibling) {
      if (x.nodeType === 1 && !ignored(x)) {
        pe = x;
        break;
      }
      if (x.nodeType === 3) lead += x.nodeValue.length;
    }
    for (let x = t.nextSibling; x && !ne; x = x.nextSibling)
      if (x.nodeType === 1 && !ignored(x)) ne = x;
    const from = pe ? counterpart(lc, pe) : null,
      to = ne ? counterpart(lc, ne) : null;
    if ((pe && !from) || (ne && !to)) return null;
    const nodes = [];
    for (
      let x = from ? from.nextSibling : kidsOf(lc).firstChild;
      x && x !== to;
      x = x.nextSibling
    )
      if (x.nodeType === 3) nodes.push(x);
    return nodes.length ? { nodes, lead } : null;
  };
  const virtual = (n) => {
    const chain = [];
    let x = n;
    for (; x && !links.via.has(x); x = x.parentNode) chain.push(x);
    if (!x || !chain.length) return null;
    let lv = one(links.via.get(x));
    for (let i = chain.length - 1; i > 0 && lv; i--)
      lv = counterpart(lv, chain[i]);
    if (!lv) return null;
    const t = chain[0];
    if (t.nodeType === 3) return textRun(lv, t);
    const el = t.nodeType === 1 ? counterpart(lv, t) : null;
    return el ? { nodes: [el], lead: 0 } : null;
  };
  const find = (m) => {
    const v = lookup(m);
    const result = v
      ? { nodes: Array.isArray(v) ? v : [v], lead: 0 }
      : links.via.size
        ? virtual(m)
        : null;
    if (!result) return null;
    const nodes = result.nodes.filter(contained);
    return nodes.length ? { nodes, lead: result.lead } : null;
  };
  const one = (m) => {
    const f = find(m);
    return f ? f.nodes[0] : null;
  };
  const livePoint = (pt) => {
    if (!pt) return null;
    if (pt.kind === "text") {
      const f = find(pt.node);
      if (!f) return null;
      const run = f.nodes,
        off = pt.offset + f.lead;
      let cum = 0;
      for (let i = 0; i < run.length; i++) {
        const len = run[i].nodeValue.length;
        if (off <= cum + len || i === run.length - 1)
          return off >= cum && off <= cum + len ? [run[i], off - cum] : null;
        cum += len;
      }
      return null;
    }
    const el = one(pt.node);
    if (!el) return null;
    if (pt.kind === "end") return [kidsOf(el), kidsOf(el).childNodes.length];
    if (pt.kind === "startOf") return [kidsOf(el), 0];
    if (pt.kind === "wholeStart")
      return el.firstChild ? [el.firstChild, 0] : [el, 0];
    if (pt.kind === "wholeEnd")
      return el.lastChild
        ? [el.lastChild, el.lastChild.nodeValue.length]
        : [el, el.childNodes.length];
    const parent = el.parentNode;
    if (!parent) return null;
    const idx = Array.prototype.indexOf.call(parent.childNodes, el);
    return [parent, pt.kind === "after" ? idx + 1 : idx];
  };
  const projectionOptions = (sp) => ({
    blocks: new Set(
      (sp.flat?.marks || [])
        .filter((m) => m.block)
        .map((m) => one(m.el))
        .filter(Boolean),
    ),
    atoms: new Set(
      (sp.flat?.atoms || []).map((a) => one(a.el)).filter(Boolean),
    ),
    ignored,
  });
  const provesText = (ls, scope, text, sp) => {
    if (!ls || !scope || !orderedSpan(ls) || !orderedSpan(scope)) return false;
    for (const s of [ls, scope])
      if (!contained(s.startContainer) || !contained(s.endContainer))
        return false;
    const M = text.merged;
    if (
      M.start === M.end &&
      (ls.startContainer !== ls.endContainer || ls.startOffset !== ls.endOffset)
    )
      return false;
    const options = projectionOptions(sp);
    return (
      projectSpan(scope, text.encoding, options) === M.text &&
      projectSpan(ls, text.encoding, options) === M.text.slice(M.start, M.end)
    );
  };
  const indexCache = new Map();
  const indexOf = (n) => {
    const parent = n.parentNode;
    if (!parent) return -1;
    if (!indexCache.has(parent))
      indexCache.set(
        parent,
        new Map(Array.from(parent.childNodes, (x, i) => [x, i])),
      );
    return indexCache.get(parent).get(n);
  };
  const inPlacement = (node, placement) => {
    if (!placement) return false;
    const parent = livePaths.logicalParent(node);
    if (!placement.parent.live.includes(parent)) return false;
    const at = indexOf(node);
    for (const [name, direction] of [
      ["before", 1],
      ["after", -1],
    ]) {
      let last = at;
      for (const ref of placement[name]) {
        if (ref.live.includes(node)) continue;
        const anchors = ref.live.filter(
          (n) => n !== node && n.parentNode === node.parentNode,
        );
        if (!anchors.length) continue;
        const index =
          direction === 1
            ? Math.min(...anchors.map(indexOf))
            : Math.max(...anchors.map(indexOf));
        if (direction * (index - last) <= 0) return false;
        last = index;
      }
    }
    return true;
  };
  const provesStructure = (rv) => {
    const st = rv.structure;
    if (st.mergedOrder) {
      const parents = new Set(rv.subject.live.map(kidsOf));
      let parent = null,
        last = -1;
      for (const ref of st.mergedOrder) {
        const n = ref.live.find((x) => parents.has(x.parentNode));
        if (!n || (parent && n.parentNode !== parent) || indexOf(n) <= last)
          return false;
        parent = n.parentNode;
        last = indexOf(n);
      }
      return rv.subject.live.length > 0;
    }
    return rv.subject.live.some((n) => inPlacement(n, st.mergedPlacement));
  };
  const liveSpan = (s, e) => {
    const a = livePoint(s),
      b = livePoint(e);
    return a && b
      ? {
          startContainer: a[0],
          startOffset: a[1],
          endContainer: b[0],
          endOffset: b[1],
        }
      : null;
  };
  const refsDone = new Set();
  const fillRef = (ref) => {
    if (!ref || refsDone.has(ref)) return;
    refsDone.add(ref);
    const live = [];
    for (const m of links.refs.get(ref) || []) {
      const f = find(m);
      if (!f) continue;
      for (const n of f.nodes) if (!live.includes(n)) live.push(n);
    }
    ref.live = live;
  };
  const fillPlacement = (p) => {
    if (!p) return;
    fillRef(p.parent);
    p.before.forEach(fillRef);
    p.after.forEach(fillRef);
  };
  const done = new Set();
  for (const c of conflicts) {
    const rv = c.recovery;
    if (!rv || done.has(rv)) continue;
    done.add(rv);
    fillRef(rv.subject);
    if (rv.structure) {
      fillPlacement(rv.structure.localPlacement);
      fillPlacement(rv.structure.remotePlacement);
      fillPlacement(rv.structure.mergedPlacement);
      (rv.structure.localOrder || []).forEach(fillRef);
      (rv.structure.mergedOrder || []).forEach(fillRef);
    }
    const anchor = links.anchors.get(rv);
    const lv = anchor ? one(anchor) : null;
    let applied = !!lv;
    if (rv.text) {
      const sp = links.spans.get(rv.text.merged);
      let ls = sp ? liveSpan(sp.start, sp.end) : null;
      let scope = sp ? liveSpan(sp.scopeStart, sp.scopeEnd) : null;
      if (sp?.empty) {
        const gap = sp.empty;
        const start = gap.previous
          ? { kind: "after", node: gap.previous }
          : { kind: "startOf", node: gap.parent };
        const end = gap.next
          ? { kind: "before", node: gap.next }
          : { kind: "end", node: gap.parent };
        const actual = liveSpan(start, end);
        if (
          !actual ||
          actual.startContainer !== actual.endContainer ||
          actual.startOffset !== actual.endOffset
        )
          ls = null;
        else ls = scope = actual;
      }
      if (!provesText(ls, scope, rv.text, sp)) ls = scope = null;
      rv.text.liveSpan = ls;
      rv.text.liveScope = ls ? scope : null;
      if (!ls) applied = false;
    }
    if (rv.structure && applied) applied = provesStructure(rv);
    if (rv.attribute && applied)
      applied = liveAttr(lv, rv.attribute, c.resolved);
    const attrVeto =
      (!!rv.attribute || (!!rv.text && lv?.tagName === "TEXTAREA")) &&
      !!vetoedAttrs &&
      [anchor, lv].some((n) =>
        vetoedAttrs
          .get(n)
          ?.has(rv.attribute ? rv.attribute.qualifiedName : "value"),
      );
    const localState = links.localState?.states.get(rv);
    const removalVeto =
      !!rv.text &&
      [...(o.removedVetoes || [])].some((n) => localState?.touched.has(n));
    const contentVeto =
      rv.structure?.localAction === "inserted" &&
      [...vetoed].some((n) => n === anchor || anchor?.contains(n));
    const hasVeto =
      (anchor && vetoedAbove(anchor)) || attrVeto || removalVeto || contentVeto;
    const preserved = hasVeto && localPreserved(rv, c, links, contained);
    if (preserved && (removalVeto || (contentVeto && rv.localLost)))
      applied = false;
    const prevented = !applied && preserved && hasVeto;
    rv.applied = applied;
    rv.unavailable = applied
      ? null
      : prevented
        ? "hook-veto"
        : "missing-output";
    if (prevented) rv.localLost = false;
    if (!applied && rv.text) rv.text.liveSpan = rv.text.liveScope = null;
  }
}

/**
 * A live node the report's refs and spans point at was replaced after apply
 * (morphElement swapping the root for one of another tag): point at the
 * replacement.
 */
export function remapLive(conflicts, from, to) {
  const fromPaths = pathsInto(from);
  const finalPaths = pathsInto(to);
  const contained = (n) => !!n && finalPaths.containerPath(n) !== null;
  const swap = (n) => {
    if (n === from) return to;
    const path = fromPaths.pathOf(n);
    if (path && from !== to) {
      const resolved = resolvePoint(to, { path, offset: 0 });
      if (resolved && resolved[0].nodeType === n.nodeType) return resolved[0];
    }
    return n;
  };
  const refs = new Set();
  const ref = (r) => {
    if (!r || refs.has(r)) return;
    refs.add(r);
    r.live = r.live.map(swap).filter(contained);
  };
  const span = (s) => {
    if (!s) return;
    s.startContainer = swap(s.startContainer);
    s.endContainer = swap(s.endContainer);
  };
  const done = new Set();
  for (const c of conflicts) {
    if (c.node === from && to.tagName === "SCRIPT") c.node = to;
    if (c.el === from && c.kind === "structure") c.el = to;
    const rv = c.recovery;
    if (!rv || done.has(rv)) continue;
    done.add(rv);
    ref(rv.subject);
    if (rv.text) {
      span(rv.text.liveSpan);
      span(rv.text.liveScope);
      const ls = rv.text.liveSpan,
        scope = rv.text.liveScope,
        M = rv.text.merged;
      const usable = (s) =>
        !!s &&
        orderedSpan(s) &&
        contained(s.startContainer) &&
        contained(s.endContainer);
      if (
        !usable(ls) ||
        !usable(scope) ||
        projectSpan(scope, rv.text.encoding) !== M.text ||
        projectSpan(ls, rv.text.encoding) !== M.text.slice(M.start, M.end)
      ) {
        rv.text.liveSpan = null;
        rv.text.liveScope = null;
        rv.applied = false;
        rv.unavailable = "missing-output";
      }
    }
    const st = rv.structure;
    if (!st) continue;
    for (const p of [st.localPlacement, st.remotePlacement, st.mergedPlacement])
      if (p) {
        ref(p.parent);
        p.before.forEach(ref);
        p.after.forEach(ref);
      }
    (st.localOrder || []).forEach(ref);
    (st.mergedOrder || []).forEach(ref);
    if (!rv.subject.live.length) {
      rv.applied = false;
      rv.unavailable = "missing-output";
    }
  }
}
