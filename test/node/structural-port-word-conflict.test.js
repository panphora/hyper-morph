import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocument } from "../../src/index.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";

for (const [
  name,
  remoteTail,
  baseAlternative,
  localAlternative,
  remoteAlternative,
] of [
  [
    "replacement",
    "TWO three",
    '<p id="a">two</p>',
    "<p>port</p><p>two</p>",
    "<p>TWO</p>",
  ],
  ["deletion", "three", '<p id="a">two </p>', "<p>port</p><p>two </p>", ""],
]) {
  test(`structural port guard: a touching word ${name} keeps its native conflict`, async () => {
    const b = '<p id="a">one two three</p>';
    const l = '<p id="a">one </p><p>port</p><p>two three</p>';
    const r = `<p id="a">one </p><p>${remoteTail}</p>`;
    const x = mergeBodies(b, l, r);
    assert.equal(x.html, r);
    assert.equal(x.res.conflicts.length, 1);
    const conflict = x.res.conflicts[0];
    assert.equal(conflict.kind, "text");
    assert.equal(conflict.base, baseAlternative);
    assert.equal(conflict.local, localAlternative);
    assert.equal(conflict.remote, remoteAlternative);
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
    const live = parse(doc(l));
    const prefix = live.body.firstElementChild,
      tail = live.body.lastElementChild;
    const report = await mergeDocument({
      live,
      base: doc(b),
      remote: doc(r),
      scripts: { execute: false },
    });
    assert.equal(live.body.innerHTML, r);
    assert.equal(live.body.firstElementChild, prefix);
    assert.equal(live.body.lastElementChild, tail);
    assert.deepEqual(
      recoveryProblems(
        report.conflicts,
        finalTree(live.documentElement),
        false,
      ),
      [],
    );
  });
}
