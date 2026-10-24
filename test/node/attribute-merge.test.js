// A document can declare how a shared attribute merges, so two people adding
// different labels to one card, or bumping one counter, both land. The
// predicate below is the one ClayJS builds from `merge-tokens` and `merge-max`
// attributes; hyper-morph only calls it, where mergeAttrs used to conflict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { merge3, mergeDocument } from "../../src/index.js";

const KINDS = { "merge-tokens": "tokens", "merge-max": "max" };

function attributeMerge(el, name) {
  if (!name.startsWith("data-") || name === "data-id" || !el?.closest)
    return null;
  for (const [attr, kind] of Object.entries(KINDS)) {
    const owner = el.closest(`[${attr}]`);
    if (owner && owner.getAttribute(attr).split(/\s+/).includes(name))
      return kind;
  }
  return null;
}

const declaration = 'merge-tokens="data-labels"';
const board = (labels) =>
  `<div class="board" ${declaration}><div class="card" data-id="c1"${labels === null ? "" : ` data-labels="${labels}"`}><h3>Task</h3></div></div>`;

/** Merge three bodies into a live copy of the local one. */
async function applied(base, local, remote, opts = {}) {
  const live = parse(doc(local));
  const report = await mergeDocument({
    live,
    base: doc(base),
    remote: doc(remote),
    attributeMerge,
    scripts: { execute: false },
    ...opts,
  });
  const card = live.querySelector(".card");
  return {
    live,
    card,
    report,
    html: live.body.innerHTML,
    labels: card ? card.getAttribute("data-labels") : undefined,
  };
}

/** The pure merge's label attribute, read off the merged document. */
function pure(base, local, remote, opts = {}) {
  const res = merge3(parse(doc(base)), parse(doc(local)), parse(doc(remote)), {
    attributeMerge,
    ...opts,
  });
  const card = res.doc.querySelector(".card");
  return { labels: card.getAttribute("data-labels"), conflicts: res.conflicts };
}

test("independent label adds both land", async () => {
  const r = await applied(
    board("design"),
    board("design bug"),
    board("design feature"),
  );
  assert.equal(r.labels, "design bug feature");
  assert.deepEqual(r.report.conflicts, []);
});

test("independent label removals both land", async () => {
  const r = await applied(
    board("design bug feature"),
    board("design feature"),
    board("design bug"),
  );
  assert.equal(r.labels, "design");
  assert.deepEqual(r.report.conflicts, []);
});

test("an add against an unrelated remove lands", async () => {
  const r = await applied(
    board("design bug"),
    board("design bug feature"),
    board("design"),
  );
  assert.equal(r.labels, "design feature");
  assert.deepEqual(r.report.conflicts, []);
});

test("the same change on both sides lands once", async () => {
  const r = await applied(
    board("design"),
    board("design bug"),
    board("design bug"),
  );
  assert.equal(r.labels, "design bug");
  assert.deepEqual(r.report.conflicts, []);
});

test("a one-sided change keeps today's rule", async () => {
  const r = await applied(
    board("design bug"),
    board("design bug feature"),
    board("design bug"),
  );
  assert.equal(r.labels, "design bug feature");
  assert.deepEqual(r.report.conflicts, []);
});

test("an empty token set removes a null or empty attribute", async () => {
  const gone = await applied(board("design"), board(null), board(""));
  assert.equal(gone.labels, null);
  assert.equal(gone.card.hasAttribute("data-labels"), false);
  assert.deepEqual(gone.report.conflicts, []);

  const emptied = await applied(
    board("design bug"),
    board("design"),
    board("bug"),
  );
  assert.equal(emptied.labels, null);
  assert.equal(emptied.card.hasAttribute("data-labels"), false);
  assert.deepEqual(emptied.report.conflicts, []);
});

test("duplicate whitespace does not duplicate or drop tokens", async () => {
  const r = await applied(
    board("design"),
    board("design  bug "),
    board(" design\tfeature"),
  );
  assert.equal(r.labels, "design bug feature");
  assert.deepEqual(r.report.conflicts, []);
});

test("Unicode tokens merge as tokens", async () => {
  const r = await applied(
    board("設計"),
    board("設計 バグ"),
    board("設計 機能"),
  );
  assert.equal(r.labels, "設計 バグ 機能");
  assert.deepEqual(r.report.conflicts, []);
});

