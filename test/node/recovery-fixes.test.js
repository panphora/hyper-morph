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

const emptyCases = [
  [
    "after br",
    '<p id="p">Hello world<br>old tail</p>',
    '<p id="p">Hello world<br>new tail</p>',
    '<p id="p">Hello world<br></p>',
    12,
  ],
  [
    "before atom",
    '<p id="p">old <img src="a.png"> tail words</p>',
    '<p id="p">new <img src="a.png"> tail words</p>',
    '<p id="p"><img src="a.png"> tail words</p>',
    0,
  ],
  [
    "text mark boundary",
    '<p id="p">A quick <i>Z</i></p>',
    '<p id="p">A fast <i>Z</i></p>',
    '<p id="p">A <i>Z</i></p>',
    2,
  ],
  [
    "emptied middle segment",
    "<p>keep one</p><p>a b c d</p><p>tail end</p>",
    "<p>keep one</p><p>a b</p><p>c d</p><p>tail end</p>",
    "<p>keep one</p><p>tail end</p>",
    0,
  ],
  [
    "bare middle segment",
    '<div id="d"><p>keep one</p>alpha beta<p>tail end</p></div>',
    '<div id="d"><p>keep one</p>alpha gamma<p>tail end</p></div>',
    '<div id="d"><p>keep one</p><p>tail end</p></div>',
    0,
  ],
  [
    "source after br",
    '<p id="p">one <br> fox</p>',
    '<p id="p">one <br></p>',
    '<p id="p"><br> aR</p>',
    null,
  ],
];
for (const [name, b, l, r, offset] of emptyCases) {
  test(`F1: ${name}`, async () => {
    const { recoveries } = await merge(b, l, r);
    const texts = recoveries.filter((x) => x.text);
    assert.ok(texts.length > 0);
    let checked = 0;
    for (const rv of texts) {
      for (const side of ["base", "local", "remote", "merged"]) {
        const s = rv.text[side];
        if (!s) continue;
        if (s.start === s.end) {
          assert.deepEqual(
            s.span.start,
            s.span.end,
            `${side}: collapsed empty span`,
          );
          checked++;
        }
        if (!s.text.length)
          assert.deepEqual(
            s.scope.start,
            s.scope.end,
            `${side}: collapsed empty scope`,
          );
      }
      assert.equal(rv.applied, true);
      if (offset !== null && rv.text.merged.fragment === "") {
        assert.deepEqual(
          [rv.text.merged.start, rv.text.merged.end],
          [offset, offset],
        );
        assert.equal(
          rv.text.liveSpan.startContainer,
          rv.text.liveSpan.endContainer,
        );
        assert.equal(rv.text.liveSpan.startOffset, rv.text.liveSpan.endOffset);
      }
    }
    assert.ok(checked > 0);
  });
}

test("F1: restoring an emptied segment preserves the surviving paragraph", async () => {
  const b = '<div id="s"><p>alpha bravo</p> charlie delta</div>';
  const l = '<div id="s"><p>alpha</p><p>BRAVE charlie delta</p></div>';
  const r = '<div id="s"><p>alpha BRAVO<br>charlie delta</p></div>';
  const { live, recoveries } = await merge(b, l, r);
  assert.equal(recoveries.length, 2);
  assert.equal(live.body.innerHTML, r);
  const t = recoveries[0].text;
  assert.equal(t.merged.text, "");
  assert.deepEqual(t.merged.span, {
    start: { path: [1, 0], offset: 1 },
    end: { path: [1, 0], offset: 1 },
  });
  const range = live.createRange();
  range.setStart(t.liveSpan.startContainer, t.liveSpan.startOffset);
  range.setEnd(t.liveSpan.endContainer, t.liveSpan.endOffset);
  assert.equal(range.collapsed, true);
  range.deleteContents();
  range.insertNode(range.createContextualFragment(t.local.fragment));
  assert.equal(
    live.body.innerHTML,
    '<div id="s"><p>alpha BRAVO<br>charlie delta</p><p>BRAVE charlie delta</p></div>',
  );
});

test("F1: collapsed mark boundary remains usable inside live template content", async () => {
  const wrap = (s) =>
    `<template id="t"><p id="p">${s}<b>bold</b> end</p></template>`;
  const { recoveries } = await merge(
    wrap("keep old "),
    wrap("keep new "),
    wrap("keep "),
  );
  assert.equal(recoveries.length, 1);
  const r = recoveries[0];
  assert.equal(r.applied, true);
  assert.deepEqual(r.text.merged.span.start, r.text.merged.span.end);
  assert.equal(r.text.liveSpan.startContainer, r.text.liveSpan.endContainer);
  assert.equal(r.text.liveSpan.startOffset, r.text.liveSpan.endOffset);
});
