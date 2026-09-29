// The per-apply counters on `report.stats`: numbers only, describing what the
// merge had to do. Each fixture drives one counter and, where cheap, asserts
// the others stay at zero. Nothing from the page ever reaches them. Every
// number here is exact: a counter that counts an element twice, or a pair once
// per visit, shows up as a changed number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, window } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";
import { emptyStats, FAST_PATH_BAILS } from "../../src/stats.js";

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
  assert.equal(report.stats.hashRejected, 1);
  assert.equal(report.stats.lazyTwins, 0);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
});

test("I4 stats.lazyTwins on the lazybug shape", async () => {
  const [b, r] = lazybug;
  const l = b.replace("tail words here", "tail words HERE");
  const { live, report } = await dirtyLive(b, l, r);
  assert.equal(report.stats.lazyTwins, 1);
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
  assert.equal(report.stats.similarTiesStrict, 1);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(report.stats.lazyTwins, 0);
});

test("I4 stats.similarTiesLoose", async () => {
  const r = `<p>alpha beta gamma delta one</p><p>alpha beta gamma delta one two</p><p>other words entirely</p>`;
  const { report } = await dirtyLive(tieBase, tieBase, r);
  assert.equal(report.stats.similarTiesLoose, 1);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(report.stats.lazyTwins, 0);
});

const moveBase = `<div><p>alpha beta gamma delta</p></div><section></section><aside></aside>`;
const moveRemote = `<div></div><section><p>alpha beta gamma delta one</p></section><aside><p>alpha beta gamma delta two</p></aside>`;

test("I4 stats.ambiguousMoves", async () => {
  const { report } = await dirtyLive(moveBase, moveBase, moveRemote);
  assert.equal(report.stats.ambiguousMoves, 1);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.hashRejected, 0);
  assert.equal(report.stats.lazyTwins, 0);
  assert.deepEqual(report.moved, []);
});

test("I4 stats.ambiguousMoves counts a refused base element once", async () => {
  // The extra nav pair opens one more slot round over the same base
  // paragraph, so a visit would count it twice.
  const extra = [
    `<nav><em>unrelated original</em></nav>`,
    `<nav><strong>different remote</strong></nav>`,
  ];
  for (const withNav of [false, true]) {
    const b = moveBase + (withNav ? extra[0] : "");
    const r = moveRemote + (withNav ? extra[1] : "");
    const { report } = await dirtyLive(b, b, r);
    assert.equal(report.stats.ambiguousMoves, 1, `nav ${withNav}`);
    assert.deepEqual(report.moved, []);
    assert.equal(report.stats.similarTiesStrict, 0);
    assert.equal(report.stats.similarTiesLoose, 0);
    assert.equal(report.stats.hashRejected, 0);
    assert.equal(report.stats.lazyTwins, 0);
  }
});

test("I4 stats.ambiguousMoves stays zero when the refusal resolves", async () => {
  // Both paragraphs are refused the move on one round and taken on a later
  // one: only the ones still refused when the alignment phase ends count.
  const b = `<div><p>alpha beta gamma delta</p><p>kilo lima mike november</p></div><section></section><aside></aside><ul><li>aaa bbb</li><li>ccc ddd</li></ul>`;
  const r = `<div></div><section><p>alpha beta gamma delta kilo lima mike november</p></section><aside><p>alpha beta gamma xray</p></aside><ul><li>eee fff</li><li>ggg hhh</li></ul>`;
  const { report } = await dirtyLive(b, b, r);
  assert.deepEqual(
    report.moved.map((el) => el.tagName + ":" + el.textContent),
    [
      "P:alpha beta gamma delta kilo lima mike november",
      "P:alpha beta gamma xray",
    ],
  );
  assert.equal(report.stats.ambiguousMoves, 0);
});

// Hint windows that fill the 64 characters, so the two headings score as
// different text and the two copies of the paragraph below are one tie.
const hintA =
  "Aardvark unique heading words that fill the whole hint window xx";
const hintZ = "Zebra totally different heading words filling hint window as yy";
const tieRoundBase = `<section><div><h3>${hintA}</h3><p>alpha beta gamma delta</p></div></section><aside></aside>`;

