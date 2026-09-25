// Fuzz harness for the text-level merge. Invariants:
//   I1 merge(base, x, base) === x and merge(base, base, x) === x, no conflicts
//   I2 merge(base, x, x) === x, no conflicts
//   I3 every output token is a token of the side it claims (base/local/remote)
//   I3s no conflicts and no same-point insertions => every word of the output
//       string is a word of base, local or remote (no invented text)
//   I4 no conflicts => |out| == |L| + |R| - |B| - collapsed (no duplication, no loss)
//   I5 separated edits (>= one untouched non-space token between them on
//      the base) both land, no conflict, output == both applied to base
//   I6 mapLocalOffset is monotonic and within [0, out.length]
//   I7 idempotent: merge(out, out, out) === out; merge(base, out, out) === out
//   I8 the resolved side's text of every conflict is present verbatim
//   I9 policy "local" keeps every local hunk: merge(base, local, remote, "local")
//      contains each local-inserted word; and with policy local + remote===base
//      the result is local
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  merge3Text,
  merge3Tokens,
  textTokens,
  words,
  wordsFast,
  allAscii,
} from "../../src/text-merge.js";

const VOCAB =
  "the quick brown fox jumps over lazy dog and a cat sat on mat with hat now then 你好 世界 日本語 テキスト café naïve 👍 x1".split(
    " ",
  );

