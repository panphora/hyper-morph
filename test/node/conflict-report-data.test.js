// E4b: the `recovery` object on every conflict record (contract:
// plans/hyper-morph/live-sync-accuracy-speed/07-conflict-report-data.md).
// Each fixture asserts the raw conflicts and the merged DOM it has today,
// then the recovery data, then that the local tree was not touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, window } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument, morphElement, merge3 } from "../../src/index.js";
import { flatten } from "../../src/inline-merge.js";
import {
  lockstepMap,
  recoveryList,
  staticRecovery,
  recoveryProblems,
  finalTree,
  labelTree,
} from "../lib/differential-observe.js";

const XLINK = "http://www.w3.org/1999/xlink";

/** The ClayJS shape: the live tab carries local, a capture of it is `local`. */
async function merge(base, local, remote, opts = {}) {
  const live = parse(doc(local)),
    cap = parse(doc(local));
  const localBefore = cap.documentElement.outerHTML;
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const pending = mergeDocument({
    live,
    base: parse(doc(base)),
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc(remote)),
    scripts: { execute: opts.execute || false },
    ...(opts.options || {}),
  });
  if (opts.between) opts.between(live);
  const report = await pending;
  assert.equal(cap.documentElement.outerHTML, localBefore, "I1: local tree");
  const label = labelTree(live.documentElement);
  const final = finalTree(live.documentElement);
  assert.deepEqual(recoveryProblems(report.conflicts, final, false), []);
  return {
    report,
    live,
    body: live.body.innerHTML,
    kinds: report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
    rv: report.conflicts.map((c) => c.recovery),
    text: (n) => live.body.querySelector(n).firstChild,
    el: (n) => live.body.querySelector(n),
    projection: recoveryList(report.conflicts, label, final),
  };
}

const ref = (r) =>
  r && {
    key: r.key,
    nodeType: r.nodeType,
    base: r.base,
    local: r.local,
    remote: r.remote,
    merged: r.merged,
  };
const span = (s) => [s.start.path, s.start.offset, s.end.path, s.end.offset];
const side = (t) =>
  t && {
    text: t.text,
    range: [t.start, t.end],
    fragment: t.fragment,
    span: span(t.span),
    scope: span(t.scope),
  };
const liveSpan = (s) =>
  s && [s.startContainer, s.startOffset, s.endContainer, s.endOffset];
const placement = (p) =>
  p && {
    parent: p.parent.key,
    before: p.before.map((x) => x.key),
    after: p.after.map((x) => x.key),
  };
const keys = (list) => list.map((x) => x.key);

test("T1: one clash in a paragraph", async () => {
  const m = await merge(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps.</p>`,
  );
  assert.deepEqual(m.kinds, ["text:"]);
  assert.equal(m.body, `<p id="p">One fast fox sleeps.</p>`);
  const r = m.rv[0];
  assert.equal(r.version, 1);
  assert.equal(r.key, "text:b:[1,0]:4:9:0");
  assert.equal(r.localLost, true);
  assert.equal(r.applied, true);
  assert.equal(r.unavailable, null);
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0]",
    nodeType: 1,
    base: [[1, 0]],
    local: [[1, 0]],
    remote: [[1, 0]],
    merged: [[1, 0]],
  });
  assert.deepEqual(r.subject.live, [m.el("p")]);
  assert.equal(r.text.encoding, "html");
  const t = (text, s, e, fragment) => ({
    text,
    range: [s, e],
    fragment,
    span: [[1, 0, 0], s, [1, 0, 0], e],
    scope: [[1, 0, 0], 0, [1, 0, 0], text.length],
  });
  assert.deepEqual(
    side(r.text.base),
    t("One quick fox sleeps.", 4, 9, "quick"),
  );
  assert.deepEqual(side(r.text.local), t("One slow fox sleeps.", 4, 8, "slow"));
  assert.deepEqual(
    side(r.text.remote),
    t("One fast fox sleeps.", 4, 8, "fast"),
  );
  assert.deepEqual(
    side(r.text.merged),
    t("One fast fox sleeps.", 4, 8, "fast"),
  );
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("p"), 4, m.text("p"), 8]);
  assert.deepEqual(liveSpan(r.text.liveScope), [
    m.text("p"),
    0,
    m.text("p"),
    20,
  ]);
  const restored =
    r.text.merged.text.slice(0, r.text.merged.start) +
    r.text.local.fragment +
    r.text.merged.text.slice(r.text.merged.end);
  assert.equal(restored, "One slow fox sleeps.");
});

test("T1 with a local prefix and a remote suffix: merged offsets are not the remote ones", async () => {
  const m = await merge(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">Note: One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps. Awake.</p>`,
  );
  assert.equal(m.body, `<p id="p">Note: One fast fox sleeps. Awake.</p>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:4:9:0");
  assert.deepEqual([r.text.base.start, r.text.base.end], [4, 9]);
  assert.deepEqual([r.text.local.start, r.text.local.end], [10, 14]);
  assert.deepEqual([r.text.remote.start, r.text.remote.end], [4, 8]);
  assert.deepEqual([r.text.merged.start, r.text.merged.end], [10, 14]);
  assert.equal(r.text.merged.text, "Note: One fast fox sleeps. Awake.");
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.text("p"),
    10,
    m.text("p"),
    14,
  ]);
  const t = r.text.merged;
  assert.equal(
    t.text.slice(0, t.start) + r.text.local.fragment + t.text.slice(t.end),
    "Note: One slow fox sleeps. Awake.",
  );
});

test("T2: the second of two identical words", async () => {
  const m = await merge(
    `<p id="p">quick fox and quick fox</p>`,
    `<p id="p">quick fox and slow fox</p>`,
    `<p id="p">quick fox and fast fox</p>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:14:19:0");
  assert.deepEqual([r.text.base.start, r.text.base.end], [14, 19]);
  assert.deepEqual([r.text.local.start, r.text.local.end], [14, 18]);
  assert.deepEqual([r.text.remote.start, r.text.remote.end], [14, 18]);
  assert.deepEqual([r.text.merged.start, r.text.merged.end], [14, 18]);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.text("p"),
    14,
    m.text("p"),
    18,
  ]);
});

test("two clashes in one paragraph have separate keys", async () => {
  const m = await merge(
    `<p id="p">a quick fox and a quick dog</p>`,
    `<p id="p">a slow fox and a slow dog</p>`,
    `<p id="p">a fast fox and a fast dog</p>`,
  );
  assert.deepEqual(keys(m.rv), ["text:b:[1,0]:2:7:0", "text:b:[1,0]:18:23:0"]);
  assert.notEqual(m.rv[0], m.rv[1]);
  assert.deepEqual(
    [m.rv[1].text.local.start, m.rv[1].text.local.end],
    [17, 21],
  );
  assert.deepEqual(
    [m.rv[1].text.merged.start, m.rv[1].text.merged.end],
    [17, 21],
  );
});

test("text policy: local keeps local (no loss); both keeps both (no loss)", async () => {
  const b = `<p id="p">One quick fox sleeps.</p>`,
    l = `<p id="p">One slow fox sleeps.</p>`,
    r = `<p id="p">One fast fox sleeps.</p>`;
  const local = await merge(b, l, r, { options: { conflicts: "local" } });
  assert.equal(local.body, l);
  assert.equal(local.rv[0].localLost, false);
  assert.deepEqual(side(local.rv[0].text.merged).range, [4, 8]);
  const both = await merge(b, l, r, { options: { conflicts: "both" } });
  assert.equal(both.body, `<p id="p">One slowfast fox sleeps.</p>`);
  assert.equal(both.rv[0].localLost, false);
  assert.deepEqual(side(both.rv[0].text.merged), {
    text: "One slowfast fox sleeps.",
    range: [4, 12],
    fragment: "slowfast",
    span: [[1, 0, 0], 4, [1, 0, 0], 12],
    scope: [[1, 0, 0], 0, [1, 0, 0], 24],
  });
});

test("a clash inside formatting: html fragments, spans in the inner text node", async () => {
  const m = await merge(
    `<p id="p">One <b>quick</b> fox</p>`,
    `<p id="p">One <b>slow</b> fox</p>`,
    `<p id="p">One <b>fast</b> fox</p>`,
  );
  const r = m.rv[0];
  assert.deepEqual(side(r.text.base), {
    text: "One quick fox",
    range: [4, 9],
    fragment: "<b>quick</b>",
    span: [[1, 0, 1, 0], 0, [1, 0, 1, 0], 5],
    scope: [[1, 0, 0], 0, [1, 0, 2], 4],
  });
  assert.equal(r.text.local.fragment, "<b>slow</b>");
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("b"), 0, m.text("b"), 4]);
  assert.deepEqual(liveSpan(r.text.liveScope), [
    m.text("p"),
    0,
    m.el("p").lastChild,
    4,
  ]);
});

