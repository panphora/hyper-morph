// A 32-bit hash match is never proof that two subtrees are equal, and
// <template> content is compared where isEqualNode ignores it. The collision
// pair is a real djb2 collision: the fixtures below assert it before they rely
// on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { tagNodes, survivors, lockstepMap } from "./lib/apply-speed-fuzz.js";
import { createAnalyzer } from "../../src/similarity.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";

const T1 = "1QD0Ts5wZ41g";
const T2 = "XSnQhahIrg3s";

const frame = (r) => parse(doc(r)).body.innerHTML;
const kinds = (rep) => rep.conflicts.map((c) => `${c.kind}:${c.detail || ""}`);

/** Clean shape: live and capture are two parses of the base, local is the
 * capture mapped onto the live tree, remote is the sender's document. */
async function cleanFull(b, r) {
  const live = parse(doc(b)),
    cap = parse(doc(b));
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const templates = [...live.querySelectorAll("template")];
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(r),
  });
  return { live, templates, html: live.body.innerHTML, report };
}

/** Dirty shape: the live tab has local edits, the base is a capture string. */
async function dirtyLive(b, l, r) {
  const live = parse(doc(l));
  const templates = [...live.querySelectorAll("template")];
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  return { live, templates, html: live.body.innerHTML, report };
}

test("the collision pair really collides", () => {
  const d = parse(doc(`<p>${T1}</p><p>${T2}</p>`));
  const [a, b] = d.querySelectorAll("p");
  const analyzer = createAnalyzer();
  assert.equal(analyzer.meta(a).hash, analyzer.meta(b).hash);
  assert.ok(!a.isEqualNode(b));
});

test("I1-A collision, clean tab, heading inserted, first paragraph replaced by its hash twin", async () => {
  const b = `<p>${T1}</p><p>second para words</p>`;
  const r = `<h2>New heading</h2><p>${T2}</p><p>second para words</p>`;
  const { html, report } = await cleanFull(b, r);
  assert.equal(html, frame(r));
  assert.equal(report.conflicts.length, 0);
});

test("I1-B collision, dirty tab, rewrite after a neighbour moved", async () => {
  const b = `<p>${T1}</p><p>second para words</p><p>third one here</p>`;
  const l = `<p>${T1}</p><p>second para words</p><p>third one HERE</p>`;
  const r = `<p>second para words</p><p>${T2}</p><p>third one here</p>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(html.includes(T2), `remote text lost: ${html}`);
  assert.ok(html.includes("HERE"), `local text lost: ${html}`);
  assert.ok(!html.includes(T1), `stale base text kept: ${html}`);
  assert.equal(report.conflicts.length, 0);
});

test("I1-C collision, rewrite against a local deletion", async () => {
  const b = `<section><p>${T1}</p></section>`;
  const l = `<section></section>`;
  const r = `<section><p>${T2}</p></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(
    html.includes(T2) || report.conflicts.length > 0,
    `remote text lost with no conflict: ${html}`,
  );
});

