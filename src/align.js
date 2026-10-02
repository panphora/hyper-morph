/**
 * align.js — pair the nodes of a base tree with the nodes of one side.
 *
 * Three passes:
 *   1. identity, global: equal usable ids with equal tag, anywhere.
 *   2. structure, top-down over paired elements: per parent, children pair by
 *      identical subtree hash, then signature plus hint, then signature plus
 *      similar text (nearest index), then position.
 *   3. moves, global: what is still unpaired on both sides, and what sits
 *      inside an unpaired element (wrapped or unwrapped content), pairs by
 *      identical hash, else by signature and similar text, bounded by a
 *      budget. A side element paired by position alone is still a
 *      candidate.
 *   4. slots, per parent: when every element still unpaired under a parent
 *      sits at the same index with the same tag on both sides, the slots
 *      were rewritten in place and pair positionally.
 *
 * Text is aligned as runs (see similarity.js). No element pair is ever made
 * on tag and class alone: an identity, an identical hash, similar text, or
 * a slot-for-slot match of everything left is required, or the two are a
 * delete and an insert. Two elements that both carry an identity pair only
 * when it is the same one: a re-keyed element is a replacement, never a
 * rewrite of the element that held the old key.
 */

import { CODE_LIKE } from "./similarity.js";

const NEAREST_WINDOW = 16;
const MOVE_BUDGET = 2000;
const POSITIONAL_LOOKAHEAD = 3;

/**
 * @typedef {object} Alignment
 * @property {Map<any, any>} map - base unit -> side unit
 * @property {Map<any, any>} reverse - side unit -> base unit
 * @property {Set<Element>} moved - base elements paired across parents
 * @property {Set<any>} identical - base units whose subtree equals the side's
 */

/**
 * @param {Element} baseRoot
 * @param {Element} sideRoot
 * @param {object} o
 * @param {ReturnType<import("./similarity.js").createAnalyzer>} o.analyzer
 * @param {Map<string, Element>} o.baseIndex - identity index of the base side
 * @param {Map<string, Element>} o.sideIndex - identity index of the side
 * @param {(el: Element) => string | null} [o.baseId] - authored identity of a base element
 * @param {(el: Element) => string | null} [o.sideId] - authored identity of a side element
 * @param {(el: Element) => string | null} [o.baseKey] - full identity of a base element, the key o.baseIndex holds it under
 * @param {(el: Element) => string | null} [o.sideKey] - full identity of a side element, the key o.sideIndex holds it under
 * @param {Set<string>} [o.baseDropped] - ids the base index dropped as duplicates
 * @param {Set<string>} [o.sideDropped] - ids the side index dropped as duplicates
 * @param {object} [o.stats] - per-apply counters to fill
 * @param {object} [o.scope] - the fast path's changed branch (fast-path.js): certification walks only the branch, and refuses the ancestors on its chain unwalked, since each holds the change
 * @returns {Alignment}
 */
/**
 * Work counters for the tests: a bound on steps holds where a wall clock
 * would be flaky. `align` counts the child units the passes examine.
 */
export const steps = { align: 0, certifyVisited: 0, certifyScheduled: 0 };