test("a clash across a local paragraph split: scope crosses the block, breaks count one", async () => {
  const m = await merge(
    `<p>alpha bravo charlie delta</p>`,
    `<p>alpha bravo</p><p>charlie delta</p>`,
    `<p>alpha BRAVO CHARLIE delta</p>`,
  );
  assert.equal(m.body, `<p>alpha BRAVO CHARLIE delta</p>`);
  const r = m.rv[0];
  assert.equal(r.subject.key, "b:[1]");
  assert.deepEqual(side(r.text.local), {
    text: "alpha bravo\u001echarlie delta\u001e",
    range: [6, 19],
    fragment: "<p>bravo</p><p>charlie</p>",
    span: [[1, 0, 0], 6, [1, 1, 0], 7],
    scope: [[1, 0, 0], 0, [1], 2],
  });
  assert.deepEqual(side(r.text.merged), {
    text: "alpha BRAVO CHARLIE delta\u001e",
    range: [6, 19],
    fragment: "<p>BRAVO CHARLIE</p>",
    span: [[1, 0, 0], 6, [1, 0, 0], 19],
    scope: [[1, 0, 0], 0, [1], 1],
  });
  assert.deepEqual(liveSpan(r.text.liveScope), [
    m.text("p"),
    0,
    m.live.body,
    1,
  ]);
});

test("T3: a textarea merged whole", async () => {
  const m = await merge(
    `<textarea id="t">old</textarea>`,
    `<textarea id="t">mine</textarea>`,
    `<textarea id="t">theirs</textarea>`,
  );
  assert.equal(m.body, `<textarea id="t">theirs</textarea>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:0:3:0");
  assert.equal(r.text.encoding, "plain");
  const whole = (text) => ({
    text,
    range: [0, text.length],
    fragment: text,
    span: [[1, 0, 0], 0, [1, 0, 0], text.length],
    scope: [[1, 0, 0], 0, [1, 0, 0], text.length],
  });
  assert.deepEqual(side(r.text.base), whole("old"));
  assert.deepEqual(side(r.text.local), whole("mine"));
  assert.deepEqual(side(r.text.remote), whole("theirs"));
  assert.deepEqual(side(r.text.merged), whole("theirs"));
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.text("textarea"),
    0,
    m.text("textarea"),
    6,
  ]);
});

test("T4: a comment, legacy node filled with the live comment", async () => {
  const m = await merge(
    `<div id="d"><!--old--></div>`,
    `<div id="d"><!--mine--></div>`,
    `<div id="d"><!--theirs--></div>`,
  );
  const c = m.report.conflicts[0];
  const comment = m.el("div").firstChild;
  assert.equal(comment.nodeType, 8);
  assert.equal(c.node, comment);
  const r = c.recovery;
  assert.equal(r.key, "text:b:[1,0,0]:run:0:3:0");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0,0]:run",
    nodeType: 8,
    base: [[1, 0, 0]],
    local: [[1, 0, 0]],
    remote: [[1, 0, 0]],
    merged: [[1, 0, 0]],
  });
  assert.deepEqual(r.subject.live, [comment]);
  assert.equal(r.text.encoding, "plain");
  assert.equal(r.text.local.fragment, "mine");
  assert.deepEqual(liveSpan(r.text.liveSpan), [comment, 0, comment, 6]);
});

test("T5: inside template content", async () => {
  const m = await merge(
    `<template id="t"><p id="p">One quick fox.</p></template>`,
    `<template id="t"><p id="p">One slow fox.</p></template>`,
    `<template id="t"><p id="p">One fast fox.</p></template>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, `text:b:[1,0,"content",0]:4:9:0`);
  const p = m.el("template").content.firstChild;
  assert.deepEqual(r.subject.local, [[1, 0, "content", 0]]);
  assert.deepEqual(r.subject.live, [p]);
  assert.deepEqual(span(r.text.merged.span), [
    [1, 0, "content", 0, 0],
    4,
    [1, 0, "content", 0, 0],
    8,
  ]);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    p.firstChild,
    4,
    p.firstChild,
    8,
  ]);
  assert.equal(r.applied, true);
  assert.equal(r.unavailable, null);
});

test("A1: an attribute", async () => {
  const m = await merge(
    `<a id="a" href="/a">Go</a>`,
    `<a id="a" href="/mine">Go</a>`,
    `<a id="a" href="/theirs">Go</a>`,
  );
  assert.deepEqual(m.kinds, ["attr:"]);
  const r = m.rv[0];
  assert.equal(r.key, "attr:b:[1,0]::href");
  assert.equal(r.localLost, true);
  assert.equal(r.applied, true);
  assert.deepEqual(r.attribute, {
    namespaceURI: null,
    localName: "href",
    qualifiedName: "href",
  });
  assert.deepEqual(r.subject.live, [m.el("a")]);
  assert.equal(m.report.conflicts[0].local, "/mine");
});

test("a namespaced attribute carries its namespace", async () => {
  const m = await merge(
    `<svg id="s"><use xlink:href="#a"></use></svg>`,
    `<svg id="s"><use xlink:href="#mine"></use></svg>`,
    `<svg id="s"><use xlink:href="#theirs"></use></svg>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, `attr:b:[1,0,0]:${XLINK}:href`);
  assert.deepEqual(r.attribute, {
    namespaceURI: XLINK,
    localName: "href",
    qualifiedName: "xlink:href",
  });
});

test("S1: local deleted, remote edited", async () => {
  const m = await merge(
    `<section id="s"><h2>FAQ</h2><p>Old</p></section>`,
    ``,
    `<section id="s"><h2>FAQ</h2><p>New</p></section>`,
  );
  assert.deepEqual(m.kinds, ["structure:edit-beats-delete"]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0]:edit-beats-delete");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0]",
    nodeType: 1,
    base: [[1, 0]],
    local: [],
    remote: [[1, 0]],
    merged: [[1, 0]],
  });
  assert.deepEqual(r.subject.live, [m.el("section")]);
  assert.equal(m.report.conflicts[0].el, m.el("section"));
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["deleted", "edited", true],
  );
  assert.equal(s.localPlacement, null);
  assert.equal(s.localFragment, null);
  assert.equal(s.fragmentKind, "element");
  assert.deepEqual(placement(s.remotePlacement), {
    parent: "b:[1]",
    before: [],
    after: [],
  });
  assert.deepEqual(placement(s.mergedPlacement), {
    parent: "b:[1]",
    before: [],
    after: [],
  });
});

test("S1 with a beforeNodeAdded veto: applied false, hook-veto, no live subject", async () => {
  const m = await merge(
    `<section id="s"><h2>FAQ</h2><p>Old</p></section>`,
    ``,
    `<section id="s"><h2>FAQ</h2><p>New</p></section>`,
    {
      options: {
        hooks: { beforeNodeAdded: (n) => !(n.nodeType === 1 && n.id === "s") },
      },
    },
  );
  assert.equal(m.body, ``);
  const r = m.rv[0];
  assert.equal(r.applied, false);
  assert.equal(r.unavailable, "hook-veto");
  assert.deepEqual(r.subject.live, []);
  assert.equal(r.localLost, false);
});

test("S2: local edited, remote deleted: not a loss", async () => {
  const m = await merge(
    `<section id="s"><h2>FAQ</h2><p>Old</p></section>`,
    `<section id="s"><h2>FAQ</h2><p>New</p></section>`,
    ``,
  );
  const r = m.rv[0];
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["edited", "deleted", false],
  );
  assert.deepEqual(r.subject.local, [[1, 0]]);
  assert.deepEqual(r.subject.remote, []);
  assert.equal(
    s.localFragment,
    `<section id="s"><h2>FAQ</h2><p>New</p></section>`,
  );
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1]",
    before: [],
    after: [],
  });
  assert.equal(s.remotePlacement, null);
  assert.deepEqual(r.subject.live, [m.el("section")]);
});

const S3 = [
  `<div id="a"><p id="p">P</p></div><div id="b"></div><div id="c"></div>`,
  `<div id="a"></div><div id="b"><p id="p">P</p></div><div id="c"></div>`,
  `<div id="a"></div><div id="b"></div><div id="c"><p id="p">P</p></div>`,
];

test("S3 and D1: both moved, two records share one recovery", async () => {
  const m = await merge(...S3);
  assert.deepEqual(m.kinds, ["structure:both-moved", "structure:both-moved"]);
  assert.equal(m.body, S3[2]);
  assert.equal(m.rv[0].key, m.rv[1].key);
  assert.equal(m.rv[0], m.rv[1]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,0]:both-moved");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0,0]",
    nodeType: 1,
    base: [[1, 0, 0]],
    local: [[1, 1, 0]],
    remote: [[1, 2, 0]],
    merged: [[1, 2, 0]],
  });
  assert.deepEqual(r.subject.live, [m.el("p")]);
  assert.equal(m.report.conflicts[0].el, m.el("p"));
  assert.equal(m.report.conflicts[1].el, m.el("p"));
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["moved", "moved", true],
  );
  assert.equal(s.localFragment, `<p id="p">P</p>`);
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1,1]",
    before: [],
    after: [],
  });
  assert.deepEqual(s.localPlacement.parent.local, [[1, 1]]);
  assert.deepEqual(s.localPlacement.parent.live, [m.el("#b")]);
  assert.deepEqual(placement(s.remotePlacement), {
    parent: "b:[1,2]",
    before: [],
    after: [],
  });
  assert.deepEqual(placement(s.mergedPlacement), {
    parent: "b:[1,2]",
    before: [],
    after: [],
  });
});

test("S3 without authored ids", async () => {
  const m = await merge(
    `<div><p>P words here</p></div><div><p>second para here</p></div><div><p>third para here</p></div>`,
    `<div></div><div><p>P words here</p><p>second para here</p></div><div><p>third para here</p></div>`,
    `<div></div><div><p>second para here</p></div><div><p>P words here</p><p>third para here</p></div>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,0]:both-moved");
  assert.deepEqual(r.subject.local, [[1, 1, 0]]);
  assert.deepEqual(r.subject.remote, [[1, 2, 0]]);
  assert.deepEqual(r.subject.live, [m.live.body.children[2].firstChild]);
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "b:[1,1]",
    before: ["b:[1,1,0]"],
    after: [],
  });
});

