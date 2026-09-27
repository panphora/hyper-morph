/**
 * text-merge.js — word-level diff and three-way merge for text.
 *
 * Pure functions, no DOM. Text is tokenized into words, whitespace runs and
 * punctuation (Intl.Segmenter, so scripts without spaces segment into words;
 * a regex fast path when all input is ASCII). Myers runs over token keys.
 *
 * Rules:
 *   - hunks that overlap conflict; a text insertion touching the other
 *     side's change conflicts; two replacements that only touch both land
 *   - two pure insertions at the same point both land, local first
 *   - identical hunks on both sides land once
 *   - nbsp and space compare equal; the raw form follows the side that
 *     changed it, and the policy side when both did, with no conflict
 *   - tag tokens (object keys) are supported for inline merging: a conflict
 *     that swallows one tag of an element swallows every hunk on that side
 *     that mentions the element
 *
 * Cost bounds: over MAX_TOKENS tokens, line granularity; over MAX_EDITS
 * edits at either granularity, the diff of that side is one coarse hunk
 * (diffTokens never fails), so a merge always has a word or line result.
 */
export const MAX_TOKENS = 20000;
export const MAX_EDITS = 4000;

/**
 * Work counters for the tests: a bound on steps holds where a wall clock
 * would be flaky. `diff` counts Myers diagonal visits and snake steps.
 */
export const steps = { diff: 0 };

// ---------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------
const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

const NO_SPACE_SCRIPTS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const FALLBACK_WORD = /[\p{L}\p{M}\p{N}_'’]+|\s+|[\s\S]/gu;
const GRAPHEME = /\P{M}\p{M}*/gu;

export function words(s) {
  if (s === "") return [];
  if (segmenter) {
    const out = [];
    for (const seg of segmenter.segment(s)) out.push(seg.segment);
    return out;
  }
  const out = [];
  for (const m of s.match(FALLBACK_WORD)) {
    if (NO_SPACE_SCRIPTS.test(m))
      for (const g of m.match(GRAPHEME)) out.push(g);
    else out.push(m);
  }
  return out;
}

const SPACE_LIKE = /^[  ]+$/;
export const normKey = (w) => (SPACE_LIKE.test(w) ? " ".repeat(w.length) : w);
export const isSpace = (t) => typeof t.k === "string" && /^\s+$/.test(t.k);
// The block break of the inline merge (src/inline-merge.js flattens a run
// of sibling blocks with this character after each block). It is a token
// of its own, and in an echo it counts as whitespace: text both sides
// typed at one point is one insertion even when one side then pressed
// Enter there.
export const BREAK = "\u001E";
const plain = (ts) => ts.every((t) => isSpace(t) || t.k === BREAK);

const ASCII = /^[\x00-\x7f\u00A0]*$/;
const FAST = /[A-Za-z0-9_']+|[ \u00A0]+|\s|./g;
export function wordsFast(s) {
  return s === "" ? [] : s.match(FAST);
}
/** Tokenize one string; `fast` when every string of the merge is ASCII. */
export function textTokens(s, fast = false) {
  return (fast ? wordsFast(s) : words(s)).map((w) => ({
    k: normKey(w),
    raw: w,
    len: w.length,
  }));
}
export const allAscii = (...strs) => strs.every((s) => ASCII.test(s));

// ---------------------------------------------------------------------
// Myers over token keys (ported from src/text-merge.js, keys compared by ===)
// ---------------------------------------------------------------------
function myers(a, b, maxD) {
  const n = a.length,
    m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds the band k in [-d, d] of v as it stood before row d, so
  // the trace costs O(D^2) instead of O(D * (n + m)) copies of the whole
  // array; entry i of trace[d] is diagonal k = i - d
  const trace = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]))
        x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      while (x < n && y < m && a[x].k === b[y].k) {
        x++;
        y++;
      }
      steps.diff += 1 + x - x0;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  const ops = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const i = k + d;
    const prevK =
      k === -d || (k !== d && vd[i - 1] < vd[i + 1]) ? k + 1 : k - 1;
    const prevX = vd[prevK + d];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push([0, x - 1, y - 1]);
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push([1, x, y - 1]);
      y--;
    } else {
      ops.push([-1, x - 1, y]);
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push([0, x - 1, y - 1]);
    x--;
    y--;
  }
  ops.reverse();
  return ops;
}