export function align(baseRoot, sideRoot, o) {
  const {
    meta,
    unitsOf,
    unitHash,
    similar,
    score,
    childrenOf,
    equalUnits,
    ignored,
  } = o.analyzer;
  const baseId = o.baseId || (() => null),
    sideId = o.sideId || (() => null);
  const baseKey = o.baseKey || (() => null),
    sideKey = o.sideKey || (() => null);
  const baseDropped = o.baseDropped || new Set(),
    sideDropped = o.sideDropped || new Set();
  const stats = o.stats || null;
  const tieCounted = stats ? new Set() : null;
  const refused = stats ? new Set() : null;
  const map = new Map(),
    reverse = new Map();
  const weak = new Set(); // base units paired with no content evidence
  const banned = new Map(); // base unit -> side units it may not pair with again
  const moved = new Set(),
    identical = new Set();
  const visited = new Set();
  const unpairedBase = [],
    unpairedSide = [];
  const slotParents = []; // [base parent, side parent] with unpaired elements on both sides
  const queue = [];
  let budget = MOVE_BUDGET;
  let posB = new Map(),
    posS = new Map();

  const pair = (b, s) => {
    map.set(b, s);
    reverse.set(s, b);
  };
  // A pair made anywhere (an identity, a move) rather than beside its
  // parents' pair: every ancestor of either unit is marked, so a pair made
  // on content can tell whether anything inside it is paired already.
  const holdsB = new Set(),
    holdsS = new Set();
  let owners = null;
  const up = (u) => {
    const p = u.nodeType ? u.parentNode : u.parent;
    if (!p || p.nodeType !== 11) return p;
    if (!owners) {
      owners = new WeakMap();
      const scan = (scope) => {
        for (const t of scope.querySelectorAll("template"))
          if (t.content) {
            owners.set(t.content, t);
            scan(t.content);
          }
      };
      for (const r of [baseRoot, sideRoot])
        scan(r.tagName === "TEMPLATE" && r.content ? r.content : r);
    }
    return owners.get(p) || null;
  };
  const anywhere = (b, s) => {
    for (let p = up(b); p && !holdsB.has(p); p = up(p)) holdsB.add(p);
    for (let p = up(s); p && !holdsS.has(p); p = up(p)) holdsS.add(p);
  };
  // Whether an identical pair owns a unit: the nearest paired ancestor is
  // identical, so the unit is paired only on demand, with its counterpart.
  const ownedB = (u) => {
    for (let p = up(u); p; p = up(p)) if (map.has(p)) return identical.has(p);
    return false;
  };
  const ownedS = (u) => {
    for (let p = up(u); p; p = up(p)) {
      const x = reverse.get(p);
      if (x !== undefined) return identical.has(x);
    }
    return false;
  };
  const isEl = (u) => !!u && u.nodeType === 1;
  const isBanned = (b, s) => {
    const set = banned.get(b);
    return !!set && set.has(s);
  };
  const codeLike = (el) => CODE_LIKE.has(el.tagName);
  const comparisons = o.comparisons || o.scope;
  const equalNodes = (b, s) => {
    if (comparisons) {
      if (comparisons.same.get(b) === s) return true;
      if (comparisons.differ.get(b) === s) return false;
    }
    if (!b.isEqualNode(s)) return false;
    if (b.tagName === "TEMPLATE") return equalUnits(b, s);
    const tb = b.getElementsByTagName("template");
    if (tb.length === 0) return true;
    const ts = s.getElementsByTagName("template");
    if (tb.length !== ts.length) return false;
    for (let i = 0; i < tb.length; i++)
      if (!equalUnits(tb[i], ts[i])) return false;
    return true;
  };
  // Elements with different identities are different elements, whatever
  // their content or position says.
  const keysAgree = (b, s) => {
    const kb = baseId(b);
    if (!kb) return true;
    const ks = sideId(s);
    return !ks || kb === ks;
  };
  // A full identity each side holds once (and the other side does not hold
  // twice, where it would decide nothing) travels with its element: a copy
  // elsewhere under another identity is another element, so it never moves
  // there. In place the two still pair, since two tabs mint different ids
  // for one element until they have met.
  const nameB = (u) => {
    const k = baseKey(u);
    return k && o.baseIndex.get(k) === u && !sideDropped.has(k) ? k : null;
  };
  const nameS = (u) => {
    const k = sideKey(u);
    return k && o.sideIndex.get(k) === u && !baseDropped.has(k) ? k : null;
  };
  const namesAgree = (b, s) => {
    const nb = nameB(b);
    if (!nb) return true;
    const ns = nameS(s);
    return !ns || nb === ns;
  };

  const prof = globalThis.__hyperMorphProfile;
  let t0 = prof ? performance.now() : 0;
  if (prof && !o.scope) {
    meta(baseRoot);
    meta(sideRoot);
    prof.meta = (prof.meta || 0) + (performance.now() - t0);
    t0 = performance.now();
  }

  // Pass 1: identity.
  pair(baseRoot, sideRoot);
  const identityPaired = new Set();
  for (const [id, b] of o.baseIndex) {
    const s = o.sideIndex.get(id);
    if (s && s.tagName === b.tagName && !map.has(b) && !reverse.has(s)) {
      pair(b, s);
      anywhere(b, s);
      identityPaired.add(b);
    }
  }
  // Pass 1b: an identity pair is identical, as a pair Pass 0 makes by
  // position is, when one lockstep walk finds the two subtrees equal and
  // every identity pairing inside them (either direction) is exactly the
  // positional counterpart. Innermost pairs first (reverse logical order,
  // template content included): a walk stops at an inner identity pair,
  // taking a certified one as equal and a refused one as a difference, so
  // each node is walked by one pair and the pass stays linear.
  if (identityPaired.size) {
    const order = [];
    if (o.scope)
      for (const c of o.scope.chain) if (identityPaired.has(c)) order.push(c);
    const stack = [o.scope ? o.scope.root : baseRoot];
    while (stack.length) {
      const n = stack.pop();
      if (identityPaired.has(n)) order.push(n);
      const kids = childrenOf(n);
      for (let i = kids.length - 1; i >= 0; i--)
        if (kids[i].nodeType === 1) stack.push(kids[i]);
    }
    const refusedPairs = new Set();
    for (let k = order.length - 1; k >= 0; k--) {
      const b = order[k];
      if (o.scope && o.scope.onChain.has(b)) refusedPairs.add(b);
      else if (certify(b, map.get(b), refusedPairs)) {
        identical.add(b);
        visited.add(b);
        if (stats) stats.certificationPairs++;
      } else refusedPairs.add(b);
    }
    const completed = new Set();
    for (const b of order)
      if (identical.has(b) && !completed.has(b)) complete(b, completed);
  }
  if (o.scope && o.scope.head) lockstep(o.scope.head[0], o.scope.head[1]);

  // Pair everything under a certified pair now, level by level, so the map
  // is as complete as a drained alignment leaves it: the merge reads twins
  // under identical subtrees before it descends into them.
  function complete(b, completed) {
    const stack = [b];
    while (stack.length) {
      const x = stack.pop();
      if (completed.has(x)) continue;
      completed.add(x);
      pairIdenticalChildren(x);
      for (const u of unitsOf(x)) if (isEl(u) && map.has(u)) stack.push(u);
    }
  }

  // Pass 2: structure, from the root and from every identity pair.
  queue.push([baseRoot, sideRoot]);
  for (const [b, s] of map) if (isEl(b) && b !== baseRoot) queue.push([b, s]);
  drain();

  movesAndSlots();
  if (prof) prof.align = (prof.align || 0) + (performance.now() - t0);

  return {
    map,
    reverse,
    moved,
    identical,
    pairIdenticalChildren,
    weak,
    unpair,
    rematch: movesAndSlots,
    insertedByHash,
    refused,
    identityPaired,
  };

  // Pass 3: moves, then the children of moved pairs. Pass 4: slots, then the
  // children of the new pairs. Those children can open slots of their own,
  // so the two passes repeat until a round finds no new slot parent, moves
  // keeping their priority over slots each round.
  function movesAndSlots() {
    moves();
    drain();
    for (let from = 0; from < slotParents.length; ) {
      const to = slotParents.length;
      pairSlots(from, to);
      from = to;
      drain();
      moves();
      drain();
    }
  }

  /**
   * Undo a pair and the pairs beneath it, and forbid it from forming again;
   * both units are free for the next moves and slots round.
   */
  function unpair(b) {
    const s = map.get(b);
    if (!s) return;
    if (!banned.has(b)) banned.set(b, new Set());
    banned.get(b).add(s);
    const drop = (x, y) => {
      map.delete(x);
      reverse.delete(y);
      moved.delete(x);
      identical.delete(x);
      weak.delete(x);
      visited.delete(x);
    };
    const walk = (bEl, sEl) => {
      for (const u of unitsOf(bEl)) {
        const t = map.get(u);
        if (!t || identityPaired.has(u)) continue;
        const within = isEl(t) ? sEl.contains(t) : sEl.contains(t.nodes[0]);
        if (!within) continue;
        drop(u, t);
        if (isEl(u)) walk(u, t);
      }
    };
    drop(b, s);
    if (isEl(b)) walk(b, s);
    unpairedBase.push(b);
    unpairedSide.push(s);
  }

  /** The side elements no base unit is paired with, by hash. */
  function insertedByHash() {
    const m = new Map();
    for (const s of new Set(unpairedSide)) {
      if (reverse.has(s)) continue;
      const h = meta(s).hash;
      if (!m.has(h)) m.set(h, []);
      m.get(h).push(s);
    }
    return m;
  }

  function drain() {
    while (queue.length) {
      const [b, s] = queue.shift();
      if (map.get(b) !== s || visited.has(b) || identical.has(b)) continue;
      alignKids(b, s);
    }
  }

  // The elements inside an unpaired element are move candidates too: an
  // element wrapped in a new container, or unwrapped from a deleted one,
  // moved rather than being deleted and inserted.
  function within(el, list) {
    if (codeLike(el)) return;
    for (const u of unitsOf(el))
      if (isEl(u)) {
        list.push(u);
        within(u, list);
      }
  }

  function alignKids(bEl, sEl) {
    visited.add(bEl);
    const bUnits = unitsOf(bEl),
      sUnits = unitsOf(sEl);
    steps.align += bUnits.length + sUnits.length;
    // Positions are looked up many times per pass; never scan for them.
    posB = new Map();
    posS = new Map();
    for (let i = 0; i < bUnits.length; i++) posB.set(bUnits[i], i);
    for (let i = 0; i < sUnits.length; i++) posS.set(sUnits[i], i);
    // Structural singletons always correspond, whatever their content.
    if (bEl.tagName === "HTML") {
      for (const tag of ["HEAD", "BODY"]) {
        const b = bUnits.find((u) => isEl(u) && u.tagName === tag),
          s = sUnits.find((u) => isEl(u) && u.tagName === tag);
        if (b && s && !map.has(b) && !reverse.has(s)) pair(b, s);
      }
    }
    // Pass 0: same index, equal subtree. Native and cheap, and it pairs
    // nearly everything on an ordinary edit, so hashing only touches the
    // remainder.
    for (let i = 0; i < bUnits.length && i < sUnits.length; i++) {
      const b = bUnits[i],
        s = sUnits[i];
      if (map.has(b) || reverse.has(s)) continue;
      if (isEl(b)) {
        if (isEl(s) && b.tagName === s.tagName && equalNodes(b, s))
          lockstep(b, s);
      } else if (!isEl(s) && b.kind === s.kind && b.value === s.value)
        lockstep(b, s);
    }
    pairUnambiguous(bUnits, sUnits);
    const freeB = bUnits.filter((u) => !map.has(u));
    const freeS = sUnits.filter((u) => !reverse.has(u));
    if (freeB.length && freeS.length) {
      passIdentical(freeB, freeS);
      passSigHint(freeB, freeS);
      passSigSimilar(freeB, freeS, bUnits, sUnits);
      passPositional(bUnits, sUnits);
    }
    let openB = false,
      openS = false;
    for (const u of bUnits) {
      if (!map.has(u)) {
        if (isEl(u)) {
          unpairedBase.push(u);
          within(u, unpairedBase);
          openB = true;
        }
        continue;
      }
      if (isEl(u) && !identical.has(u)) queue.push([u, map.get(u)]);
    }
    for (const u of sUnits)
      if (!reverse.has(u) && isEl(u)) {
        unpairedSide.push(u);
        within(u, unpairedSide);
        openS = true;
      }
    if (openB && openS) slotParents.push([bEl, sEl]);
  }

  /**
   * The same slots rewritten on one side: base [A, B] against side [A', B']
   * with neither text similar. Leftovers are grouped by gap between paired
   * elements; within a gap whose sides hold the same count with the same
   * tags, no insertion or deletion can have shifted them, and each pairs
   * with the element in its slot. Runs last, after moves, so an element
   * that moved away and was replaced in its slot is a move, not a rewrite.
   * A gap with a count mismatch pairs nothing: the difference could be a
   * shift.
   */
  function pairSlots(from, to) {
    for (let n = from; n < to; n++) {
      const [bEl, sEl] = slotParents[n];
      if (map.get(bEl) !== sEl) continue;
      const bu = unitsOf(bEl),
        su = unitsOf(sEl);
      // Leftovers by gap: the gap is named by the nearest preceding paired
      // element (the base one, or the side one's base twin), or null at the
      // start. A gap whose two sides hold the same number of leftovers, tag
      // for tag, was rewritten in place; a gap with a count mismatch may
      // have shifted and pairs nothing, whatever the other gaps hold.
      const gapsB = new Map(),
        gapsS = new Map();
      let anchor = null;
      for (const u of bu) {
        if (!isEl(u)) continue;
        if (map.has(u)) anchor = u;
        else {
          if (!gapsB.has(anchor)) gapsB.set(anchor, []);
          gapsB.get(anchor).push(u);
        }
      }
      anchor = null;
      for (const u of su) {
        if (!isEl(u)) continue;
        if (reverse.has(u)) anchor = reverse.get(u);
        else {
          if (!gapsS.has(anchor)) gapsS.set(anchor, []);
          gapsS.get(anchor).push(u);
        }
      }
      for (const [key, leftB] of gapsB) {
        const leftS = gapsS.get(key);
        if (!leftS || leftB.length !== leftS.length) continue;
        if (
          !leftB.every(
            (b, k) =>
              leftS[k].tagName === b.tagName &&
              keysAgree(b, leftS[k]) &&
              !isBanned(b, leftS[k]),
          )
        )
          continue;
        for (let k = 0; k < leftB.length; k++) adopt(leftB[k], leftS[k]);
      }
    }
  }

  /**
   * Pair two elements on positional evidence alone (a weak pair) and align
   * their children.
   */
  function adopt(b, s) {
    pair(b, s);
    weak.add(b);
    queue.push([b, s]);
    drain();
  }

  function passIdentical(freeB, freeS) {
    const byHashB = countBy(freeB, unitHash),
      byHashS = countBy(freeS, unitHash);
    const sideByHash = new Map();
    for (const s of freeS) {
      const h = unitHash(s);
      if (byHashS.get(h) === 1) sideByHash.set(h, s);
    }
    for (const b of freeB) {
      if (map.has(b)) continue;
      const h = unitHash(b);
      if (byHashB.get(h) !== 1) continue;
      const s = sideByHash.get(h);
      if (s && !reverse.has(s) && equalUnits(b, s)) lockstep(b, s);
    }
  }

  function certify(b, s, refusedPairs) {
    const stack = [[b, s]];
    while (stack.length) {
      const [x, y] = stack.pop();
      steps.certifyVisited++;
      if (stats) stats.certificationVisited++;
      if (x.nodeType !== y.nodeType) return false;
      if (x.nodeType === 3 || x.nodeType === 8) {
        if (x.nodeValue !== y.nodeValue) return false;
        continue;
      }
      if (x.nodeType !== 1) {
        if (!x.isEqualNode(y)) return false;
        continue;
      }
      if (x.tagName !== y.tagName || x.namespaceURI !== y.namespaceURI)
        return false;
      if (ignored(x) !== ignored(y)) return false;
      const xa = x.attributes,
        ya = y.attributes;
      if (xa.length !== ya.length) return false;
      for (let i = 0; i < xa.length; i++) {
        const a = xa[i];
        if (y.getAttributeNS(a.namespaceURI, a.localName) !== a.value)
          return false;
      }
      const mx = map.get(x);
      if (mx !== undefined && mx !== y) return false;
      const ry = reverse.get(y);
      if (ry !== undefined && ry !== x) return false;
      if (x !== b) {
        if (identical.has(x)) continue;
        if (refusedPairs.has(x)) return false;
      }
      const xk = childrenOf(x),
        yk = childrenOf(y);
      if (xk.length !== yk.length) return false;
      steps.certifyScheduled += xk.length;
      for (let i = xk.length - 1; i >= 0; i--) stack.push([xk[i], yk[i]]);
    }
    return true;
  }

  /**
   * Pair two identical subtrees unit by unit without scoring. Descendants
   * must still be paired so apply can keep every live node, but nothing
   * about them needs to be compared. Two subtrees an identity pair inside
   * contradicts (a child of one is paired elsewhere by identity) are not
   * the same subtree when either is named: both stay unpaired, and nothing
   * pairs them crosswise. Unnamed ones still pair on their content, and
   * the identity pair inside moves out.
   */
  function mayLockstep(b, s) {
    if (!isEl(b) || !(holdsB.has(b) || holdsS.has(s))) return true;
    return !!ownership(b, s) || !(nameB(b) || nameS(s));
  }

  function lockstep(b, s) {
    if (isEl(b) && (holdsB.has(b) || holdsS.has(s))) {
      const pairs = ownership(b, s);
      if (!pairs) {
        if (nameB(b) || nameS(s)) return;
        pair(b, s);
        queue.push([b, s]);
        return;
      }
      for (let i = 0; i < pairs.length; i += 2) {
        const x = pairs[i],
          y = pairs[i + 1];
        const t = map.get(x);
        if (t !== undefined && t !== y) release(x, t);
        const z = reverse.get(y);
        if (z !== undefined && z !== x) release(z, y);
        if (map.get(x) === y) {
          moved.delete(x);
          weak.delete(x);
          identical.add(x);
          visited.add(x);
        }
      }
    }
    lockstepUnder(b, s);
  }

  function release(x, y) {
    map.delete(x);
    reverse.delete(y);
    moved.delete(x);
    identical.delete(x);
    weak.delete(x);
    visited.delete(x);
  }

  function ownership(b, s) {
    const stack = [b, s, false],
      pairs = [];
    while (stack.length) {
      const deep = stack.pop(),
        y = stack.pop(),
        x = stack.pop();
      const t = map.get(x),
        z = reverse.get(y);
      if (x !== b) {
        if (t !== undefined && t !== y && identityPaired.has(x)) return null;
        if (z !== undefined && z !== x && identityPaired.has(z)) return null;
      }
      if (t === y && identical.has(x)) continue;
      if (t !== undefined || z !== undefined) pairs.push(x, y);
      if (!isEl(x)) continue;
      if (
        deep ||
        (t !== undefined && t !== y) ||
        (z !== undefined && z !== x)
      ) {
        const xu = unitsOf(x),
          yu = unitsOf(y);
        for (let i = 0; i < xu.length && i < yu.length; i++)
          stack.push(xu[i], yu[i], true);
      } else if (holdsB.has(x) || holdsS.has(y)) {
        const xu = x.tagName === "TEMPLATE" ? x.content : x,
          yu = y.tagName === "TEMPLATE" ? y.content : y;
        for (let a = xu.firstElementChild, c = yu.firstElementChild; a && c; ) {
          if (ignored(a)) {
            a = a.nextElementSibling;
            continue;
          }
          if (ignored(c)) {
            c = c.nextElementSibling;
            continue;
          }
          if (map.has(a) || reverse.has(c) || holdsB.has(a) || holdsS.has(c))
            stack.push(a, c, false);
          a = a.nextElementSibling;
          c = c.nextElementSibling;
        }
      }
    }
    return pairs;
  }

  function lockstepUnder(b, s) {
    pair(b, s);
    identical.add(b);
    if (isEl(b)) visited.add(b);
  }

  /**
   * Pair the children of an identical pair, one level, on demand. A merge
   * that descends into an identical subtree (hooks present, or a children
   * only morph) needs the pairs; one that skips it never pays for them.
   */
  function pairIdenticalChildren(b) {
    const s = map.get(b);
    if (!s || !isEl(b)) return;
    const bu = unitsOf(b),
      su = unitsOf(s);
    for (let i = 0; i < bu.length && i < su.length; i++)
      if (!map.has(bu[i])) lockstepUnder(bu[i], su[i]);
  }

  function passSigHint(freeB, freeS) {
    const key = (u) =>
      isEl(u) && !codeLike(u) ? meta(u).sig + "\u0003" + meta(u).hint : null;
    const cb = countBy(freeB, key),
      cs = countBy(freeS, key);
    const sideByKey = new Map();
    for (const s of freeS) {
      const k = key(s);
      if (k != null && cs.get(k) === 1) sideByKey.set(k, s);
    }
    for (const b of freeB) {
      if (map.has(b)) continue;
      const k = key(b);
      if (k == null || cb.get(k) !== 1) continue;
      const s = sideByKey.get(k);
      if (s && !reverse.has(s) && keysAgree(b, s)) pair(b, s);
    }
  }

  // Similar elements pair by the best score across the whole parent, not
  // first come first served: an emptied list and the grown list it fed
  // both contain the grown list's items, and only the fuller match keeps
  // the grown list from reading as a rewrite of the wrong one.
  function passSigSimilar(freeB, freeS, bUnits, sUnits) {
    const buckets = new Map();
    for (const s of freeS) {
      if (!isEl(s) || reverse.has(s) || codeLike(s)) continue;
      const sig = meta(s).sig;
      if (!buckets.has(sig)) buckets.set(sig, []);
      buckets.get(sig).push({ el: s, index: posS.get(s) });
    }
    const cands = [];
    for (const b of freeB) {
      if (map.has(b) || !isEl(b) || codeLike(b)) continue;
      const bucket = buckets.get(meta(b).sig);
      if (!bucket || !bucket.length) continue;
      const bi = posB.get(b);
      let near = bucket
        .filter((c) => !reverse.has(c.el))
        .map((c) => ({ c, d: Math.abs(c.index - bi) }));
      near.sort((x, y) => x.d - y.d);
      if (near.length > NEAREST_WINDOW) near = near.slice(0, NEAREST_WINDOW);
      for (const { c, d } of near) {
        if (!keysAgree(b, c.el)) continue;
        const sc = score(b, c.el);
        if (sc && sc.coef >= 0.5)
          cands.push({ b, s: c.el, coef: sc.coef, share: sc.share, d, bi });
      }
    }
    cands.sort(
      (x, y) =>
        y.coef - x.coef || y.share - x.share || x.d - y.d || x.bi - y.bi,
    );
    if (stats && cands.length > 1) {
      const best = new Map();
      for (const c of cands) {
        const t = best.get(c.b);
        if (!t)
          best.set(c.b, { coef: c.coef, share: c.share, strict: 0, loose: 0 });
        else if (t.coef === c.coef) {
          if (t.share === c.share) t.strict++;
          else t.loose++;
        }
      }
      for (const [b, t] of best) {
        if (tieCounted.has(b) || !(t.strict || t.loose)) continue;
        tieCounted.add(b);
        if (t.strict) stats.similarTiesStrict++;
        else stats.similarTiesLoose++;
      }
    }
    for (const c of cands)
      if (!map.has(c.b) && !reverse.has(c.s)) pair(c.b, c.s);
  }

  function compatible(b, s) {
    if (isEl(b) !== isEl(s)) return false;
    if (isEl(b)) {
      if (b.tagName !== s.tagName || !keysAgree(b, s)) return false;
      if (codeLike(b)) return true;
      // An element that was empty on one side (a new paragraph being typed
      // into, a cleared field) pairs positionally; similarity has nothing to
      // compare, and two fills of the same empty element surface as a
      // collision conflict rather than as a duplicate.
      if (meta(b).hint === "" || meta(s).hint === "") return true;
      return similar(b, s);
    }
    return b.kind === s.kind;
  }

  /**
   * Text and comment runs pair by the element they follow: the run after
   * element E on the base side is the run after E's twin on the side. This
   * survives reorders, where global order would skew every run by one.
   */
  function pairRunsByAnchor(bUnits, sUnits) {
    const runAfter = (units, el) => {
      const i =
        el === null ? -1 : units === sUnits ? posS.get(el) : posB.get(el);
      const next = units[i + 1];
      return next && !isEl(next) ? next : null;
    };
    let prevEl = null;
    for (const b of bUnits) {
      if (isEl(b)) {
        prevEl = b;
        continue;
      }
      if (map.has(b)) continue;
      const twin = prevEl === null ? null : map.get(prevEl);
      if (prevEl !== null && !twin) continue;
      const s = runAfter(sUnits, twin);
      if (s && !reverse.has(s) && s.kind === b.kind) pair(b, s);
    }
  }

  function passPositional(bUnits, sUnits) {
    pairRunsByAnchor(bUnits, sUnits);
    // An empty line where a block with words was is that block cleared only
    // in its own slot; elsewhere it is a new line (Enter) beside a deletion.
    const sameSlot = slotTest(bUnits, sUnits);
    const emptiedElsewhere = (b, s) =>
      isEl(b) &&
      meta(b).hint !== "" &&
      meta(s).hint === "" &&
      !!s.querySelector("br") &&
      !sameSlot(b, s);
    let cursor = 0;
    for (const b of bUnits) {
      if (map.has(b)) {
        const si = posS.get(map.get(b));
        if (si !== undefined && si >= cursor) cursor = si + 1;
        continue;
      }
      let looked = 0;
      for (
        let i = cursor;
        i < sUnits.length && looked < POSITIONAL_LOOKAHEAD;
        i++
      ) {
        const s = sUnits[i];
        if (reverse.has(s)) continue;
        looked++;
        if (compatible(b, s) && !isBanned(b, s) && !emptiedElsewhere(b, s)) {
          pair(b, s);
          if (isEl(b) && (meta(b).hint === "" || meta(s).hint === ""))
            weak.add(b);
          cursor = i + 1;
          break;
        }
      }
    }
    pairUnambiguous(bUnits, sUnits);
  }

  /**
   * Unambiguous replacement: exactly one element of a tag is unpaired on
   * each side and both sit in the same slot: the same index, or after the
   * same paired element. That is the same slot with rewritten content (a
   * heading retitled, a container whose insides changed). With any second
   * candidate the shift could be an insertion, so no pair. The pair is weak:
   * a move with content evidence takes the side element over. Runs before the hash passes because it needs no hashing,
   * which keeps an ordinary edit from hashing the whole document.
   */
  // The same slot: the same index, or the same paired element before it
  // (an insertion or deletion further up shifts the index, not the slot).
  function slotTest(bUnits, sUnits) {
    const anchor = (units, i, has) => {
      for (let j = i - 1; j >= 0; j--)
        if (isEl(units[j]) && has(units[j])) return units[j];
      return null;
    };
    return (b, s) => {
      const bi = posB.get(b),
        si = posS.get(s);
      if (bi === si) return true;
      const ab = anchor(bUnits, bi, (u) => map.has(u)),
        as = anchor(sUnits, si, (u) => reverse.has(u));
      return ab ? map.get(ab) === as : !as;
    };
  }

  function pairUnambiguous(bUnits, sUnits) {
    const leftB = bUnits.filter((u) => isEl(u) && !map.has(u)),
      leftS = sUnits.filter((u) => isEl(u) && !reverse.has(u));
    if (!leftB.length || !leftS.length) return;
    const byTagB = countBy(leftB, (u) => u.tagName),
      byTagS = countBy(leftS, (u) => u.tagName);
    const sameSlot = slotTest(bUnits, sUnits);
    for (const b of leftB) {
      const tag = b.tagName;
      if (byTagB.get(tag) !== 1 || byTagS.get(tag) !== 1) continue;
      const s = leftS.find((u) => u.tagName === tag);
      if (
        s &&
        !reverse.has(s) &&
        sameSlot(b, s) &&
        keysAgree(b, s) &&
        !isBanned(b, s)
      ) {
        // An equal pair is identical, not merely the only candidate: pairing
        // it weakly would make the merge descend into content nobody changed.
        if (equalUnits(b, s)) lockstep(b, s);
        else {
          pair(b, s);
          weak.add(b);
        }
      }
    }
  }

  function moves() {
    // A base element paired only by its slot whose exact copy sits unpaired
    // elsewhere on the side moved there: the copy is the stronger evidence.
    const weakByHash = new Map();
    for (const b of weak)
      if (isEl(b) && isEl(map.get(b))) {
        const h = meta(b).hash;
        if (!weakByHash.has(h)) weakByHash.set(h, []);
        weakByHash.get(h).push(b);
      }
    if (weakByHash.size)
      for (const s of unpairedSide) {
        if (reverse.has(s) || !isEl(s) || ownedS(s)) continue;
        const list = weakByHash.get(meta(s).hash);
        const b =
          list &&
          list.find(
            (x) =>
              weak.has(x) &&
              !isBanned(x, s) &&
              keysAgree(x, s) &&
              namesAgree(x, s) &&
              equalUnits(x, s) &&
              mayLockstep(x, s),
          );
        if (!b) continue;
        unpair(b);
        lockstep(b, s);
        anywhere(b, s);
        moved.add(b);
      }
    const byHash = new Map(),
      bySig = new Map();
    // A side element paired only by position (a weak pair) is still free for
    // a move: content evidence beats a slot. Its base partner goes back to
    // the unpaired.
    const weakOf = new Map();
    for (const b of weak) {
      const s = map.get(b);
      if (isEl(b) && isEl(s)) weakOf.set(s, b);
    }
    // Never from a weak pair's own descendant: that would pair the side
    // container with a piece of its base twin.
    const free = (s, b) => {
      if (!reverse.has(s)) return !ownedS(s);
      const w = weakOf.get(s);
      return w === reverse.get(s) && w !== b && !w.contains(b);
    };
    const take = (s) => {
      if (reverse.has(s)) {
        const w = weakOf.get(s);
        weakOf.delete(s);
        unpair(w);
      }
    };
    for (const s of [...unpairedSide, ...weakOf.keys()]) {
      if (reverse.has(s) && !weakOf.has(s)) continue;
      const h = meta(s).hash;
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(s);
      if (codeLike(s)) continue;
      const sig = meta(s).sig;
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(s);
    }
    // A base element paired by its slot with a dissimilar rewrite is a move
    // candidate too: an edited copy elsewhere is the stronger evidence, and
    // the rewrite in its slot is then an insertion.
    const slotOnly = new Set();
    for (const b of weak) {
      const s = map.get(b);
      if (!isEl(b) || !isEl(s) || codeLike(b)) continue;
      if (meta(b).hint === "" || meta(s).hint === "") continue;
      if (!similar(b, s)) slotOnly.add(b);
    }
    for (const b of [...unpairedBase, ...slotOnly]) {
      const was = map.get(b);
      if (was ? !(weak.has(b) && slotOnly.has(b)) : ownedB(b)) continue;
      const claim = (s) => {
        if (was) unpair(b);
        take(s);
      };
      const same = byHash.get(meta(b).hash);
      if (same) {
        const s = same.find(
          (x) =>
            x !== was &&
            free(x, b) &&
            !isBanned(b, x) &&
            namesAgree(b, x) &&
            equalUnits(b, x) &&
            mayLockstep(b, x),
        );
        if (s) {
          claim(s);
          lockstep(b, s);
          anywhere(b, s);
          moved.add(b);
          continue;
        }
      }
      if (codeLike(b) || budget <= 0) continue;
      const bucket = bySig.get(meta(b).sig);
      if (!bucket) continue;
      let hit = null,
        count = 0;
      for (const s of bucket) {
        if (
          s === was ||
          !free(s, b) ||
          !keysAgree(b, s) ||
          !namesAgree(b, s) ||
          isBanned(b, s)
        )
          continue;
        if (budget-- <= 0) break;
        if (similar(b, s)) {
          count++;
          hit = s;
          if (count > 1) break;
        }
      }
      if (count > 1 && refused) refused.add(b);
      if (count === 1) {
        claim(hit);
        pair(b, hit);
        anywhere(b, hit);
        moved.add(b);
        queue.push([b, hit]);
      }
    }
  }
}

function countBy(list, keyOf) {
  const m = new Map();
  for (const u of list) {
    const k = keyOf(u);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
