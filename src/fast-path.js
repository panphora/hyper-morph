/**
 * fast-path.js — the one changed branch of a clean-shape document merge.
 *
 * When base and local are one tree (a clean tab merging against its own fresh
 * capture), everything the remote did not change is byte-equal between base
 * and remote. `findScope` descends from the roots while exactly one child
 * node can still differ and the pair there is two elements with one tag and one
 * identity. If that last child is equal, the whole page is equal. Otherwise
 * the pair where that stops is the scope, and the elements above
 * it are its chain. Every other child of a chain element is outside: equal
 * to its remote counterpart.
 *
 * The merge that follows is the whole-document merge with its identity work
 * narrowed: identities are indexed on the chain and the scope only, and only
 * the scope is certified. That is exact when the whole-document alignment
 * pairs every outside element with its positional counterpart, which the
 * outside walk makes sure of (every outside element carries its
 * counterpart's identity), and when the chain pairs as it lies, which `held`
 * checks on the finished alignment. Anything else takes the whole-document
 * merge, named by a bail from FAST_PATH_BAILS. Nothing here writes to any
 * tree.
 */

import { structuralKey, KEYED } from "./merge.js";
import { defaultIdentity } from "./identity.js";
import { NEVER } from "./ignore.js";

export const steps = { compared: 0 };

const FORM_TAGS = new Set(["INPUT", "SELECT", "OPTION", "TEXTAREA"]);

/** Equal attributes, leaving out the ones the caller ignores. */
function sameAttrs(x, y, ignoreAttribute) {
  let n = 0;
  for (const a of x.attributes) {
    if (ignoreAttribute(x, a.name)) continue;
    n++;
    if (y.getAttribute(a.name) !== a.value) return false;
  }
  for (const a of y.attributes) if (!ignoreAttribute(y, a.name)) n--;
  return n === 0;
}

/** Equal tags and attributes, as isEqualNode compares them. */
function sameMarkup(x, y) {
  if (
    x.namespaceURI !== y.namespaceURI ||
    x.prefix !== y.prefix ||
    x.localName !== y.localName
  )
    return false;
  const xa = x.attributes;
  if (xa.length !== y.attributes.length) return false;
  for (const a of xa)
    if (y.getAttributeNS(a.namespaceURI, a.localName) !== a.value) return false;
  return true;
}

/**
 * The identity index the whole-document merge would build, restricted to
 * the chain and the scope: an id also used outside, or twice inside, is
 * dropped, as a duplicate is from the whole-document index. Every id seen
 * goes into `seen`. `below` lists the root's descendants that can carry an
 * id, when the identity names only some.
 */
function scopedIndex(chain, root, keyOf, ignored, outside, seen, below) {
  const map = new Map();
  const dup = new Set();
  const consider = (el) => {
    if (ignored(el)) return;
    const id = keyOf(el);
    if (!id) return;
    seen.add(id);
    if (outside.has(id) || map.has(id)) dup.add(id);
    else map.set(id, el);
  };
  for (const el of chain) consider(el);
  consider(root);
  for (const el of below || root.querySelectorAll("*")) consider(el);
  for (const id of dup) map.delete(id);
  return map;
}

/**
 * @param {object} a
 * @param {Element} a.baseRoot - the base and local root (one tree)
 * @param {Element} a.remoteRoot
 * @param {Element} a.liveRoot
 * @param {(n: Node) => Node | null} a.toLive
 * @param {object} a.o - normalized options
 * @param {{ base: Function, remote: Function }} a.identity - resolved identities
 * @param {string} a.baseURI
 * @returns {{ bail: string } | { scope: object }}
 */
