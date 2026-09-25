/**
 * align.js — pair the nodes of a base tree with the nodes of one side.
 *
 * Three passes:
 *   1. identity, global: equal usable ids with equal tag, anywhere.
 *   2. structure, top-down over paired elements: per parent, children pair by
 *      identical subtree hash, then signature plus hint, then signature plus
 *      similar text (nearest index), then position.
 *   3. moves, global: what is still unpaired on both sides pairs by identical
 *      hash, else by signature and similar text, bounded by a budget.
 *
 * Text is aligned as runs (see similarity.js). No element pair is ever made
 * on tag and class alone: an identity, an identical hash, or similar text is
 * required, or the two are a delete and an insert.
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
 * @returns {Alignment}
 */
export function align(baseRoot, sideRoot, o) {
  const { meta, unitsOf, unitHash, similar } = o.analyzer;
  const map = new Map(), reverse = new Map();
  const moved = new Set(), identical = new Set();
  const visited = new Set();
  const unpairedBase = [], unpairedSide = [];
  const queue = [];
  let budget = MOVE_BUDGET;

  const pair = (b, s) => { map.set(b, s); reverse.set(s, b); };
  const isEl = (u) => !!u && u.nodeType === 1;
  const codeLike = (el) => CODE_LIKE.has(el.tagName);

  // Pass 1: identity.
  pair(baseRoot, sideRoot);
  for (const [id, b] of o.baseIndex) {
    const s = o.sideIndex.get(id);
    if (s && s.tagName === b.tagName && !map.has(b) && !reverse.has(s)) pair(b, s);
  }

  // Pass 2: structure, from the root and from every identity pair.
  queue.push([baseRoot, sideRoot]);
  for (const [b, s] of map) if (isEl(b) && b !== baseRoot) queue.push([b, s]);
  drain();

  // Pass 3: moves, then the children of moved pairs.
  moves();
  drain();

  return { map, reverse, moved, identical };

  function drain() {
    while (queue.length) {
      const [b, s] = queue.shift();
      if (visited.has(b) || identical.has(b)) continue;
      alignKids(b, s);
    }
  }

  function alignKids(bEl, sEl) {
    visited.add(bEl);
    const bUnits = unitsOf(bEl), sUnits = unitsOf(sEl);
    const freeB = bUnits.filter((u) => !map.has(u));
    const freeS = sUnits.filter((u) => !reverse.has(u));
    if (freeB.length && freeS.length) {
      passIdentical(freeB, freeS);
      passSigHint(freeB, freeS);
      passSigSimilar(freeB, freeS, bUnits, sUnits);
      passPositional(bUnits, sUnits);
    }
    for (const u of bUnits) {
      if (!map.has(u)) { if (isEl(u)) unpairedBase.push(u); continue; }
      if (isEl(u) && !identical.has(u)) queue.push([u, map.get(u)]);
    }
    for (const u of sUnits) if (!reverse.has(u) && isEl(u)) unpairedSide.push(u);
  }

  function passIdentical(freeB, freeS) {
    const byHashB = countBy(freeB, unitHash), byHashS = countBy(freeS, unitHash);
    const sideByHash = new Map();
    for (const s of freeS) { const h = unitHash(s); if (byHashS.get(h) === 1) sideByHash.set(h, s); }
    for (const b of freeB) {
      if (map.has(b)) continue;
      const h = unitHash(b);
      if (byHashB.get(h) !== 1) continue;
      const s = sideByHash.get(h);
      if (s && !reverse.has(s)) lockstep(b, s);
    }
  }

  /**
   * Pair two identical subtrees unit by unit without scoring. Descendants
   * must still be paired so apply can keep every live node, but nothing
   * about them needs to be compared.
   */
  function lockstep(b, s) {
    pair(b, s);
    identical.add(b);
    if (!isEl(b)) return;
    visited.add(b);
    const bu = unitsOf(b), su = unitsOf(s);
    for (let i = 0; i < bu.length && i < su.length; i++) lockstep(bu[i], su[i]);
  }

  function passSigHint(freeB, freeS) {
    const key = (u) => (isEl(u) && !codeLike(u) ? meta(u).sig + "\u0003" + meta(u).hint : null);
    const cb = countBy(freeB, key), cs = countBy(freeS, key);
    const sideByKey = new Map();
    for (const s of freeS) { const k = key(s); if (k != null && cs.get(k) === 1) sideByKey.set(k, s); }
    for (const b of freeB) {
      if (map.has(b)) continue;
      const k = key(b);
      if (k == null || cb.get(k) !== 1) continue;
      const s = sideByKey.get(k);
      if (s && !reverse.has(s)) pair(b, s);
    }
  }

  function passSigSimilar(freeB, freeS, bUnits, sUnits) {
    const buckets = new Map();
    for (const s of freeS) {
      if (!isEl(s) || reverse.has(s) || codeLike(s)) continue;
      const sig = meta(s).sig;
      if (!buckets.has(sig)) buckets.set(sig, []);
      buckets.get(sig).push({ el: s, index: sUnits.indexOf(s) });
    }
    for (const b of freeB) {
      if (map.has(b) || !isEl(b) || codeLike(b)) continue;
      const bucket = buckets.get(meta(b).sig);
      if (!bucket || !bucket.length) continue;
      const bi = bUnits.indexOf(b);
      let cands = bucket.filter((c) => !reverse.has(c.el)).map((c) => ({ c, d: Math.abs(c.index - bi) }));
      cands.sort((x, y) => x.d - y.d);
      if (cands.length > NEAREST_WINDOW) cands = cands.slice(0, NEAREST_WINDOW);
      for (const { c } of cands) {
        if (similar(b, c.el)) { pair(b, c.el); break; }
      }
    }
  }

  function compatible(b, s) {
    if (isEl(b) !== isEl(s)) return false;
    if (isEl(b)) {
      if (b.tagName !== s.tagName) return false;
      if (codeLike(b)) return true;
      return similar(b, s);
    }
    return b.kind === s.kind;
  }

  function passPositional(bUnits, sUnits) {
    let cursor = 0;
    for (const b of bUnits) {
      if (map.has(b)) {
        const si = sUnits.indexOf(map.get(b));
        if (si >= cursor) cursor = si + 1;
        continue;
      }
      let looked = 0;
      for (let i = cursor; i < sUnits.length && looked < POSITIONAL_LOOKAHEAD; i++) {
        const s = sUnits[i];
        if (reverse.has(s)) continue;
        looked++;
        if (compatible(b, s)) { pair(b, s); cursor = i + 1; break; }
      }
    }
  }

  function moves() {
    const byHash = new Map(), bySig = new Map();
    for (const s of unpairedSide) {
      if (reverse.has(s)) continue;
      const h = meta(s).hash;
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(s);
      if (codeLike(s)) continue;
      const sig = meta(s).sig;
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(s);
    }
    for (const b of unpairedBase) {
      if (map.has(b)) continue;
      const same = byHash.get(meta(b).hash);
      if (same) {
        const s = same.find((x) => !reverse.has(x));
        if (s) { lockstep(b, s); moved.add(b); continue; }
      }
      if (codeLike(b) || budget <= 0) continue;
      const bucket = bySig.get(meta(b).sig);
      if (!bucket) continue;
      let hit = null, count = 0;
      for (const s of bucket) {
        if (reverse.has(s)) continue;
        if (budget-- <= 0) break;
        if (similar(b, s)) { count++; hit = s; if (count > 1) break; }
      }
      if (count === 1) { pair(b, hit); moved.add(b); queue.push([b, hit]); }
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
