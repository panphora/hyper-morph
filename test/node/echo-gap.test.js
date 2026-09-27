// An echo (a phrase both sides typed at one spot) that the diff splits
// across a space: one copy is the whole of one side's insertion, the other
// ends or starts the other side's edit on the far side of the space. It
// lands once. Text two sides typed independently never collapses: adjacent
// replacements that share text keep both copies, exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3Text } from "../../src/text-merge.js";
import { mergeBodies } from "./lib/merge.js";

const POLICIES = ["remote", "local", "both"];
const html = (s) => s.replace(/&nbsp;/g, "\u00a0");

function monotonic(m, local) {
  let prev = -1;
  for (let o = 0; o <= local.length; o++) {
    const v = m.mapLocalOffset(o);
    if (v < prev || v > m.text.length) return false;
    prev = v;
  }
  return true;
}

// [base, local, remote, { "lr|rl policy": [text, conflicts] }]
const UNCHANGED = [
  [
    "猫犬",
    "鳥犬",
    "猫鳥",
    {
      "lr remote": ["鳥鳥", 0],
      "lr local": ["鳥鳥", 0],
      "lr both": ["鳥鳥", 0],
      "rl remote": ["鳥鳥", 0],
      "rl local": ["鳥鳥", 0],
      "rl both": ["鳥鳥", 0],
    },
  ],
  [
    "Hi!.",
    "Hi?.",
    "Hi!?",
    {
      "lr remote": ["Hi??", 0],
      "lr local": ["Hi??", 0],
      "lr both": ["Hi??", 0],
      "rl remote": ["Hi??", 0],
      "rl local": ["Hi??", 0],
      "rl both": ["Hi??", 0],
    },
  ],
  [
    "with now the",
    "over now the",
    "with over it the",
    {
      "lr remote": ["over over it the", 0],
      "lr local": ["over over it the", 0],
      "lr both": ["over over it the", 0],
      "rl remote": ["over over it the", 0],
      "rl local": ["over over it the", 0],
      "rl both": ["over over it the", 0],
    },
  ],
  [
    "red car",
    "blue car",
    "red blue sedan",
    {
      "lr remote": ["blue blue sedan", 0],
      "lr local": ["blue blue sedan", 0],
      "lr both": ["blue blue sedan", 0],
      "rl remote": ["blue blue sedan", 0],
      "rl local": ["blue blue sedan", 0],
      "rl both": ["blue blue sedan", 0],
    },
  ],
  [
    "red car",
    "big blue car",
    "red blue sedan",
    {
      "lr remote": ["big blue blue sedan", 0],
      "lr local": ["big blue blue sedan", 0],
      "lr both": ["big blue blue sedan", 0],
      "rl remote": ["big blue blue sedan", 0],
      "rl local": ["big blue blue sedan", 0],
      "rl both": ["big blue blue sedan", 0],
    },
  ],
  [
    "A cat dog",
    "A cat dog E dog",
    "A  dog E ",
    {
      "lr remote": ["A  dog E ", 1],
      "lr local": ["A cat dog E dog", 1],
      "lr both": ["A cat dog E dog  dog E ", 1],
      "rl remote": ["A cat dog E dog", 1],
      "rl local": ["A  dog E ", 1],
      "rl both": ["A  dog E  cat dog E dog", 1],
    },
  ],
  [
    "a b c",
    "a b X Y c",
    "a X c",
    {
      "lr remote": ["a X X Y c", 0],
      "lr local": ["a X X Y c", 0],
      "lr both": ["a X X Y c", 0],
      "rl remote": ["a X X Y c", 0],
      "rl local": ["a X X Y c", 0],
      "rl both": ["a X X Y c", 0],
    },
  ],
  [
    "the the. fox on. hat on",
    "the the.and fox on. hat sat with brown ",
    "the the. fox on. hzat sat with brown on",
    {
      "lr remote": [
        "the the.and fox on. hzat sat with brown sat with brown ",
        0,
      ],
      "lr local": [
        "the the.and fox on. hzat sat with brown sat with brown ",
        0,
      ],
      "lr both": ["the the.and fox on. hzat sat with brown sat with brown ", 0],
      "rl remote": [
        "the the.and fox on. hzat sat with brown sat with brown ",
        0,
      ],
      "rl local": [
        "the the.and fox on. hzat sat with brown sat with brown ",
        0,
      ],
      "rl both": ["the the.and fox on. hzat sat with brown sat with brown ", 0],
    },
  ],
  // one side inserted the phrase, the other replaced a word with it
  [
    "hat\u00a0on",
    "hat\u00a0P on",
    "P\u00a0on",
    {
      "lr remote": ["P\u00a0P on", 0],
      "lr local": ["P\u00a0P on", 0],
      "lr both": ["P\u00a0P on", 0],
      "rl remote": ["P\u00a0P on", 0],
      "rl local": ["P\u00a0P on", 0],
      "rl both": ["P\u00a0P on", 0],
    },
  ],
  [
    "a hat\u00a0on b",
    "a hat\u00a0P Q on b",
    "a P Q\u00a0on b",
    {
      "lr remote": ["a P Q\u00a0P Q on b", 0],
      "lr local": ["a P Q\u00a0P Q on b", 0],
      "lr both": ["a P Q\u00a0P Q on b", 0],
      "rl remote": ["a P Q\u00a0P Q on b", 0],
      "rl local": ["a P Q\u00a0P Q on b", 0],
      "rl both": ["a P Q\u00a0P Q on b", 0],
    },
  ],
  // a shared run of spaces alone is no echo; a word between is no gap
  [
    "w381 ",
    "w381 \n ",
    "w381a cat w382 w383 \n ",
    {
      "lr remote": ["w381a cat w382 w383 \n \n ", 0],
      "lr local": ["w381a cat w382 w383 \n \n ", 0],
      "lr both": ["w381a cat w382 w383 \n \n ", 0],
      "rl remote": ["w381a cat w382 w383 \n \n ", 0],
      "rl local": ["w381a cat w382 w383 \n \n ", 0],
      "rl both": ["w381a cat w382 w383 \n \n ", 0],
    },
  ],
  [
    "w396 the\nsat \n w397\u9ce5\u00a0w398 \n ",
    "w396 the\nw400 \n w397\u9ce5 w399\u9ce5 w398w401",
    "w396 the\ncat \n w397\u9ce5 w399\u9ce5 w398 \n ",
    {
      "lr remote": [
        "w396 the\ncat \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
      "lr local": [
        "w396 the\nw400 \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
      "lr both": [
        "w396 the\nw400cat \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
      "rl remote": [
        "w396 the\nw400 \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
      "rl local": [
        "w396 the\ncat \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
      "rl both": [
        "w396 the\ncatw400 \n w397\u9ce5 w399\u9ce5 w399\u9ce5 w398w401",
        1,
      ],
    },
  ],
  [
    "a X b",
    "a P X b",
    "a X P b",
    {
      "lr remote": ["a P X P b", 0],
      "lr local": ["a P X P b", 0],
      "lr both": ["a P X P b", 0],
      "rl remote": ["a P X P b", 0],
      "rl local": ["a P X P b", 0],
      "rl both": ["a P X P b", 0],
    },
  ],
  // a replacement is never a slid insertion (candidate 1's isIns(E))
  [
    "x.y\u00a0z",
    "x. P\u00a0z",
    "x.y\u00a0P z",
    {
      "lr remote": ["x. P\u00a0P z", 0],
      "lr local": ["x. P\u00a0P z", 0],
      "lr both": ["x. P\u00a0P z", 0],
      "rl remote": ["x. P\u00a0P z", 0],
      "rl local": ["x. P\u00a0P z", 0],
      "rl both": ["x. P\u00a0P z", 0],
    },
  ],
  // a newline in the gap anchors: no pairing across it
  [
    "red\u00a0\nsat",
    "red \nbig\u00a0\nsat",
    "d big\u00a0\nsat",
    {
      "lr remote": ["d big \nbig\u00a0\nsat", 0],
      "lr local": ["d big \nbig\u00a0\nsat", 0],
      "lr both": ["d big \nbig\u00a0\nsat", 0],
      "rl remote": ["d big \nbig\u00a0\nsat", 0],
      "rl local": ["d big \nbig\u00a0\nsat", 0],
      "rl both": ["d big \nbig\u00a0\nsat", 0],
    },
  ],
  // the pairing never crosses another hunk of the same side (C neighbour)
  [
    "mat\u00a0\nthe",
    " mat fox\u00a0\n",
    "t\u00a0fox\u00a0\nthe",
    {
      "lr remote": ["t\u00a0fox fox\u00a0\n", 1],
      "lr local": [" mat fox\u00a0\n", 1],
      "lr both": [" matt\u00a0fox fox\u00a0\n", 1],
      "rl remote": [" mat fox\u00a0\n", 1],
      "rl local": ["t\u00a0fox fox\u00a0\n", 1],
      "rl both": ["t\u00a0fox mat fox\u00a0\n", 1],
    },
  ],
];

test("independent edits beside a shared word, NBSP (\\u00a0) gaps included, keep 1.0.0's result, both orders, every policy", () => {
  for (const [b, l, r, want] of UNCHANGED)
    for (const [L, R, k] of [
      [l, r, "lr"],
      [r, l, "rl"],
    ])
      for (const p of POLICIES) {
        const m = merge3Text(b, L, R, p);
        assert.deepEqual(
          [m.text, m.conflicts.length],
          want[`${k} ${p}`],
          `${k} ${p}: ${b} / ${L} / ${R}`,
        );
      }
});

const FIXED = [
  [
    "quick, café x1\u00a0x1 café\u00a0fox. the lazy.",
    "quick, café x1\u00a0x1 café\u00a0and with fox. the mat a sat ",
    "quick, café x1\u00a0 café\u00a0and with fox. the lazy.",
    "quick, café x1\u00a0 café\u00a0and with fox. the mat a sat ",
  ],
  [
    "and\u00a0over quick with",
    "and the\u00a0over quick with",
    "aznd the\u00a0over quick with",
    "aznd the\u00a0over quick with",
  ],
  [
    "brown\u00a0lazy sat",
    "over jumps dog\u00a0lazy sat",
    "brown dog\u00a0lazy sat",
    "over jumps dog\u00a0lazy sat",
  ],
  [
    "fox\u00a0a and then",
    "fzox the\u00a0a and then",
    "fox the\u00a0a and thez",
    "fzox the\u00a0a and thez",
  ],
];

test("an echo split across an NBSP (\\u00a0) lands once, both orders, every policy, both paths", () => {
  for (const [b, l, r, want] of FIXED)
    for (const [L, R] of [
      [l, r],
      [r, l],
    ]) {
      for (const p of POLICIES) {
        const m = merge3Text(b, L, R, p);
        assert.equal(m.text, want, `${p}: ${L} / ${R}`);
        assert.equal(m.conflicts.length, 0, `${p}: ${L} / ${R}`);
        assert.ok(monotonic(m, L), `caret map ${p}: ${L} / ${R}`);
      }
      const d = mergeBodies(`<p>${b}</p>`, `<p>${L}</p>`, `<p>${R}</p>`);
      assert.equal(html(d.html), `<p>${want}</p>`, `doc: ${L} / ${R}`);
      assert.equal(d.res.conflicts.length, 0, `doc: ${L} / ${R}`);
    }
});

// One side typed the phrase beside a base space and nothing else there
// (maybe an edit far away); the other typed it too and edited the word just
// before or after the space. The oracle is the full text: each side's own
// edits applied to base, the phrase once.
function fuzz(seed, N) {
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const int = (n) => Math.floor(rnd() * n);
  const V =
    "the quick brown fox jumps over lazy dog and a cat sat on mat with hat now then".split(
      " ",
    );
  let seq = 0;
  const fresh = () => V[int(V.length)] + ++seq;
  const edit = (w) => {
    const k = int(3);
    if (k === 0) return w.slice(0, 1) + "z" + w.slice(1);
    if (k === 1) return fresh();
    return fresh() + " " + fresh();
  };
  const fails = [];
  let conflicted = 0;
  for (let it = 0; it < N; it++) {
    const n = 3 + int(5);
    const pool = V.slice();
    const ws = Array.from(
      { length: n },
      () => pool.splice(int(pool.length), 1)[0],
    );
    const sp = Array.from({ length: n - 1 }, () =>
      rnd() < 0.2 ? "\u00a0" : " ",
    );
    const g = int(n - 1);
    const phrase = Array.from({ length: 1 + int(3) }, fresh).join(" ");
    const after = rnd() < 0.5;
    const text = (w, withPhrase) => {
      let s = "";
      for (let i = 0; i < n; i++) {
        s += w[i];
        if (i === g && withPhrase)
          s += after ? sp[i] + phrase + " " : " " + phrase + sp[i];
        else if (i < n - 1) s += sp[i];
      }
      return s;
    };
    const xw = ws.slice(),
      yw = ws.slice();
    const near = rnd() < 0.5 ? g : g + 1;
    yw[near] = edit(ws[near]);
    const far = [...ws.keys()].filter((i) => i < g - 1 || i > g + 2);
    if (far.length && rnd() < 0.5) xw[far[int(far.length)]] = edit("q");
    const base = text(ws, false),
      X = text(xw, true),
      Y = text(yw, true);
    const want = text(
      ws.map((w, i) => (xw[i] !== w ? xw[i] : yw[i])),
      true,
    );
    const [local, remote] = rnd() < 0.5 ? [Y, X] : [X, Y];
    for (const p of POLICIES) {
      const m = merge3Text(base, local, remote, p);
      if (m.conflicts.length) conflicted++;
      if (m.text !== want || !monotonic(m, local))
        fails.push({ p, base, local, remote, out: m.text, want });
    }
    const d = mergeBodies(
      `<p>${base}</p>`,
      `<p>${local}</p>`,
      `<p>${remote}</p>`,
    );
    if (html(d.html) !== `<p>${want}</p>` || d.res.conflicts.length)
      fails.push({ doc: true, base, local, remote, out: d.html, want });
  }
  return { fails, conflicted };
}

for (const seed of [1, 2, 3]) {
  test(`echo split across a space or an NBSP (\\u00a0), full-text oracle, seed ${seed}`, () => {
    const { fails, conflicted } = fuzz(seed, 600);
    assert.equal(conflicted, 0);
    assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 3), null, 1));
  });
}

test("the caret map stays monotonic beside a split echo, every policy", () => {
  for (const p of POLICIES)
    for (const [l, r] of [
      ["a b X Y c", "a X c"],
      ["a X c", "a b X Y c"],
    ]) {
      const m = merge3Text("a b c", l, r, p);
      assert.ok(monotonic(m, l), `${p}: ${l} / ${r}`);
    }
});
