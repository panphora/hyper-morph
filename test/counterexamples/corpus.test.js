// The counterexample corpus: every case in cases/ is a merge some engine got
// wrong, found by the adversarial loop or carried over from a review. Each
// must now pass the oracle in test/counterexamples/lib/oracle.js, must still
// create the conditions it claims (`requires`), and must record the engine
// it failed on, so `node test/counterexamples/cli.mjs prove` can show it
// fails there. The oracle's own properties are checked for sensitivity at
// the end: a planted fault of each kind must turn a case red that the real
// engine passes, over the corpus plus a fixed set of generated cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../../src/index.js";
import { verdict, judge } from "./lib/oracle.js";
import { MUTANTS } from "./lib/mutants.js";
import { identityCase } from "./lib/gen-identity.js";

const dir = fileURLToPath(new URL("./cases/", import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const cases = files.map((f) => [
  f,
  JSON.parse(readFileSync(path.join(dir, f), "utf8")),
]);

test("the corpus is not empty", () => {
  assert.ok(cases.length > 0);
});

for (const [file, c] of cases)
  test(`${file}: ${c.title || ""}`, async () => {
    const m = c.meta || {};
    assert.equal(m.id, path.basename(file, ".json"), "meta.id names the file");
    assert.ok(
      m.failsOn?.engine,
      "meta.failsOn.engine records the engine it failed on",
    );
    assert.ok(
      m.failsOn?.violations?.length,
      "meta.failsOn.violations records how",
    );
    const v = await verdict(E, null, c);
    assert.equal(
      v.status,
      "passes",
      `${v.status}: ${v.reason || JSON.stringify(v.violations?.slice(0, 3))}`,
    );
    if (m.original) {
      const o = await verdict(E, null, m.original);
      assert.notEqual(
        o.status,
        "counterexample",
        `the unshrunk original: ${JSON.stringify(o.violations?.slice(0, 3))}`,
      );
    }
  });

const pool = cases.map(([, c]) => c);
for (let seed = 1; seed <= 12; seed++)
  for (const dirty of [false, true]) {
    const c = identityCase(E, seed, "full", dirty);
    if (c) pool.push(c);
  }

for (const [kind, mutate] of Object.entries(MUTANTS))
  test(`the oracle sees a planted ${kind}`, async () => {
    const bad = mutate(E);
    let seen = 0;
    for (const c of pool) {
      if ((await judge(E, c)).violations.length) continue;
      if ((await judge(bad, c)).violations.length) seen++;
    }
    assert.ok(seen > 0, `no green case turned red under the planted ${kind}`);
  });