test("I4 stats.similarTies counts a base element once across a rematch", async () => {
  for (const loose of [false, true]) {
    const ps = `<p>alpha beta gamma delta one</p><p>alpha beta gamma delta one${loose ? " two" : ""}</p>`;
    const r = `<section><div><h3>${hintZ}</h3>${ps}</div></section><aside><div><h3>${hintA}</h3>${ps}</div></aside>`;
    const { report } = await dirtyLive(tieRoundBase, tieRoundBase, r);
    assert.equal(
      report.stats.similarTiesStrict,
      loose ? 0 : 1,
      `loose ${loose}`,
    );
    assert.equal(
      report.stats.similarTiesLoose,
      loose ? 1 : 0,
      `loose ${loose}`,
    );
    assert.equal(report.stats.hashRejected, 0);
    assert.equal(report.stats.ambiguousMoves, 0);
  }
});

test("I4 stats.similarTiesStrict excludes loose", async () => {
  const r = `<p>alpha beta gamma delta one</p><p>alpha beta gamma delta one</p><p>alpha beta gamma delta one two</p>`;
  const { report } = await dirtyLive(tieBase, tieBase, r);
  assert.equal(report.stats.similarTiesStrict, 1);
  assert.equal(report.stats.similarTiesLoose, 0);
});

test("I4 stats.similarTies ignores a lower-coef candidate", async () => {
  const r = `<p>alpha beta gamma delta one</p><p>alpha beta zeta eta</p><p>other words entirely</p>`;
  const { report } = await dirtyLive(tieBase, tieBase, r);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
});

test("I4 stats.hashRejected counts one collision once at any depth", async () => {
  const [b, r] = collision;
  for (const depth of [1, 3, 6]) {
    const wrap = (html) =>
      "<div>".repeat(depth) + html + "</div>".repeat(depth);
    const { report } = await dirtyLive(wrap(b), wrap(b), wrap(r));
    assert.equal(report.stats.hashRejected, 1, `depth ${depth}`);
  }
});

test("I4 stats.hashRejected counts a pair once in either order", async () => {
  // The <x-a> pair differs only through its colliding text run, and the run
  // is compared from both ends: one collision, not four.
  const base = `<p>one two three</p><p>four five <x-a>${T1}</x-a> six</p>`;
  const local = `<p>one two three again</p><p>four five <x-a>${T1}</x-a> six again</p>`;
  const remote = `<p>one two <x-a>${T2}</x-a> three</p><p>four five six</p>`;
  const { report } = await dirtyLive(base, local, remote);
  assert.equal(report.stats.hashRejected, 1);
  assert.equal(report.stats.similarTiesStrict, 0);
  assert.equal(report.stats.similarTiesLoose, 0);
  assert.equal(report.stats.ambiguousMoves, 0);
  assert.equal(report.stats.lazyTwins, 0);
});

// Two merges held open on a `<script src>` load at once: each fills its own
// stats object, and each keeps its numbers once the other settles.
test("I4 stats are per call", async () => {
  const [b, r] = collision;
  const first = await dirtyLive(b, b, r);
  const firstNumbers = Object.assign({}, first.report.stats);
  assert.equal(firstNumbers.hashRejected, 1);
  const second = await dirtyLive(b, b, r);
  assert.notEqual(first.report.stats, second.report.stats);
  assert.deepEqual(first.report.stats, firstNumbers);

  const heldA = parse(doc(b));
  const plain = doc(`<p>plain</p>`);
  const heldB = parse(plain);
  let settledA = false,
    settledB = false;
  const a = mergeDocument({
    live: heldA,
    base: doc(b),
    remote: doc(r + `<script src="/held-a.js"></script>`),
  }).then((x) => {
    settledA = true;
    return x;
  });
  const c = mergeDocument({
    live: heldB,
    base: plain,
    remote: doc(`<p>changed</p><script src="/held-b.js"></script>`),
  }).then((x) => {
    settledB = true;
    return x;
  });
  await new Promise((res) => setImmediate(res));
  assert.equal(settledA, false);
  assert.equal(settledB, false);
  heldB.querySelector("script[src]").dispatchEvent(new window.Event("load"));
  const rc = await c;
  assert.equal(rc.stats.hashRejected, 0);
  assert.equal(settledA, false);
  const cNumbers = Object.assign({}, rc.stats);
  rc.stats.hashRejected = 999;
  heldA.querySelector("script[src]").dispatchEvent(new window.Event("load"));
  const ra = await a;
  assert.notEqual(ra.stats, rc.stats);
  assert.deepEqual(ra.stats, firstNumbers);
  assert.deepEqual(rc.stats, { ...cNumbers, hashRejected: 999 });
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
    if (k === "fastPathFallback") {
      assert.ok(stats[k] === null || FAST_PATH_BAILS.includes(stats[k]), k);
      continue;
    }
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
