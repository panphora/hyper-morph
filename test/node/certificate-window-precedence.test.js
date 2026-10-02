import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import {
  finalTree,
  lockstepMap,
  recoveryProblems,
} from "../lib/differential-observe.js";

const base =
  "<p>Intro text here.</p><p>We met the team then the client signed today.</p><p>Closing words.</p>";
const edited = base.replace("today", "TODAY");

function fixture(count, mirror) {
  const inserted =
    "<p>Ask the client about pricing.</p>" +
    (count === 2 ? "<p>Thank the team later.</p>" : "");
  const split =
    "<p>Intro text here.</p>" +
    inserted +
    "<p>We met the team</p><p>then the client</p><p>signed today.</p><p>Closing words.</p>";
  return {
    local: mirror ? split : edited,
    remote: mirror ? edited : split,
    expected: split.replace("today", "TODAY"),
    side: mirror ? 0 : 1,
  };
}

function planner(x, limit) {
  const units = [x.b, x.l, x.r].map((d) => Array.from(d.body.children));
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    V: {
      units: units[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[side + 1].includes(u),
    },
    idOf: (u) => u.id || null,
  }));
  const records = [];
  const result = certificateGroups({
    base: units[0],
    views,
    limit,
    eligible: (u) => u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    onUncertainSource: (record) => records.push(record),
  });
  return { result, records, units, views };
}

function assertPlan(x, planned, count, side) {
  const { result, units, views } = planned;
  assert.ok(result);
  const source = x.b.body.children[1];
  const certificates = result.certificatesBySource.get(source);
  assert.equal(certificates.length, 2);
  assert.deepEqual(
    certificates.map((c) => [c.side, c.target.textContent]),
    [
      [side, "then the client"],
      [side, "signed today."],
    ],
  );
  const covered = new Set();
  for (const certificate of certificates) {
    assert.equal(certificate.conservedSource, true);
    for (const run of certificate.retained.concat(certificate.runs)) {
      if (run.source !== source) continue;
      for (let i = run.from; i < run.to; i++) covered.add(i);
      assert.equal(
        source.textContent.slice(run.from, run.to),
        run.target.textContent.slice(
          run.targetFrom,
          run.targetFrom + run.to - run.from,
        ),
      );
    }
  }
  for (let i = 0; i < source.textContent.length; i++)
    if (/\S/.test(source.textContent[i])) assert.ok(covered.has(i));
  assert.deepEqual(
    result.certificates,
    Array.from(result.certificatesBySource.values()).flat(),
  );
  for (let i = 1; i <= count; i++) {
    const independent = units[side + 1][i];
    assert.equal(result.blocks.has(independent), false);
    assert.equal(
      result.certificates.some((c) => c.target === independent),
      false,
    );
  }
  const expectedBlocks = new Set();
  for (const { source, target, side } of result.certificates) {
    if (source.nodeType === 1) expectedBlocks.add(source);
    if (target.nodeType === 1) expectedBlocks.add(target);
    const owner = views[side].V.baseOf(target);
    if (owner?.nodeType === 1) expectedBlocks.add(owner);
  }
  for (const unit of units[0])
    if (expectedBlocks.has(unit))
      for (const { V } of views) {
        const twin = V.twin(unit);
        if (twin && V.here(twin)) expectedBlocks.add(twin);
      }
  assert.deepEqual(result.blocks, expectedBlocks);
  assert.deepEqual(planned.records, []);
}

for (const count of [1, 2])
  for (const mirror of [false, true]) {
    test(`conserved window: ${count} independent paragraphs, mirror ${mirror}`, () => {
      const f = fixture(count, mirror);
      const x = mergeBodies(base, f.local, f.remote);
      assert.equal(x.html, f.expected);
      assert.deepEqual(x.res.conflicts, []);
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
      assertPlan(x, planner(x), count, f.side);
    });

    test(`conserved window: ${count} independent paragraphs, mirror ${mirror}, live typing`, async () => {
      const f = fixture(count, mirror);
      const live = parse(doc(f.local)),
        captured = parse(doc(f.local));
      const owners = Array.from(live.body.children),
        texts = owners.map((n) => n.firstChild);
      const map = lockstepMap(captured.documentElement, live.documentElement);
      const ownerIndex = mirror ? count + 1 : 1;
      texts[ownerIndex].data = texts[ownerIndex].data.replace(
        "We met",
        "We TYPED met",
      );
      if (mirror) texts[1].data = texts[1].data.replace("Ask", "Ask TYPED-NEW");
      const report = await mergeDocument({
        live,
        base: doc(base),
        remote: doc(f.remote),
        local: {
          root: captured.documentElement,
          toLive: (node) => map.get(node) || null,
        },
        scripts: { execute: false },
        fastPath: false,
      });
      assert.equal(
        live.body.innerHTML,
        f.expected
          .replace("We met", "We TYPED met")
          .replace("Ask", mirror ? "Ask TYPED-NEW" : "Ask"),
      );
      assert.deepEqual(report.conflicts, []);
      assert.deepEqual(
        recoveryProblems(
          report.conflicts,
          finalTree(live.documentElement),
          false,
        ),
        [],
      );
      for (let i = 0; i < owners.length; i++) {
        assert.equal(live.body.contains(owners[i]), true);
        assert.equal(owners[i].firstChild, texts[i]);
      }
    });
  }

test("conserved window: a completed split remains indivisible across budget limits", () => {
  const f = fixture(2, false);
  const x = mergeBodies(base, f.local, f.remote);
  let completed = 0;
  for (const limit of [0, 1, 64, 1024, 2048, 4096, 8192, 640000]) {
    const planned = planner(x, limit);
    if (!planned.result?.certificates.some((c) => c.conservedSource)) continue;
    completed++;
    assertPlan(x, planned, 2, 1);
  }
  assert.ok(completed > 0);
});