/**
 * Token hunks transforming B into S. Each hunk: { bs, be, toks, keys }
 * in B token indices. Cosmetic hunks (equal key, different raw) are returned
 * separately: { bi, tok }.
 */
export function diffTokens(B, S, maxD = MAX_EDITS) {
  const cosmetic = [];
  let p = 0;
  while (p < B.length && p < S.length && B[p].k === S[p].k) {
    if (B[p].raw !== S[p].raw) cosmetic.push({ bi: p, tok: S[p] });
    p++;
  }
  let s = 0;
  while (
    s < B.length - p &&
    s < S.length - p &&
    B[B.length - 1 - s].k === S[S.length - 1 - s].k
  ) {
    if (B[B.length - 1 - s].raw !== S[S.length - 1 - s].raw)
      cosmetic.push({ bi: B.length - 1 - s, tok: S[S.length - 1 - s] });
    s++;
  }
  const am = B.slice(p, B.length - s),
    bm = S.slice(p, S.length - s);
  // A middle that shares few words is a rewrite: one hunk, no Myers. Also
  // the answer when Myers exceeds maxD (prefix and suffix are already trimmed).
  const ops = sharesFew(am, bm) ? null : myers(am, bm, maxD);
  if (!ops) {
    const hunks =
      am.length || bm.length ? [{ bs: p, be: p + am.length, toks: bm }] : [];
    return {
      hunks,
      cosmetic,
      coarse: true,
      parts: hunks.map((h) => ({ ...h, gap: [], group: 0 })),
      cosmeticEq: cosmetic,
    };
  }
  // Equal whitespace between two changes is not an anchor: a run of spaces
  // Myers matched inside one edit would split it into two hunks, and a
  // conflict could then swallow one half while the other lands beside it
  // (duplicating the words the second half re-inserts). Such a gap joins
  // the hunks on both sides of it. A newline keeps its anchoring, so edits
  // on separate lines stay separate. The unjoined hunks are returned too, as
  // `parts` in groups, so a three-way merge can leave a part identical on
  // both sides out of the join (an echoed word beside a one-sided edit).
  const parts = [];
  const cosmeticAt = (ia, ib) => {
    if (am[ia].raw !== bm[ib].raw) cosmetic.push({ bi: p + ia, tok: bm[ib] });
  };
  let cur = null;
  let gap = [];
  let group = 0;
  let ai = 0;
  const settle = () => {
    if (cur) parts.push(cur);
    cur = null;
    for (const [ia, ib] of gap) cosmeticAt(ia, ib);
    gap = [];
    group++;
  };
  for (const [op, ia, ib] of ops) {
    if (op === 0) {
      if (cur && isSpace(am[ia]) && !am[ia].k.includes("\n"))
        gap.push([ia, ib]);
      else {
        settle();
        cosmeticAt(ia, ib);
      }
      ai = ia + 1;
      continue;
    }
    if (!cur || gap.length) {
      if (cur) parts.push(cur);
      cur = {
        bs: p + ai,
        be: p + ai,
        toks: [],
        gap: gap.map(([ga, gb]) => ({ bi: p + ga, tok: bm[gb] })),
        group,
      };
      gap = [];
    }
    if (op === -1) {
      cur.be = p + ai + 1;
      ai = ia + 1;
    } else cur.toks.push(bm[ib]);
  }
  settle();
  const joined = joinParts(parts);
  return {
    hunks: joined.hunks,
    cosmetic: cosmetic.concat(joined.cosmetic),
    parts,
    cosmeticEq: cosmetic,
  };
}

/**
 * Join the parts of each group across their whitespace gaps into hunks.
 * A part for which `alone` is true stands on its own and joins nothing on
 * either side. Gap tokens that are not swallowed come back as cosmetic
 * differences.
 */
