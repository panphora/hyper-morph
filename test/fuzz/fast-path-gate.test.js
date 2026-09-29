// The fast path's equivalence gate: every generated input in ClayJS's clean
// shape merges with `fastPath: false` as the reference and with
// `fastPath: true`, in id modes 0 to 6, three page shapes (the generated body
// alone, the body inside a page with static siblings, form controls,
// ignored and remote-wins regions, a head and a JSON merge tag, and on every
// third seed that page merged into a live page that differs from its
// capture in the head and outside the changed branch) and four
// identity variants (authored only, synthetic converged by path,
// operation-maintained, and operation-maintained with one id swapped, copied
// or renewed), and the two runs must agree on everything the observer in
// test/lib/fast-path-gate.js sees. Each id mode runs in its own thread.
// The fast path must actually be taken: a gate whose inputs all bail proves
// nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const MODES = [0, 1, 2, 3, 4, 5, 6];
const SEEDS = Number(process.env.HM_GATE_SEEDS) || 3000;

const runMode = (mode) =>
  new Promise((resolve, reject) => {
    const w = new Worker(
      new URL("../lib/fast-path-gate-worker.js", import.meta.url),
      {
        workerData: { mode, seeds: SEEDS },
      },
    );
    w.once("message", resolve);
    w.once("error", reject);
  });

test(`E5 fast path equals the full path: ${SEEDS} seeds, id modes 0 to 6`, async () => {
  const results = await Promise.all(MODES.map(runMode));
  const diffs = results.flatMap((r) => r.diffs);
  for (const r of results) {
    const taken = Object.values(r.tally).reduce((n, t) => n + t.taken, 0);
    console.log(
      `mode ${r.mode}: ${r.runs} pairs, fast path taken ${taken}`,
      JSON.stringify(r.tally),
    );
    assert.ok(taken > 0, `mode ${r.mode}: the fast path was never taken`);
    for (const [key, t] of Object.entries(r.tally))
      assert.ok(t.taken > 0, `mode ${r.mode} ${key}: never taken`);
  }
  assert.deepEqual(diffs.slice(0, 20), []);
});
