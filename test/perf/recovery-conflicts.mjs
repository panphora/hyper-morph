import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parse, doc } from "../node/lib/dom.js";
import * as candidate from "../../src/index.js";

assert.ok(global.gc, "Run node --expose-gc");
assert.ok(
  process.env.HM_REFERENCE_ENTRY,
  "Set HM_REFERENCE_ENTRY to the frozen pre-E4b entry",
);
const reference = await import(
  pathToFileURL(process.env.HM_REFERENCE_ENTRY).href
);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fixture = (n, mode) => {
  const build = (side) =>
    Array.from({ length: n }, (_, i) => {
      if (mode === "structure")
        return `<section id="s${i}"><p>${side === "remote" ? "new" : "old"} words ${i}</p></section>`;
      if (mode === "collision")
        return `<p id="p${i}">x${i}</p>${side !== "base" && i % 10 === 0 ? `<p id="n${i}">${side === "local" ? "L" : "R"}${i}</p>` : ""}`;
      return `<p id="p${i}">One ${side === "remote" && i === n - 1 ? "fast" : "quick"} fox ${i}.</p>`;
    }).join("");
  return ["base", "local", "remote"].map((side) =>
    mode === "structure" && side === "local" ? "" : build(side),
  );
};

for (const [n, mode, shape] of [
  [3000, "clean", "pure"],
  [1000, "structure", "pure"],
  [6000, "collision", "live"],
]) {
  const bodies = fixture(n, mode),
    times = { reference: [], candidate: [] };
  let count = 0,
    anchors = 0;
  for (let round = 0; round < 4; round++) {
    for (const name of round % 2
      ? ["candidate", "reference"]
      : ["reference", "candidate"]) {
      const engine = name === "candidate" ? candidate : reference;
      const inputs = bodies.map((html) => parse(doc(html)));
      global.gc();
      const start = performance.now();
      const result =
        shape === "pure"
          ? engine.merge3(...inputs)
          : await engine.mergeDocument({
              base: inputs[0],
              live: inputs[1],
              remote: inputs[2],
              scripts: { execute: false },
            });
      const elapsed = performance.now() - start;
      if (round) times[name].push(elapsed);
      count = result.conflicts.length;
      assert.equal(
        count,
        mode === "clean" ? 0 : mode === "structure" ? n : n / 10,
      );
      if (name === "candidate")
        anchors = result.conflicts.reduce(
          (sum, c) =>
            sum +
            ["localPlacement", "remotePlacement", "mergedPlacement"].reduce(
              (a, key) => {
                const p = c.recovery.structure?.[key];
                return a + (p ? p.before.length + p.after.length : 0);
              },
              0,
            ),
          0,
        );
    }
  }
  const ratio = median(times.candidate) / median(times.reference);
  console.log(
    JSON.stringify({
      n,
      mode,
      shape,
      conflicts: count,
      anchors,
      ...times,
      ratio,
    }),
  );
  if (mode === "structure")
    assert.ok(
      ratio <= 2,
      `1000 structural conflicts: ${ratio.toFixed(3)}x exceeds 2x`,
    );
}
