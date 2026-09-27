// Echo-aware structural fuzz (Opus 18), run on the node DOM. The generator
// and the model live in test/lib/structure-fuzz.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "./lib/merge.js";
import { fuzz as run } from "../lib/structure-fuzz.js";

const merge = (b, l, r) => {
  const { html, res } = mergeBodies(b, l, r);
  return { html, conflicts: res.conflicts };
};
export const fuzz = (from, to) => run(from, to, merge);

test("O18 structural fuzz: echoes, nested slots, cross-block moves, splits and joins never duplicate or lose shared content", async () => {
  const fails = await fuzz(1, 1000);
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 3), null, 1));
});
