import { test } from "node:test";
import assert from "node:assert/strict";
// Two byte-identical siblings with distinct synthetic ids swap on the remote,
// while the local tab edits one of them. Identity says the edit follows the card.

import { runSynthetic as run } from "../lib/identity-witness.js";
const cases = {
  "swap in a list, local edits the first": {
    baseBody: `<ul><li>Same card</li><li>Same card</li></ul><p>x</p>`,
    localEdit: (b) => (b.querySelector("li").textContent = "Same card LOCAL"),
    remoteBody: `<ul><li>Same card</li><li>Same card</li></ul><p>x changed</p>`,
    ids: [0, "A", "B", "P"],
    remoteIds: [0, "B", "A", "P"],
  },
  "swap across columns, local edits one": {
    baseBody: `<section><ul><li>Same card</li></ul></section><section><ul><li>Same card</li></ul></section><p>x</p>`,
    localEdit: (b) => (b.querySelector("li").textContent = "Same card LOCAL"),
    remoteBody: `<section><ul><li>Same card</li></ul></section><section><ul><li>Same card</li></ul></section><p>x changed</p>`,
    ids: ["S1", "U1", "A", "S2", "U2", "B", "P"],
    remoteIds: ["S1", "U1", "B", "S2", "U2", "A", "P"],
  },
  "swap in a list, clean": {
    baseBody: `<ul><li>Same card</li><li>Same card</li></ul><p>x</p>`,
    localEdit: null,
    remoteBody: `<ul><li>Same card</li><li>Same card</li></ul><p>x changed</p>`,
    ids: [0, "A", "B", "P"],
    remoteIds: [0, "B", "A", "P"],
  },
};
for (const [name, c] of Object.entries(cases))
  test(`G1 ${name}`, async () => {
    const out = await run("candidate", c);
    const expected = c.localEdit
      ? name.includes("columns")
        ? ["Same card", "Same card LOCAL"]
        : ["Same card", "Same card LOCAL"]
      : ["Same card", "Same card"];
    assert.deepEqual(
      [...out.html.matchAll(/<li>(.*?)<\/li>/g)].map((x) => x[1]),
      expected,
    );
    assert.deepEqual(out.conflicts, []);
  });
