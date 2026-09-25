import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { createAnalyzer } from "../../src/similarity.js";
import { align } from "../../src/align.js";
import { makeIgnore } from "../../src/ignore.js";
import { indexByIdentity, defaultIdentity } from "../../src/identity.js";

function run(baseHtml, sideHtml, { ignore, idOf = defaultIdentity } = {}) {
  const b = parse(doc(baseHtml)).body, s = parse(doc(sideHtml)).body;
  const ignored = makeIgnore(ignore);
  const analyzer = createAnalyzer({ ignored });
  const a = align(b, s, { analyzer, baseIndex: indexByIdentity(b, idOf, ignored), sideIndex: indexByIdentity(s, idOf, ignored) });
  return { b, s, a, analyzer };
}
const q = (root, sel, i = 0) => root.querySelectorAll(sel)[i];

test("T-A1 identity pairs across parents", () => {
  const { b, s, a } = run('<div><p data-id="x">hi</p></div><section></section>', '<div></div><section><p data-id="x">hi!</p></section>');
  assert.equal(a.map.get(q(b, "p")), q(s, "p"));
  assert.ok(a.moved.has(q(b, "p")) === false); // identity pairs are not counted as content moves
});

test("T-A3 identical siblings keep order and are marked identical", () => {
  const { b, s, a } = run("<ul><li>a</li><li>b</li><li>c</li></ul>", "<ul><li>a</li><li>b</li><li>c</li></ul>");
  for (let i = 0; i < 3; i++) assert.equal(a.map.get(q(b, "li", i)), q(s, "li", i));
  assert.ok(a.identical.has(q(b, "ul")));
});

test("T-A4 a retyped heading pairs by signature and similar text", () => {
  const { b, s, a } = run("<h2>Pricing plans for teams</h2><h2>About</h2>", "<h2>Pricing plans for everyone</h2><h2>About</h2>");
  assert.equal(a.map.get(q(b, "h2")), q(s, "h2"));
});

test("T-A5 tag and class alone never pair dissimilar text", () => {
  const { b, s, a } = run("<article><p>One</p><p>Two</p><p>Three</p></article>", "<article><p>One</p><p>Three</p><p>Four</p></article>");
  assert.equal(a.map.get(q(b, "p", 1)), undefined);
  assert.equal(a.map.get(q(b, "p", 2)), q(s, "p", 1));
  assert.equal(a.reverse.get(q(s, "p", 2)), undefined);
});

test("T-A6 move detection pairs an element that changed parent", () => {
  const { b, s, a } = run(
    '<div class="col"><div class="card"><h3>Pricing</h3></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>',
    '<div class="col"><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div><div class="card"><h3>Pricing plans</h3></div></div>'
  );
  const pricing = q(b, ".card");
  assert.equal(a.map.get(pricing), q(s, ".card", 2));
  assert.ok(a.moved.has(pricing));
  assert.equal(a.map.get(q(pricing, "h3")), q(q(s, ".card", 2), "h3")); // children aligned after the move
});

test("T-A8 split text runs pair with a single parsed text node", () => {
  const b = parse(doc("<p>Hello world</p>")).body;
  const s = parse(doc("<p>Hello world</p>")).body;
  const p = q(s, "p");
  p.firstChild.splitText(5); // "Hello" + " world" on the side
  const analyzer = createAnalyzer();
  const a = align(b, s, { analyzer, baseIndex: new Map(), sideIndex: new Map() });
  const bRun = analyzer.unitsOf(q(b, "p"))[0], sRun = analyzer.unitsOf(p)[0];
  assert.equal(sRun.nodes.length, 2);
  assert.equal(a.map.get(bRun), sRun);
});

test("T-A9 code-like elements pair by position, never by text", () => {
  const { b, s, a } = run("<script>a()</script><p>x</p>", "<script>completely()</script><p>x</p>");
  assert.equal(a.map.get(q(b, "script")), q(s, "script"));
});

test("T-A10 ignored subtrees are absent from units and never paired", () => {
  const { b, s, a, analyzer } = run("<div><aside no-save><p>chrome</p></aside><p>chrome</p></div>", "<div><p>chrome</p></div>", { ignore: (el) => el.hasAttribute("no-save") });
  assert.equal(analyzer.unitsOf(q(b, "div")).length, 1);
  assert.equal(a.map.get(q(b, "p", 1)), q(s, "p"));
  assert.equal(a.map.get(q(b, "aside")), undefined);
});

test("reorder of similar siblings pairs each with itself", () => {
  const { b, s, a } = run("<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>", "<ul><li>Cherries</li><li>Apples</li><li>Bananas (organic)</li></ul>");
  assert.equal(a.map.get(q(b, "li", 0)), q(s, "li", 1));
  assert.equal(a.map.get(q(b, "li", 1)), q(s, "li", 2));
  assert.equal(a.map.get(q(b, "li", 2)), q(s, "li", 0));
});

test("alignment of two identical 3000-element documents is fast", () => {
  let items = "";
  for (let i = 0; i < 1000; i++) items += `<li class="row"><span class="t">Item ${i}</span><a href="/i/${i}">open</a></li>`;
  const b = parse(doc(`<main><ul>${items}</ul></main>`)).body, s = parse(doc(`<main><ul>${items}</ul></main>`)).body;
  const analyzer = createAnalyzer();
  const t0 = performance.now();
  const a = align(b, s, { analyzer, baseIndex: new Map(), sideIndex: new Map() });
  const ms = performance.now() - t0;
  assert.ok(a.identical.has(q(b, "main")));
  assert.ok(ms < 1000, `took ${ms}ms`); // jsdom is slow; the browser benchmark holds the real target
});