test("S3 with duplicate authored ids: base paths stay independent", async () => {
  const m = await merge(
    `<div id="x"><p id="p">P</p></div><div id="x"></div><div id="x"></div>`,
    `<div id="x"></div><div id="x"><p id="p">P</p></div><div id="x"></div>`,
    `<div id="x"></div><div id="x"></div><div id="x"><p id="p">P</p></div>`,
  );
  assert.deepEqual(m.kinds, ["structure:both-reordered"]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1]:both-reordered");
  assert.deepEqual(keys(r.structure.localOrder), [
    "b:[1,1]",
    "b:[1,0]",
    "b:[1,2]",
  ]);
  assert.deepEqual(keys(r.structure.mergedOrder), [
    "b:[1,2]",
    "b:[1,1]",
    "b:[1,0]",
  ]);
  assert.equal(r.localLost, true);
});

test("S3 plus an independent attribute conflict: separate keys, nothing in stats", async () => {
  const m = await merge(
    `<div id="a" title="t"><p id="p">P</p></div><div id="b"></div><div id="c"></div>`,
    `<div id="a" title="mineSECRET"></div><div id="b"><p id="p">P</p></div><div id="c"></div>`,
    `<div id="a" title="theirs"></div><div id="b"></div><div id="c"><p id="p">P</p></div>`,
  );
  assert.deepEqual(keys(m.rv), [
    "attr:b:[1,0]::title",
    "structure:b:[1,0,0]:both-moved",
    "structure:b:[1,0,0]:both-moved",
  ]);
  assert.equal(m.rv[0].attribute.localName, "title");
  assert.equal(m.rv[1], m.rv[2]);
  assert.equal(JSON.stringify(m.report.stats).includes("SECRET"), false);
});

test("P1: S3 under the local policy: the order side still decides, reported truthfully", async () => {
  const m = await merge(...S3, { options: { conflicts: "local" } });
  assert.equal(m.body, S3[2]);
  assert.equal(m.rv[0].localLost, true);
  assert.deepEqual(placement(m.rv[0].structure.mergedPlacement), {
    parent: "b:[1,2]",
    before: [],
    after: [],
  });
});

test("S4: both reordered", async () => {
  const m = await merge(
    `<div id="s"><p id="a">A</p><p id="b">B</p><p id="c">C</p></div>`,
    `<div id="s"><p id="b">B</p><p id="a">A</p><p id="c">C</p></div>`,
    `<div id="s"><p id="a">A</p><p id="c">C</p><p id="b">B</p></div>`,
  );
  assert.deepEqual(m.kinds, ["structure:both-reordered"]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0]:both-reordered");
  assert.deepEqual(r.subject.live, [m.el("#s")]);
  assert.equal(m.report.conflicts[0].el, m.el("#s"));
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["reordered", "reordered", true],
  );
  assert.deepEqual(keys(s.localOrder), ["b:[1,0,1]", "b:[1,0,0]", "b:[1,0,2]"]);
  assert.deepEqual(keys(s.mergedOrder), [
    "b:[1,0,0]",
    "b:[1,0,2]",
    "b:[1,0,1]",
  ]);
  assert.deepEqual(
    s.localOrder.map((x) => x.live[0]),
    [m.el("#b"), m.el("#a"), m.el("#c")],
  );
  assert.equal(s.localFragment, null);
});

test("S5: local deleted, remote moved (two records, one recovery)", async () => {
  const m = await merge(
    `<div id="a"><p id="p">P</p></div><div id="b"></div>`,
    `<div id="a"></div><div id="b"></div>`,
    `<div id="a"></div><div id="b"><p id="p">P</p></div>`,
  );
  assert.deepEqual(m.kinds, [
    "structure:move-beats-delete",
    "structure:move-beats-delete",
  ]);
  assert.equal(m.rv[0].key, m.rv[1].key);
  assert.equal(m.rv[0], m.rv[1]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,0]:move-beats-delete");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0,0]",
    nodeType: 1,
    base: [[1, 0, 0]],
    local: [],
    remote: [[1, 1, 0]],
    merged: [[1, 1, 0]],
  });
  assert.deepEqual(r.subject.live, [m.el("p")]);
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["deleted", "moved", true],
  );
  assert.equal(s.localPlacement, null);
  assert.deepEqual(placement(s.remotePlacement), {
    parent: "b:[1,1]",
    before: [],
    after: [],
  });
});

test("S5 swapped: a retained local move is not a loss", async () => {
  const m = await merge(
    `<div id="a"><p id="p">P</p></div><div id="b"></div>`,
    `<div id="a"></div><div id="b"><p id="p">P</p></div>`,
    `<div id="a"></div><div id="b"></div>`,
  );
  const r = m.rv[0];
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["moved", "deleted", false],
  );
  assert.equal(s.localFragment, `<p id="p">P</p>`);
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1,1]",
    before: [],
    after: [],
  });
  assert.equal(s.remotePlacement, null);
});

test("S6: colliding element insertions", async () => {
  const m = await merge(
    `<div id="s"></div>`,
    `<div id="s"><p id="p">LOCAL</p></div>`,
    `<div id="s"><p id="p">REMOTE</p></div>`,
  );
  assert.deepEqual(m.kinds, ["structure:insert-collision"]);
  assert.equal(m.body, `<div id="s"><p id="p">REMOTE</p></div>`);
  const r = m.rv[0];
  assert.equal(r.key, "structure:l:[1,0,0]:insert-collision");
  assert.deepEqual(ref(r.subject), {
    key: "l:[1,0,0]",
    nodeType: 1,
    base: [],
    local: [[1, 0, 0]],
    remote: [[1, 0, 0]],
    merged: [[1, 0, 0]],
  });
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["inserted", "inserted", true],
  );
  assert.equal(s.localFragment, `<p id="p">LOCAL</p>`);
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1,0]",
    before: [],
    after: [],
  });
  assert.deepEqual(r.subject.live, [m.el("p")]);
});

test("S7: colliding text insertions between siblings", async () => {
  const m = await merge(
    `<div id="s"><section id="a"></section><section id="b"></section></div>`,
    `<div id="s"><section id="a"></section>LOCAL<section id="b"></section></div>`,
    `<div id="s"><section id="a"></section>REMOTE<section id="b"></section></div>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "structure:l:[1,0,1]:run:insert-collision");
  assert.deepEqual(ref(r.subject), {
    key: "l:[1,0,1]:run",
    nodeType: 3,
    base: [],
    local: [[1, 0, 1]],
    remote: [[1, 0, 1]],
    merged: [[1, 0, 1]],
  });
  assert.deepEqual(r.subject.live, [m.el("#s").childNodes[1]]);
  assert.equal(m.report.conflicts[0].el, m.el("#s"));
  const s = r.structure;
  assert.equal(s.fragmentKind, "text");
  assert.equal(s.localFragment, "LOCAL");
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1,0]",
    before: ["b:[1,0,1]"],
    after: ["b:[1,0,0]"],
  });
  assert.equal(r.localLost, true);
});

test("L1: the whole paragraph is the merged text, the clash located in it", async () => {
  const p = (w) =>
    `<h2>Team plan</h2><p id="p">Our team plan includes five seats, shared folders, priority support and a ${w} price for everyone.</p>`;
  const m = await merge(p("fair"), p("great"), p("low"));
  const t = m.rv[0].text.merged;
  assert.deepEqual([t.start, t.end], [74, 77]);
  assert.equal(t.text.slice(t.start, t.end), "low");
  assert.equal(
    t.text,
    "Our team plan includes five seats, shared folders, priority support and a low price for everyone.",
  );
});

test("mergeRun on the public path: a run beside a side-inserted comment", async () => {
  const m = await merge(
    `<div id="d">One quick <b>fox</b> sleeps</div>`,
    `<div id="d">One slow <!--x--><b>fox</b> sleeps</div>`,
    `<div id="d">One fast <b>fox</b> sleeps</div>`,
  );
  assert.equal(m.body, `<div id="d">One fast <!--x--><b>fox</b> sleeps</div>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0,0]:run:4:9:0");
  assert.equal(r.text.encoding, "plain");
  assert.equal(r.subject.nodeType, 3);
  assert.deepEqual(side(r.text.base), {
    text: "One quick ",
    range: [4, 9],
    fragment: "quick",
    span: [[1, 0, 0], 4, [1, 0, 0], 9],
    scope: [[1, 0, 0], 0, [1, 0, 0], 10],
  });
  assert.deepEqual(side(r.text.local).range, [4, 8]);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.el("#d").firstChild,
    4,
    m.el("#d").firstChild,
    8,
  ]);
  assert.equal(m.report.conflicts[0].node, m.el("#d").firstChild);
});