export function joinParts(parts, alone = () => false) {
  const hunks = [],
    cosmetic = [];
  let cur = null,
    curGroup = -1;
  for (const q of parts) {
    const solo = alone(q);
    if (cur && !cur.alone && !solo && q.group === curGroup) {
      cur.be = q.be;
      for (const g of q.gap) cur.toks.push(g.tok);
      for (const t of q.toks) cur.toks.push(t);
      continue;
    }
    if (cur) hunks.push({ bs: cur.bs, be: cur.be, toks: cur.toks });
    for (const g of q.gap) cosmetic.push(g);
    cur = { bs: q.bs, be: q.be, toks: q.toks.slice(), alone: solo };
    curGroup = q.group;
  }
  if (cur) hunks.push({ bs: cur.bs, be: cur.be, toks: cur.toks });
  return { hunks, cosmetic };
}

/** The same edit on both sides: same base range, same tokens. */
export const sameParts = (a, b) =>
  a.bs === b.bs && a.be === b.be && sameToks(a.toks, b.toks);

/**
 * Both sides' hunks with the join deferred past the identical parts: a part
 * both sides made is one "both" edit, never glued to a neighbour that only
 * one side made.
 */
export function pairedHunks(dL, dR, B) {
  const aloneIn = (others) => (q) => others.some((x) => sameParts(q, x));
  const jl = joinParts(dL.parts, aloneIn(dR.parts)),
    jr = joinParts(dR.parts, aloneIn(dL.parts));
  const cosL = dL.cosmeticEq.concat(jl.cosmetic),
    cosR = dR.cosmeticEq.concat(jr.cosmetic);
  const [lh, rh] = B
    ? splitEchoes(jl.hunks, jr.hunks, B, cosL, cosR)
    : [jl.hunks, jr.hunks];
  return {
    lh,
    rh,
    cosL,
    cosR,
  };
}

/**
 * Text both sides inserted at one point, glued to an edit only one side
 * made: local inserted " w7" after "w0" while remote replaced "w0" with
 * "w10 w7". A hunk of one side and a hunk of the other that end at the same
 * base position with the same tokens (an insertion may slide there across
 * equal base tokens), or begin at the same position with the same tokens,
 * split so the shared tokens are an insertion of their own at that point,
 * which pairs as one edit made on both sides. The rest of an insertion that
 * precedes the shared tokens leads them (`lead`).
 */
