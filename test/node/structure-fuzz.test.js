// Echo-aware structural fuzz (Opus 18), run on the node DOM. The generator
// and the model live in test/lib/structure-fuzz.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "./lib/merge.js";
import { fuzz as run, setIdMode } from "../lib/structure-fuzz.js";

const merge = (b, l, r) => {
  const { html, res } = mergeBodies(b, l, r);
  return { html, conflicts: res.conflicts };
};
export const fuzz = (from, to) => run(from, to, merge);

test("O18 structural fuzz: echoes, nested slots, cross-block moves, splits and joins never duplicate or lose shared content", async () => {
  const fails = await fuzz(1, 1000);
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 3), null, 1));
});

// The same seeds with authored ids on the elements: the engine reads ids to
// pair elements, so every later engine change is checked with them too.
for (const mode of [1, 3, 4, 5, 6]) {
  test(`O18 structural fuzz, id mode ${mode}: seeds 1-300`, async () => {
    setIdMode(mode);
    let fails;
    try {
      fails = await fuzz(1, 300);
    } finally {
      setIdMode(0);
    }
    assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 3), null, 1));
  });
}