test("mergeRun resolving to nothing: the merged side is an insertion point", async () => {
  const m = await merge(
    `<div id="d">alpha <b>x</b> beta</div>`,
    `<div id="d"><b>x</b><!--c--> beta</div>`,
    `<div id="d">alpha! <b>x</b> beta</div>`,
    { options: { conflicts: "local" } },
  );
  assert.equal(m.body, `<div id="d"><b>x</b><!--c--> beta</div>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0,0]:run:0:6:0");
  assert.equal(r.localLost, false);
  assert.deepEqual(side(r.text.merged), {
    text: "",
    range: [0, 0],
    fragment: "",
    span: [[1, 0], 0, [1, 0], 0],
    scope: [[1, 0], 0, [1, 0], 0],
  });
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.el("#d"), 0, m.el("#d"), 0]);
  assert.deepEqual(r.subject.live, []);
  assert.deepEqual(r.subject.merged, []);
  assert.equal(m.report.conflicts[0].node, null);
  assert.equal(r.applied, true);
});

test("a remote script src insertion: the report survives the load", async () => {
  const m = await merge(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps.</p><script src="/x.js"></script>`,
    {
      execute: true,
      between: (live) =>
        live
          .querySelector("script[src]")
          .dispatchEvent(new window.Event("load")),
    },
  );
  const r = m.rv[0];
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("p"), 4, m.text("p"), 8]);
  assert.equal(r.text.local.fragment, "slow");
});

test("an inline .quill-data script: the live subject is the activated script", async () => {
  const m = await merge(
    `<p>x</p><script type="application/json" class="quill-data">{"a":1}</script>`,
    `<p>x</p><script type="application/json" class="quill-data">{"a":2}</script>`,
    `<p>x</p><script type="application/json" class="quill-data">{"a":3}</script>`,
    { execute: true },
  );
  const script = m.el("script");
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,1]:0:7:0");
  assert.equal(r.text.encoding, "plain");
  assert.deepEqual(r.subject.live, [script]);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    script.firstChild,
    0,
    script.firstChild,
    7,
  ]);
  assert.equal(r.text.local.text, `{"a":2}`);
});

test("null-el emitters resolve: cross echo, cycle, order-side and other-side already-emitted", async () => {
  const cross = await merge(
    `<div><p>a</p><p>b</p></div><div><p>c</p></div>`,
    `<div><p>a</p><p>c</p><p>e</p></div><div></div>`,
    `<div><p>a</p><p>e</p></div><div><p>c</p></div>`,
  );
  for (const r of cross.rv) {
    assert.match(
      r.key,
      /^structure:(b|l|r):\[.*\]:(both-moved|insert-collision)$/,
    );
    assert.ok(r.subject.live.length >= 1);
  }
  const cycle = await merge(
    `<div id="a"><p>a</p></div><div id="b"><p>b</p></div>`,
    `<div id="b"><p>b</p><div id="a"><p>a</p></div></div>`,
    `<div id="a"><p>a</p><div id="b"><p>b</p></div></div>`,
  );
  assert.deepEqual(cycle.kinds, [
    "structure:both-moved",
    "structure:both-moved",
  ]);
  assert.equal(cycle.rv[0], cycle.rv[1]);
  assert.equal(
    cycle.body,
    `<div id="a"><p>a</p><div id="b"><p>b</p></div></div>`,
  );
  assert.equal(cycle.rv[0].key, "structure:b:[1,0]:both-moved");
  assert.deepEqual(cycle.rv[0].subject.live, [cycle.el("#a")]);
  assert.equal(cycle.report.conflicts[0].el, cycle.el("#a"));
  assert.equal(cycle.rv[0].localLost, true);
  assert.deepEqual(placement(cycle.rv[0].structure.localPlacement), {
    parent: "b:[1,1]",
    before: [],
    after: ["b:[1,1,0]"],
  });
  assert.deepEqual(placement(cycle.rv[0].structure.mergedPlacement), {
    parent: "b:[1]",
    before: [],
    after: [],
  });
  const order = await merge(
    `<div id="x"><p>1</p><p>2</p></div><div id="p"><div id="y"></div></div>`,
    `<div id="x"><p>2</p><p>1</p><div id="y"></div></div><div id="p"></div>`,
    `<div id="x"><p>1</p><p>2</p></div><div id="p"></div><div id="y"></div>`,
  );
  assert.deepEqual(order.kinds, [
    "structure:both-moved",
    "structure:both-moved",
  ]);
  assert.equal(order.rv[0], order.rv[1]);
  assert.equal(order.rv[0].key, "structure:b:[1,1,0]:both-moved");
  assert.deepEqual(order.rv[0].subject.live, [order.el("#y")]);
  assert.equal(order.rv[0].localLost, false);
  assert.deepEqual(placement(order.rv[0].structure.mergedPlacement), {
    parent: "b:[1,0]",
    before: [],
    after: ["b:[1,0,0]", "b:[1,0,1]"],
  });
});