test("I1-D collision, two independent insertions", async () => {
  const b = `<section class="a"></section><section class="b"></section>`;
  const l = `<section class="a"><p>${T1}</p></section><section class="b"></section>`;
  const r = `<section class="a"></section><section class="b"><p>${T2}</p></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(
    html.includes(T1) && html.includes(T2),
    `an insertion was dropped: ${html}`,
  );
  assert.equal(report.conflicts.length, 0);
});

test("I1-E split live text keeps every live node when identical cards shift", async () => {
  const card = (t) =>
    `<div class="card"><h3>${t}</h3><p>Body text of the card.</p></div>`;
  const b = `${card("Same")}${card("Same")}${card("Same")}`;
  const r = `<h2>Inserted</h2>${b}`;
  const live = parse(doc(b)),
    cap = parse(doc(b));
  const split = [];
  for (const d of [live, cap])
    for (const p of d.querySelectorAll("p")) {
      const piece = p.firstChild.splitText(4);
      if (d === live) split.push(p.firstChild, piece);
    }
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const ids = tagNodes(live.documentElement);
  await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(r),
  });
  assert.equal(live.body.innerHTML, frame(r));
  const rebuilt = (survivors(live.documentElement, ids).match(/N/g) || [])
    .length;
  assert.equal(rebuilt, 2, `live nodes were rebuilt: ${live.body.innerHTML}`);
  for (const n of split)
    assert.ok(
      n.isConnected,
      `a split text node was dropped: ${live.body.innerHTML}`,
    );
});

test("I1-F equality controls", () => {
  const analyzer = createAnalyzer();
  const div = (s) => parse(doc(s)).body.firstElementChild;
  const units = (el) => analyzer.unitsOf(el);

  // The identical-unit shortcut, for an element and for a run.
  const src = div(`<p>hi<span>s</span></p>`);
  for (const u of units(src)) assert.equal(analyzer.equalUnits(u, u), true);

  // A comment never equals a text run of the same bytes.
  const pText = div(`<p>abc</p>`),
    pComment = div(`<p><!--abc--></p>`);
  assert.equal(analyzer.equalUnits(units(pText)[0], units(pComment)[0]), false);

  // A changed non-ignored attribute differs.
  assert.equal(
    analyzer.equalUnits(div(`<p a="1">x</p>`), div(`<p a="2">x</p>`)),
    false,
  );

  // Ignored attributes and ignored subtrees keep today's policy.
  const ignoring = createAnalyzer({
    ignored: (el) => el.hasAttribute("no-save"),
    ignoreAttribute: (el, name) => name === "data-x",
  });
  assert.equal(
    ignoring.equalUnits(div(`<p data-x="1">x</p>`), div(`<p data-x="2">x</p>`)),
    true,
  );
  assert.equal(
    ignoring.unitsOf(div(`<div><aside no-save>chrome</aside><p>x</p></div>`))
      .length,
    1,
  );

  // The same tag name in two namespaces is not the same element.
  const impl = parse(doc("")).implementation;
  const urnA = impl.createDocument("urn:a", "a").documentElement,
    urnB = impl.createDocument("urn:b", "a").documentElement;
  assert.equal(urnA.tagName, urnB.tagName);
  assert.equal(analyzer.unitHash(urnA), analyzer.unitHash(urnB));
  assert.equal(analyzer.equalUnits(urnA, urnB), false);

  // Namespaced attributes compare by namespace, not by qualified name.
  const html = parse(doc("<div></div>"));
  const withAttr = (ns) => {
    const el = html.createElement("p");
    el.setAttributeNS(ns, "xlink:href", "/x");
    return el;
  };
  const xlink = withAttr("http://www.w3.org/1999/xlink"),
    other = withAttr("http://example.com/ns");
  assert.equal(analyzer.unitHash(xlink), analyzer.unitHash(other));
  assert.equal(
    analyzer.equalUnits(xlink, withAttr("http://www.w3.org/1999/xlink")),
    true,
  );
  assert.equal(analyzer.equalUnits(xlink, other), false);

  // A separator in an attribute value cannot forge two attribute sets equal.
  const forged = html.createElement("p");
  forged.setAttribute("a", "x\u0001b=y");
  const genuine = html.createElement("p");
  genuine.setAttribute("a", "x");
  genuine.setAttribute("b", "y");
  assert.equal(analyzer.unitHash(forged), analyzer.unitHash(genuine));
  assert.equal(analyzer.equalUnits(forged, genuine), false);

  // A second call walks nothing: the answer is the cached one even after the
  // other side mutates, which a fresh walk would read.
  const x = div(`<p>a<span>b</span></p>`),
    y = div(`<p>a<span>b</span></p>`);
  assert.equal(analyzer.equalUnits(x, y), true);
  y.firstChild.nodeValue = "zzz";
  assert.equal(analyzer.equalUnits(x, y), true);
  assert.equal(analyzer.equalUnits(x, div(`<p>zzz<span>b</span></p>`)), false);
});

test("I1-H collision, two insertions under one parent", async () => {
  const b = `<section></section>`;
  const l = `<section><p>${T1}</p></section>`;
  const r = `<section><p>${T2}</p></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(
    html.includes(T1) && html.includes(T2),
    `an insertion was dropped: ${html}`,
  );
  assert.equal(report.conflicts.length, 0);
});

test("I1-I collision, two template insertions under one parent", async () => {
  const analyzer = createAnalyzer();
  const tpls = parse(
    doc(`<template>${T1}</template><template>${T2}</template>`),
  ).querySelectorAll("template");
  assert.equal(analyzer.unitHash(tpls[0]), analyzer.unitHash(tpls[1]));
  const b = `<section></section>`;
  const l = `<section><template>${T1}</template></section>`;
  const r = `<section><template>${T2}</template></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  const out = [...parse(doc(html)).querySelectorAll("template")]
    .map((t) => t.innerHTML)
    .sort();
  assert.deepEqual(out, [T1, T2].sort(), `templates lost: ${html}`);
  assert.equal(report.conflicts.length, 0);
});

test("I1-J demoteEchoes: a local rewrite is not an echo of a colliding remote insert", async () => {
  const b = `<div><h2>old words</h2><p>alpha beta gamma</p></div>`;
  const l = `<div><h2>${T1}</h2><p>alpha beta gamma</p></div>`;
  const r = `<div><h2>old words</h2><p>alpha beta gamma</p><h2>${T2}</h2></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(
    html,
    `<div><h2>${T1}</h2><p>alpha beta gamma</p><h2>${T2}</h2></div>`,
  );
  assert.equal(report.conflicts.length, 0);
});

