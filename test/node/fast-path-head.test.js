import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { doc, parse } from "./lib/dom.js";
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
      let prepared = 0;
      const input = {
        b,
        r: b.replace(">old<", ">NEW<"),
        prepare(live) {
          prepared++;
          if (mode === "live-node") {
            const style = live.createElement("style");
            style.textContent = "body { color: red }";
            live.head.append(style);
          }
          if (mode === "live-attribute")
            live.head.setAttribute("data-runtime", "keep");
          if (mode === "capture-only")
            live.querySelector('meta[name="capture"]').remove();
          if (mode !== "activation") {
            const capture = parse(b);
            assert.notEqual(live.head.outerHTML, capture.head.outerHTML);
            if (mode === "live-node") {
              assert.ok(live.head.querySelector("style"));
              assert.equal(capture.head.querySelector("style"), null);
            } else if (mode === "live-attribute") {
              assert.equal(live.head.getAttribute("data-runtime"), "keep");
              assert.equal(capture.head.hasAttribute("data-runtime"), false);
            } else {
              assert.equal(
                live.head.querySelector('meta[name="capture"]'),
                null,
              );
              assert.ok(capture.head.querySelector('meta[name="capture"]'));
            }
          }
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
      if (mode !== "activation") assert.equal(prepared, 2);
      assert.equal(fast.fast.fastPathTaken, 1);
      assert.deepEqual(differences(full, fast), []);
    });
  }
}
