// Fuzz harness for the inline merge (seat B's fuzz.mjs, ported). A random
// paragraph model (words, spaces, <br> atoms, nested marks) is rendered to
// DOM, edited on each side, merged through mergeInline with real
// alignments, and checked against these invariants:
//   I1  the output's flattened text equals the merge's text
//   I2  no invented token: every word of the output is a word of a side
//   I3  no conflicts => output text = base with both sides' hunks applied
//   I4  merge(b,x,b) = x, merge(b,b,y) = y, merge(b,x,x) = x, as canonical forms
//   I5  merge(b,l,r,remote) and merge(b,r,l,local) hold the same token bag
//   I6  mapLocal is monotonic, bounded, and sits after the kept local char
//   I7  every local text node with a surviving character is claimed by
//       exactly one output node, and each mapper stays in range
//   I8  localDiverged equals "merged differs from remote"
//   I9  a text conflict's resolved (remote) region is present, and its
//       range covers it in the merged text
//   I10 separated edits (a base word untouched between them) both land
//       exactly, with no conflict
//   I11 token count: every word token of the output occurs at most
//       max(count in local, count in remote) times (nothing duplicated)
// FUZZ_ITERS overrides the iteration count for long local runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { document } from "./lib/dom.js";
import { mergeSegment } from "./lib/inline.js";
import { flatten, flatSig, ATOM } from "../../src/inline-merge.js";
import { textTokens } from "../../src/text-merge.js";

const VOCAB = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "eps",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "我们",
  "公园",
  "café",
  "naïve",
  "😀",
];
const MARK_KINDS = [
  ["b", {}],
  ["i", {}],
  ["a", { href: "/x" }],
  ["span", { class: "c" }],
  ["code", {}],
];

