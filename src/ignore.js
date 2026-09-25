/**
 * ignore.js — "is this node inside a region the merge must leave alone?"
 *
 * The caller's predicate answers for one element; this wrapper makes it
 * ancestor-aware and memoizes it, so it is evaluated at most once per element
 * per merge across all trees it is used on.
 */

/**
 * @param {(el: Element) => boolean} [pred]
 * @returns {(node: Node | null | undefined) => boolean}
 */
export function makeIgnore(pred) {
  if (typeof pred !== "function") return () => false;
  const cache = new WeakMap();
  return (node) => {
    if (!node || node.nodeType !== 1) return false;
    const hit = cache.get(node);
    if (hit !== undefined) return hit;
    // Walk up until an answer is known: a cached ancestor, a predicate hit,
    // or the top of the tree. Every element visited on the way shares that
    // answer, because ignoring is inherited by descendants.
    const chain = [];
    let el = node;
    let result = false;
    while (el && el.nodeType === 1) {
      const known = cache.get(el);
      if (known !== undefined) { result = known; break; }
      chain.push(el);
      if (pred(el)) { result = true; break; }
      el = el.parentElement;
    }
    for (const c of chain) cache.set(c, result);
    return result;
  };
}
