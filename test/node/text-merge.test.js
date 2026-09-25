import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, merge3Text } from "../../src/text-merge.js";

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
