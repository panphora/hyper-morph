import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/index.js";
import { judge } from "../counterexamples/lib/oracle.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const shrunk = {
  shape: "dirty",
  identity: "clay",
  options: {},
  requires: ["localChanged", "remoteChanged"],
  base: "<main>before  after</main>",
  local: "<main>before beta after</main>",
  remote: "<main>before after</main>",
};
const original = {
  ...shrunk,
  base: '<main>before <b sid="S">alpha beta</b> after</main>',
  local: '<main>before <b sid="S">alpha LOCAL beta</b> after</main>',
};
for (const [name, input, output] of [
  ["shrunk", shrunk, "<main>before beta after</main>"],
  ["original", original, "<main>before <b>alpha LOCAL beta</b> after</main>"],
])
  test(`formatting port: exact ${name} clay fixture keeps its content`, async () => {
    const result = await judge(E, input);
    assert.deepEqual(result.violations, []);
    assert.equal(result.obs.raw.liveRoot.body.innerHTML, output);
    assert.deepEqual(
      result.obs.raw.report.conflicts.map((c) => [c.kind, c.detail]),
      name === "shrunk" ? [] : [["structure", "edit-beats-delete"]],
    );
  });

for (const mirror of [false, true])
  for (const conflicts of ["local", "remote", "both"])
    test(`formatting port: deleted bold, mirror ${mirror}, policy ${conflicts}`, () => {
      const { base, local, remote } = original;
      const x = mergeBodies(
        base,
        mirror ? remote : local,
        mirror ? local : remote,
        { conflicts, idOf: (u) => u.getAttribute?.("sid") || null },
      );
      assert.equal(x.html, local);
      assert.equal(x.res.conflicts.length, 1);
      const c = x.res.conflicts[0];
      assert.equal(c.kind, "structure");
      assert.equal(c.detail, "edit-beats-delete");
      assert.equal(c.recovery.localLost, mirror);
      assert.equal(
        c.recovery.structure.localAction,
        mirror ? "deleted" : "edited",
      );
      assert.equal(
        c.recovery.structure.remoteAction,
        mirror ? "edited" : "deleted",
      );
      const roots = {
        base: x.b.documentElement,
        local: x.l.documentElement,
        remote: x.r.documentElement,
        merged: x.res.doc.documentElement,
      };
      assert.deepEqual(
        recoveryProblems(x.res.conflicts, finalTree(roots.merged), true, roots),
        [],
      );
    });

test("formatting port: respacing only yields when it would win over the inserted word", () => {
  for (const mirror of [false, true])
    for (const conflicts of ["local", "remote", "both"]) {
      const x = mergeBodies(
        shrunk.base,
        mirror ? shrunk.remote : shrunk.local,
        mirror ? shrunk.local : shrunk.remote,
        { conflicts },
      );
      const yielding = conflicts === (mirror ? "local" : "remote");
      assert.equal(
        x.html,
        conflicts === "both"
          ? mirror
            ? "<main>before  beta after</main>"
            : "<main>before beta  after</main>"
          : shrunk.local,
      );
      assert.equal(x.res.conflicts.length, yielding ? 0 : 1);
    }
});

test("formatting port: native bold and text identities keep postcapture typing", async () => {
  const base = original.base.replace('sid="S"', 'id="S"'),
    local = original.local.replace('sid="S"', 'id="S"');
  const live = parse(doc(local)),
    captured = parse(doc(local));
  const bold = live.querySelector("b"),
    text = bold.firstChild;
  const map = lockstepMap(captured.documentElement, live.documentElement);
  text.data = "alpha TYPED LOCAL beta";
  const report = await E.mergeDocument({
    live,
    base: doc(base),
    remote: doc(original.remote),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    scripts: { execute: false },
    fastPath: false,
  });
  assert.equal(
    live.body.innerHTML,
    '<main>before <b id="S">alpha TYPED LOCAL beta</b> after</main>',
  );
  assert.equal(live.querySelector("b"), bold);
  assert.equal(bold.firstChild, text);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].detail, "edit-beats-delete");
  assert.equal(report.conflicts[0].recovery.localLost, false);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
});

test("formatting port: an existing source retention keeps its exact native conflict", () => {
  const x = mergeBodies(
    "<p>We met the team. Then we left.</p><p>The client called.</p>",
    "<p>We met the team. Then we LEFT.</p><p>The client called.</p>",
    "<p>We met the team.</p><p>The client called. Then we left.</p>",
  );
  assert.equal(
    x.html,
    "<p>We met the team. Then we LEFT.</p><p>The client called. Then we left.</p>",
  );
  assert.equal(x.res.conflicts.length, 1);
  const c = x.res.conflicts[0];
  assert.equal(c.kind, "text");
  assert.equal(c.resolved, " Then we LEFT.");
  assert.equal(c.recovery.localLost, false);
  assert.deepEqual(
    [c.recovery.text.base.start, c.recovery.text.base.end],
    [16, 30],
  );
});

test("formatting port: actual word deletion and formatting-only edits retain their text conflict", () => {
  for (const [b, l, r] of [
    ["<p>quick brown</p>", "<p>quick brown fox</p>", "<p>quick</p>"],
    ["<p>Hello world</p>", "<p><b>Hello world</b></p>", "<p></p>"],
  ]) {
    const x = mergeBodies(b, l, r);
    assert.equal(x.html, r);
    assert.equal(x.res.conflicts.length, 1);
    assert.equal(x.res.conflicts[0].kind, "text");
  }
});
