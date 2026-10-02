import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../../src/index.js";
import { verdict } from "../counterexamples/lib/oracle.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";

for (const [name, selector] of [
  ["holdout", "section"],
  ["round4", "main"],
]) {
  test(`hunt3 step6 original: ${name} preserves content and live owners`, async () => {
    const c = JSON.parse(
      readFileSync(
        new URL(
          `../counterexamples/cases/cx-hunt3-step6-${name}-original.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const v = await verdict(E, null, c);
    assert.equal(v.status, "passes");
    assert.deepEqual(v.violations || [], []);
    const observed = await runCase(E, normalize(c));
    const { p, liveRoot, report } = observed.raw;
    const captured = p.cap.querySelector(selector);
    const root = liveRoot.querySelector(selector);
    assert.equal(root, p.capToLive.get(captured));
    assert.equal(liveRoot.body.innerHTML, c.expect.html);
    assert.equal(root.children.length, captured.children.length);
    for (let i = 0; i < captured.children.length; i++)
      assert.equal(root.children[i], p.capToLive.get(captured.children[i]));
    assert.equal(report.conflicts.length, 0);
  });
}
