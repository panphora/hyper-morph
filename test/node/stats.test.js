// The per-apply counters on `report.stats`: numbers only, describing what the
// merge had to do. Each fixture drives one counter and, where cheap, asserts
// the others stay at zero. Nothing from the page ever reaches them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";
import { emptyStats } from "../../src/stats.js";

// A real djb2 collision on the subtree hash: equal hashes, unequal content.
const T1 = "1QD0Ts5wZ41g";
const T2 = "XSnQhahIrg3s";

const KEYS = Object.keys(emptyStats());

/** Dirty shape: the live tab has local edits, the base is a capture string. */
async function dirtyLive(b, l, r, opts = {}) {
  const live = parse(doc(l));
  const report = await mergeDocument({
    live,
    base: doc(b),
    remote: doc(r),
    ...opts,
  });
  return { live, html: live.body.innerHTML, report };
}

const collision = [
  `<p>${T1}</p><p>second para words</p>`,
  `<h2>New heading</h2><p>${T2}</p><p>second para words</p>`,
];

const lazybug = [
  `<p>alpha bravo charlie</p><div><p>delta echo foxtrot golf</p></div><p>tail words here</p>`,
  `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><div></div><p>tail words here</p>`,
];

const tieBase = `<p>alpha beta gamma delta</p><p>other words entirely</p>`;

test("I4 stats: shape on a trivial merge", async () => {
  const { res } = mergeBodies("<p>a</p>", "<p>a</p>", "<p>a</p>");
  assert.deepEqual(res.stats, emptyStats());
  const { report } = await dirtyLive("<p>a</p>", "<p>a</p>", "<p>a</p>");
  assert.deepEqual(report.stats, emptyStats());
});

test("I4 stats.hashRejected on the collision", async () => {
  const [b, r] = collision;
  const { report } = await dirtyLive(b, b, r);
  assert.ok(
    report.stats.hashRejected >= 1,
    `hashRejected ${report.stats.hashRejected}`,
  );
  assert.equal(report.stats.lazyTwins, 0);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
});

test("I4 stats.lazyTwins on the lazybug shape", async () => {
  const [b, r] = lazybug;
  const l = b.replace("tail words here", "tail words HERE");
  const { live, report } = await dirtyLive(b, l, r);
  assert.ok(report.stats.lazyTwins >= 1, `lazyTwins ${report.stats.lazyTwins}`);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(
    live.body.innerHTML,
    `<p>DELTA echo foxtrot golf</p><p>alpha bravo charlie</p><div></div><p>tail words HERE</p>`,
  );
});

test("I4 stats.similarTiesStrict", async () => {
  const r = `<p>alpha beta gamma delta one</p><p>alpha beta gamma delta one</p><p>other words entirely</p>`;
  const { report } = await dirtyLive(tieBase, tieBase, r);
  assert.ok(
    report.stats.similarTiesStrict >= 1,
    `similarTiesStrict ${report.stats.similarTiesStrict}`,
  );
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(report.stats.lazyTwins, 0);
});

test("I4 stats.similarTiesLoose", async () => {
  const r = `<p>alpha beta gamma delta one</p><p>alpha beta gamma delta one two</p><p>other words entirely</p>`;
  const { report } = await dirtyLive(tieBase, tieBase, r);
  assert.ok(
    report.stats.similarTiesLoose >= 1,
    `similarTiesLoose ${report.stats.similarTiesLoose}`,
  );
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(report.stats.lazyTwins, 0);
});

const moveBase = `<div><p>alpha beta gamma delta</p></div><section></section><aside></aside>`;

test("I4 stats.ambiguousMoves", async () => {
  const r = `<div></div><section><p>alpha beta gamma delta one</p></section><aside><p>alpha beta gamma delta two</p></aside>`;
  const { report } = await dirtyLive(moveBase, moveBase, r);
  assert.ok(
    report.stats.ambiguousMoves >= 1,
    `ambiguousMoves ${report.stats.ambiguousMoves}`,
  );
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.lazyTwins, 0);
  assert.deepEqual(report.moved, []);
});

// The node suite holds no `<script src>` load open, so the concurrency here is
// two calls in flight at once on separate documents (plus two sequential ones).
test("I4 stats are per call", async () => {
  const [b, r] = collision;
  const first = await dirtyLive(b, b, r);
  const firstNumbers = Object.assign({}, first.report.stats);
  assert.ok(firstNumbers.hashRejected >= 1);
  const second = await dirtyLive(b, b, r);
  assert.notEqual(first.report.stats, second.report.stats);
  assert.deepEqual(first.report.stats, firstNumbers);

  const a = dirtyLive(b, b, r);
  const c = dirtyLive(b, b, r);
  const [ra, rc] = await Promise.all([a, c]);
  const seen = new Set([
    first.report.stats,
    second.report.stats,
    ra.report.stats,
    rc.report.stats,
  ]);
  assert.equal(seen.size, 4);
  assert.notEqual(ra.report.stats, rc.report.stats);
  for (const s of seen) assert.deepEqual(s, firstNumbers);
});

test("I4 stats on an ignored root", async () => {
  const ignore = (el) => el.hasAttribute("no-save");
  const live = parse(doc(`<p>current</p>`));
  live.documentElement.setAttribute("no-save", "");
  const before = live.body.innerHTML;
  const report = await mergeDocument({
    live,
    base: doc(`<p>current</p>`),
    remote: doc(`<p>next</p>`),
    ignore,
  });
  assert.deepEqual(report.stats, emptyStats());
  assert.equal(live.body.innerHTML, before);
});

test("I4 stats carry no content", async () => {
  const [b, r] = collision;
  const { report } = await dirtyLive(b, b, r);
  const stats = report.stats;
  assert.deepEqual(Object.keys(stats).sort(), [...KEYS].sort());
  for (const k of KEYS) {
    assert.equal(typeof stats[k], "number", k);
    assert.ok(Number.isInteger(stats[k]) && stats[k] >= 0, k);
  }
  const json = JSON.stringify(stats);
  for (const w of ["New", "heading", "second", "para", "words", T1, T2])
    assert.ok(!json.includes(w), `${w} leaked into ${json}`);
});

test("I4 unique candidate controls", async () => {
  const tie = await dirtyLive(
    tieBase,
    tieBase,
    `<p>alpha beta gamma delta one</p><p>other words entirely</p>`,
  );
  assert.equal(tie.report.stats.similarTiesStrict, 0);
  assert.equal(tie.report.stats.similarTiesLoose, 0);
  assert.equal(
    tie.html,
    `<p>alpha beta gamma delta one</p><p>other words entirely</p>`,
  );

  const move = await dirtyLive(
    moveBase,
    moveBase,
    `<div></div><section><p>alpha beta gamma delta one</p></section><aside></aside>`,
  );
  assert.equal(move.report.stats.ambiguousMoves, 0);
  assert.equal(
    move.html,
    `<div></div><section><p>alpha beta gamma delta one</p></section><aside></aside>`,
  );
  assert.deepEqual(
    move.report.moved.map((el) => el.tagName + ":" + el.textContent),
    ["P:alpha beta gamma delta one"],
  );
});
