import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diff,
  merge3Text,
  MAX_TOKENS,
  MAX_EDITS,
} from "../../src/text-merge.js";

function apply(base, hunks) {
  let out = "",
    pos = 0;
  for (const h of hunks) {
    out += base.slice(pos, h.bs) + h.text;
    pos = h.be;
  }
  return out + base.slice(pos);
}

test("diff round-trips arbitrary edits", () => {
  const cases = [
    ["", "abc"],
    ["abc", ""],
    ["abc", "abc"],
    ["abc", "axc"],
    ["the lazy dog", "the sleepy dog"],
    ["a\nb\nc", "a\nx\nc\nd"],
    ["😀x😀", "😀y😀"],
    ["aaaa", "aa"],
    ["kitten", "sitting"],
  ];
  for (const [a, b] of cases)
    assert.equal(apply(a, diff(a, b)), b, `${a} -> ${b}`);
});

test("diff never splits a surrogate pair", () => {
  const h = diff("x 😀 y", "x y");
  assert.equal(h.length, 1);
  const base = "x 😀 y";
  for (const i of [h[0].bs, h[0].be]) {
    const c = base.charCodeAt(i);
    assert.ok(!(c >= 0xdc00 && c <= 0xdfff), `offset ${i} splits a pair`);
  }
});

test("text conflicts carry base offsets of the contested region", () => {
  const base = "the lazy dog";
  const c = merge3Text(base, "the LAZY dog", "the sleepy dog").conflicts[0];
  assert.equal(base.slice(c.bs, c.be), "lazy");
});

test("T-T1 disjoint edits both apply", () => {
  const base = "The quick brown fox jumps over the lazy dog.";
  const r = merge3Text(base, "Note: " + base, base.replace("lazy", "sleepy"));
  assert.equal(r.text, "Note: The quick brown fox jumps over the sleepy dog.");
  assert.equal(r.conflicts.length, 0);
});

test("T-T2 overlapping edits by policy", () => {
  const base = "the lazy dog";
  assert.equal(
    merge3Text(base, "the LAZY dog", "the sleepy dog", "remote").text,
    "the sleepy dog",
  );
  assert.equal(
    merge3Text(base, "the LAZY dog", "the sleepy dog", "local").text,
    "the LAZY dog",
  );
  assert.equal(
    merge3Text(base, "the LAZY dog", "the sleepy dog", "both").text,
    "the LAZYsleepy dog",
  );
  const r = merge3Text(base, "the LAZY dog", "the sleepy dog");
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(
    [r.conflicts[0].local, r.conflicts[0].remote],
    ["LAZY", "sleepy"],
  );
});

test("T-T3 two insertions at the same point: local first, no conflict", () => {
  const r = merge3Text("a b", "a X b", "a Y b");
  assert.equal(r.text, "a X Y b");
  assert.equal(r.conflicts.length, 0);
});

test("T-T3b two edits inside one word conflict", () => {
  const r = merge3Text("ab", "aXb", "aYb");
  assert.equal(r.text, "aYb");
  assert.equal(r.conflicts.length, 1);
});

test("T-T4 insertion touching a deletion inside one word conflicts", () => {
  const r = merge3Text("abcd", "abXcd", "abd");
  assert.equal(r.text, "abd");
  assert.equal(r.conflicts.length, 1);
});

test("T-T5 one side empties the string", () => {
  const r = merge3Text("hello world", "", "hello there");
  assert.equal(r.text, "hello there");
  assert.equal(r.conflicts.length, 1);
});

test("fast paths", () => {
  assert.equal(merge3Text("a", "b", "b").text, "b");
  assert.equal(merge3Text("a", "a", "c").text, "c");
  assert.equal(merge3Text("a", "d", "a").text, "d");
});

test("T-T6 mapLocalOffset before, inside, after a remote hunk", () => {
  const base = "The lazy dog sleeps.";
  const local = "The lazy dog sleeps!"; // local edited the end
  const remote = "The sleepy dog sleeps."; // remote replaced "lazy" (4..8) with "sleepy"
  const r = merge3Text(base, local, remote);
  assert.equal(r.text, "The sleepy dog sleeps!");
  assert.equal(r.mapLocalOffset(2), 2); // before
  // inside the word remote replaced ("lazy" -> "sleepy") -> after "sleepy"
  assert.equal(r.mapLocalOffset(6), 10);
  assert.equal(r.mapLocalOffset(13), 15); // after: shifted by +2
  assert.equal(r.mapLocalOffset(local.length), r.text.length);
});

test("mapLocalOffset inside a local insertion", () => {
  const r = merge3Text("a b", "a XYZ b", "a b!");
  assert.equal(r.text, "a XYZ b!");
  assert.equal(r.mapLocalOffset(4), 4);
  assert.equal(r.mapLocalOffset(7), 7);
});

test("mapLocalOffset when the local hunk lost a conflict clamps after the remote text", () => {
  const r = merge3Text("the lazy dog", "the LAZY dog", "the sleepy dog");
  assert.equal(r.mapLocalOffset(6), 10); // caret inside LAZY -> after "sleepy"
  assert.equal(r.mapLocalOffset(12), 14);
});

