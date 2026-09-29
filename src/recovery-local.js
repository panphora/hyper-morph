import { projectSpan, staticSpan, resolvePoint } from "./recovery-dom.js";

const fragment = (n) => (n.nodeType === 1 ? n.outerHTML : n.nodeValue);

export function captureLocal(conflicts, links, toLive) {
  if (!links) return;
  const states = new Map();
  const refs = new Map();
  const ref = (r) => {
    if (!r) return null;
    if (refs.has(r)) return refs.get(r);
    const nodes = r.local
      .map((path) => resolvePoint(links.localRoot, { path, offset: 0 })?.[0])
      .map((n) => n && toLive(n))
      .filter(Boolean);
    const state = nodes.map((n) => ({
      node: n,
      parent: n.parentNode,
      previous: n.previousSibling,
      next: n.nextSibling,
      fragment: fragment(n),
    }));
    refs.set(r, state);
    return state;
  };
  const span = (s) => {
    const resolved = staticSpan(links.localRoot, s);
    if (!resolved) return null;
    const a = toLive(resolved.startContainer),
      b = toLive(resolved.endContainer);
    return a && b ? { ...resolved, startContainer: a, endContainer: b } : null;
  };
  for (const c of conflicts) {
    const rv = c.recovery;
    if (states.has(rv)) continue;
    const state = {
      subject: ref(rv.subject),
      span: null,
      scope: null,
      touched: new Set(),
    };
    if (rv.text) {
      state.span = span(rv.text.local.span);
      state.scope = span(rv.text.local.scope);
      const s = state.span;
      if (s) {
        const range = s.startContainer.ownerDocument.createRange();
        range.setStart(s.startContainer, s.startOffset);
        range.setEnd(s.endContainer, s.endOffset);
        const walk = (n) => {
          if (!range.intersectsNode(n)) return;
          state.touched.add(n);
          for (const child of n.childNodes) walk(child);
        };
        walk(range.commonAncestorContainer);
      }
    }
    if (rv.structure) {
      for (const p of [rv.structure.localPlacement])
        if (p) {
          ref(p.parent);
          p.before.forEach(ref);
          p.after.forEach(ref);
        }
      for (const r of rv.structure.localOrder || []) ref(r);
    }
    states.set(rv, state);
  }
  links.localState = { states, refs };
}

export function localPreserved(rv, c, links, contained) {
  const state = links.localState?.states.get(rv);
  if (!state) return false;
  const samePlace = (s) => {
    const n = s.node;
    if (!contained(n) || n.parentNode !== s.parent) return false;
    const index = (x) =>
      Array.prototype.indexOf.call(n.parentNode.childNodes, x);
    if (
      s.previous &&
      contained(s.previous) &&
      s.previous.parentNode === n.parentNode &&
      index(s.previous) >= index(n)
    )
      return false;
    if (
      s.next &&
      contained(s.next) &&
      s.next.parentNode === n.parentNode &&
      index(s.next) <= index(n)
    )
      return false;
    return true;
  };
  if (rv.structure?.localAction === "deleted")
    return rv.subject.live.length === 0;
  if (!state.subject.length || !state.subject.every(samePlace)) return false;
  if (rv.text) {
    const t = rv.text.local;
    const valid = (s) =>
      s && contained(s.startContainer) && contained(s.endContainer);
    return (
      valid(state.span) &&
      valid(state.scope) &&
      projectSpan(state.scope, rv.text.encoding) === t.text &&
      projectSpan(state.span, rv.text.encoding) === t.text.slice(t.start, t.end)
    );
  }
  if (rv.attribute) {
    const a = rv.attribute,
      n = state.subject[0].node;
    return (
      (a.namespaceURI
        ? n.getAttributeNS(a.namespaceURI, a.localName)
        : n.getAttribute(a.qualifiedName)) === c.local
    );
  }
  const st = rv.structure;
  if (st.localOrder) {
    let last = -1,
      parent = null;
    for (const r of st.localOrder) {
      const n = links.localState.refs.get(r)?.[0]?.node;
      if (!n || !contained(n) || (parent && n.parentNode !== parent))
        return false;
      const index = Array.prototype.indexOf.call(n.parentNode.childNodes, n);
      if (index <= last) return false;
      parent = n.parentNode;
      last = index;
    }
    return true;
  }
  return (
    st.localAction === "moved" ||
    state.subject.every((s) => fragment(s.node) === s.fragment)
  );
}
