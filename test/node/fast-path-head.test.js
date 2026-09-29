import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { doc } from "./lib/dom.js";
import { VARIANTS, observeClean, differences } from "../lib/fast-path-gate.js";

for (const mode of [
  "live-node",
  "live-attribute",
  "capture-only",
  "activation",
]) {
  for (const identity of [
    "synthetic",
    "default-keyed",
    "duplicate-outside",
    "duplicate-branch",
  ]) {
    test(`fast head matches full: ${mode}, ${identity}`, async () => {
      const keyed = identity !== "synthetic";
      const body = `<main${identity === "duplicate-branch" ? ' id="head"' : ""}><p>old</p></main><aside${identity === "duplicate-outside" ? ' id="head"' : ""}><p>side</p></aside>`;
      const head = '<title>base</title><meta name="capture" content="one">';
      const b = doc(body, head).replace(
        "<head>",
        keyed ? '<head id="head">' : "<head>",
      );
      const input = {
        b,
        r: b.replace(">old<", ">NEW<"),
        afterCapture(live) {
          if (mode === "live-node") {
            const style = live.createElement("style");
            style.textContent = "body { color: red }";
            live.head.append(style);
          }
          if (mode === "live-attribute")
            live.head.setAttribute("data-runtime", "keep");
          if (mode === "capture-only")
            live.querySelector('meta[name="capture"]').remove();
        },
        options: (calls) => ({
          scripts: { execute: false },
          beforeApply(d) {
            calls.push([d.head.outerHTML]);
            if (mode === "activation")
              d.head.setAttribute("data-activated", "yes");
          },
        }),
      };
      const variant = keyed ? null : VARIANTS.synthetic;
      const full = await observeClean(E, input, variant, false);
      const fast = await observeClean(E, input, variant, true);
      assert.equal(fast.fast.fastPathTaken, 1);
      assert.deepEqual(differences(full, fast), []);
    });
  }
}
