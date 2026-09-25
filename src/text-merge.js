/**
 * text-merge.js — character-level diff and three-way merge for text.
 *
 * Pure functions, no DOM. `diff` is Myers' O(ND) algorithm over UTF-16 code
 * units with surrogate pairs kept together. `merge3Text` merges two edits of
 * one base string hunk by hunk and returns a mapper from a caret offset in
 * the LOCAL text to the merged text.
 *
 * Cost bounds: strings longer than MAX_CHARS, or an edit distance above
 * MAX_EDITS, fall back to line granularity, then to whole-value merge.
 */

export const MAX_CHARS = 20000;
export const MAX_EDITS = 4000;

/**
 * @typedef {object} Hunk
 * @property {number} bs - start offset in the base (inclusive)
 * @property {number} be - end offset in the base (exclusive)
 * @property {string} text - replacement text for base[bs, be)
 */

function units(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out.push(s.slice(i, i + 2));
        i++;
        continue;
      }
    }
    out.push(s[i]);
  }
  return out;
}

/**
 * Myers diff over two token arrays. Returns [op, aIndex, bIndex] triples with
 * op 0 (equal), -1 (delete a[aIndex]), 1 (insert b[bIndex]); null when the
 * edit distance exceeds maxD.
 */
function myers(a, b, maxD) {
  const n = a.length, m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(Int32Array.from(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  if (!found) return null;
  const ops = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push([0, x - 1, y - 1]); x--; y--; }
    if (d > 0) {
      if (x === prevX) { ops.push([1, x, y - 1]); y--; }
      else { ops.push([-1, x - 1, y]); x--; }
    }
  }
  while (x > 0 && y > 0) { ops.push([0, x - 1, y - 1]); x--; y--; }
  ops.reverse();
  return ops;
}

function opsToHunks(ops, a, b) {
  const aOff = new Int32Array(a.length + 1);
  for (let i = 0; i < a.length; i++) aOff[i + 1] = aOff[i] + a[i].length;
  const hunks = [];
  let cur = null;
  let ai = 0;
  for (const [op, ia, ib] of ops) {
    if (op === 0) {
      if (cur) { hunks.push(cur); cur = null; }
      ai = ia + 1;
      continue;
    }
    if (!cur) cur = { bs: aOff[ai], be: aOff[ai], text: "" };
    if (op === -1) { cur.be = aOff[ia + 1]; ai = ia + 1; }
    else cur.text += b[ib];
  }
  if (cur) hunks.push(cur);
  return hunks;
}

/**
 * Character-level hunks that transform `base` into `side`; null when the
 * edit distance exceeds maxD.
 * @param {string} base
 * @param {string} side
 * @param {number} [maxD]
 * @returns {Hunk[] | null}
 */
export function diff(base, side, maxD = MAX_EDITS) {
  if (base === side) return [];
  const a = units(base), b = units(side);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const am = a.slice(p, a.length - s), bm = b.slice(p, b.length - s);
  const ops = myers(am, bm, maxD);
  if (!ops) return null;
  const prefixLen = a.slice(0, p).join("").length;
  const hunks = opsToHunks(ops, am, bm);
  for (const h of hunks) { h.bs += prefixLen; h.be += prefixLen; }
  return coalesce(hunks, base);
}

/**
 * Join hunks separated by a short equal run. Myers finds shared letters
 * inside rewritten words ("lazy" -> "sleepy" shares "l" and "y"), which
 * would split one edit into several and let another side's edit interleave
 * with it. A gap of up to COALESCE_GAP characters is absorbed.
 */
const COALESCE_GAP = 3;
function coalesce(hunks, base) {
  if (hunks.length < 2) return hunks;
  const out = [hunks[0]];
  for (let i = 1; i < hunks.length; i++) {
    const cur = out[out.length - 1], next = hunks[i];
    if (next.bs - cur.be <= COALESCE_GAP) {
      cur.text += base.slice(cur.be, next.bs) + next.text;
      cur.be = next.be;
    } else out.push(next);
  }
  return out;
}

function diffLines(base, side) {
  const a = base.split("\n"), b = side.split("\n");
  const aTok = a.map((l, i) => (i < a.length - 1 ? l + "\n" : l));
  const bTok = b.map((l, i) => (i < b.length - 1 ? l + "\n" : l));
  const ops = myers(aTok, bTok, MAX_EDITS);
  if (!ops) return null;
  return opsToHunks(ops, aTok, bTok);
}

function hunksFor(base, side) {
  if (base.length <= MAX_CHARS && side.length <= MAX_CHARS) {
    const h = diff(base, side);
    if (h) return { hunks: h, granularity: "char" };
  }
  const l = diffLines(base, side);
  if (l) return { hunks: l, granularity: "line" };
  return { hunks: [{ bs: 0, be: base.length, text: side }], granularity: "whole" };
}

/** Apply hunks (all within [bs, be)) to that slice of base. */
function applyHunks(base, hunks, bs, be) {
  let out = "", pos = bs;
  for (const h of hunks) { out += base.slice(pos, h.bs) + h.text; pos = h.be; }
  return out + base.slice(pos, be);
}

/**
 * @typedef {object} Segment  One piece of the merged text, in base order.
 * @property {number} bs - base range start
 * @property {number} be - base range end
 * @property {string} text - the merged text for this range
 * @property {"base" | "local" | "remote" | "conflict"} source
 * @property {Hunk[]} [localHunks] - the local hunks this segment absorbed
 */

