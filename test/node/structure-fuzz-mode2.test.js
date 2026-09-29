// Mode 2 (every node id'd, with one duplicated id per side) is a golden gate,
// not an oracle gate: a duplicated id has no single right merge, so what is
// pinned is the merged bytes and the conflicts reported. The engine this file
// was recorded on is the first reference; a later golden change is listed with
// its classification. `UPDATE_GOLDENS=1` rewrites the file instead of
// comparing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mergeBodies } from "./lib/merge.js";
import { generate, setIdMode } from "../lib/structure-fuzz.js";

const GOLDEN = new URL(
  "../fixtures/structure-fuzz-mode2.json",
  import.meta.url,
);
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const signature = (conflicts) =>
  conflicts
    .map((c) => `${c.kind}:${c.detail || ""}`)
    .sort()
    .join(",");

function golden() {
  const out = {};
  for (let seed = 1; seed <= 300; seed++) {
    const { b, l, r } = generate(seed);
    const { html, res } = mergeBodies(b, l, r);
    out[seed] = `${sha1(html)}#${signature(res.conflicts)}`;
  }
  return out;
}

test("O18 structural fuzz, id mode 2: seeds 1-300", async () => {
  setIdMode(2);
  let got;
  try {
    got = golden();
  } finally {
    setIdMode(0);
  }
  if (process.env.UPDATE_GOLDENS) {
    writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + "\n");
    return;
  }
  const want = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const seeds = Object.keys(want);
  const bad = seeds
    .filter((s) => want[s] !== got[s])
    .map((s) => `${s}: want ${want[s]}, got ${got[s]}`);
  assert.deepEqual(bad, []);
  assert.equal(Object.keys(got).length, seeds.length);
});
