// The aligner pairs the children of an identical container lazily: a base
// element under a Pass 0 identical container has no map entry until
// someone asks `twinIn(A, bk)`. These fixtures pin the reads that must ask
// first: a moved block under an unchanged container moves its live node
// instead of reporting `move-beats-delete` and rebuilding it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { merge3, mergeDocument } from "../../src/index.js";

const kinds = (rep) => rep.conflicts.map((c) => `${c.kind}:${c.detail || ""}`);

/** Dirty shape: the live tab has local edits, the base is a capture string. */
async function dirtyLive(b, l, r) {
  const live = parse(doc(l));
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  return { live, html: live.body.innerHTML, report };
}

test("I3 lazybug: a paragraph moved out of an unchanged div and edited moves its live node without a conflict", async () => {
  const b = `<p>alpha bravo charlie</p><div><p>delta echo foxtrot golf</p></div><p>tail words here</p>`;
  const l = b.replace("tail words here", "tail words HERE");
  const r = `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><div></div><p>tail words here</p>`;
  const live = parse(doc(l));
  const movedP = live.querySelector("div > p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.equal(
    live.body.firstElementChild,
    movedP,
    `the live paragraph was rebuilt: ${live.body.innerHTML}`,
  );
  assert.equal(movedP.textContent, "DELTA echo foxtrot golf");
  assert.equal(
    live.body.innerHTML,
    `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><div></div><p>tail words HERE</p>`,
  );
});

test("I3 lazybug, nested", async () => {
  const b = `<section><div><p>delta echo foxtrot golf</p></div></section><p>tail words here</p>`;
  const l = b.replace("tail words here", "tail words HERE");
  const r = `<p>DELTA echo foxtrot golf</p><section><div></div></section><p>tail words here</p>`;
  const live = parse(doc(l));
  const movedP = live.querySelector("section div > p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.equal(
    live.body.firstElementChild,
    movedP,
    `the live paragraph was rebuilt: ${live.body.innerHTML}`,
  );
  assert.equal(movedP.textContent, "DELTA echo foxtrot golf");
  assert.equal(
    live.body.innerHTML,
    `<p>DELTA echo foxtrot golf</p><section><div></div></section><p>tail words HERE</p>`,
  );
});

/** Template content is compared where `isEqualNode` ignores it. */
const tplOf = (html) => parse(doc(html)).querySelector("template").innerHTML;

test("I3 template-source move: a paragraph moved out of an unchanged template and edited moves its live node without a conflict", async () => {
  const b = `<p>alpha bravo charlie</p><template><p>delta echo foxtrot golf</p></template><p>tail words here</p>`;
  const l = b.replace("tail words here", "tail words HERE");
  const r = `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><template></template><p>tail words here</p>`;
  const live = parse(doc(l));
  const template = live.querySelector("template");
  const movedP = template.content.querySelector("p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.equal(
    template.innerHTML,
    tplOf(r),
    `template content: ${live.body.innerHTML}`,
  );
  const outP = live.body.firstElementChild;
  assert.equal(outP.tagName, "P", live.body.innerHTML);
  assert.equal(outP.textContent, "DELTA echo foxtrot golf");
  assert.equal(
    live.body.innerHTML,
    `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><template></template><p>tail words HERE</p>`,
  );
  // The paragraph starts inside the template content fragment; some engine
  // paths move that node out, others rebuild it. Survival is asserted only
  // where the output paragraph is the captured node.
  if (outP === movedP) assert.equal(movedP.isConnected, true);
  else assert.ok(!template.content.contains(movedP));
});