function runFuzz(seed, N) {
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  let wordSeq = 0;
  const freshWord = () => pick(VOCAB) + ++wordSeq;
  let markSeq = 0;

  function genBase() {
    const m = { items: [], marks: new Map() };
    const n = int(2, 9);
    for (let i = 0; i < n; i++) {
      if (i)
        m.items.push({
          id: "s" + i,
          kind: "space",
          text: rnd() < 0.15 ? " " : " ",
          marks: new Set(),
        });
      if (rnd() < 0.08)
        m.items.push({
          id: "br" + i,
          kind: "br",
          text: ATOM,
          marks: new Set(),
        });
      m.items.push({
        id: "w" + i,
        kind: "word",
        text: freshWord(),
        marks: new Set(),
      });
    }
    const k = int(0, 3);
    for (let j = 0; j < k; j++)
      addMark(m, int(0, m.items.length - 1), int(0, m.items.length - 1));
    return m;
  }
  function addMark(m, a, b, kind) {
    if (a > b) [a, b] = [b, a];
    const [tag, attrs] = kind || pick(MARK_KINDS);
    for (const [mid] of m.marks) {
      const covered = m.items
        .map((x, i) => (x.marks.has(mid) ? i : -1))
        .filter((i) => i >= 0);
      if (!covered.length) continue;
      const lo = covered[0],
        hi = covered[covered.length - 1];
      const disjoint = b < lo || a > hi,
        nested = (a <= lo && hi <= b) || (lo <= a && b <= hi);
      if (!disjoint && !nested) return null;
    }
    const id = "m" + ++markSeq;
    m.marks.set(id, { tag, attrs: { ...attrs } });
    for (let i = a; i <= b; i++) m.items[i].marks.add(id);
    return id;
  }
  const clone = (m) => ({
    items: m.items.map((x) => ({ ...x, marks: new Set(x.marks) })),
    marks: new Map(
      [...m.marks].map(([k, v]) => [k, { tag: v.tag, attrs: { ...v.attrs } }]),
    ),
  });
  function randomOp(m, lo, hi) {
    const words = m.items
      .map((x, i) => i)
      .filter((i) => i >= lo && i <= hi && m.items[i].kind === "word");
    if (!words.length) return null;
    const kind = pick([
      "insert",
      "insert",
      "delete",
      "replace",
      "replace",
      "mark",
      "unmark",
      "attr",
      "br",
      "delbr",
    ]);
    const i = pick(words);
    const it = m.items[i];
    if (kind === "replace") {
      it.text = freshWord();
      return "replace";
    }
    if (kind === "insert") {
      const after = rnd() < 0.5;
      const w = {
        id: "n" + ++wordSeq,
        kind: "word",
        text: freshWord(),
        marks: new Set(it.marks),
      };
      const sp = {
        id: "ns" + wordSeq,
        kind: "space",
        text: " ",
        marks: new Set(it.marks),
      };
      if (after) m.items.splice(i + 1, 0, sp, w);
      else m.items.splice(i, 0, w, sp);
      return "insert";
    }
    if (kind === "delete") {
      if (i + 1 <= hi && m.items[i + 1] && m.items[i + 1].kind === "space")
        m.items.splice(i, 2);
      else if (i - 1 >= lo && m.items[i - 1] && m.items[i - 1].kind === "space")
        m.items.splice(i - 1, 2);
      else m.items.splice(i, 1);
      return "delete";
    }
    if (kind === "mark") {
      const j = pick(words);
      return addMark(m, i, j) ? "mark" : null;
    }
    if (kind === "unmark") {
      const ids = [...it.marks];
      if (!ids.length) return null;
      const id = pick(ids);
      for (let k = 0; k < m.items.length; k++)
        if (m.items[k].marks.has(id) && (k < lo || k > hi)) return null;
      for (const x of m.items) x.marks.delete(id);
      m.marks.delete(id);
      return "unmark";
    }
    if (kind === "attr") {
      const ids = [...it.marks].filter(
        (id) => Object.keys(m.marks.get(id).attrs).length,
      );
      if (!ids.length) return null;
      const id = pick(ids);
      for (let k = 0; k < m.items.length; k++)
        if (m.items[k].marks.has(id) && (k < lo || k > hi)) return null;
      const a = m.marks.get(id).attrs;
      const key = Object.keys(a)[0];
      a[key] = a[key] + "-" + ++wordSeq;
      return "attr";
    }
    if (kind === "br") {
      m.items.splice(i + 1, 0, {
        id: "nb" + ++wordSeq,
        kind: "br",
        text: ATOM,
        marks: new Set(it.marks),
      });
      return "br";
    }
    if (kind === "delbr") {
      const brs = m.items
        .map((x, k) => k)
        .filter((k) => k >= lo && k <= hi && m.items[k].kind === "br");
      if (!brs.length) return null;
      m.items.splice(pick(brs), 1);
      return "delbr";
    }
    return null;
  }
  function render(m, split = true) {
    const p = document.createElement("p");
    let stack = [];
    let container = p;
    for (const it of m.items) {
      const want = [...it.marks].sort();
      let c = 0;
      while (c < stack.length && c < want.length && stack[c] === want[c]) c++;
      while (stack.length > c) {
        stack.pop();
        container = container.parentNode;
      }
      while (stack.length < want.length) {
        const id = want[stack.length];
        const mk = m.marks.get(id);
        const el = document.createElement(mk.tag);
        for (const [k, v] of Object.entries(mk.attrs)) el.setAttribute(k, v);
        container.appendChild(el);
        container = el;
        stack.push(id);
      }
      if (it.kind === "br") container.appendChild(document.createElement("br"));
      else if (split && it.text.length > 2 && rnd() < 0.3) {
        const k = int(1, it.text.length - 1);
        container.appendChild(document.createTextNode(it.text.slice(0, k)));
        container.appendChild(document.createTextNode(it.text.slice(k)));
      } else container.appendChild(document.createTextNode(it.text));
    }
    return p;
  }
  const sig = (p) => flatSig(flatten([...p.childNodes], {}));
  const modelSig = (m) => sig(render(m, false));

  const doMerge = (bp, lp, rp, policy = "remote") => {
    const x = mergeSegment(bp, lp, rp, { policy });
    return {
      res: x.res,
      outP: x.node,
      fb: flatten([...bp.childNodes]),
      fl: flatten([...lp.childNodes]),
      fr: flatten([...rp.childNodes]),
      conflicts: x.conflicts,
      provenance: x.provenance,
      textMappers: x.textMappers,
    };
  };

  const stats = { separated: 0, random: 0, conflicts: 0, fail: 0 };
  const fails = [];
  const failsByName = {};
  const check = (cond, name, ctx) => {
    if (cond) return;
    stats.fail++;
    const key = name.split(":")[0];
    failsByName[key] = (failsByName[key] || 0) + 1;
    if (fails.length < 12) fails.push({ name, ...ctx });
  };
  const applyHunks = (base, hunks) => {
    let o = "",
      pos = 0;
    for (const h of hunks) {
      o += base.slice(pos, h.bs) + h.text;
      pos = h.be;
    }
    return o + base.slice(pos);
  };
  const norm = (s) => s.replace(/ /g, " ");
  const isWord = (k) => /[\p{L}\p{N}]/u.test(k);
  const wordKeys = (t) =>
    t
      .split(ATOM)
      .flatMap((s) => textTokens(s))
      .map((x) => x.k)
      .filter(isWord);
  const wordSet = (t) => new Set(wordKeys(t));
  const counts = (t) => {
    const m = new Map();
    for (const k of wordKeys(t)) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const wordBag = (t) =>
    t
      .split(ATOM)
      .flatMap((s) => textTokens(s))
      .map((x) => x.k)
      .sort()
      .join("\u0001");

  function invariants(bp, lp, rp, label) {
    const { res, outP, fb, fl, fr, conflicts, provenance, textMappers } =
      doMerge(bp, lp, rp);
    const ctx = {
      label,
      base: bp.innerHTML,
      local: lp.innerHTML,
      remote: rp.innerHTML,
      out: outP.innerHTML,
      conflicts: conflicts.length,
    };
    const fo = flatten([...outP.childNodes], {});
    check(fo.text === res.text, "I1 output text equals merged text", ctx);
    const pool = new Set([
      ...wordSet(fb.text),
      ...wordSet(fl.text),
      ...wordSet(fr.text),
    ]);
    for (const t of wordSet(res.text))
      check(pool.has(t), "I2 no invented token: " + t, ctx);
    if (!conflicts.length) {
      const same = (a, b) =>
        a.bs === b.bs && a.be === b.be && a.text === b.text;
      const all = [
        ...res.localHunks,
        ...res.remoteHunks.filter(
          (r) => !res.localHunks.some((l) => same(l, r)),
        ),
      ].sort((a, b) => a.bs - b.bs || (b.bs === b.be) - (a.bs === a.be));
      const expected = applyHunks(fb.text, all);
      check(
        norm(expected) === norm(res.text),
        "I3 conflict-free text = base + all hunks",
        { ...ctx, expected },
      );
    }
    const m1 = doMerge(bp, lp, bp).outP,
      m2 = doMerge(bp, bp, rp).outP,
      m3 = doMerge(bp, lp, lp).outP;
    check(sig(m1) === sig(lp), "I4 merge(b,x,b)=x", {
      ...ctx,
      got: m1.innerHTML,
    });
    check(sig(m2) === sig(rp), "I4 merge(b,b,y)=y", {
      ...ctx,
      got: m2.innerHTML,
    });
    check(sig(m3) === sig(lp), "I4 merge(b,x,x)=x", {
      ...ctx,
      got: m3.innerHTML,
    });
    const sw = doMerge(bp, rp, lp, "local").res;
    check(
      wordBag(norm(sw.text)) === wordBag(norm(res.text)),
      "I5 merge(b,l,r,remote) ~ merge(b,r,l,local) as token bags",
      { ...ctx, swapped: sw.text },
    );
    let prev = 0;
    for (let k = 0; k <= fl.text.length; k++) {
      const mp = res.mapLocal(k);
      check(
        mp >= prev && mp <= res.text.length,
        "I6 caret monotonic and bounded",
        ctx,
      );
      if (k > 0 && res.lToM[k - 1] >= 0)
        check(
          norm(res.text[mp - 1]) === norm(fl.text[k - 1]),
          "I6 caret sits after the kept local char",
          { ...ctx, k, mp },
        );
      prev = mp;
    }
    const claimed = new Map();
    for (const t of res.textNodes) {
      const p = provenance.get(t.node);
      for (const n of p.local) claimed.set(n, (claimed.get(n) || 0) + 1);
      const mapper = textMappers.get(t.node);
      const runLen = p.local.reduce((a, n) => a + n.nodeValue.length, 0);
      for (let k = 0; k <= runLen; k++) {
        const v = mapper(k);
        check(
          v >= 0 && v <= t.node.nodeValue.length,
          "I7 mapper in range",
          ctx,
        );
      }
    }
    for (const n of fl.nodes) {
      const survives = res.lToM.slice(n.s, n.e).some((x) => x >= 0);
      const c = claimed.get(n.node) || 0;
      check(
        survives ? c === 1 : c <= 1,
        "I7 each local text node claimed once",
        ctx,
      );
    }
    check(
      res.localDiverged === (sig(outP) !== sig(rp)),
      "I8 localDiverged = merged != remote",
      ctx,
    );
    for (const c of conflicts) {
      if (c.kind !== "text") continue;
      const region = norm(fr.text.slice(c.rss, c.rse));
      check(
        norm(res.text).includes(region),
        "I9 remote region present under remote policy",
        ctx,
      );
      check(
        norm(res.text.slice(c.range[0], c.range[1])) === region,
        "I9 conflict.range covers the resolved region",
        { ...ctx, range: c.range },
      );
    }
    const cl = counts(fl.text),
      cr = counts(fr.text);
    for (const [k, n] of counts(res.text))
      check(
        n <= Math.max(cl.get(k) || 0, cr.get(k) || 0),
        "I11 token count: " + k + " occurs " + n + " times",
        ctx,
      );
    return { conflicts, outP };
  }

  for (let iter = 0; iter < N; iter++) {
    const base = genBase();
    const words = base.items
      .map((x, i) => i)
      .filter((i) => base.items[i].kind === "word");
    if (words.length >= 3) {
      const cut = int(1, words.length - 2);
      const gapWord = words[cut];
      const local = clone(base),
        remote = clone(base);
      const flip = rnd() < 0.5;
      const zone = (m, side) => {
        const g = m.items.findIndex((x) => x.id === base.items[gapWord].id);
        return side === "A" ? [0, g - 1] : [g + 1, m.items.length - 1];
      };
      for (let k = int(1, 3); k > 0; k--)
        randomOp(local, ...zone(local, flip ? "B" : "A"));
      for (let k = int(1, 3); k > 0; k--)
        randomOp(remote, ...zone(remote, flip ? "A" : "B"));
      const expected = clone(base);
      const boundaryId = base.items[gapWord].id;
      const takeUntil = (m, stopId) => {
        const o = [];
        for (const it of m.items) {
          if (it.id === stopId) break;
          o.push(it);
        }
        return o;
      };
      const takeAfter = (m, startId) => {
        const i = m.items.findIndex((x) => x.id === startId);
        return m.items.slice(i + 1);
      };
      const A = flip ? remote : local,
        B = flip ? local : remote;
      expected.items = [
        ...takeUntil(A, boundaryId),
        base.items[gapWord],
        ...takeAfter(B, boundaryId),
      ].map((x) => ({ ...x, marks: new Set(x.marks) }));
      expected.marks = new Map([...local.marks, ...remote.marks]);
      for (const [id, v] of expected.marks) {
        const lv = local.marks.get(id),
          rv = remote.marks.get(id),
          bv = base.marks.get(id);
        if (bv && lv && rv)
          for (const k of Object.keys(bv.attrs))
            v.attrs[k] =
              lv.attrs[k] !== bv.attrs[k] ? lv.attrs[k] : rv.attrs[k];
      }
      const bp = render(base),
        lp = render(local),
        rp = render(remote);
      const { conflicts, outP } = invariants(bp, lp, rp, "separated");
      stats.separated++;
      const ctx = {
        label: "separated",
        base: bp.innerHTML,
        local: lp.innerHTML,
        remote: rp.innerHTML,
        out: outP.innerHTML,
        expected: render(expected, false).innerHTML,
      };
      check(conflicts.length === 0, "I10 separated edits: no conflict", {
        ...ctx,
        conflicts: conflicts.map(
          (c) => c.base + " | " + c.local + " | " + c.remote,
        ),
      });
      check(
        sig(outP) === modelSig(expected),
        "I10 separated edits: both land exactly",
        ctx,
      );
    }
    {
      const local = clone(base),
        remote = clone(base);
      for (let k = int(1, 4); k > 0; k--)
        randomOp(local, 0, local.items.length - 1);
      for (let k = int(1, 4); k > 0; k--)
        randomOp(remote, 0, remote.items.length - 1);
      const bp = render(base),
        lp = render(local),
        rp = render(remote);
      const { conflicts } = invariants(bp, lp, rp, "random");
      stats.random++;
      if (conflicts.length) stats.conflicts++;
    }
  }
  return { fails, failsByName, ...stats };
}

const ITERS = Number(process.env.FUZZ_ITERS) || 500;

test(`inline merge fuzz, seed 1, ${ITERS} iterations`, () => {
  const r = runFuzz(1, ITERS);
  assert.equal(r.random, ITERS, "random merges actually ran");
  assert.ok(r.separated > ITERS * 0.7, `separated merges ran: ${r.separated}`);
  assert.ok(
    r.conflicts > ITERS * 0.1,
    `some merges conflicted: ${r.conflicts}`,
  );
  assert.equal(
    r.fail,
    0,
    `invariant failures ${JSON.stringify(r.failsByName)}\nfirst examples: ${JSON.stringify(r.fails.slice(0, 3), null, 1)}`,
  );
});