function splitEchoes(lh, rh, B, cosL, cosR) {
  const same = (a, b) => a.k === b.k && a.raw === b.raw;
  const sides = [
    { list: lh.map((h) => ({ ...h })), resp: new Set(cosL.map((c) => c.bi)) },
    { list: rh.map((h) => ({ ...h })), resp: new Set(cosR.map((c) => c.bi)) },
  ];
  const isIns = (h) => h.bs === h.be;
  // The tokens of hunk i placed at base position `to`: a replacement only
  // where it already sits, an insertion slid there across equal base tokens
  // no other hunk of its side touches. Null when it cannot go there.
  const place = (S, i, to, edge) => {
    const h = S.list[i];
    if (!isIns(h)) return edge(h) === to ? h.toks : null;
    const lo = i ? S.list[i - 1].be : 0,
      hi = i + 1 < S.list.length ? S.list[i + 1].bs : B.length;
    if (to < lo || to > hi) return null;
    let toks = h.toks,
      at = h.bs;
    while (at > to) {
      const last = toks[toks.length - 1];
      if (!same(last, B[at - 1]) || S.resp.has(at - 1)) return null;
      toks = [last, ...toks.slice(0, -1)];
      at--;
    }
    while (at < to) {
      if (!same(toks[0], B[at]) || S.resp.has(at)) return null;
      toks = [...toks.slice(1), toks[0]];
      at++;
    }
    return toks;
  };
  const split = (S, i, toks, n, tail, P) => {
    const h = S.list[i];
    const shared = tail ? toks.slice(toks.length - n) : toks.slice(0, n),
      rest = tail ? toks.slice(0, toks.length - n) : toks.slice(n);
    const sh = { bs: P, be: P, toks: shared };
    if (isIns(h)) {
      if (!rest.length) {
        S.list[i] = sh;
        return;
      }
      const r = { bs: P, be: P, toks: rest };
      if (tail) r.lead = true;
      S.list.splice(i, 1, ...(tail ? [r, sh] : [sh, r]));
      return;
    }
    const r = { bs: h.bs, be: h.be, toks: rest };
    S.list.splice(i, 1, ...(tail ? [r, sh] : [sh, r]));
  };
  // Both sides replaced the same base tokens and share a head or tail: the
  // shared part is one replacement of those tokens (an echo), and what one
  // side typed beyond it is an insertion beside it.
  const splitSame = (S, i, toks, n, tail) => {
    const h = S.list[i];
    const shared = tail ? toks.slice(toks.length - n) : toks.slice(0, n),
      rest = tail ? toks.slice(0, toks.length - n) : toks.slice(n);
    const sh = { bs: h.bs, be: h.be, toks: shared };
    if (!rest.length) {
      S.list[i] = sh;
      return;
    }
    const r = tail
      ? { bs: h.bs, be: h.bs, toks: rest, lead: true }
      : { bs: h.be, be: h.be, toks: rest };
    S.list.splice(i, 1, ...(tail ? [r, sh] : [sh, r]));
  };
  const X = sides[0],
    Y = sides[1];
  for (let guard = 0; guard < 64; guard++) {
    let changed = false;
    outer: for (let i = 0; i < X.list.length; i++)
      for (let j = 0; j < Y.list.length; j++) {
        const x = X.list[i],
          y = Y.list[j];
        if (x.bs === y.bs && x.be === y.be && sameToks(x.toks, y.toks))
          continue;
        for (const tail of [true, false]) {
          const edge = (h) => (tail ? h.be : h.bs);
          const targets = isIns(x) ? [edge(y), x.bs] : [edge(x)];
          for (const P of targets) {
            const xt = place(X, i, P, edge),
              yt = xt && place(Y, j, P, edge);
            if (!yt) continue;
            const at = (t, k) => (tail ? t[t.length - 1 - k] : t[k]);
            let n = 0;
            while (
              n < xt.length &&
              n < yt.length &&
              at(xt, n).k === at(yt, n).k
            )
              n++;
            if (!n) continue;
            // Two sides that each typed something different beyond the
            // shared part at the same point are two insertions there, and
            // both land whole (split, the two rests would fuse).
            const restX = tail ? xt.slice(0, xt.length - n) : xt.slice(n),
              restY = tail ? yt.slice(0, yt.length - n) : yt.slice(n);
            if (
              n < xt.length &&
              n < yt.length &&
              !plain(restX) &&
              !plain(restY) &&
              ((isIns(x) && isIns(y)) || (x.bs === y.bs && x.be === y.be))
            )
              continue;
            const shared = tail ? xt.slice(xt.length - n) : xt.slice(0, n);
            if (!shared.some((t) => !isSpace(t))) continue;
            if (n === xt.length && n === yt.length && isIns(x) && isIns(y)) {
              if (x.bs === P && y.bs === P) continue;
              X.list[i] = { bs: P, be: P, toks: xt };
              Y.list[j] = { bs: P, be: P, toks: yt };
            } else if (!isIns(x) && x.bs === y.bs && x.be === y.be) {
              splitSame(X, i, xt, n, tail);
              splitSame(Y, j, yt, n, tail);
            } else {
              split(X, i, xt, n, tail, P);
              split(Y, j, yt, n, tail, P);
            }
            changed = true;
            break outer;
          }
        }
      }
    if (!changed) break;
  }
  return [X.list, Y.list];
}

const REWRITE_MIN = 48,
  REWRITE_SHARE = 0.3;
function sharesFew(a, b) {
  const na = a.filter((t) => !isSpace(t)),
    nb = b.filter((t) => !isSpace(t));
  if (Math.min(na.length, nb.length) < REWRITE_MIN) return false;
  const count = new Map();
  for (const t of na) count.set(t.k, (count.get(t.k) || 0) + 1);
  let inter = 0;
  for (const t of nb) {
    const c = count.get(t.k);
    if (c > 0) {
      inter++;
      count.set(t.k, c - 1);
    }
  }
  return inter / Math.min(na.length, nb.length) < REWRITE_SHARE;
}

const keysOf = (h, B) => {
  const ks = new Set();
  for (const t of h.toks) if (typeof t.k !== "string") ks.add(t.k.el);
  for (let i = h.bs; i < h.be; i++)
    if (typeof B[i].k !== "string") ks.add(B[i].k.el);
  return ks;
};