test("the pure merge3 route: paths and text, nothing applied", () => {
  const { res } = mergeBodies(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps.</p>`,
  );
  assert.equal(res.conflicts.length, 1);
  const r = res.conflicts[0].recovery;
  assert.equal(r.key, "text:b:[1,0]:4:9:0");
  assert.deepEqual(r.subject.merged, [[1, 0]]);
  assert.deepEqual(r.subject.live, []);
  assert.equal(r.applied, false);
  assert.equal(r.unavailable, null);
  assert.equal(r.text.liveSpan, null);
  assert.deepEqual([r.text.merged.start, r.text.merged.end], [4, 8]);
});

test("a conflict-free merge adds nothing", async () => {
  const m = await merge(`<p>a</p>`, `<p>a</p>`, `<p>b</p>`);
  assert.deepEqual(m.report.conflicts, []);
  const { res } = mergeBodies(`<p>a</p>`, `<p>a</p>`, `<p>b</p>`);
  assert.equal(res.recoveryLinks, null);
});

test("determinism: the same inputs give the same recovery data", async () => {
  const a = await merge(...S3),
    b = await merge(...S3);
  assert.equal(staticRecovery(a.projection), staticRecovery(b.projection));
  assert.equal(JSON.stringify(a.projection), JSON.stringify(b.projection));
});

// Ported fixtures for the emitter sites the public fixtures above do not
// reach (inline-merge.test.js, round2-crossblock.test.js,
// hash-verify.test.js, hm-h-cross-echo.test.js).

test("attrsOf: a mark both sides inserted with different attributes", async () => {
  const m = await merge(
    `<p id="p">See docs.</p>`,
    `<p id="p">See <a href="/a">docs</a>.</p>`,
    `<p id="p">See <a href="/b">docs</a>.</p>`,
  );
  assert.deepEqual(m.kinds, ["attr:"]);
  const r = m.rv[0];
  assert.equal(r.key, "attr:l:[1,0,1]::href");
  assert.deepEqual(ref(r.subject), {
    key: "l:[1,0,1]",
    nodeType: 1,
    base: [],
    local: [[1, 0, 1]],
    remote: [[1, 0, 1]],
    merged: [[1, 0, 1]],
  });
  assert.deepEqual(r.subject.live, [m.el("a")]);
  assert.equal(r.localLost, true);
});

test("emitRescues: a joined block edited here and deleted there is a retained edit", async () => {
  const m = await merge(
    `<div id="d">hello there <p>P</p> big world</div>`,
    `<div id="d">hello there <p>P2</p> big world</div>`,
    `<div id="d">hello there  big world</div>`,
  );
  assert.deepEqual(m.kinds, ["structure:edit-beats-delete"]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,1]:edit-beats-delete");
  assert.deepEqual(
    [r.structure.localAction, r.structure.remoteAction, r.localLost],
    ["edited", "deleted", false],
  );
  assert.equal(r.structure.localFragment, "<p>P2</p>");
  assert.deepEqual(r.subject.remote, []);
  assert.deepEqual(r.subject.live, [m.el("p")]);
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "b:[1,0]",
    before: ["b:[1,0,2]:run"],
    after: ["b:[1,0,0]:run"],
  });
});

test("ch.dup: an atom both sides moved inside one paragraph", async () => {
  const m = await merge(
    `<p id="p">a1 <img src="x"> b1 c1</p>`,
    `<p id="p">a1 b1 c1 <img src="x"></p>`,
    `<p id="p"><img src="x"> a1 b1 c1</p>`,
  );
  assert.deepEqual(m.kinds, ["text:", "structure:both-moved"]);
  const r = m.rv[1];
  assert.equal(r.key, "structure:b:[1,0,1]:both-moved");
  assert.deepEqual(r.subject.remote, [[1, 0, 0]]);
  assert.deepEqual(r.subject.live, [m.el("img")]);
  assert.equal(m.report.conflicts[1].el, m.el("img"));
  assert.equal(r.structure.localFragment, `<img src="x">`);
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "b:[1,0]",
    before: [],
    after: ["b:[1,0,0]:run"],
  });
  assert.deepEqual(placement(r.structure.mergedPlacement), {
    parent: "b:[1,0]",
    before: ["b:[1,0,0]:run"],
    after: [],
  });
});

test("ch.bk: a colliding atom moved here and deleted there", async () => {
  const T1 = "alpha beta gamma delta",
    T2 = "epsilon zeta eta theta";
  const m = await merge(
    `<p id="p">head <x-a>${T1}</x-a> middle <x-a>${T2}</x-a> tail</p>`,
    `<p id="p">head <x-a>${T2}</x-a> middle <x-a>${T1} L</x-a> tail</p>`,
    `<p id="p">head middle <x-a>${T2} R</x-a> tail</p>`,
  );
  assert.deepEqual(m.kinds, ["text:", "structure:move-beats-delete"]);
  const r = m.rv[1];
  assert.equal(r.key, "structure:b:[1,0,1]:move-beats-delete");
  assert.deepEqual(
    [r.structure.localAction, r.structure.remoteAction, r.localLost],
    ["moved", "deleted", false],
  );
  assert.equal(r.structure.localFragment, `<x-a>${T1} L</x-a>`);
  assert.deepEqual(r.subject.local, [[1, 0, 3]]);
  assert.deepEqual(r.subject.remote, []);
  assert.deepEqual(r.subject.live, [m.el("#p").children[1]]);
});

test("cloneUnit: an atom both sides moved, one into a new block", async () => {
  const m = await merge(
    `<p>w0 w1 w2 w3</p><p>w6 w7 <img src="x"> w8</p>`,
    `<p>n1 n2 <img src="x"> n3</p><p>w0 w1 w2 w3</p><p>w6 w7 w8</p>`,
    `<p>w0 w1 <img src="x"> w2 w3</p><p>w6 w7 w8</p>`,
  );
  assert.equal(
    m.body,
    `<p>n1 n2  n3</p><p>w0 w1 <img src="x"> w2 w3</p><p>w6 w7 w8</p>`,
  );
  assert.deepEqual(m.kinds, ["structure:both-moved"]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,1,1]:both-moved");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,1,1]",
    nodeType: 1,
    base: [[1, 1, 1]],
    local: [[1, 0, 1]],
    remote: [[1, 0, 1]],
    merged: [[1, 1, 1]],
  });
  assert.deepEqual(r.subject.live, [m.el("img")]);
  assert.equal(r.localLost, true);
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "l:[1,0]",
    before: ["l:[1,0,2]:run"],
    after: ["l:[1,0,0]:run"],
  });
  assert.deepEqual(placement(r.structure.mergedPlacement), {
    parent: "b:[1,0]",
    before: [],
    after: ["b:[1,0,0]:run"],
  });
});

test("moveInto: an atom both sides moved, the other side into a new block", async () => {
  const m = await merge(
    `<p>w0 w1 w2 w3</p><p>w6 w7 <img src="x"> w8</p>`,
    `<p>w0 w1 <img src="x"> w2 w3</p><p>w6 w7 w8</p>`,
    `<p>n1 n2 <img src="x"> n3</p><p>w0 w1 w2 w3</p><p>w6 w7 w8</p>`,
  );
  assert.equal(
    m.body,
    `<p>n1 n2 <img src="x"> n3</p><p>w0 w1  w2 w3</p><p>w6 w7 w8</p>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,1,1]:both-moved");
  assert.deepEqual(r.subject.merged, [[1, 0, 1]]);
  assert.deepEqual(r.subject.live, [m.el("img")]);
  assert.equal(r.localLost, true);
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "b:[1,0]",
    before: ["l:[1,0,2]:run"],
    after: ["b:[1,0,0]:run"],
  });
  assert.deepEqual(placement(r.structure.remotePlacement), {
    parent: "r:[1,0]",
    before: ["r:[1,0,2]:run"],
    after: ["r:[1,0,0]:run"],
  });
  assert.deepEqual(placement(r.structure.mergedPlacement), {
    parent: "r:[1,0]",
    before: ["r:[1,0,2]:run"],
    after: ["r:[1,0,0]:run"],
  });
});

test("moveInto: a mark moved by local into a paragraph remote deleted (HM-H2 seed)", async () => {
  const m = await merge(
    `<div><p>w0 w1 w2 <b>w4</b> w3</p></div><div><p>w5 w6 w7 <b>w9 w10</b> w8</p></div>`,
    `<div><p>w11 w12 <b>w15</b> w13 w14</p><p>w0 w1 w2 w3</p></div><div><p>w16 <b>w4</b> w17</p></div>`,
    `<div><p>w11 w12 <b>w15</b> w13 w14</p><p>w18 w19</p></div><p>w5 w6 w7 <b>w9 w10</b> w8</p><div></div>`,
  );
  const mbd = m.rv.find((r) => r.key.endsWith(":move-beats-delete"));
  assert.equal(mbd.key, "structure:b:[1,0,0,1]:move-beats-delete");
  assert.deepEqual(
    [mbd.structure.localAction, mbd.structure.remoteAction, mbd.localLost],
    ["moved", "deleted", false],
  );
  assert.equal(mbd.structure.localFragment, "<b>w4</b>");
  assert.deepEqual(mbd.subject.local, [[1, 1, 0, 1]]);
  assert.deepEqual(mbd.subject.merged, [[1, 1, 1]]);
  assert.equal(mbd.subject.live.length, 1);
  assert.equal(mbd.subject.live[0].textContent, "w4");
  assert.deepEqual(placement(mbd.structure.localPlacement), {
    parent: "b:[1,1,0]",
    before: ["b:[1,1,0,2]:run"],
    after: ["b:[1,1,0,0]:run"],
  });
  for (const r of m.rv) assert.ok(r.subject.live.length >= 1, r.key);
});

// The ClayJS default: the live tree is `local`, and apply rewrites it. The
// local side of every record is read before that.

async function mergeDefault(base, local, remote, prepare) {
  const live = parse(doc(local));
  if (prepare) prepare(live);
  const report = await mergeDocument({
    live,
    base: parse(doc(base)),
    remote: parse(doc(remote)),
    scripts: { execute: false },
  });
  const final = finalTree(live.documentElement);
  assert.deepEqual(recoveryProblems(report.conflicts, final, false), []);
  return {
    report,
    live,
    body: live.body.innerHTML,
    rv: report.conflicts.map((c) => c.recovery),
    text: (n) => live.body.querySelector(n).firstChild,
    el: (n) => live.body.querySelector(n),
  };
}

test("the default live-as-local route: S6 keeps the local fragment apply replaced", async () => {
  const m = await mergeDefault(
    `<div id="s"></div>`,
    `<div id="s"><p id="p">LOCAL</p></div>`,
    `<div id="s"><p id="p">REMOTE</p></div>`,
  );
  assert.equal(m.body, `<div id="s"><p id="p">REMOTE</p></div>`);
  const r = m.rv[0];
  assert.equal(r.key, "structure:l:[1,0,0]:insert-collision");
  assert.equal(r.structure.localFragment, `<p id="p">LOCAL</p>`);
  assert.deepEqual(r.subject.local, [[1, 0, 0]]);
  assert.deepEqual(r.subject.live, [m.el("p")]);
  assert.equal(r.localLost, true);
});

test("the default live-as-local route: T1 keeps the local text apply overwrote", async () => {
  const m = await mergeDefault(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps.</p>`,
  );
  assert.equal(m.body, `<p id="p">One fast fox sleeps.</p>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:4:9:0");
  assert.equal(r.text.local.text, "One slow fox sleeps.");
  assert.equal(r.text.local.fragment, "slow");
  assert.equal(r.text.merged.text, "One fast fox sleeps.");
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("p"), 4, m.text("p"), 8]);
});

test("a split live text run on the default route: the local side sees the split", async () => {
  const m = await mergeDefault(
    `<p id="p">One quick fox sleeps.</p>`,
    `<p id="p">One slow fox sleeps.</p>`,
    `<p id="p">One fast fox sleeps.</p>`,
    (live) => live.getElementById("p").firstChild.splitText(6),
  );
  assert.equal(m.body, `<p id="p">One fast fox sleeps.</p>`);
  const r = m.rv[0];
  assert.deepEqual(side(r.text.local), {
    text: "One slow fox sleeps.",
    range: [4, 8],
    fragment: "slow",
    span: [[1, 0, 0], 4, [1, 0, 1], 2],
    scope: [[1, 0, 0], 0, [1, 0, 1], 14],
  });
  assert.equal(r.applied, true);
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("p"), 4, m.text("p"), 8]);
});

