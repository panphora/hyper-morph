import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../src/index.js";
import { observe, staticRecovery } from "../lib/differential-observe.js";
import { parse, doc } from "./lib/dom.js";

const p = (id, text) => `<p data-id="${id}">${text}</p>`;
const baseFirst = p("b0", "w0 w1 <b>w3</b> w2");
const baseLast = p("b1", "w4 w5 w6 w7 w8 <b>w10 w11</b> w9");
const split = p("b0", "w0") + p("b3", "w1 <b>w3</b> w2");
const edit = p("b0", "w13 w14");
const localInsert = p("b2", "w15");
const remoteInsert = p("r2", "remote independent");
const exact = {
  b: baseFirst + baseLast,
  l: edit + localInsert + p("b1", "w4 w5 w6 w7 w12 w8 <b>w10 w11</b> w9"),
  r: split + p("b1", "w16 w17 w18 w19"),
};
const expected = split + localInsert + p("b1", "w16 w17 w18 w19");

for (const shape of ["pure", "dirty", "clean", "element"]) {
  test(`split group anchor: exact mode1 seed981 ${shape}`, async () => {
    const plain = await observe(engine, shape, exact);
    assert.equal(plain.html, shape === "element" ? `<section>${expected}</section>` : shape === "clean" ? exact.r : expected);
    assert.equal(plain.recovery.length, shape === "clean" ? 0 : 2);
    assert.deepEqual(plain.recoveryProblems, []);
    if (shape === "pure") return;
    let callbacks = 0;
    const lineage = (elements) => ({
      elements,
      onResult(result, report) {
        callbacks++;
        assert.equal(report.lineage, result);
        assert.equal(result.status, "complete");
      },
    });
    const tracked = {
      mergeDocument: (options) => engine.mergeDocument({ ...options, lineage: lineage([...options.live.querySelectorAll("p")]) }),
      morphElement: (el, remote, options) => engine.morphElement(el, remote, { ...options, lineage: lineage([...el.querySelectorAll("p")]) }),
    };
    assert.deepEqual(await observe(tracked, shape, exact), plain);
    assert.equal(callbacks, 1);
  });
}

test("split group anchor: independent insertion retains native identity and lineage", async () => {
  const live = parse(doc(exact.l));
  const inserted = live.querySelector('[data-id="b2"]');
  const text = inserted.firstChild;
  const report = await engine.mergeDocument({
    live,
    base: doc(exact.b),
    remote: doc(exact.r),
    scripts: { execute: false },
    lineage: { elements: [inserted], onResult() {} },
  });
  assert.equal(live.body.innerHTML, expected);
  assert.equal(live.querySelector('[data-id="b2"]'), inserted);
  assert.equal(inserted.firstChild, text);
  assert.equal(inserted.textContent, "w15");
  assert.equal(report.lineage.entries.length, 1);
  assert.equal(report.lineage.entries[0].from, inserted);
  assert.equal(report.lineage.entries[0].kind, "retained");
  assert.equal(report.lineage.entries[0].complete, true);
  assert.deepEqual(report.lineage.entries[0].to, [inserted]);
  assert.equal(report.conflicts.length, 2);
  const recovery = report.conflicts[0].recovery;
  assert.equal(recovery.localLost, true);
  assert.equal(recovery.applied, true);
  assert.equal(recovery.unavailable, null);
  const range = live.createRange();
  const span = recovery.text.liveSpan;
  range.setStart(span.startContainer, span.startOffset);
  range.setEnd(span.endContainer, span.endOffset);
  assert.equal(range.toString(), "w0w1 w3 w2");
  assert.equal(range.intersectsNode(inserted), false);
});

const neighbors = [
  ["unchanged local owner", baseFirst + baseLast, baseFirst + localInsert + baseLast, split + baseLast, split + localInsert + baseLast],
  ["both follow remote split", baseFirst + baseLast, edit + localInsert + baseLast, split + remoteInsert + baseLast, split + localInsert + remoteInsert + baseLast],
  ["both follow local split", baseFirst + baseLast, split + localInsert + baseLast, baseFirst + remoteInsert + baseLast, split + localInsert + remoteInsert + baseLast],
  ["ordinary same anchor", baseFirst + baseLast, baseFirst + localInsert + baseLast, baseFirst + remoteInsert + baseLast, baseFirst + localInsert + remoteInsert + baseLast],
  ["insertion inside split", p("b0", "one two three"), p("b0", "one") + localInsert + p("b3", "two three"), p("b0", "one two THREE"), p("b0", "one") + localInsert + p("b3", "two THREE")],
  ["simultaneous interior ports", '<p id="a">onetwo</p>', '<p id="a">one</p><div id="port">local</div><p>two</p>', '<p id="a">one</p>TEXT<p>two</p>', '<p id="a">one</p><div id="port">local</div>TEXT<p>two</p>'],
];
for (const [name, b, l, r, html] of neighbors) {
  test(`split group anchor: ${name}`, async () => {
    for (const shape of ["pure", "dirty", "element"]) {
      const observed = await observe(engine, shape, { b, l, r });
      assert.equal(observed.html, shape === "element" ? `<section>${html}</section>` : html);
      assert.deepEqual(observed.recoveryProblems, []);
    }
  });
}

test("split group anchor: recovery repeats and pure agrees with dirty", async () => {
  const pure = await observe(engine, "pure", exact);
  const dirty = await observe(engine, "dirty", exact);
  const again = await observe(engine, "dirty", exact);
  assert.equal(pure.recovery.length, 2);
  assert.deepEqual(again.recovery, dirty.recovery);
  assert.equal(staticRecovery(pure.recovery), staticRecovery(dirty.recovery));
});

test("split group anchor: local order and local conflict policy", async () => {
  const owner = p("b0", "one two three four");
  const pieces = p("b0", "one") + p("b3", "two three four");
  const tail = '<aside id="x">X</aside><aside id="y">Y</aside>';
  const reordered = '<aside id="y">Y</aside><aside id="x">X</aside>';
  const cases = [
    ["local", pieces + localInsert + tail, p("b0", "REWRITE") + remoteInsert + tail, pieces + localInsert + remoteInsert + tail],
    ["local", pieces + localInsert + reordered, p("b0", "REWRITE") + remoteInsert + tail, pieces + localInsert + remoteInsert + reordered],
    ["remote", p("b0", "REWRITE") + localInsert + reordered, pieces + remoteInsert + tail, pieces + localInsert + remoteInsert + reordered],
  ];
  for (const [conflicts, l, r, html] of cases) {
    const wrapped = {
      merge3: (b, local, remote, options) => engine.merge3(b, local, remote, { ...options, conflicts }),
      mergeDocument: (options) => engine.mergeDocument({ ...options, conflicts }),
      morphElement: (el, remote, options) => engine.morphElement(el, remote, { ...options, conflicts }),
    };
    for (const shape of ["pure", "dirty", "element"]) {
      const observed = await observe(wrapped, shape, { b: owner + tail, l, r });
      assert.equal(observed.html, shape === "element" ? `<section>${html}</section>` : html);
      assert.deepEqual(observed.recoveryProblems, []);
    }
  }
});