export function findScope({
  baseRoot,
  remoteRoot,
  liveRoot,
  toLive,
  o,
  identity,
  baseURI,
}) {
  if (baseRoot.tagName !== remoteRoot.tagName) return { bail: "root-tag" };
  if (
    baseRoot.getElementsByTagName("template").length ||
    remoteRoot.getElementsByTagName("template").length
  )
    return { bail: "script-or-template" };
  if (!sameAttrs(baseRoot, remoteRoot, o.ignoreAttribute))
    return { bail: "root-attrs" };
  const { ignored, remoteWins } = o;
  const keyOf = structuralKey(
    o.scripts.merge === false ? null : o.scripts.mergeTags,
    baseURI,
  );
  const keyB = (el) => {
    const k = keyOf(el);
    return k !== null ? k : identity.base(el) || null;
  };
  const keyR = (el) => {
    const k = keyOf(el);
    return k !== null ? k : identity.remote(el) || null;
  };

  const chain = [],
    remoteChain = [],
    same = new Map(),
    differ = new Map();
  const comparisons = { same, differ };
  const bailOut = (bail) => ({ bail, comparisons });
  const equal = (x, y, native = true) => {
    if (same.get(x) === y) return true;
    if (differ.get(x) === y) return false;
    steps.compared++;
    if (native && x.isEqualNode(y)) {
      same.set(x, y);
      return true;
    }
    let matches = x.nodeType === y.nodeType;
    if (matches && x.nodeType === 1) {
      matches = sameMarkup(x, y);
      if (matches) {
        let a = x.firstChild,
          c = y.firstChild;
        for (; a && c; a = a.nextSibling, c = c.nextSibling)
          if (!equal(a, c, false)) {
            matches = false;
            break;
          }
        if (a || c) matches = false;
      }
    } else if (matches) matches = x.isEqualNode(y);
    (matches ? same : differ).set(x, y);
    return matches;
  };
  let b = baseRoot,
    r = remoteRoot,
    knownDifferent = false;
  const equalPage = () => {
    same.set(b, r);
    for (let i = 0; i < chain.length; i++) same.set(chain[i], remoteChain[i]);
    return bailOut("equal");
  };
  for (;;) {
    const bk = b.childNodes,
      rk = r.childNodes;
    if (bk.length !== rk.length) break;
    const differs = (i) => {
      if (!equal(bk[i], rk[i])) return true;
      same.set(bk[i], rk[i]);
      return false;
    };
    let suspect = -1,
      most = -1;
    for (let i = 0; i < bk.length; i++) {
      if (bk[i].nodeType !== 1) continue;
      let n = 0;
      for (let c = bk[i].firstElementChild; c; c = c.nextElementSibling) n++;
      if (n >= most) {
        most = n;
        suspect = i;
      }
    }
    const found = [];
    let inferred = false;
    for (let i = 0; i < bk.length && found.length < 2; i++)
      if (i !== suspect && differs(i)) found.push(i);
    if (suspect >= 0 && found.length < 2)
      if (found.length === 0 && sameMarkup(b, r)) {
        found.push(suspect);
        inferred = true;
      } else if (differs(suspect)) found.push(suspect);
    if (found.length !== 1) {
      if (!knownDifferent && found.length === 0 && sameMarkup(b, r))
        return equalPage();
      break;
    }
    const x = bk[found[0]],
      y = rk[found[0]];
    knownDifferent = knownDifferent || !inferred;
    if (knownDifferent) differ.set(x, y);
    if (x.nodeType !== 1 || y.nodeType !== 1 || x.tagName !== y.tagName) break;
    if (keyB(x) !== keyR(y)) {
      if (!knownDifferent && equal(x, y)) return equalPage();
      break;
    }
    chain.push(b);
    remoteChain.push(r);
    b = x;
    r = y;
  }
  differ.set(b, r);
  for (let i = 0; i < chain.length; i++) differ.set(chain[i], remoteChain[i]);
  if (b === baseRoot || b.tagName === "HEAD" || b.tagName === "BODY")
    return bailOut("root-level");
  if (chain.length < 2 || chain[1].tagName !== "BODY")
    return bailOut("not-in-body");
  if (ignored(b) || ignored(r)) return bailOut("ignored-ancestor");
  if (remoteWins(b) || remoteWins(r)) return bailOut("remote-wins-ancestor");
  for (const c of chain)
    if (FORM_TAGS.has(c.tagName)) return bailOut("form-ancestor");
  if (
    b.tagName === "SCRIPT" ||
    b.getElementsByTagName("script").length ||
    r.getElementsByTagName("script").length
  )
    return bailOut("script-or-template");
  const liveScope = toLive(b);
  if (!liveScope || liveScope.nodeType !== 1 || liveScope.tagName !== b.tagName)
    return bailOut("no-live-twin");
  if (!liveRoot.contains(liveScope)) return bailOut("live-detached");
  for (const c of chain) {
    const lc = toLive(c);
    if (!lc || lc.nodeType !== 1) return bailOut("ancestor-live");
  }

  // The outside, in document order. Every element must carry its positional
  // counterpart's identity, so the whole-document alignment's identity pairs
  // out here are positional ones. With the default identity on both sides
  // and nothing ignored, an unchanged subtree carries its counterpart's
  // identities by construction: only the ids it uses are collected, from
  // the elements that can carry one.
  const plain =
    identity.base === defaultIdentity &&
    identity.remote === defaultIdentity &&
    ignored === NEVER;
  const outside = new Set(),
    duplicates = new Set(),
    tops = [];
  let head = null;
  const use = (id) => {
    if (!id) return;
    if (outside.has(id)) duplicates.add(id);
    else outside.add(id);
  };
  // Whether x carries y's identity; the identity is recorded as used.
  const check = (x, y) => {
    const k = keyOf(x);
    const kb = k !== null ? k : identity.base(x) || null;
    if (kb !== (k !== null ? k : identity.remote(y) || null)) return false;
    use(kb);
    return true;
  };
  // The descendants of an unchanged subtree: its own identity was checked
  // by the caller.
  const unit = (x, y) => {
    for (
      let a = x.firstElementChild, c = y.firstElementChild;
      a;
      a = a.nextElementSibling, c = c.nextElementSibling
    ) {
      const skip = ignored(a);
      if (skip !== ignored(c)) return false;
      if (skip) continue;
      if (!check(a, c) || !unit(a, c)) return false;
    }
    return true;
  };
  const level = (i) => {
    const next = i + 1 < chain.length ? chain[i + 1] : b;
    for (
      let x = chain[i].firstElementChild, y = remoteChain[i].firstElementChild;
      x;
      x = x.nextElementSibling, y = y.nextElementSibling
    ) {
      if (x === next) {
        const bail = i + 1 < chain.length ? level(i + 1) : null;
        if (bail) return bail;
        continue;
      }
      const skip = ignored(x);
      if (skip !== ignored(y)) return "outside-id-changed";
      if (skip) continue;
      const lx = toLive(x);
      if (!lx || lx.nodeType !== 1) return "sibling-live";
      tops.push([x, y]);
      if (!plain && (!check(x, y) || !unit(x, y))) return "outside-id-changed";
      // The whole-document merge pairs a keyed head by identity and
      // certifies it unchanged, unless its key is used twice (see `head`
      // below); an unkeyed one is the root's singleton, merged into.
      if (i === 0 && x.tagName === "HEAD" && keyB(x)) head = [x, y];
    }
    return null;
  };
  const bail = level(0);
  if (bail) return bailOut(bail);
  const onChain = new Set(chain);
  let below = null;
  if (identity.base === defaultIdentity) {
    below = [];
    for (const el of baseRoot.querySelectorAll(KEYED)) {
      if (el === b || onChain.has(el)) continue;
      if (b.contains(el)) below.push(el);
      else if (plain) use(keyB(el));
    }
  }

  const inside = new Set();
  const baseIndex = scopedIndex(
    chain,
    b,
    keyB,
    ignored,
    outside,
    inside,
    below,
  );
  const remoteIndex = scopedIndex(
    remoteChain,
    r,
    keyR,
    ignored,
    outside,
    inside,
    identity.remote === defaultIdentity && r.querySelectorAll(KEYED),
  );
  if (head && (duplicates.has(keyB(head[0])) || inside.has(keyB(head[0]))))
    head = null;
  return {
    scope: {
      chain,
      root: b,
      onChain,
      baseIndex,
      remoteIndex,
      // The keyed head the whole-document merge pairs by identity and
      // certifies, or null.
      head,
      same,
      differ,
      duplicates,
      // The alignment kept the chain and the outside where they lie.
      held: (R) => {
        for (let i = 1; i < chain.length; i++)
          if (R.map.get(chain[i]) !== remoteChain[i]) return false;
        for (const [x, y] of tops) if (R.map.get(x) !== y) return false;
        return true;
      },
    },
  };
}
