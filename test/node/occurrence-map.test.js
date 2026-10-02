import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileOccurrenceMap,
  occurrenceBudget,
} from "../../src/occurrence-map.js";
import { BREAK } from "../../src/text-merge.js";
import { ATOM } from "../../src/inline-merge.js";

const flat = (text) => ({ text, atomAt: new Map() });
const compile = (
  base,
  side,
  { retained = [], transfers = [], ...options } = {},
) =>
  compileOccurrenceMap({
    base: flat(base),
    side: flat(side),
    retained,
    transfers,
    ...options,
  });

test("occurrence map: a split carries exact inverse origins and its destination", () => {
  const destination = {};
  const result = compile("alpha beta gamma", `alpha${BREAK}beta gamma`, {
    retained: [{ from: 0, to: 5, target: 0 }],
    transfers: [{ from: 6, to: 16, target: 6, destination }],
  });
  assert.equal(result.status, "ready");
  const transfers = result.runs.filter((run) => run.kind === "transfer");
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].destination, destination);
  assert.equal(result.covers(0, 16), true);
  assert.equal(result.bTo[5], -1);
  for (let i = 0; i < 16; i++)
    if (i !== 5) {
      assert.equal(result.bTo[i], i);
      assert.equal(result.toB[result.bTo[i]], i);
    }
});

test("occurrence map: a copy cannot claim an original's retained text", () => {
  const result = compile("one two three", "one TWO threeone two three", {
    retained: [
      { from: 0, to: 4, target: 0 },
      { from: 7, to: 13, target: 7 },
    ],
    transfers: [{ from: 0, to: 13, target: 13 }],
  });
  assert.deepEqual(result, { status: "fallback", reason: "source-overlap" });
});

test("occurrence map: two repeated source characters cannot claim one target", () => {
  const result = compile("aa", "a", {
    transfers: [
      { from: 0, to: 1, target: 0 },
      { from: 1, to: 2, target: 0 },
    ],
  });
  assert.deepEqual(result, { status: "fallback", reason: "target-overlap" });
});

test("occurrence map: reordered origins are preserved and identified as nonmonotone", () => {
  const result = compile("ab", "ba", {
    transfers: [
      { from: 0, to: 1, target: 1 },
      { from: 1, to: 2, target: 0 },
    ],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.monotone, false);
  assert.deepEqual([...result.bTo], [1, 0, 2]);
  assert.deepEqual([...result.toB], [1, 0, 2]);
});

test("occurrence map: a shared word or period does not cover an orphan rewrite", () => {
  const word = compile("common one two", "common xx yy zz", {
    transfers: [{ from: 0, to: 6, target: 0 }],
  });
  assert.equal(word.status, "ready");
  assert.equal(word.covers(0, 14), false);
  const source = "Bring slides tomorrow.";
  const target = "Ask host first.";
  const period = compile(source, target, {
    transfers: [
      { from: source.length - 1, to: source.length, target: target.length - 1 },
    ],
  });
  assert.equal(period.status, "ready");
  assert.equal(period.covers(0, source.length), false);
});

test("occurrence map: atom glyphs require established correspondence", () => {
  const baseAtom = {};
  const sideAtom = {};
  const options = {
    base: { text: ATOM, atomAt: new Map([[0, { el: baseAtom }]]) },
    side: { text: ATOM, atomAt: new Map([[0, { el: sideAtom }]]) },
    retained: [],
    transfers: [{ from: 0, to: 1, target: 0 }],
  };
  assert.deepEqual(compileOccurrenceMap(options), {
    status: "fallback",
    reason: "different-atom",
  });
  assert.equal(
    compileOccurrenceMap({ ...options, sideAtomKey: () => baseAtom }).status,
    "ready",
  );
});

test("occurrence map: budget failures allocate no maps and coverage can remain undecided", () => {
  const emptyBudget = occurrenceBudget(0);
  const options = { retained: [{ from: 0, to: 3, target: 0 }] };
  assert.deepEqual(compile("abc", "abc", { ...options, budget: emptyBudget }), {
    status: "fallback",
    reason: "work-limit",
  });
  assert.equal(emptyBudget.mapCells, 0);
  const budget = occurrenceBudget();
  const result = compile("abc", "abc", { ...options, budget });
  assert.equal(result.status, "ready");
  assert.equal(budget.mapCells, 8);
  assert.equal(budget.mapWrites, 8);
  assert.equal(budget.comparisons, 3);
  budget.remaining = 0;
  assert.equal(result.covers(0, 3), null);
});

test("occurrence map: sorting stops at the shared work bound", () => {
  const budget = occurrenceBudget(12);
  const result = compile("abcd", "abcd", {
    budget,
    retained: [3, 2, 1, 0].map((i) => ({ from: i, to: i + 1, target: i })),
  });
  assert.deepEqual(result, { status: "fallback", reason: "work-limit" });
  assert.equal(budget.mapCells, 0);
});

test("occurrence map: unequal text cannot become an origin claim", () => {
  assert.deepEqual(
    compile("a", "b", { transfers: [{ from: 0, to: 1, target: 0 }] }),
    { status: "fallback", reason: "unequal-occurrence" },
  );
});