const sameToks = (a, b) =>
  a.length === b.length && a.every((t, i) => t.k === b[i].k);

/**
 * @returns {{ tokens: Array, segments: Array, conflicts: Array, mapLocalOffset, localHunks }}
 * Each output token also carries `src`: "base" | "local" | "remote".
 */
export function merge3Tokens(B, L, R, policy = "remote") {
  const dL = diffTokens(B, L),
    dR = diffTokens(B, R);
  const { lh, rh, cosL: cosLList, cosR: cosRList } = pairedHunks(dL, dR, B);

  const isInsert = (h) => h.bs === h.be;
  const hasText = (h) => h.toks.some((t) => typeof t.k === "string");
  const isTagOnly = (h) => isInsert(h) && !hasText(h);
  const overlap = (h, o) => o.bs < h.be && h.bs < o.be;
  // a text insertion at the edge of the other side's change conflicts; a
  // tag-only insertion (a wrap) at that edge does not; two disjoint
  // replacements do not
  const edgeConflict = (h, o) =>
    !overlap(h, o) &&
    o.bs <= h.be &&
    h.bs <= o.be &&
    ((isInsert(h) && hasText(h)) || (isInsert(o) && hasText(o))) &&
    !(isInsert(h) && isInsert(o));
  const identical = (l, r) =>
    l.bs === r.bs && l.be === r.be && sameToks(l.toks, r.toks);

  // Units: every hunk of either side; identical pairs become one "both" unit.
  const units = [];
  const rUsed = new Set();
  for (const l of lh) {
    const r = rh.find((x) => !rUsed.has(x) && identical(l, x));
    if (r) {
      rUsed.add(r);
      units.push({ bs: l.bs, be: l.be, side: "both", l, r, toks: l.toks });
    } else
      units.push({
        bs: l.bs,
        be: l.be,
        side: "L",
        l,
        toks: l.toks,
        lead: !!l.lead,
      });
  }
  for (const r of rh)
    if (!rUsed.has(r))
      units.push({
        bs: r.bs,
        be: r.be,
        side: "R",
        r,
        toks: r.toks,
        lead: !!r.lead,
      });
  units.sort((a, b) => a.bs - b.bs || a.be - b.be || b.lead - a.lead);
  let collapsedDelta = 0,
    samePoint = 0;
  for (const u of units)
    if (u.side === "both") collapsedDelta += u.toks.length - (u.be - u.bs);

  // Union-find over units: cross-side overlap or edge conflict; same key on
  // one side; then closure over each mixed group's base range.
  const parent = units.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a === b) return false;
    parent[a] = b;
    return true;
  };
  const uKeys = units.map((u) =>
    keysOf({ bs: u.bs, be: u.be, toks: u.toks }, B),
  );
  const byKey = { L: new Map(), R: new Map() };
  units.forEach((u, i) => {
    const sides = u.side === "both" ? ["L", "R"] : [u.side];
    for (const s of sides)
      for (const k of uKeys[i]) {
        if (!byKey[s].has(k)) byKey[s].set(k, []);
        byKey[s].get(k).push(i);
      }
  });
  for (const m of [byKey.L, byKey.R])
    for (const idx of m.values())
      for (let j = 1; j < idx.length; j++) union(idx[0], idx[j]);
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i],
        b = units[j];
      if (a.side === b.side && a.side !== "both") continue;
      if (a.bs > b.be) continue;
      if (overlap(a, b) || edgeConflict(a, b)) union(i, j);
      else if (a.bs === b.bs && isInsert(a) && isInsert(b)) samePoint++;
    }
  // a wrap (tag-only insertion) whose whole content the other side replaced
  // or removed conflicts with those hunks; a wrap around a partial edit does not
  const closeIndexOf = (side, key) => {
    const hs = side === "L" ? lh : rh;
    for (const h of hs)
      if (h.toks.some((t) => t.kind === "close" && t.k.el === key.el))
        return h.bs;
    for (let i = 0; i < B.length; i++)
      if (B[i].kind === "close" && B[i].k.el === key.el) return i;
    return -1;
  };
  units.forEach((u, i) => {
    if (!isTagOnly(u) || u.side === "both") return;
    for (const t of u.toks) {
      if (t.kind !== "open") continue;
      const q = closeIndexOf(u.side, t.k);
      if (q <= u.bs) continue;
      const covered = new Uint8Array(q - u.bs);
      const others = [];
      units.forEach((o, j) => {
        if (o.side === u.side || isInsert(o)) return;
        if (o.bs < q && o.be > u.bs) {
          others.push(j);
          for (let x = Math.max(o.bs, u.bs); x < Math.min(o.be, q); x++)
            covered[x - u.bs] = 1;
        }
      });
      if (others.length && covered.every((c) => c === 1))
        for (const j of others) union(i, j);
    }
  });
  // closure: a mixed group's range swallows every unit inside or touching it
  let grew = true;
  while (grew) {
    grew = false;
    const groups = new Map();
    units.forEach((u, i) => {
      const g = find(i);
      const info = groups.get(g) || { bs: u.bs, be: u.be, L: false, R: false };
      info.bs = Math.min(info.bs, u.bs);
      info.be = Math.max(info.be, u.be);
      if (u.side !== "R") info.L = true;
      if (u.side !== "L") info.R = true;
      groups.set(g, info);
    });
    units.forEach((u, i) => {
      for (const [og, info] of groups) {
        if (find(i) === find(og) || !(info.L && info.R)) continue;
        const inside = u.bs < info.be && u.be > info.bs;
        const textInsertAtEdge =
          isInsert(u) && hasText(u) && (u.bs === info.be || u.bs === info.bs);
        if ((inside || textInsertAtEdge) && union(i, og)) grew = true;
      }
    });
  }

  // Emit in base order.
  const groupOf = new Map();
  units.forEach((u, i) => {
    const g = find(i);
    if (!groupOf.has(g)) groupOf.set(g, []);
    groupOf.get(g).push(u);
  });
  const emitUnits = [];
  for (const members of groupOf.values()) {
    const L_ = members.some((u) => u.side === "L"),
      R_ = members.some((u) => u.side === "R");
    if (L_ && R_) {
      const bs = Math.min(...members.map((u) => u.bs)),
        be = Math.max(...members.map((u) => u.be));
      const localHunks = members
          .filter((u) => u.side !== "R")
          .map((u) => u.l)
          .sort((a, b) => a.bs - b.bs),
        remoteHunks = members
          .filter((u) => u.side !== "L")
          .map((u) => u.r)
          .sort((a, b) => a.bs - b.bs);
      emitUnits.push({ bs, be, kind: "conflict", localHunks, remoteHunks });
    } else
      for (const u of members)
        emitUnits.push({ bs: u.bs, be: u.be, kind: u.side, u });
  }
  // same-point insertions nest: the open whose close comes later goes first;
  // the close whose open came earlier goes last; otherwise local first
  const closeAt = (side, key) => {
    const hs = side === "L" ? lh : rh;
    for (const h of hs)
      if (h.toks.some((t) => t.kind === "close" && t.k.el === key.el))
        return h.bs + 0.5;
    for (let i = 0; i < B.length; i++)
      if (B[i].kind === "close" && B[i].k.el === key.el) return i;
    return Infinity;
  };
  const openAt = (side, key) => {
    const hs = side === "L" ? lh : rh;
    for (const h of hs)
      if (h.toks.some((t) => t.kind === "open" && t.k.el === key.el))
        return h.bs - 0.5;
    for (let i = 0; i < B.length; i++)
      if (B[i].kind === "open" && B[i].k.el === key.el) return i;
    return -Infinity;
  };
  const sideOf = (e) => (e.kind === "R" ? "R" : "L");
  const rank = (e) => (e.kind === "R" ? 1 : 0);
  emitUnits.sort((a, b) => {
    if (a.bs !== b.bs) return a.bs - b.bs;
    const ai = a.bs === a.be,
      bi = b.bs === b.be;
    if (ai !== bi) return ai ? -1 : 1;
    if (ai && bi && a.kind !== "conflict" && b.kind !== "conflict") {
      const at = a.u.toks,
        bt = b.u.toks;
      const allOpen = (t) => t.length && t.every((x) => x.kind === "open");
      const allClose = (t) => t.length && t.every((x) => x.kind === "close");
      if (allOpen(at) && allOpen(bt)) {
        const ca = Math.max(...at.map((x) => closeAt(sideOf(a), x.k))),
          cb = Math.max(...bt.map((x) => closeAt(sideOf(b), x.k)));
        if (ca !== cb) return cb - ca; // later close opens first
      }
      if (allClose(at) && allClose(bt)) {
        const oa = Math.min(...at.map((x) => openAt(sideOf(a), x.k))),
          ob = Math.min(...bt.map((x) => openAt(sideOf(b), x.k)));
        if (oa !== ob) return ob - oa; // later open closes first
        return rank(b) - rank(a); // equal: remote's close first (local's open went first)
      }
    }
    const lead = (e) => (e.u && e.u.lead ? 1 : 0);
    return lead(b) - lead(a) || rank(a) - rank(b) || a.be - b.be;
  });

  const segments = [];
  const conflicts = [];
  let pos = 0;
  const pushBase = (to) => {
    if (to > pos) {
      segments.push({
        bs: pos,
        be: to,
        toks: B.slice(pos, to),
        source: "base",
      });
      pos = to;
    }
  };
  for (const e of emitUnits) {
    pushBase(e.bs);
    if (e.kind === "conflict") {
      const localToks = applyTok(B, e.localHunks, e.bs, e.be),
        remoteToks = applyTok(B, e.remoteHunks, e.bs, e.be);
      const resolvedToks =
        policy === "local"
          ? localToks
          : policy === "both"
            ? localToks.concat(remoteToks)
            : remoteToks;
      conflicts.push({
        bs: e.bs,
        be: e.be,
        base: B.slice(e.bs, e.be),
        local: localToks,
        remote: remoteToks,
        resolved: resolvedToks,
      });
      segments.push({
        bs: e.bs,
        be: e.be,
        toks: resolvedToks,
        source: "conflict",
        localHunks: e.localHunks,
        localToks,
        keepsLocal: policy !== "remote",
      });
    } else {
      segments.push({
        bs: e.bs,
        be: e.be,
        toks: e.u.toks,
        source: e.kind === "R" ? "remote" : "local",
        localHunks: e.kind === "R" ? [] : [e.u.l],
      });
    }
    pos = Math.max(pos, e.be);
  }
  pushBase(B.length);

  // cosmetic (nbsp/space) forms on base tokens: three-way per token, no conflict
  const cosL = new Map(cosLList.map((c) => [c.bi, c.tok])),
    cosR = new Map(cosRList.map((c) => [c.bi, c.tok]));
  const tokens = [];
  for (const seg of segments) {
    if (seg.source === "base") {
      seg.toks = seg.toks.map((t, i) => {
        const bi = seg.bs + i;
        const lt = cosL.get(bi),
          rt = cosR.get(bi);
        const pick = lt && rt ? (policy === "remote" ? rt : lt) : lt || rt || t;
        return pick === t ? t : { ...pick, cosmetic: true };
      });
    }
    for (const t of seg.toks) tokens.push({ ...t, src: seg.source });
  }
  return {
    tokens,
    segments,
    conflicts,
    localHunks: lh,
    remoteHunks: rh,
    collapsedDelta,
    samePoint,
    mapLocalOffset: makeMapper(B, lh, segments),
  };
}

