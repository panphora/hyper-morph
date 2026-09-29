// The aligner pairs the children of an identical container lazily: a base
// element under a Pass 0 identical container has no map entry until
// someone asks `twinIn(A, bk)`. These fixtures pin the reads that must ask
// first: a moved block under an unchanged container moves its live node
// instead of reporting `move-beats-delete` and rebuilding it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeDocument } from "../../src/index.js";

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