/**
 * @typedef {object} TextMergeResult
 * @property {string} text
 * @property {Array<{ bs: number, be: number, local: string, remote: string, resolved: string }>} conflicts
 * @property {function(number): number} mapLocalOffset - caret offset in LOCAL -> merged
 * @property {"char" | "line" | "whole"} granularity
 */

/**
 * Three-way merge of two edits of `base`.
 * @param {string} base
 * @param {string} local
 * @param {string} remote
 * @param {"remote" | "local" | "both"} [policy]
 * @returns {TextMergeResult}
 */
export function merge3Text(base, local, remote, policy = "remote") {
  if (local === remote || remote === base) {
    return { text: local, conflicts: [], mapLocalOffset: (n) => Math.min(n, local.length), granularity: "char" };
  }
  const L = local === base ? { hunks: [], granularity: "char" } : hunksFor(base, local);
  const R = hunksFor(base, remote);
  const granularity = [L.granularity, R.granularity].includes("whole") ? "whole"
    : [L.granularity, R.granularity].includes("line") ? "line" : "char";
  const lh = L.hunks, rh = R.hunks;

  /** @type {Segment[]} */
  const segments = [];
  const conflicts = [];
  let pos = 0, li = 0, ri = 0;
  const pushBase = (to) => { if (to > pos) { segments.push({ bs: pos, be: to, text: base.slice(pos, to), source: "base" }); pos = to; } };

  while (li < lh.length || ri < rh.length) {
    const l = lh[li], r = rh[ri];
    const takeL = !!l && (!r || l.bs < r.bs || (l.bs === r.bs && l.be <= r.be));
    const h = takeL ? l : r;
    const other = takeL ? r : l;
    const overlaps = other && other.bs < h.be && h.bs < other.be;
    if (overlaps) {
      let bs = Math.min(h.bs, other.bs), be = Math.max(h.be, other.be);
      let lEnd = li, rEnd = ri, grew = true;
      while (grew) {
        grew = false;
        while (lEnd < lh.length && lh[lEnd].bs < be && lh[lEnd].be > bs) { be = Math.max(be, lh[lEnd].be); bs = Math.min(bs, lh[lEnd].bs); lEnd++; grew = true; }
        while (rEnd < rh.length && rh[rEnd].bs < be && rh[rEnd].be > bs) { be = Math.max(be, rh[rEnd].be); bs = Math.min(bs, rh[rEnd].bs); rEnd++; grew = true; }
      }
      const localHunks = lh.slice(li, lEnd);
      const localText = applyHunks(base, localHunks, bs, be);
      const remoteText = applyHunks(base, rh.slice(ri, rEnd), bs, be);
      const resolved = policy === "local" ? localText : policy === "both" ? localText + remoteText : remoteText;
      conflicts.push({ bs, be, local: localText, remote: remoteText, resolved });
      pushBase(bs);
      segments.push({ bs, be, text: resolved, source: "conflict", localHunks, localText, keepsLocal: policy !== "remote" });
      pos = be; li = lEnd; ri = rEnd;
      continue;
    }
    pushBase(h.bs);
    segments.push({ bs: h.bs, be: h.be, text: h.text, source: takeL ? "local" : "remote", localHunks: takeL ? [h] : [] });
    pos = h.be;
    if (takeL) li++; else ri++;
  }
  pushBase(base.length);

  const text = segments.map((s) => s.text).join("");
  return { text, conflicts, mapLocalOffset: makeMapper(base, lh, segments), granularity };
}

/**
 * Local offset -> merged offset.
 *
 * Step 1 walks the local hunks to express the local offset as a base offset,
 * or as (hunk, inner) when the caret sits inside locally inserted text.
 * Step 2 walks the merged segments: a base offset lands at the same relative
 * position inside a base segment, at the start of a remote segment covering
 * it, or, for a caret inside a local hunk, at the corresponding position of
 * that hunk's text within the segment that absorbed it (clamped to the
 * segment end when the local text was dropped by a remote-wins conflict).
 */
function makeMapper(base, localHunks, segments) {
  return (localOffset) => {
    // Step 1: local -> base
    let baseOff = null, inHunk = null, inner = 0;
    let lPos = 0, bPos = 0;
    for (const h of localHunks) {
      const eq = h.bs - bPos;
      if (localOffset <= lPos + eq) { baseOff = bPos + (localOffset - lPos); break; }
      lPos += eq; bPos = h.bs;
      if (localOffset <= lPos + h.text.length) { inHunk = h; inner = localOffset - lPos; baseOff = h.bs; break; }
      lPos += h.text.length; bPos = h.be;
    }
    if (baseOff === null) baseOff = bPos + (localOffset - lPos);

    // Step 2: base -> merged
    let mergedPos = 0;
    for (const seg of segments) {
      // A caret exactly at a segment's start stays before that segment,
      // including before text another side inserted at the caret.
      if (!inHunk && baseOff <= seg.bs) return mergedPos;
      const covers = inHunk ? seg.localHunks && seg.localHunks.includes(inHunk) : baseOff < seg.be;
      if (!covers) {
        mergedPos += seg.text.length;
        continue;
      }
      if (seg.source === "base") return mergedPos + (baseOff - seg.bs);
      if (seg.source === "remote") return mergedPos + seg.text.length; // clamp after remote's replacement
      if (seg.source === "local") return mergedPos + Math.min(inner, seg.text.length);
      // conflict
      if (!seg.keepsLocal || !inHunk) return mergedPos + seg.text.length;
      const before = applyHunks(base, seg.localHunks.slice(0, seg.localHunks.indexOf(inHunk)), seg.bs, inHunk.bs);
      return mergedPos + Math.min(before.length + inner, seg.localText.length);
    }
    return mergedPos;
  };
}
