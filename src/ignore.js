/**
 * ignore.js — "is this node inside a region the merge must leave alone?"
 *
 * The caller's predicate answers for one element; this wrapper makes it
 * ancestor-aware and memoizes it, so it is evaluated at most once per element
 * per merge across all trees it is used on. The walk stops at a boundary
 * root: a marker above what the caller asked to merge does not exempt it.
 */

/**
 * @param {(el: Element) => boolean} [pred]
 * @param {Iterable<Node>} [boundaries] - roots at which the ancestor walk stops (inclusive)
 * @returns {(node: Node | null | undefined) => boolean}
 */
export function makeIgnore(pred, boundaries = []) {
  if (typeof pred !== "function") return () => false;
  const cache = new WeakMap();
  const stops = new Set(boundaries);
  return (node) => {
    if (!node || node.nodeType !== 1) return false;
    const hit = cache.get(node);
    if (hit !== undefined) return hit;
    const chain = [];
    let el = node;
    let result = false;
    while (el && el.nodeType === 1) {
      const known = cache.get(el);
      if (known !== undefined) { result = known; break; }
      chain.push(el);
      if (pred(el)) { result = true; break; }
      if (stops.has(el)) break;
      el = el.parentElement;
    }
    for (const c of chain) cache.set(c, result);
    return result;
  };
}
