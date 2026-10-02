import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocument } from "../../src/index.js";
import { planNativeTransfers } from "../../src/native-transfers.js";
import { occurrenceBudget } from "../../src/occurrence-map.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

const base = "<p>a b</p><p>c d</p><p>e f</p>";
const moved = "<p>a</p><p>c d</p><p>e f b</p>";
const edited = "<p>a b</p><p>c d</p><p>e F</p>";
const combined = "<p>a</p><p>c d</p><p>e F b</p>";
const competing = [
  '<p id="a">keep MOVED</p><p id="b">stay</p><p id="c">rest</p>',
  '<p id="a">keep</p><p id="b">stay MOVED</p><p id="c">rest</p>',
  '<p id="a">keep</p><p id="b">stay</p><p id="c">rest MOVED</p>',
  '<p id="a">keep</p><p id="b">stay MOVED</p><p id="c">rest MOVED</p>',
];
const fixtures = [
  ["local destination beside remote edit", base, moved, edited, combined],
  ["remote destination beside local edit", base, edited, moved, combined],
  ["competing destinations", ...competing],
  ["identical destination", base, moved, moved, moved],
  [
    "disjoint source edit",
    base,
    moved,
    "<p>A b</p><p>c d</p><p>e f</p>",
    "<p>A</p><p>c d</p><p>e f b</p>",
  ],
];
for (const [name, B, L, R, expected] of fixtures)
  for (const conflicts of ["local", "remote", "both"])
    test(`native transfer ${name}, ${conflicts}`, () => {
      const { html, res } = mergeBodies(B, L, R, { conflicts });
      assert.equal(html, expected);
      assert.equal(res.conflicts.length, 0);
    });

function plan(B, L, R, budget) {
  const sides = Object.fromEntries(
    [
      ["base", B],
      ["local", L],
      ["remote", R],
    ].map(([side, html]) => [
      side,
      Array.from(parse(doc(html)).body.childNodes),
    ]),
  );
  const localTwin = (node) => sides.local[sides.base.indexOf(node)];
  const remoteTwin = (node) => sides.remote[sides.base.indexOf(node)];
  return planNativeTransfers({
    ...sides,
    localTwin,
    remoteTwin,
    eligible: (node) => node.nodeType === 1 && node.tagName === "P",
    nodes: sides,
    ...(budget ? { budget } : {}),
  });
}

test("native producer certifies a nonmonotone origin and keeps full native nodes", () => {
  const result = plan(base, moved, edited);
  assert.ok(result);
  assert.equal(result.transfers.length, 1);
  assert.equal(result.prepared.localMap.monotone, false);
  const event = result.transfers[0];
  assert.equal(result.prepared.localMap.bTo[event.bs], event.ss);
  assert.equal(result.prepared.localMap.toB[event.ss], event.bs);
  for (const side of ["base", "local", "remote"])
    for (const node of result.prepared[side].nodes)
      assert.equal(
        result.prepared[side].text.slice(node.s, node.e),
        node.node.data,
      );
});

test("native producer declines copies, ambiguous residuals, and source rewrites", () => {
  assert.equal(plan(base, "<p>a b</p><p>c d</p><p>e f b</p>", edited), null);
  const repeated = "<p>a b</p><p>c b</p><p>d</p><p>e</p>";
  assert.equal(
    plan(repeated, "<p>a</p><p>c</p><p>d b</p><p>e b</p>", repeated),
    null,
  );
  assert.equal(plan(base, moved, "<p>a B</p><p>c d</p><p>e f</p>"), null);
});

test("native producer refuses an exhausted allowance without partial certification", () => {
  const budget = occurrenceBudget(0);
  assert.equal(plan(base, moved, edited, budget), null);
  assert.equal(budget.mapCells, 0);
});

async function applyFixture(B, L, R, type = () => {}) {
  const live = parse(doc(L));
  const snapshot = live.cloneNode(true);
  const toLive = new Map();
  const walk = (a, b) => {
    toLive.set(a, b);
    for (let i = 0; i < a.childNodes.length; i++)
      walk(a.childNodes[i], b.childNodes[i]);
  };
  walk(snapshot, live);
  const owners = Array.from(live.body.children);
  const texts = owners.map((owner) => owner.firstChild);
  type(live);
  const report = await mergeDocument({
    live,
    base: doc(B),
    local: { root: snapshot, toLive: (node) => toLive.get(node) || null },
    remote: doc(R),
  });
  assert.deepEqual(Array.from(live.body.children), owners);
  assert.deepEqual(
    Array.from(live.body.children, (owner) => owner.firstChild),
    texts,
  );
  assert.equal(report.conflicts.length, 0);
  return live.body.innerHTML;
}

test("native apply preserves the live owner and text nodes", async () => {
  assert.equal(await applyFixture(base, moved, edited), combined);
  assert.equal(await applyFixture(base, edited, moved), combined);
  assert.equal(await applyFixture(...competing.slice(0, 3)), competing[3]);
});

test("typing after the snapshot follows local and remote transfer origins once", async () => {
  const expected = "<p>a</p><p>c d</p><p>e F b!</p>";
  assert.equal(
    await applyFixture(base, moved, edited, (live) => {
      live.body.children[2].firstChild.data += "!";
    }),
    expected,
  );
  assert.equal(
    await applyFixture(base, edited, moved, (live) => {
      live.body.children[0].firstChild.data += "!";
    }),
    expected,
  );
});
