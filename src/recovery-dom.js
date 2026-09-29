import { flatten, BLOCK_TAGS, BREAK } from "./inline-merge.js";

const size = (n) =>
  n.nodeType === 3 || n.nodeType === 8
    ? n.nodeValue.length
    : n.childNodes.length;

export function orderedSpan(s) {
  if (!s) return false;
  const {
    startContainer: a,
    startOffset: x,
    endContainer: b,
    endOffset: y,
  } = s;
  if (
    !a ||
    !b ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > size(a) ||
    y > size(b)
  )
    return false;
  if (a.getRootNode() !== b.getRootNode()) return false;
  const r = a.ownerDocument.createRange();
  r.setStart(a, x);
  r.setEnd(b, y);
  return r.startContainer === a && r.startOffset === x;
}

export function projectSpan(s, encoding, options = {}) {
  if (!orderedSpan(s)) return null;
  const {
    startContainer: a,
    startOffset: x,
    endContainer: b,
    endOffset: y,
  } = s;
  if (a === b && (a.nodeType === 3 || a.nodeType === 8))
    return a.nodeValue.slice(x, y);
  if (a === b && x === y) return "";
  const ancestors = new Set();
  for (let n = a; n; n = n.parentNode) ancestors.add(n);
  let root = b;
  while (!ancestors.has(root)) root = root.parentNode;
  const compare = (u, v) => {
    const r = root.ownerDocument.createRange();
    const q = root.ownerDocument.createRange();
    r.setStart(u[0], u[1]);
    r.collapse(true);
    q.setStart(v[0], v[1]);
    q.collapse(true);
    return r.compareBoundaryPoints(0, q);
  };
  const edge = (n, after = false) => [
    n.parentNode,
    Array.prototype.indexOf.call(n.parentNode.childNodes, n) + Number(after),
  ];
  const entries = [];
  let text;
  if (encoding === "plain") {
    text = "";
    const walk = (n) => {
      if (n.nodeType === 3 || n.nodeType === 8) {
        const start = text.length;
        text += n.nodeValue;
        entries.push({
          s: start,
          e: text.length,
          a: [n, 0],
          b: [n, n.nodeValue.length],
          node: n,
        });
      } else for (const c of n.childNodes) walk(c);
    };
    walk(root);
  } else {
    let blocks = options.blocks;
    if (!blocks) {
      blocks = new Set();
      const walk = (n) => {
        if (n !== root && n.nodeType === 1 && BLOCK_TAGS.has(n.tagName))
          blocks.add(n);
        for (const c of n.childNodes) walk(c);
      };
      walk(root);
    }
    const f = flatten(Array.from(root.childNodes), {
      blocks,
      atomize: (n) => !!options.atoms?.has(n),
      ignored: options.ignored,
    });
    text = f.text;
    for (const n of f.nodes)
      entries.push({
        s: n.s,
        e: n.e,
        a: [n.node, 0],
        b: [n.node, n.e - n.s],
        node: n.node,
      });
    for (const at of f.atoms)
      entries.push({
        s: at.i,
        e: at.i + 1,
        a: edge(at.el),
        b: edge(at.el, true),
      });
    for (let i = 0; i < f.text.length; i++) {
      if (f.text[i] !== BREAK) continue;
      const close = f.marks.find((m) => m.block && m.to === i + 1);
      const open = f.marks.find((m) => m.block && m.from === i + 1);
      if (close)
        entries.push({
          s: i,
          e: i + 1,
          a: [close.el, close.el.childNodes.length],
          b: edge(close.el, true),
        });
      else if (open)
        entries.push({ s: i, e: i + 1, a: edge(open.el), b: [open.el, 0] });
      else return null;
    }
  }
  entries.sort((p, q) => p.s - q.s);
  const offset = (p) => {
    if (p[0].nodeType === 3 || p[0].nodeType === 8) {
      const e = entries.find((e) => e.node === p[0]);
      return e ? e.s + p[1] : null;
    }
    let at = 0;
    for (const e of entries) {
      if (compare(p, e.a) <= 0) return e.s;
      if (compare(p, e.b) < 0) return null;
      at = e.e;
    }
    return at;
  };
  const start = offset([a, x]),
    end = offset([b, y]);
  return start !== null && end !== null && start <= end
    ? text.slice(start, end)
    : null;
}

export function resolvePoint(root, point) {
  let n = root;
  for (const part of point.path) {
    n = part === "content" ? n?.content : n?.childNodes[part];
    if (!n) return null;
  }
  return [n, point.offset];
}

export function staticSpan(root, span) {
  if (!root || !span) return null;
  const a = resolvePoint(root, span.start),
    b = resolvePoint(root, span.end);
  return a && b
    ? {
        startContainer: a[0],
        startOffset: a[1],
        endContainer: b[0],
        endOffset: b[1],
      }
    : null;
}