// The merged side is measured on the output as built: an atom the rebuild
// suppressed as a duplicate, a block it rescued, a break it glued.

const flat = (m, sel) =>
  flatten(Array.from(m.el(sel).childNodes), {
    blocks: new Set(m.el(sel).querySelectorAll(":scope > p")),
  }).text;

test("merged side from the final output: a suppressed duplicate atom", async () => {
  const m = await merge(
    `<p id="p">a1 <img src="x"> b1 c1</p>`,
    `<p id="p">a1 bX c1 <img src="x"></p>`,
    `<p id="p"><img src="x"> a1 bY c1</p>`,
  );
  assert.deepEqual(m.kinds, ["text:", "structure:both-moved"]);
  assert.equal(m.body, `<p id="p"><img src="x"> a1 bY c1 </p>`);
  const r = m.rv[0];
  assert.deepEqual(side(r.text.merged), {
    text: "￼ a1 bY c1 ",
    range: [0, 8],
    fragment: `<img src="x"> a1 bY `,
    span: [[1, 0], 0, [1, 0, 1], 7],
    scope: [[1, 0], 0, [1, 0, 1], 10],
  });
  assert.equal(r.text.merged.text, flat(m, "#p"));
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.el("p"),
    0,
    m.el("p").lastChild,
    7,
  ]);
});

test("merged side from the final output: a rescued block", async () => {
  const m = await merge(
    `<div id="d">hello quick <p>P</p> big world</div>`,
    `<div id="d">hello slow <p>P2</p> big world</div>`,
    `<div id="d">hello fast  big world</div>`,
  );
  assert.deepEqual(m.kinds, ["text:", "structure:edit-beats-delete"]);
  assert.equal(m.body, `<div id="d">hello <p>P2</p>fast  big world</div>`);
  const r = m.rv[0];
  assert.deepEqual(side(r.text.merged), {
    text: "hello ￼fast  big world",
    range: [7, 13],
    fragment: "fast  ",
    span: [[1, 0, 2], 0, [1, 0, 2], 6],
    scope: [[1, 0, 0], 0, [1, 0, 2], 15],
  });
  assert.equal(
    r.text.merged.text,
    flatten(Array.from(m.el("#d").childNodes)).text,
  );
  const tail = m.el("#d").lastChild;
  assert.deepEqual(liveSpan(r.text.liveSpan), [tail, 0, tail, 6]);
  assert.deepEqual(liveSpan(r.text.liveScope), [m.text("#d"), 0, tail, 15]);
});

test("merged side from the final output: a glued break, clash before it", async () => {
  const m = await merge(
    `<div id="d"><p>A one</p><p>B two</p><p>C three</p></div>`,
    `<div id="d"><p>A uno B two</p><p>C three</p></div>`,
    `<div id="d"><p>A eins</p><p>B two C three</p></div>`,
  );
  assert.equal(m.body, `<div id="d"><p>A eins</p><p>B two C three</p></div>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:2:6:0");
  assert.deepEqual(side(r.text.merged), {
    text: "A eins\u001eB two C three\u001e",
    range: [2, 7],
    fragment: "<p>eins</p>",
    span: [[1, 0, 0, 0], 2, [1, 0], 1],
    scope: [[1, 0, 0, 0], 0, [1, 0], 2],
  });
  assert.equal(r.text.merged.text, flat(m, "#d"));
  assert.deepEqual(liveSpan(r.text.liveSpan), [m.text("p"), 2, m.el("#d"), 1]);
});

test("merged side from the final output: a glued break, clash after it", async () => {
  const m = await merge(
    `<div id="d"><p>A one</p><p>B two</p><p>C three</p></div>`,
    `<div id="d"><p>A one B two</p><p>C tres</p></div>`,
    `<div id="d"><p>A one</p><p>B two C drei</p></div>`,
  );
  assert.equal(m.body, `<div id="d"><p>A one B two C drei</p></div>`);
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:14:19:0");
  assert.deepEqual(side(r.text.merged), {
    text: "A one B two C drei\u001e",
    range: [14, 18],
    fragment: "<p>drei</p>",
    span: [[1, 0, 0, 0], 14, [1, 0, 0, 0], 18],
    scope: [[1, 0, 0, 0], 0, [1, 0], 1],
  });
  assert.equal(r.text.merged.text, flat(m, "#d"));
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.text("p"),
    14,
    m.text("p"),
    18,
  ]);
});

test("offsets are UTF-16 code units: an emoji before T1", async () => {
  const m = await merge(
    `<p id="p">\u{1F600} One quick fox sleeps.</p>`,
    `<p id="p">\u{1F600} One slow fox sleeps.</p>`,
    `<p id="p">\u{1F600} One fast fox sleeps.</p>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:7:12:0");
  assert.deepEqual([r.text.base.start, r.text.base.end], [7, 12]);
  assert.deepEqual([r.text.merged.start, r.text.merged.end], [7, 11]);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    m.text("p"),
    7,
    m.text("p"),
    11,
  ]);
  assert.equal(m.text("p").nodeValue.slice(7, 11), "fast");
  assert.equal(m.text("p").nodeValue.slice(0, 2), "\u{1F600}");
});

// Hooks veto one operation at a time.

test("an attribute veto is per operation: the sibling text clash still applied", async () => {
  const m = await merge(
    `<p id="p" title="t">One quick fox sleeps.</p>`,
    `<p id="p" title="L">One slow fox sleeps.</p>`,
    `<p id="p" title="R">One fast fox sleeps.</p>`,
    {
      options: {
        hooks: { beforeAttributeUpdated: (name) => name !== "title" },
      },
    },
  );
  assert.equal(m.body, `<p id="p" title="L">One fast fox sleeps.</p>`);
  assert.deepEqual(m.kinds, ["attr:", "text:"]);
  const [a, t] = m.rv;
  assert.equal(a.key, "attr:b:[1,0]::title");
  assert.equal(a.applied, false);
  assert.equal(a.unavailable, "hook-veto");
  assert.equal(a.localLost, false);
  assert.deepEqual(a.subject.live, [m.el("p")]);
  assert.equal(t.key, "text:b:[1,0]:4:9:0");
  assert.equal(t.applied, true);
  assert.equal(t.unavailable, null);
  assert.equal(t.localLost, true);
});

// The live side follows what apply and activation put in the document.

test("morphElement with a differing tag: the report points at the replacement root", async () => {
  const d = parse(doc(`<div id="s">One slow fox sleeps.</div>`));
  const old = d.getElementById("s");
  const report = await morphElement(
    old,
    `<section id="s">One fast fox sleeps.</section>`,
    {
      base: `<div id="s">One quick fox sleeps.</div>`,
      scripts: { execute: false },
    },
  );
  const fresh = d.getElementById("s");
  assert.equal(fresh.tagName, "SECTION");
  assert.equal(old.isConnected, false);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(fresh), false),
    [],
  );
  const r = report.conflicts[0].recovery;
  assert.equal(r.key, "text:b:[]:4:9:0");
  assert.deepEqual(r.subject.live, [fresh]);
  assert.equal(report.conflicts[0].node, fresh);
  assert.equal(r.applied, true);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    fresh.firstChild,
    4,
    fresh.firstChild,
    8,
  ]);
  assert.deepEqual(liveSpan(r.text.liveScope), [
    fresh.firstChild,
    0,
    fresh.firstChild,
    20,
  ]);
});

test("a .quill-data script with scripts.merge off: the live subject is the activated copy", async () => {
  const q = (v) =>
    `<p>x</p><script id="q" class="quill-data" type="application/json">{"value":"${v}"}</script>`;
  const live = parse(doc(q("mine"))),
    cap = parse(doc(q("mine")));
  const before = live.getElementById("q");
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: parse(doc(q("old"))),
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc(q("theirs"))),
    scripts: { merge: false, execute: true },
  });
  const fresh = live.querySelector("script.quill-data");
  assert.equal(live.body.innerHTML, q("theirs"));
  assert.notEqual(fresh, before);
  assert.equal(before.isConnected, false);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
  assert.deepEqual(
    report.conflicts.map((c) => c.kind),
    ["text"],
  );
  const r = report.conflicts[0].recovery;
  assert.equal(r.key, "text:b:[1,1]:0:15:0");
  assert.equal(r.text.encoding, "plain");
  assert.equal(r.text.local.text, `{"value":"mine"}`);
  assert.deepEqual(r.subject.live, [fresh]);
  assert.equal(report.conflicts[0].node, fresh);
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    fresh.firstChild,
    0,
    fresh.firstChild,
    18,
  ]);
});

// An unchanged stand-in (the hook-less merge's instruction for apply) reads
// as the subtree it stands for, on every route.