test("elements that disagree about the declaration still conflict", async () => {
  const local = `<div class="board" merge-tokens="data-labels"><div class="card" data-id="c1" data-labels="design bug"><h3>Task</h3></div></div>`;
  const remote = `<div class="board" merge-tokens="data-members"><div class="card" data-id="c1" data-labels="design feature"><h3>Task</h3></div></div>`;
  const r = await applied(board("design"), local, remote);
  assert.equal(r.report.conflicts.length, 1);
  assert.equal(r.report.conflicts[0].name, "data-labels");
  assert.equal(r.report.conflicts[0].kind, "attr");
});

test("swapping local and remote gives the same string", async () => {
  const b = board("design bug"),
    l = board("design bug feature"),
    r = board("design");
  const one = pure(b, l, r),
    two = pure(b, r, l);
  assert.equal(one.labels, "design feature");
  assert.equal(two.labels, one.labels);
  assert.deepEqual(one.conflicts, []);
  assert.deepEqual(two.conflicts, []);
});

test("max takes the larger of two numbers", async () => {
  const counter = (n) =>
    `<div class="board" merge-max="data-next-card"><div class="meta" data-id="m1" data-next-card="${n}"></div></div>`;
  const r = await applied(counter(15), counter(17), counter(16));
  const meta = r.live.querySelector(".meta");
  assert.equal(meta.getAttribute("data-next-card"), "17");
  assert.deepEqual(r.report.conflicts, []);
});

test("max with one non-number keeps today's conflict", async () => {
  const counter = (n) =>
    `<div class="board" merge-max="data-next-card"><div class="meta" data-id="m1" data-next-card="${n}"></div></div>`;
  const r = await applied(counter(15), counter("sixteen"), counter(16));
  assert.equal(r.report.conflicts.length, 1);
  assert.equal(r.report.conflicts[0].name, "data-next-card");
});

test("max with a one-sided change keeps today's rule", async () => {
  const counter = (n) =>
    `<div class="board" merge-max="data-next-card"><div class="meta" data-id="m1" data-next-card="${n}"></div></div>`;
  const r = await applied(counter(15), counter(15), counter(16));
  const meta = r.live.querySelector(".meta");
  assert.equal(meta.getAttribute("data-next-card"), "16");
  assert.deepEqual(r.report.conflicts, []);
});

test("class and style merge as they always did", async () => {
  const page = (cls, style) =>
    `<div data-id="x" class="${cls}" style="${style}"></div>`;
  const r = await applied(
    page("a", "color: red"),
    page("a b", "color: red; width: 1px"),
    page("a c", "color: red; height: 2px"),
    { attributeMerge: () => "max" },
  );
  const el = r.live.querySelector("[data-id]");
  assert.equal(el.getAttribute("class"), "a b c");
  assert.equal(el.getAttribute("style"), "color: red; width: 1px; height: 2px");
  assert.deepEqual(r.report.conflicts, []);
});

test("an undeclared attribute still conflicts", async () => {
  const page = (title) => `<div data-id="x" data-title="${title}"></div>`;
  const r = await applied(page("one"), page("two"), page("three"));
  assert.equal(r.report.conflicts.length, 1);
  assert.equal(r.report.conflicts[0].name, "data-title");
});

test("the fast path agrees with the full path", async () => {
  const clean = board("design");
  const remote = doc(board("design feature"));
  const live = parse(doc(clean));
  const fast = await mergeDocument({
    live,
    base: live,
    remote,
    attributeMerge,
    fastPath: true,
    scripts: { execute: false },
  });
  const full = await applied(clean, clean, board("design feature"));
  assert.equal(live.body.innerHTML, full.html);
  assert.equal(
    live.querySelector(".card").getAttribute("data-labels"),
    "design feature",
  );
  assert.deepEqual(fast.conflicts, []);
  assert.equal(fast.stats.fastPathAttempted, 1);
});

test("node identity and counts are unchanged", async () => {
  const live = parse(doc(board("design bug")));
  const card = live.querySelector(".card"),
    heading = live.querySelector(".card h3");
  await mergeDocument({
    live,
    base: doc(board("design")),
    remote: doc(board("design feature")),
    attributeMerge,
    scripts: { execute: false },
  });
  assert.equal(live.querySelector(".card"), card);
  assert.equal(live.querySelector(".card h3"), heading);
  assert.equal(live.querySelectorAll(".card").length, 1);
  assert.equal(card.childNodes.length, 1);
});
