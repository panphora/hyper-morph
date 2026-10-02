import assert from "node:assert/strict";
import { test } from "node:test";
import { flatten, mergeInline, prepareInline } from "../../src/inline-merge.js";
import {
  boundaryOccurrences,
  occurrenceBudget,
} from "../../src/occurrence-map.js";
import { createAnalyzer } from "../../src/similarity.js";
import { mergeDocument } from "../../src/index.js";
import { steps } from "../../src/text-merge.js";
import { alignBlocks } from "./lib/inline.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";

const fixtures = [
  {
    name: "split",
    base: '<p id="a">alpha beta gamma</p>',
    local: '<p id="a">alpha</p><p id="b">beta gamma</p>',
  },
  {
    name: "join",
    base: '<p id="a">alpha</p><p id="b">beta gamma</p>',
    local: '<p id="a">alpha beta gamma</p>',
  },
];

function inputs(base, local) {
  const b = parse(doc(base));
  const l = parse(doc(local));
  const r = parse(doc(base));
  const analyzer = createAnalyzer({});
  const L = alignBlocks(b.body, l.body, analyzer);
  const R = alignBlocks(b.body, r.body, analyzer);
  const nodes = {
    base: [...b.body.childNodes],
    local: [...l.body.childNodes],
    remote: [...r.body.childNodes],
  };
  const blocks = new Set(
    Object.values(nodes)
      .flat()
      .filter((n) => n.nodeType === 1),
  );
  const fb = flatten(nodes.base, { blocks });
  const fl = flatten(nodes.local, { blocks });
  const fr = flatten(nodes.remote, { blocks });
  return { nodes, blocks, L, R, fb, fl, fr };
}

for (const fixture of fixtures) {
  test(`boundary occurrences: certified ${fixture.name} prepares without another diff`, () => {
    const { nodes, blocks, L, R, fb, fl, fr } = inputs(
      fixture.base,
      fixture.local,
    );
    const budget = occurrenceBudget();
    const local = boundaryOccurrences({
      base: fb,
      side: fl,
      baseOf: (el) => L.reverse.get(el),
      budget,
    });
    assert.equal(local.status, "ready");
    assert.ok(local.runs.filter((run) => run.kind === "transfer").length > 0);
    assert.equal(local.monotone, true);
    assert.ok(budget.boundarySteps > 0);
    const before = steps.diff;
    const prepared = prepareInline(fb, fl, fr, {}, { local, remote: null });
    assert.equal(steps.diff - before, 0);
    const out = parse(doc(""));
    const conflicts = [];
    const result = mergeInline({
      ...nodes,
      blocks,
      L,
      R,
      out,
      conflicts,
      prepared,
    });
    assert.equal(steps.diff - before, 0);
    assert.ok(result.nodes.length > 0);
    out.body.append(...result.nodes);
    assert.equal(out.body.innerHTML, fixture.local);
    assert.equal(conflicts.length, 0);
  });

  test(`boundary occurrences: production ${fixture.name} transfers an edit and retains live nodes`, async () => {
    const remote = fixture.base.replace("gamma", "GAMMA");
    const expected = fixture.local.replace("gamma", "GAMMA");
    const merged = mergeBodies(fixture.base, fixture.local, remote);
    assert.equal(merged.html, expected);
    assert.equal(merged.res.conflicts.length, 0);
    const live = parse(doc(fixture.local));
    const paragraph = live.body.lastElementChild;
    const text = paragraph.firstChild;
    await mergeDocument({ live, base: doc(fixture.base), remote: doc(remote) });
    assert.equal(live.body.innerHTML, expected);
    assert.equal(live.body.lastElementChild, paragraph);
    assert.equal(paragraph.firstChild, text);
  });
}

test("boundary occurrences: a full copy is not sequence conservation", () => {
  const { fb, fl, L } = inputs(
    '<p id="a">one two</p>',
    '<p id="a">one two</p><p id="copy">one two</p>',
  );
  assert.equal(
    boundaryOccurrences({
      base: fb,
      side: fl,
      baseOf: (el) => L.reverse.get(el),
    }).status,
    "none",
  );
});

test("boundary occurrences: a bound returns an explicit fallback", () => {
  const { fb, fl, L } = inputs(fixtures[0].base, fixtures[0].local);
  assert.deepEqual(
    boundaryOccurrences({
      base: fb,
      side: fl,
      baseOf: (el) => L.reverse.get(el),
      budget: occurrenceBudget(0),
    }),
    { status: "fallback", reason: "work-limit" },
  );
});