const STUB = [
  `<div><p>w0 w1 w2 w3</p><p>w4 <b>w7 w8</b> <img src="i9.png"> w5 w6</p></div><p>w10 w11 w12</p>`,
  `<div><p>w0 w1 w2 w3</p><p>w4 <b>w7 w8</b> <img src="i9.png"> w5 w6</p></div><p>w13 w11 w12</p>`,
  `<div><p>w0 w1 w2 w3</p><p>w4 <img src="i9.png"> w5 w6</p></div><p><b>w7 w8</b> w14 w11 w12</p>`,
];
const STUB_MERGED = {
  text: "w7 w8 w14 w11 w12",
  range: [0, 9],
  fragment: "<b>w7 w8</b> w14",
  span: [[1, 1], 0, [1, 1, 1], 4],
  scope: [[1, 1, 0, 0], 0, [1, 1, 1], 12],
};

test("the pure route with stand-ins: the merged side reads through the stub, paths under it", () => {
  const parsed = () => STUB.map((s) => parse(doc(s)));
  const stubs = merge3(...parsed());
  const stub = stubs.doc.body.querySelector("b");
  assert.equal(stub.outerHTML, "<b></b>");
  assert.equal(stubs.conflicts.length, 1);
  const r = stubs.conflicts[0].recovery;
  assert.equal(r.key, "text:b:[1,1]:0:3:0");
  assert.deepEqual(side(r.text.merged), STUB_MERGED);
  assert.deepEqual(r.subject.live, []);
  assert.equal(r.applied, false);
  const full = merge3(...parsed(), { hooks: { beforeNodeMorphed: () => {} } });
  assert.deepEqual(
    recoveryProblems(
      stubs.conflicts,
      finalTree(stubs.doc.documentElement),
      true,
      { merged: full.root },
    ),
    [],
  );
  assert.equal(full.doc.body.querySelector("b").outerHTML, "<b>w7 w8</b>");
  const project = (res) =>
    staticRecovery(
      recoveryList(
        res.conflicts,
        labelTree(res.doc.documentElement),
        finalTree(res.doc.documentElement),
      ),
    );
  assert.equal(project(stubs), project(full));
});

test("the live route with stand-ins: the scope reaches into the kept live subtree", async () => {
  const m = await merge(...STUB);
  assert.equal(m.body, STUB[2]);
  const r = m.rv[0];
  assert.deepEqual(side(r.text.merged), STUB_MERGED);
  assert.equal(r.applied, true);
  const b = m.el("b");
  assert.deepEqual(liveSpan(r.text.liveSpan), [
    b.parentNode,
    0,
    b.nextSibling,
    4,
  ]);
  assert.deepEqual(liveSpan(r.text.liveScope), [
    b.firstChild,
    0,
    b.nextSibling,
    12,
  ]);
});

// localLost by emitter: whole-value emitters compare resolved with local;
// the inline emitters follow the policy.

test("policy both: whole-value emitters lose the local value, inline keeps it", async () => {
  const both = { options: { conflicts: "both" } };
  const t = await merge(
    `<textarea id="t">old</textarea>`,
    `<textarea id="t">mine</textarea>`,
    `<textarea id="t">theirs</textarea>`,
    both,
  );
  assert.equal(t.report.conflicts[0].resolved, "theirs");
  assert.equal(t.rv[0].text.merged.text, "theirs");
  assert.equal(t.rv[0].localLost, true);
  const c = await merge(
    `<div id="d"><!--old--></div>`,
    `<div id="d"><!--mine--></div>`,
    `<div id="d"><!--theirs--></div>`,
    both,
  );
  assert.equal(c.report.conflicts[0].resolved, "theirs");
  assert.equal(c.rv[0].localLost, true);
  const i = await merge(
    `<p id="p">a b c</p>`,
    `<p id="p">a X c</p>`,
    `<p id="p">a Y c</p>`,
    both,
  );
  assert.equal(i.body, `<p id="p">a XY c</p>`);
  assert.equal(i.rv[0].text.merged.fragment, "XY");
  assert.equal(i.rv[0].localLost, false);
});

// Witness fixtures for the two move emitters that had no base or no other
// side (in place of the contract's P1 example).

const CROSS_ECHO = [
  `<div id="a"></div><div id="b"></div>`,
  `<div id="a"><p id="p">long repeated inserted text</p></div><div id="b"></div>`,
  `<div id="a"></div><div id="b"><p id="p">long repeated inserted text</p></div>`,
];

test("crossEchoMove: the policy picks the order side, and the report says which", async () => {
  const remote = await merge(...CROSS_ECHO);
  assert.deepEqual(remote.kinds, ["structure:both-moved"]);
  assert.equal(remote.body, CROSS_ECHO[2]);
  let r = remote.rv[0];
  assert.equal(r.key, "structure:l:[1,0,0]:both-moved");
  assert.deepEqual(ref(r.subject), {
    key: "l:[1,0,0]",
    nodeType: 1,
    base: [],
    local: [[1, 0, 0]],
    remote: [[1, 1, 0]],
    merged: [[1, 1, 0]],
  });
  assert.equal(r.localLost, true);
  assert.equal(placement(r.structure.mergedPlacement).parent, "b:[1,1]");
  assert.deepEqual(r.subject.live, [remote.el("p")]);
  const local = await merge(...CROSS_ECHO, { options: { conflicts: "local" } });
  assert.equal(local.body, CROSS_ECHO[1]);
  r = local.rv[0];
  assert.equal(r.key, "structure:l:[1,0,0]:both-moved");
  assert.deepEqual(r.subject.merged, [[1, 0, 0]]);
  assert.equal(r.localLost, false);
  assert.equal(placement(r.structure.mergedPlacement).parent, "b:[1,0]");
  assert.deepEqual(r.subject.live, [local.el("p")]);
});