test("T-T8 large input falls back within bounds", () => {
  const base = "x".repeat(30000);
  const local = base + "\nlocal";
  const remote = "remote\n" + base;
  const t0 = performance.now();
  const r = merge3Text(base, local, remote);
  assert.ok(performance.now() - t0 < 200);
  assert.equal(r.text, "remote\n" + base + "\nlocal");
});

test("same-word edits conflict instead of inventing words", () => {
  const cases = [
    ["cat", "cut", "cap", "cap"],
    [
      "the colr is red",
      "the color is red",
      "the colour is red",
      "the colour is red",
    ],
    [
      "The meeting is on Monday at noon.",
      "The meeting is on Tuesday at noon.",
      "The meeting is on Mondy at noon.",
      "The meeting is on Mondy at noon.",
    ],
    [
      "We will ship it soon.",
      "We plan to release it next week.",
      "We will ship it very soon.",
      "We plan to release it very soon.",
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const m = merge3Text(b, l, r);
    assert.equal(m.text, want, `${l} / ${r}`);
    assert.equal(m.conflicts.length, 1, `${l} / ${r}`);
  }
});

test("edits to adjacent words both land", () => {
  const r = merge3Text(
    "the quick brown fox",
    "the fast brown fox",
    "the quick red fox",
  );
  assert.equal(r.text, "the fast red fox");
  assert.equal(r.conflicts.length, 0);
});

test("scripts without spaces merge by word", () => {
  const r = merge3Text("我们今天去公园", "我们明天去公园", "我们今天去海边");
  assert.equal(r.text, "我们明天去海边");
  assert.equal(r.conflicts.length, 0);
});

test("H2 diff joins hunks separated only by whitespace", () => {
  assert.deepEqual(diff("a b c", "a x y b"), [{ bs: 2, be: 5, text: "x y b" }]);
  assert.deepEqual(diff("the cat sat", "the dog and cat"), [
    { bs: 4, be: 11, text: "dog and cat" },
  ]);
  assert.deepEqual(diff("a b c", "x b y"), [
    { bs: 0, be: 1, text: "x" },
    { bs: 4, be: 5, text: "y" },
  ]);
  assert.deepEqual(diff("a\nb\nc", "x\ny\nc"), [
    { bs: 0, be: 1, text: "x" },
    { bs: 2, be: 3, text: "y" },
  ]);
});

test("H2 a whitespace anchor inside one edit does not split it around a conflict", () => {
  const cases = [
    ["a b c", "a x y b", "a Z b c", "a Z b c"],
    [
      "the cat sat",
      "the dog and cat",
      "the black cat sat",
      "the black cat sat",
    ],
    [
      "We plan to release it next week.",
      "We plan to ship it and release it",
      "We plan to release it very next week.",
      "We plan to ship it very next week.",
    ],
    [
      "one two three",
      "one four five two",
      "one six two three",
      "one six two three",
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const m = merge3Text(b, l, r);
    assert.equal(m.text, want, `${l} / ${r}`);
    assert.equal(m.conflicts.length, 1, `${l} / ${r}`);
    const ml = merge3Text(b, l, r, "local");
    assert.equal(ml.text, l, `${l} / ${r} (local policy)`);
  }
});

test("H16 a text insertion touching a replacement is a conflict, either side", () => {
  const b = "We plan to release it next week.";
  const ins = "We plan to release it very next week.";
  const rep = "We plan to release it soon.";
  const a = merge3Text(b, ins, rep);
  assert.equal(a.text, rep);
  assert.equal(a.conflicts.length, 1);
  assert.equal(merge3Text(b, ins, rep, "local").text, ins);
  const c = merge3Text(b, rep, ins);
  assert.equal(c.text, ins);
  assert.equal(c.conflicts.length, 1);
  assert.equal(merge3Text(b, rep, ins, "local").text, rep);
});

test("H16 two touching replacements both land, fused word included", () => {
  const a = merge3Text(
    "now then, upon a time",
    "now when, upon a time",
    "now then upon a time",
  );
  assert.equal(a.text, "now when upon a time");
  assert.equal(a.conflicts.length, 0);
  const f = merge3Text("the cat. sat", "the dog sat", "the cat.sat");
  assert.equal(f.text, "the dogsat");
  assert.equal(f.conflicts.length, 0);
  const g = merge3Text("the cat. sat", "the cat.sat", "the dog sat");
  assert.equal(g.text, "the dogsat");
  assert.equal(g.conflicts.length, 0);
});

test("H19b past both bounds the merge is a line-granularity conflict", () => {
  const lines = 5000;
  const base = "a b c d e\n".repeat(lines);
  const local = "a b c d L\n".repeat(lines);
  const remote = "R b c d e\n" + "a b c d e\n".repeat(lines - 1);
  assert.ok(base.split(" ").length > MAX_TOKENS);
  assert.ok(lines > MAX_EDITS);
  const r = merge3Text(base, local, remote);
  assert.equal(r.granularity, "line");
  assert.equal(r.text, remote);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].bs, 0);
  assert.equal(r.conflicts[0].be, base.length);
  const l = merge3Text(base, local, remote, "local");
  assert.equal(l.granularity, "line");
  assert.equal(l.text, local);
});
