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
  const h = diff("a😀b", "ab");
  assert.equal(h.length, 1);
  assert.equal(h[0].be - h[0].bs, 2);
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

test("T-T3 two insertions at the same offset: local first, no conflict", () => {
  const r = merge3Text("ab", "aXb", "aYb");
  assert.equal(r.text, "aXYb");
  assert.equal(r.conflicts.length, 0);
});

test("T-T4 insertion adjacent to a deletion both apply", () => {
  const r = merge3Text("abcd", "abXcd", "abd");
  assert.equal(r.text, "abXd");
  assert.equal(r.conflicts.length, 0);
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
  // inside the remote hunk -> after it; the trailing "y" is shared base text,
  // so the hunk is [4,7) "sleep" and the caret lands after "sleep"
  assert.equal(r.mapLocalOffset(6), 9);
  assert.equal(r.mapLocalOffset(13), 15); // after: shifted by +2
  assert.equal(r.mapLocalOffset(local.length), r.text.length);
});

test("mapLocalOffset inside a local insertion", () => {
  const base = "ab";
  const r = merge3Text(base, "aXYZb", "ab!");
  assert.equal(r.text, "aXYZb!");
  assert.equal(r.mapLocalOffset(3), 3); // between X and Y... offset 3 in local is after "aXY"
  assert.equal(r.mapLocalOffset(5), 5); // end of local
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
