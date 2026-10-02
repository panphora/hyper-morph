import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeBodies } from "./lib/merge.js";

for (const [name, before, after] of [
  ["space insertion", "alpha beta", "alpha  beta"],
  ["space deletion", "alpha  beta", "alpha beta"],
  ["newline reindent", "alpha\n  beta", "alpha\n    beta"],
])
  for (const mirror of [false, true])
    test(`formatting whitespace keeps text policy: ${name}, mirror ${mirror}`, () => {
      const base = `<p>before <b>${before}</b> after</p>`;
      const deleted = "<p>before  after</p>";
      const respaced = `<p>before <b>${after}</b> after</p>`;
      const local = mirror ? respaced : deleted;
      const remote = mirror ? deleted : respaced;
      const winning = mergeBodies(base, local, remote, {
        conflicts: mirror ? "remote" : "local",
      });
      assert.equal(winning.html, deleted);
      assert.deepEqual(
        winning.res.conflicts.map((c) => c.kind),
        ["text"],
      );
      const both = mergeBodies(base, local, remote, { conflicts: "both" });
      assert.deepEqual(
        both.res.conflicts.map((c) => c.kind),
        ["text"],
      );
      assert.equal(
        both.res.conflicts.some((c) => c.detail === "edit-beats-delete"),
        false,
      );
    });