test("movedMarkAgainstDelete: a retained local move of a mark, anchored on a text run", async () => {
  const m = await merge(
    `<p id="a">before <b id="x">bold words</b> after</p><p id="b">target</p>`,
    `<p id="a">before  after</p><p id="b">target <b id="x">bold words</b></p>`,
    `<p id="a">before  after</p><p id="b">target</p>`,
  );
  assert.deepEqual(m.kinds, ["structure:move-beats-delete"]);
  assert.equal(
    m.body,
    `<p id="a">before  after</p><p id="b">target <b id="x">bold words</b></p>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,1]:move-beats-delete");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0,1]",
    nodeType: 1,
    base: [[1, 0, 1]],
    local: [[1, 1, 1]],
    remote: [],
    merged: [[1, 1, 1]],
  });
  const s = r.structure;
  assert.deepEqual(
    [s.localAction, s.remoteAction, r.localLost],
    ["moved", "deleted", false],
  );
  assert.equal(s.localFragment, `<b id="x">bold words</b>`);
  assert.deepEqual(placement(s.localPlacement), {
    parent: "b:[1,1]",
    before: [],
    after: ["b:[1,1,0]:run"],
  });
  assert.deepEqual(s.localPlacement.after[0].live, [m.text("#b")]);
  assert.equal(s.remotePlacement, null);
});

// Refs never resolve by authored id: duplicates stay apart.

test("duplicate authored ids: four records, two keys, two live sets", async () => {
  const m = await merge(
    `<div id="a"><p id="p">Alpha</p><p id="p">Beta</p></div><div id="b"></div><div id="c"></div>`,
    `<div id="a"></div><div id="b"><p id="p">Alpha</p><p id="p">Beta</p></div><div id="c"></div>`,
    `<div id="a"></div><div id="b"></div><div id="c"><p id="p">Alpha</p><p id="p">Beta</p></div>`,
  );
  assert.equal(m.kinds.length, 4);
  assert.deepEqual(keys(m.rv), [
    "structure:b:[1,0,0]:both-moved",
    "structure:b:[1,0,1]:both-moved",
    "structure:b:[1,0,0]:both-moved",
    "structure:b:[1,0,1]:both-moved",
  ]);
  assert.equal(m.rv[0], m.rv[2]);
  assert.equal(m.rv[1], m.rv[3]);
  assert.notEqual(m.rv[0], m.rv[1]);
  const [alpha, beta] = m.el("#c").children;
  assert.deepEqual(m.rv[0].subject.live, [alpha]);
  assert.deepEqual(m.rv[1].subject.live, [beta]);
  assert.deepEqual(m.rv[0].subject.merged, [[1, 2, 0]]);
  assert.deepEqual(m.rv[1].subject.merged, [[1, 2, 1]]);
  assert.equal(m.rv[0].structure.localFragment, `<p id="p">Alpha</p>`);
  assert.equal(m.rv[1].structure.localFragment, `<p id="p">Beta</p>`);
});

test("noIdMove: both moved without ids, placements anchored on text runs", async () => {
  const m = await merge(
    `<div><p>UniqueP</p>Alpha</div><div>Bravo</div><div>Charlie</div>`,
    `<div>Alpha</div><div>Bravo<p>UniqueP</p></div><div>Charlie</div>`,
    `<div>Alpha</div><div>Bravo</div><div>Charlie<p>UniqueP</p></div>`,
  );
  assert.deepEqual(m.kinds, ["structure:both-moved", "structure:both-moved"]);
  assert.equal(
    m.body,
    `<div>Alpha</div><div>Bravo</div><div>Charlie<p>UniqueP</p></div>`,
  );
  assert.equal(m.rv[0].key, m.rv[1].key);
  assert.equal(m.rv[0], m.rv[1]);
  const r = m.rv[0];
  assert.equal(r.key, "structure:b:[1,0,0]:both-moved");
  assert.deepEqual(ref(r.subject), {
    key: "b:[1,0,0]",
    nodeType: 1,
    base: [[1, 0, 0]],
    local: [[1, 1, 1]],
    remote: [[1, 2, 1]],
    merged: [[1, 2, 1]],
  });
  assert.deepEqual(placement(r.structure.localPlacement), {
    parent: "b:[1,1]",
    before: [],
    after: ["b:[1,1,0]:run"],
  });
  assert.deepEqual(placement(r.structure.mergedPlacement), {
    parent: "b:[1,2]",
    before: [],
    after: ["b:[1,2,0]:run"],
  });
  const charlie = m.el("p").previousSibling;
  assert.equal(charlie.nodeValue, "Charlie");
  assert.deepEqual(r.structure.mergedPlacement.after[0].live, [charlie]);
  assert.equal(r.localLost, true);
});

test("movedWithAttributes: a move and two attribute clashes on one subject", async () => {
  const m = await merge(
    `<div id="a"><p id="p" title="t" lang="en">P</p></div><div id="b"></div><div id="c"></div>`,
    `<div id="a"></div><div id="b"><p id="p" title="L" lang="fr">P</p></div><div id="c"></div>`,
    `<div id="a"></div><div id="b"></div><div id="c"><p id="p" title="R" lang="es">P</p></div>`,
  );
  assert.deepEqual(m.kinds, [
    "structure:both-moved",
    "structure:both-moved",
    "attr:",
    "attr:",
  ]);
  assert.equal(
    m.body,
    `<div id="a"></div><div id="b"></div><div id="c"><p id="p" title="R" lang="es">P</p></div>`,
  );
  assert.deepEqual(keys(m.rv), [
    "structure:b:[1,0,0]:both-moved",
    "structure:b:[1,0,0]:both-moved",
    "attr:b:[1,0,0]::title",
    "attr:b:[1,0,0]::lang",
  ]);
  assert.equal(m.rv[0], m.rv[1]);
  assert.equal(
    m.rv[0].structure.localFragment,
    `<p id="p" title="L" lang="fr">P</p>`,
  );
  for (const r of m.rv) {
    assert.deepEqual(r.subject.live, [m.el("p")]);
    assert.equal(r.localLost, true);
  }
  assert.ok(
    Object.values(m.report.stats).every((v) => typeof v === "number"),
    JSON.stringify(m.report.stats),
  );
});

test("baselessMarkAttribute: an attribute clash on a mark both sides inserted", async () => {
  const m = await merge(
    `<p id="p">same words</p>`,
    `<p id="p"><a href="/L">same words</a></p>`,
    `<p id="p"><a href="/R">same words</a></p>`,
  );
  assert.deepEqual(m.kinds, ["attr:"]);
  assert.equal(m.body, `<p id="p"><a href="/R">same words</a></p>`);
  const r = m.rv[0];
  assert.equal(r.key, "attr:l:[1,0,0]::href");
  assert.deepEqual(ref(r.subject), {
    key: "l:[1,0,0]",
    nodeType: 1,
    base: [],
    local: [[1, 0, 0]],
    remote: [[1, 0, 0]],
    merged: [[1, 0, 0]],
  });
  assert.deepEqual(r.attribute, {
    namespaceURI: null,
    localName: "href",
    qualifiedName: "href",
  });
  assert.deepEqual(r.subject.live, [m.el("a")]);
  assert.equal(r.localLost, true);
});

test("S4 with a remote insertion: the orders keep the three base children", async () => {
  const m = await merge(
    `<div id="s"><p id="a">A</p><p id="b">B</p><p id="c">C</p></div>`,
    `<div id="s"><p id="b">B</p><p id="a">A</p><p id="c">C</p></div>`,
    `<div id="s"><p id="a">A</p><p id="d">D</p><p id="c">C</p><p id="b">B</p></div>`,
  );
  assert.deepEqual(m.kinds, ["structure:both-reordered"]);
  assert.equal(
    m.body,
    `<div id="s"><p id="a">A</p><p id="d">D</p><p id="c">C</p><p id="b">B</p></div>`,
  );
  const s = m.rv[0].structure;
  assert.deepEqual(keys(s.localOrder), ["b:[1,0,1]", "b:[1,0,0]", "b:[1,0,2]"]);
  assert.deepEqual(keys(s.mergedOrder), [
    "b:[1,0,0]",
    "b:[1,0,2]",
    "b:[1,0,1]",
  ]);
  assert.deepEqual(
    s.mergedOrder.map((x) => x.live[0]),
    [m.el("#a"), m.el("#c"), m.el("#b")],
  );
  assert.equal(m.rv[0].localLost, true);
});

test("an atom the other side moved out: the sides read the whole segment", async () => {
  const base = `<p id="a">One <img id="i" src="x"> fast fox here.</p><p id="b">Two.</p>`;
  const local = `<p id="a">One <img id="i" src="x"> slow fox here.</p><p id="b">Two.</p>`;
  const remote = `<p id="a">One  quick fox here.</p><p id="b">Two. <img id="i" src="x"></p>`;
  const m = await merge(base, local, remote);
  assert.deepEqual(m.kinds, ["text:"]);
  assert.equal(
    m.body,
    `<p id="a">One  quick fox here.</p><p id="b">Two. <img id="i" src="x"></p>`,
  );
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:5:9:0");
  const t = r.text;
  for (const [sd, html, word] of [
    ["base", base, "fast"],
    ["local", local, "slow"],
  ]) {
    const s = t[sd];
    const p = parse(doc(html)).querySelector("#a");
    assert.equal(s.text, flatten([...p.childNodes], {}).text, sd);
    assert.equal(s.text, `One ￼ ${word} fox here.`);
    assert.equal(s.text.slice(s.start, s.end), word);
    assert.equal(s.fragment, word);
    assert.deepEqual(span(s.span), [[1, 0, 2], 1, [1, 0, 2], 5]);
    assert.deepEqual(span(s.scope), [[1, 0, 0], 0, [1, 0, 2], 15]);
    assert.equal(p.childNodes[2].nodeValue.slice(1, 5), word);
  }
  assert.equal(t.remote.text, "One  quick fox here.");
  assert.deepEqual([t.remote.start, t.remote.end], [5, 10]);
  assert.deepEqual(span(t.remote.scope), [[1, 0, 0], 0, [1, 0, 0], 20]);
  assert.equal(t.merged.text, "One  quick fox here.");
  assert.deepEqual([t.merged.start, t.merged.end], [5, 10]);
  assert.equal(r.applied, true);
  assert.deepEqual(liveSpan(t.liveSpan), [m.text("#a"), 5, m.text("#a"), 10]);
  assert.equal(r.localLost, true);
});

test("beforeApply removes the conflict's output: missing-output, no span", async () => {
  const m = await merge(
    `<p id="p">One fast fox.</p>`,
    `<p id="p">One slow fox.</p>`,
    `<p id="p">One quick fox.</p>`,
    {
      options: {
        beforeApply(d) {
          d.querySelector("#p").remove();
        },
      },
    },
  );
  assert.deepEqual(m.kinds, ["text:"]);
  assert.equal(m.body, "");
  const r = m.rv[0];
  assert.equal(r.key, "text:b:[1,0]:4:8:0");
  assert.equal(r.text.merged.fragment, "quick");
  assert.deepEqual(r.subject.live, []);
  assert.equal(r.text.liveSpan, null);
  assert.equal(r.text.liveScope, null);
  assert.equal(r.applied, false);
  assert.equal(r.unavailable, "missing-output");
  assert.equal(r.localLost, true);
});

test("beforeApply rewrites the clash: the span is not faked", async () => {
  const m = await merge(
    `<p id="p">One fast fox.</p>`,
    `<p id="p">One slow fox.</p>`,
    `<p id="p">One quick fox.</p>`,
    {
      options: {
        beforeApply(d) {
          d.querySelector("#p").firstChild.nodeValue = "X";
        },
      },
    },
  );
  assert.deepEqual(m.kinds, ["text:"]);
  assert.equal(m.body, `<p id="p">X</p>`);
  const r = m.rv[0];
  assert.equal(r.text.merged.text, "One quick fox.");
  assert.equal(r.text.merged.fragment, "quick");
  assert.deepEqual(r.subject.live, [m.el("p")]);
  assert.equal(r.text.liveSpan, null);
  assert.equal(r.text.liveScope, null);
  assert.equal(r.applied, false);
  assert.equal(r.unavailable, "missing-output");
  assert.equal(r.localLost, true);
});
