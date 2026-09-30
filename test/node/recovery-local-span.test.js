import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { mergeDocument } from "../../src/index.js";

test("recovery capture skips a local span whose live text is shorter than the snapshot's, and the merge completes", async () => {
  const live = parse(doc('<p id="p">prefix mine suffix</p>'));
  const cap = parse(doc('<p id="p">prefix mine suffix</p>'));
  const map = lockstepMap(cap.documentElement, live.documentElement);
  const text = live.querySelector("p").firstChild;
  text.data = "mine";
  const report = await mergeDocument({
    live,
    base: doc('<p id="p">prefix base suffix</p>'),
    remote: doc('<p id="p">prefix theirs suffix</p>'),
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    hooks: { beforeAttributeUpdated: () => true },
    scripts: { execute: false },
  });
  assert.equal(live.querySelector("p").textContent, "theirs");
  assert.equal(report.conflicts.length, 1);
});
