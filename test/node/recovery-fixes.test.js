import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeDocument, morphElement, merge3 } from "../../src/index.js";
import { lockstepMap, observe } from "../lib/differential-observe.js";

async function merge(b, l, r, options = {}, mutate = null) {
  const live = parse(doc(l));
  const cap = parse(doc(l));
  const map = lockstepMap(cap.documentElement, live.documentElement);
  if (mutate) mutate(live);
  const report = await mergeDocument({
    live,
    base: parse(doc(b)),
    remote: parse(doc(r)),
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    scripts: { execute: false },
    ...options,
  });
  return { live, report, recoveries: report.conflicts.map((c) => c.recovery) };
}

test("F2: an unrelated conflict never fills a legacy insertion decision", async () => {
  const b = '<p id="p">old</p>';
  const r = '<p id="p">theirs</p><aside id="new">x</aside>';
  for (const l of [b, '<p id="p">mine</p>']) {
    const { live, report } = await merge(b, l, r);
    assert.equal(live.body.innerHTML, r);
    const d = report.decisions.find((x) => x.kind === "insert");
    assert.ok(d);
    assert.equal(d.el, null);
    assert.equal(d.node, null);
    assert.equal(d.applied, false);
  }
});

for (const [kind, b, l, r, field] of [
  [
    "text",
    '<p id="p">One quick fox</p>',
    '<p id="p">One slow fox</p>',
    '<p id="p">One fast fox</p>',
    "node",
  ],
  [
    "attr",
    '<a id="p" href="/a">Go</a>',
    '<a id="p" href="/mine">Go</a>',
    '<a id="p" href="/theirs">Go</a>',
    "el",
  ],
]) {
  test(`F2: ${kind} legacy pointer stays null after capture replacement`, async () => {
    const { report, recoveries } = await merge(b, l, r, {}, (live) => {
      const p = live.getElementById("p");
      p.replaceWith(p.cloneNode(true));
    });
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.conflicts[0][field], null);
    assert.equal(recoveries[0].subject.live.length, 1);
    assert.equal(recoveries[0].applied, true);
  });
}

test("F2: differential observes decision order, pointers, applied and stats", async () => {
  const engine = { mergeDocument, morphElement, merge3 };
  const b = '<p id="p">old</p>';
  const r = '<p id="p">theirs</p><aside id="new">x</aside>';
  const o = await observe(engine, "dirty", { b, l: '<p id="p">mine</p>', r });
  assert.deepEqual(
    o.decisions.map((d) => d.kind),
    ["text", "insert"],
  );
  assert.equal(o.decisions[1].source, "remote");
  assert.equal(o.decisions[1].applied, false);
  assert.equal(o.decisions[1].el, null);
  assert.ok(Object.keys(o.stats).length > 0);
  assert.ok(Object.values(o.stats).every((v) => typeof v === "number"));
});

test("F6: structural conflicts retain every ordered fallback anchor", () => {
  const body = (word) =>
    Array.from(
      { length: 12 },
      (_, i) => `<section id="s${i}"><p>${word} words ${i}</p></section>`,
    ).join("");
  const res = merge3(
    parse(doc(body("old"))),
    parse(doc("")),
    parse(doc(body("new"))),
  );
  assert.equal(res.conflicts.length, 12);
  for (let i = 0; i < 12; i++) {
    const r = res.conflicts[i].recovery;
    assert.equal(r.subject.key, `b:[1,${i}]`);
    assert.equal(r.structure.mergedPlacement.before.length, 11 - i);
    assert.equal(r.structure.mergedPlacement.after.length, i);
    assert.deepEqual(
      r.structure.mergedPlacement.before.map((x) => x.key),
      Array.from({ length: 11 - i }, (_, k) => `b:[1,${i + k + 1}]`),
    );
    assert.deepEqual(
      r.structure.mergedPlacement.after.map((x) => x.key),
      Array.from({ length: i }, (_, k) => `b:[1,${i - k - 1}]`),
    );
  }
});
