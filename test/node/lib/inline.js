import { parse, doc } from "./dom.js";
import { createAnalyzer } from "../../../src/similarity.js";
import { align } from "../../../src/align.js";
import { indexByIdentity, defaultIdentity } from "../../../src/identity.js";
import { mergeInline } from "../../../src/inline-merge.js";

const never = () => false;

/** Align two blocks the way merge3 does, with their identical children paired. */
export function alignBlocks(bEl, sEl, analyzer) {
  const A = align(bEl, sEl, {
    analyzer,
    baseIndex: indexByIdentity(bEl, defaultIdentity, never),
    sideIndex: indexByIdentity(sEl, defaultIdentity, never),
  });
  if (A.identical.has(bEl)) A.pairIdenticalChildren(bEl);
  return A;
}

/** Parse one block of HTML and return the element. */
export const block = (html) => parse(doc(html)).body.firstElementChild;

/**
 * Merge the inline content of three block elements through mergeInline.
 * Returns the merged block (a fresh element of base's tag) and the records.
 */
export function mergeSegment(bEl, lEl, rEl, opts = {}) {
  const analyzer = createAnalyzer({});
  const L = alignBlocks(bEl, lEl, analyzer),
    R = alignBlocks(bEl, rEl, analyzer);
  const out = bEl.ownerDocument.implementation.createHTMLDocument("");
  const conflicts = [],
    decisions = [];
  const provenance = new WeakMap(),
    textMappers = new WeakMap();
  const node = out.createElement(bEl.tagName);
  const res = mergeInline({
    base: [...bEl.childNodes],
    local: [...lEl.childNodes],
    remote: [...rEl.childNodes],
    out,
    policy: opts.policy || "remote",
    L,
    R,
    provenance,
    textMappers,
    conflicts,
    decisions,
    node,
    ...(opts.inline || {}),
  });
  for (const n of res.nodes) node.appendChild(n);
  return { node, res, conflicts, decisions, provenance, textMappers, L, R };
}

/** Merge three one-block HTML strings; `html` is the merged block's outerHTML. */
export function mergeBlocks(base, local, remote, opts = {}) {
  const b = block(base),
    l = block(local),
    r = block(remote);
  const x = mergeSegment(b, l, r, opts);
  return { ...x, html: x.node.outerHTML, b, l, r };
}