test("I1-K splitCrossRewrites: colliding rewrites of two paragraphs are not one inserted block", async () => {
  const b = `<div><p>x y z</p></div><div><p>alpha beta gamma</p></div>`;
  const l = `<div><p>x y z</p></div><div><p>${T1}</p></div>`;
  const r = `<div><p>${T2}</p></div><div><p>eta theta</p></div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(html, `<div><p>${T2}</p></div><div><p>eta theta</p></div>`);
  assert.deepEqual(kinds(report), ["text:"]);
});

test("I1-L per-parent echo: alike inserts whose hashes collide are a collision, never a silent keep", async () => {
  // A shared suffix keeps a djb2 collision: T1 + s and T2 + s collide too.
  const b = `<section><p>one</p><p>two</p></section>`;
  const l = `<section><p>one</p><p>${T1} alpha beta</p><p>two</p></section>`;
  const r = `<section><p>one</p><p>${T2} alpha beta</p><p>two</p></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.ok(
    html.includes(T2) || kinds(report).includes("structure:insert-collision"),
    html,
  );
  assert.ok(kinds(report).length > 0, "two different inserts merged silently");
});

// A shared suffix after the colliding pair keeps the collision, so a
// similar-but-colliding fixture is cheap to build.
test("I1-M per-parent echo lookup: two independent colliding inserts in one parent both land", async () => {
  const b = `<section><p>one</p><p>two</p></section>`;
  const l = `<section><p>${T1}</p><p>one</p><p>two</p></section>`;
  const r = `<section><p>one</p><p>two</p><p>${T2}</p></section>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(
    html,
    `<section><p>${T1}</p><p>one</p><p>two</p><p>${T2}</p></section>`,
  );
  assert.equal(report.conflicts.length, 0);
});

test("I1-N per-parent echo lookup: colliding text runs at different anchors both land", async () => {
  const b = `<div><h2>Aaa</h2><h2>Bbb</h2></div>`;
  const l = `<div><h2>Aaa</h2>${T1}<h2>Bbb</h2></div>`;
  const r = `<div><h2>Aaa</h2><h2>Bbb</h2>${T2}</div>`;
  const { html, report } = await dirtyLive(b, l, r);
  assert.equal(html, `<div><h2>Aaa</h2>${T1}<h2>Bbb</h2>${T2}</div>`);
  assert.equal(report.conflicts.length, 0);
});

test("I1-G colliding inline atoms stay distinct", () => {
  const b = `<p>head <x-a>${T1}</x-a> middle <x-a>${T2}</x-a> tail</p>`;
  const l = `<p>head <x-a>${T2}</x-a> middle <x-a>${T1} L</x-a> tail</p>`;
  const r = `<p>head middle <x-a>${T2} R</x-a> tail</p>`;
  const atoms = parse(doc(b)).querySelectorAll("x-a");
  const analyzer = createAnalyzer();
  assert.equal(analyzer.unitHash(atoms[0]), analyzer.unitHash(atoms[1]));
  const { html } = mergeBodies(b, l, r);
  assert.ok(html.includes(`${T1} L`), `local edit lost: ${html}`);
  assert.ok(html.includes(`${T2} R`), `remote edit lost: ${html}`);
});

const card = (t, tpl = "Old") =>
  `<div class="card"><h3>${t}</h3><template><li class="row">${tpl} label</li></template><ul></ul></div>`;

const tplText = (html) => {
  const d = parse(doc(html));
  return [...d.querySelectorAll("template")]
    .map((t) => t.innerHTML)
    .join(" | ");
};

// [name, base, remote]. Local edits the sibling paragraph, or the first card's
// heading, on the dirty lane.
const TEMPLATES = [
  [
    "I2-T1 id-less template content changed",
    `<template><p>a</p></template><p>x</p>`,
    `<template><p>b</p></template><p>x</p>`,
  ],
  [
    "I2-T2 id'd template, content changed",
    `<template id="t"><p>a</p></template><p>x</p>`,
    `<template id="t"><p>b</p></template><p>x</p>`,
  ],
  [
    "I2-T3 id'd div holding an id-less template, content changed",
    `<div id="d"><template><p>a</p></template></div><p>x</p>`,
    `<div id="d"><template><p>b</p></template></div><p>x</p>`,
  ],
  [
    "I2-T4 five identical id-less cards, the third card's template changed",
    card("Same").repeat(5),
    card("Same").repeat(2) + card("Same", "New") + card("Same").repeat(2),
  ],
  [
    "I2-T5 template unchanged, sibling text changed",
    `<div><template><p>a</p></template><p>x</p></div>`,
    `<div><template><p>a</p></template><p>y</p></div>`,
  ],
  [
    "I2-T6 nested template, the inner one changed",
    `<template><div><template><p>a</p></template></div></template><p>x</p>`,
    `<template><div><template><p>b</p></template></div></template><p>x</p>`,
  ],
];

for (const [name, b, r] of TEMPLATES)
  test(name, async () => {
    const want = tplText(r);
    const local = b
      .replace("<p>x</p>", "<p>x LOCAL</p>")
      .replace("<h3>Same</h3>", "<h3>Same LOCAL</h3>");
    const dirty = await dirtyLive(b, local, r);
    assert.equal(tplText(dirty.html), want, `dirty: ${dirty.html}`);
    const clean = await cleanFull(b, r);
    assert.equal(tplText(clean.html), want, `clean: ${clean.html}`);
    if (name.startsWith("I2-T5"))
      for (const t of [...dirty.templates, ...clean.templates])
        assert.ok(t.isConnected, "the unchanged template was rebuilt");
  });