function runFuzz(seed, N) {
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (n) => Math.floor(rnd() * n);

  function makeBase() {
    const n = 1 + int(12);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(pick(VOCAB));
      if (i < n - 1)
        out.push(pick([" ", " ", " ", ", ", ". ", "\u00a0", "\n"]));
    }
    if (rnd() < 0.3) out.push(".");
    return out.join("");
  }

  function editTokens(toks) {
    const t = toks.slice();
    const kind = int(5);
    const i = int(t.length + 1);
    if (kind === 0 && t.length) {
      const j = Math.min(i, t.length - 1);
      t[j] = pick(VOCAB);
      return t;
    }
    if (kind === 1) {
      t.splice(i, 0, pick(VOCAB), " ");
      return t;
    }
    if (kind === 2 && t.length) {
      t.splice(Math.min(i, t.length - 1), 1);
      return t;
    }
    if (kind === 3 && t.length) {
      const j = Math.min(i, t.length - 1);
      const w = t[j];
      if (/^\s+$/.test(w)) t[j] = w + " ";
      else
        t[j] =
          w.slice(0, Math.floor(w.length / 2)) +
          "z" +
          w.slice(Math.floor(w.length / 2));
      return t;
    }
    const j = Math.min(i, t.length);
    const len = int(4);
    const repl = [];
    for (let k = 0; k < 1 + int(3); k++) repl.push(pick(VOCAB), " ");
    t.splice(j, len, ...repl);
    return t;
  }

  const join = (t) => t.join("");
  const norm = (w) => w.replace(/\u00a0/g, " ");
  let n = 0,
    conflicted = 0,
    joins = 0;
  const fails = [];
  const check = (name, cond, info) => {
    if (!cond) fails.push({ name, ...info });
  };

  for (let iter = 0; iter < N; iter++) {
    const base = makeBase();
    const B = words(base);
    let Lt = editTokens(B);
    if (rnd() < 0.4) Lt = editTokens(Lt);
    let Rt = editTokens(B);
    if (rnd() < 0.4) Rt = editTokens(Rt);
    const local = join(Lt),
      remote = join(Rt);
    const out = merge3Text(base, local, remote);
    n++;
    if (out.conflicts.length) conflicted++;
    const info = {
      base,
      local,
      remote,
      out: out.text,
      conflicts: out.conflicts.length,
    };

    const a = merge3Text(base, local, base),
      b = merge3Text(base, base, remote);
    check("I1a", a.text === local && a.conflicts.length === 0, info);
    check("I1b", b.text === remote && b.conflicts.length === 0, info);
    check("I2", merge3Text(base, local, local).text === local, info);

    const tok = allAscii(base, local, remote) ? wordsFast : words;
    const wB = new Set(tok(base).map(norm)),
      wL = new Set(tok(local).map(norm)),
      wR = new Set(tok(remote).map(norm));
    const fastD = allAscii(base, local, remote);
    const d = merge3Tokens(
      textTokens(base, fastD),
      textTokens(local, fastD),
      textTokens(remote, fastD),
    );
    if (d) {
      const okTok = d.tokens.every((t) =>
        t.src === "local"
          ? wL.has(norm(t.raw))
          : t.src === "remote" || t.src === "conflict"
            ? wR.has(norm(t.raw)) || wB.has(norm(t.raw))
            : t.cosmetic
              ? wL.has(norm(t.raw)) || wR.has(norm(t.raw))
              : wB.has(norm(t.raw)),
      );
      check("I3", okTok, info);
      if (!out.conflicts.length && d.samePoint === 0) {
        const bad = tok(out.text)
          .map(norm)
          .filter((w) => !wB.has(w) && !wL.has(w) && !wR.has(w));
        if (bad.length) joins++;
      }
      if (!out.conflicts.length) {
        const fast = allAscii(base, local, remote);
        const lb = textTokens(base, fast).length,
          ll = textTokens(local, fast).length,
          lr = textTokens(remote, fast).length;
        check("I4", d.tokens.length === ll + lr - lb - d.collapsedDelta, {
          ...info,
          lo: d.tokens.length,
          ll,
          lr,
          lb,
          collapsed: d.collapsedDelta,
        });
      }
    }

    let prev = -1,
      mono = true;
    for (let o = 0; o <= local.length; o++) {
      const m = out.mapLocalOffset(o);
      if (m < prev || m < 0 || m > out.text.length) mono = false;
      prev = m;
    }
    check("I6", mono, info);

    check(
      "I7a",
      merge3Text(out.text, out.text, out.text).text === out.text,
      info,
    );
    check("I7b", merge3Text(base, out.text, out.text).text === out.text, info);

    for (const c of out.conflicts)
      check("I8", out.text.includes(c.resolved), { ...info, c });

    const loc = merge3Text(base, local, remote, "local");
    for (const c of loc.conflicts)
      check("I9", loc.text.includes(c.local), { ...info, policy: "local", c });
  }

  // I5: separated edits
  let sep = 0;
  for (let iter = 0; iter < N; iter++) {
    const base = makeBase();
    const B = words(base);
    const nonSpace = B.map((w, i) => (/^\s+$/.test(w) ? -1 : i)).filter(
      (i) => i >= 0,
    );
    if (nonSpace.length < 3) continue;
    const ai = int(nonSpace.length - 2);
    const a = nonSpace[ai];
    const b = nonSpace[ai + 2 + int(nonSpace.length - ai - 2)];
    if (b === undefined) continue;
    const L = B.slice();
    L[a] = pick(VOCAB);
    const R = B.slice();
    R[b] = pick(VOCAB);
    const E = B.slice();
    E[a] = L[a];
    E[b] = R[b];
    if (L[a] === B[a] || R[b] === B[b]) continue;
    const out = merge3Text(base, join(L), join(R));
    sep++;
    check("I5", out.text === join(E) && out.conflicts.length === 0, {
      base,
      local: join(L),
      remote: join(R),
      out: out.text,
      expected: join(E),
      conflicts: out.conflicts.length,
    });
  }

  return { fails, n, sep, conflicted };
}

for (const seed of [1, 2, 3]) {
  test(`text merge fuzz, seed ${seed}`, () => {
    const { fails, n, sep } = runFuzz(seed, 500);
    assert.ok(n > 400, `random merges actually ran: ${n}`);
    assert.ok(sep > 100, `separated-edit merges actually ran: ${sep}`);
    assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 3), null, 1));
  });
}