function applyTok(B, hunks, bs, be) {
  let out = [],
    p = bs;
  for (const h of hunks) {
    out = out.concat(B.slice(p, h.bs), h.toks);
    p = h.be;
  }
  return out.concat(B.slice(p, be));
}

const lenOf = (toks) => toks.reduce((n, t) => n + t.len, 0);

/**
 * Char-space mapper, same shape as the shipped makeMapper: local offset ->
 * base offset via the local hunks, then base offset -> merged via segments.
 */
function makeMapper(B, localHunks, segments) {
  const bOff = new Int32Array(B.length + 1);
  for (let i = 0; i < B.length; i++) bOff[i + 1] = bOff[i] + B[i].len;
  const ch = localHunks.map((h) => ({
    bs: bOff[h.bs],
    be: bOff[h.be],
    text: h.toks.map((t) => t.raw).join(""),
    ref: h,
  }));
  const cs = segments.map((s) => ({
    bs: bOff[s.bs],
    be: bOff[s.be],
    len: lenOf(s.toks),
    source: s.source,
    localHunks: s.localHunks || [],
    localLen: s.localToks ? lenOf(s.localToks) : 0,
    keepsLocal: s.keepsLocal,
    ref: s,
  }));
  return (localOffset) => {
    let baseOff = null,
      inHunk = null,
      inner = 0;
    let lPos = 0,
      bPos = 0;
    for (const h of ch) {
      const eq = h.bs - bPos;
      if (localOffset <= lPos + eq) {
        baseOff = bPos + (localOffset - lPos);
        break;
      }
      lPos += eq;
      bPos = h.bs;
      if (localOffset <= lPos + h.text.length) {
        inHunk = h;
        inner = localOffset - lPos;
        baseOff = h.bs;
        break;
      }
      lPos += h.text.length;
      bPos = h.be;
    }
    if (baseOff === null) baseOff = bPos + (localOffset - lPos);
    let mergedPos = 0;
    for (const seg of cs) {
      if (!inHunk && baseOff <= seg.bs) return mergedPos;
      const covers = inHunk
        ? seg.localHunks.includes(inHunk.ref)
        : baseOff < seg.be;
      if (!covers) {
        mergedPos += seg.len;
        continue;
      }
      if (seg.source === "base") return mergedPos + (baseOff - seg.bs);
      if (seg.source === "remote") return mergedPos + seg.len;
      if (seg.source === "local") return mergedPos + Math.min(inner, seg.len);
      if (!seg.keepsLocal || !inHunk) return mergedPos + seg.len;
      const idx = seg.localHunks.indexOf(inHunk.ref);
      const before = lenOf(
        applyTok(B, seg.localHunks.slice(0, idx), seg.ref.bs, inHunk.ref.bs),
      );
      return mergedPos + Math.min(before + inner, seg.localLen);
    }
    return mergedPos;
  };
}

