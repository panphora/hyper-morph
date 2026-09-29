import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, window } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { findScope } from "../../src/fast-path.js";
import { defaultIdentity } from "../../src/identity.js";

test("scope descent bounds repeated subtree comparisons on a deep chain", () => {
  const b = doc(
    "<main>" +
      "<div>".repeat(600) +
      "<p>old</p>" +
      "</div>".repeat(600) +
      "</main>",
  );
  const cap = parse(b),
    live = parse(b),
    remote = parse(b.replace(">old<", ">NEW<"));
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const original = window.Node.prototype.isEqualNode;
  let comparisons = 0;
  window.Node.prototype.isEqualNode = function (other) {
    comparisons++;
    return original.call(this, other);
  };
  try {
    const result = findScope({
      baseRoot: cap.documentElement,
      remoteRoot: remote.documentElement,
      liveRoot: live.documentElement,
      toLive: (n) => lock.get(n) || null,
      o: {
        ignored: () => false,
        remoteWins: () => false,
        ignoreAttribute: () => false,
        scripts: { merge: false },
      },
      identity: { base: defaultIdentity, remote: defaultIdentity },
      baseURI: live.baseURI,
    });
    assert.ok(result.scope);
    assert.ok(comparisons <= 18, `subtree comparisons: ${comparisons}`);
  } finally {
    window.Node.prototype.isEqualNode = original;
  }
});