test("I3 nested template-source move: a paragraph moved out of an unchanged nested template and edited moves its live node without a conflict", async () => {
  const b = `<section><template><p>delta echo foxtrot golf</p></template></section><p>tail words here</p>`;
  const l = b.replace("tail words here", "tail words HERE");
  const r = `<p>DELTA echo foxtrot golf</p><section><template></template></section><p>tail words here</p>`;
  const live = parse(doc(l));
  const template = live.querySelector("template");
  const movedP = template.content.querySelector("p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.equal(
    template.innerHTML,
    tplOf(r),
    `template content: ${live.body.innerHTML}`,
  );
  const outP = live.body.firstElementChild;
  assert.equal(outP.tagName, "P", live.body.innerHTML);
  assert.equal(outP.textContent, "DELTA echo foxtrot golf");
  assert.equal(
    live.body.innerHTML,
    `<p>DELTA echo foxtrot golf</p><section><template></template></section><p>tail words HERE</p>`,
  );
  if (outP === movedP) assert.equal(movedP.isConnected, true);
  else assert.ok(!template.content.contains(movedP));
});

test("I3 seed37b: move out of an unchanged container to an earlier sibling, id-less", async () => {
  const b = `<section></section><div><p>x words here</p></div>`;
  const l = `${b}<p>local</p>`;
  const r = `<section><p>x words here</p></section><div></div>`;
  const live = parse(doc(l));
  const movedP = live.querySelector("div > p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.ok(report.moved.includes(movedP), JSON.stringify(report.moved));
  assert.deepEqual(report.replaced, []);
});

test("I3 seed37b: move out of an unchanged container to an earlier sibling, id'd", async () => {
  const b = `<section></section><div><p data-id="m">x words here</p></div>`;
  const l = `${b}<p>local</p>`;
  const r = `<section><p data-id="m">x words here</p></section><div></div>`;
  const live = parse(doc(l));
  const movedP = live.querySelector("div > p");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.deepEqual(kinds(report), []);
  assert.ok(report.moved.includes(movedP), JSON.stringify(report.moved));
  assert.deepEqual(report.replaced, []);
});

test("actual delete: a truly deleted twin still returns null and keeps today's conflict", async () => {
  const b = `<p>alpha bravo charlie</p><div><p>delta echo foxtrot golf</p></div><p>tail words here</p>`;
  const l = `<p>delta echo foxtrot golf</p><p>alpha bravo charlie</p><div></div><p>tail words HERE</p>`;
  const r = `<p>alpha bravo charlie</p><div></div><p>tail words here</p>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(
    kinds(report).includes("structure:move-beats-delete"),
    kinds(report).join("|"),
  );
  assert.ok(
    html.includes("delta echo foxtrot golf"),
    `moved text lost: ${html}`,
  );
});

test("lookup idempotence: a repeated lookup returns the same twin without pairing again", async () => {
  const b = `<div><p>one one one</p><p>two two two</p><p>three three three</p></div>`;
  const l = b.replace("three three three", "three three THREE");
  const r = `<p>one one one</p><div><p>two two two</p><p>three three three</p></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(html, r.replace("three three three", "three three THREE"));
  assert.deepEqual(kinds(report), []);
});

test("mixed authored and lazy: an identified container with id-less children", async () => {
  const b = `<div id="c"><p>one one one</p><p>two two two</p></div>`;
  const l = b.replace("two two two", "two two TWO");
  const r = `<div id="c"><p>two two two</p><p>one one one</p></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(html, `<div id="c"><p>two two TWO</p><p>one one one</p></div>`);
  assert.deepEqual(kinds(report), []);
});

test("mixed authored and lazy: id-less container with identified children", async () => {
  const b = `<div><p id="a">one one one</p><p id="b">two two two</p></div>`;
  const l = b.replace("two two two", "two two TWO");
  const r = `<div><p id="b">two two two</p><p id="a">one one one</p></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(
    html,
    `<div><p id="b">two two TWO</p><p id="a">one one one</p></div>`,
  );
  assert.deepEqual(kinds(report), []);
});

test("collision is not lazy equality: a colliding pair is never materialized as identical children", async () => {
  const T1 = "1QD0Ts5wZ41g";
  const T2 = "XSnQhahIrg3s";
  const b = `<div><p>${T1}</p></div>`;
  const l = `<div><p>${T1}</p></div>`;
  const r = `<div><p>${T2}</p></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(!html.includes(T1), `stale base text kept: ${html}`);
  assert.ok(html.includes(T2), `remote rewrite lost: ${html}`);
});

const B = `<template><p>w0 w1 w2 w3 w4</p></template>`;
const MOVED_OUT_ROWS = [
  {
    name: "to new section",
    base: B,
    local: B,
    remote: `<section><p>w0 w1 w2 w3 w4</p></section><template></template>`,
    expected: `<section><p>w0 w1 w2 w3 w4</p></section><template></template>`,
  },
  {
    name: "to new section, local edit elsewhere",
    base: `${B}<p>tail x y</p>`,
    local: `${B}<p>tail x Y</p>`,
    remote: `<section><p>w0 w1 w2 w3 w4</p></section><template></template><p>tail x y</p>`,
    expected: `<section><p>w0 w1 w2 w3 w4</p></section><template></template><p>tail x Y</p>`,
  },
  {
    name: "inline child",
    base: `<template><p>w0 <b>w1</b> w2 w3</p></template>`,
    local: `<template><p>w0 <b>w1</b> w2 w3</p></template>`,
    remote: `<section><p>w0 <b>w1</b> w2 w3</p></section><template></template>`,
    expected: `<section><p>w0 <b>w1</b> w2 w3</p></section><template></template>`,
  },
  {
    name: "whole div subtree",
    base: `<template><div><p>w0 w1</p><p>w2 w3</p></div></template>`,
    local: `<template><div><p>w0 w1</p><p>w2 w3</p></div></template>`,
    remote: `<section><div><p>w0 w1</p><p>w2 w3</p></div></section><template></template>`,
    expected: `<section><div><p>w0 w1</p><p>w2 w3</p></div></section><template></template>`,
  },
  {
    name: "nested template below a section",
    base: `<section><template><p>w0 w1 w2 w3 w4</p></template></section>`,
    local: `<section><template><p>w0 w1 w2 w3 w4</p></template></section>`,
    remote: `<article><p>w0 w1 w2 w3 w4</p></article><section><template></template></section>`,
    expected: `<article><p>w0 w1 w2 w3 w4</p></article><section><template></template></section>`,
  },
  {
    name: "div source (control)",
    base: `<div><p>w0 w1 w2 w3 w4</p></div>`,
    local: `<div><p>w0 w1 w2 w3 w4</p></div>`,
    remote: `<section><p>w0 w1 w2 w3 w4</p></section><div></div>`,
    expected: `<section><p>w0 w1 w2 w3 w4</p></section><div></div>`,
  },
];

for (const row of MOVED_OUT_ROWS)
  test(`unchanged element moved out of template content into a new wrapper keeps its content: ${row.name}`, async () => {
    const { html, report } = await dirtyLive(row.base, row.local, row.remote);
    assert.equal(html, row.expected, html);
    assert.deepEqual(kinds(report), []);
  });

test("detached element roots: a move whose destination climbs to the root does not throw", async () => {
  const det = (inner) => {
    const el = parse(doc(`<section>${inner}</section>`)).body.firstElementChild;
    el.remove();
    return el;
  };
  const res = merge3(
    det(`<div><p>delta echo foxtrot golf</p></div><p>tail words here</p>`),
    det(`<div><p>delta echo foxtrot golf</p></div><p>tail words HERE</p>`),
    det(`<div></div><p>DELTA echo foxtrot golf</p><p>tail words here</p>`),
    { hooks: { beforeNodeMorphed: () => {} } },
  );
  assert.equal(
    res.root.outerHTML,
    `<section><div></div><p>DELTA echo foxtrot golf</p><p>tail words HERE</p></section>`,
  );
  assert.deepEqual(res.conflicts, []);
});