// ---------------------------------------------------------------------
// String wrapper: drop-in for merge3Text(base, local, remote, policy)
// ---------------------------------------------------------------------
export function merge3Text(base, local, remote, policy = "remote") {
  if (local === remote || remote === base)
    return {
      text: local,
      conflicts: [],
      mapLocalOffset: (n) => Math.min(n, local.length),
      granularity: "word",
    };
  const fast = allAscii(base, local, remote);
  const B = textTokens(base, fast),
    L = textTokens(local, fast),
    R = textTokens(remote, fast);
  let res =
    B.length <= MAX_TOKENS && L.length <= MAX_TOKENS && R.length <= MAX_TOKENS
      ? merge3Tokens(B, L, R, policy)
      : null;
  let granularity = "word";
  let baseToks = B;
  if (!res) {
    const lines = (s) =>
      s.split(/(?<=\n)/).map((w) => ({ k: w, raw: w, len: w.length }));
    baseToks = lines(base);
    res = merge3Tokens(baseToks, lines(local), lines(remote), policy);
    granularity = "line";
  }
  const join = (toks) => toks.map((t) => t.raw).join("");
  const off = [0];
  for (const t of baseToks) off.push(off[off.length - 1] + t.len);
  return {
    text: join(res.tokens),
    conflicts: res.conflicts.map((c) => ({
      bs: off[c.bs],
      be: off[c.be],
      base: join(c.base),
      local: join(c.local),
      remote: join(c.remote),
      resolved: join(c.resolved),
    })),
    mapLocalOffset: res.mapLocalOffset,
    granularity,
  };
}

/**
 * Word-level hunks that transform `base` into `side`, in character offsets.
 * @param {string} base
 * @param {string} side
 * @param {number} [maxD]
 * @returns {Array<{ bs: number, be: number, text: string }>}
 */
export function diff(base, side, maxD = MAX_EDITS) {
  if (base === side) return [];
  const fast = allAscii(base, side);
  const B = textTokens(base, fast),
    S = textTokens(side, fast);
  const d = diffTokens(B, S, maxD);
  const off = [0];
  for (const t of B) off.push(off[off.length - 1] + t.len);
  return d.hunks.map((h) => ({
    bs: off[h.bs],
    be: off[h.be],
    text: h.toks.map((t) => t.raw).join(""),
  }));
}
