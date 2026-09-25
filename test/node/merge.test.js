import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "./lib/merge.js";

const kinds = (res, k) =>
  res.conflicts.filter((c) =>
    c.kind === "structure" ? c.detail === k : c.kind === k,
  );

test("S1 concurrent edits in the same paragraph", () => {
  const base = `<p>The quick brown fox jumps over the lazy dog.</p>`;
  const { html, res } = mergeBodies(
    base,
    `<p>Note: The quick brown fox jumps over the lazy dog.</p>`,
    `<p>The quick brown fox jumps over the sleepy dog.</p>`,
  );
  assert.equal(
    html,
    `<p>Note: The quick brown fox jumps over the sleepy dog.</p>`,
  );
  assert.equal(res.conflicts.length, 0);
  assert.equal(res.localDiverged, true);
});

test("S1b same word: remote wins, conflict reported", () => {
  const { html, res } = mergeBodies(
    `<p>the lazy dog</p>`,
    `<p>the LAZY dog</p>`,
    `<p>the sleepy dog</p>`,
  );
  assert.equal(html, `<p>the sleepy dog</p>`);
  assert.equal(kinds(res, "text").length, 1);
});

test("S2 local reorders a keyless list while remote edits an item", () => {
  const { html } = mergeBodies(
    `<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>`,
    `<ul><li>Cherries</li><li>Apples</li><li>Bananas</li></ul>`,
    `<ul><li>Apples</li><li>Bananas (organic)</li><li>Cherries</li></ul>`,
  );
  assert.equal(
    html,
    `<ul><li>Cherries</li><li>Apples</li><li>Bananas (organic)</li></ul>`,
  );
});

test("S3 local moves a card to another column while remote retitles it", () => {
  const base = `<div class="col"><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`;
  const local = `<div class="col"><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div></div>`;
  const remote = `<div class="col"><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`;
  const { html, res, l } = mergeBodies(base, local, remote);
  assert.equal(
    html,
    `<div class="col"><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div></div>`,
  );
  // provenance: the merged card comes from the local card (node identity for apply)
  const outCard = res.doc.querySelectorAll(".card")[2];
  assert.equal(
    res.provenance.get(outCard).local,
    l.querySelectorAll(".card")[2],
  );
});

test("S4 both append to the same list", () => {
  const { html } = mergeBodies(
    `<ul><li>Apples</li><li>Bananas</li></ul>`,
    `<ul><li>Apples</li><li>Bananas</li><li>Dates</li></ul>`,
    `<ul><li>Apples</li><li>Bananas</li><li>Elderberries</li></ul>`,
  );
  assert.equal(
    html,
    `<ul><li>Apples</li><li>Bananas</li><li>Dates</li><li>Elderberries</li></ul>`,
  );
});

test("S5 attribute edits on different elements", () => {
  const { html } = mergeBodies(
    `<section class="hero"><h1>Hi</h1></section>`,
    `<section class="hero"><h1 style="color:red">Hi</h1></section>`,
    `<section class="hero compact"><h1>Hi</h1></section>`,
  );
  assert.equal(
    html,
    `<section class="hero compact"><h1 style="color:red">Hi</h1></section>`,
  );
});

test("S6 different attributes on the same element", () => {
  const { html } = mergeBodies(
    `<div class="box" data-x="1">t</div>`,
    `<div class="box open" data-x="1">t</div>`,
    `<div class="box" data-x="2">t</div>`,
  );
  assert.equal(html, `<div class="box open" data-x="2">t</div>`);
});

test("S7 remote deletes the paragraph local is editing and adds another", () => {
  const { html, res } = mergeBodies(
    `<article><p>One</p><p>Two</p><p>Three</p></article>`,
    `<article><p>One</p><p>Two, edited locally</p><p>Three</p></article>`,
    `<article><p>One</p><p>Three</p><p>Four</p></article>`,
  );
  assert.equal(
    html,
    `<article><p>One</p><p>Two, edited locally</p><p>Three</p><p>Four</p></article>`,
  );
  assert.equal(kinds(res, "edit-beats-delete").length, 1);
});

test("S10 remote deletes an untouched paragraph while local edits another", () => {
  const { html } = mergeBodies(
    `<article><p>One</p><p>Two</p></article>`,
    `<article><p>One!</p><p>Two</p></article>`,
    `<article><p>One</p></article>`,
  );
  assert.equal(html, `<article><p>One!</p></article>`);
});

test("T-M1 both insert the same element: one copy", () => {
  const { html } = mergeBodies(
    `<ul><li>a</li></ul>`,
    `<ul><li>a</li><li>b</li></ul>`,
    `<ul><li>a</li><li>b</li></ul>`,
  );
  assert.equal(html, `<ul><li>a</li><li>b</li></ul>`);
});

test("T-M2 both reorder differently: remote order, conflict", () => {
  const { html, res } = mergeBodies(
    `<ul><li>a</li><li>b</li><li>c</li></ul>`,
    `<ul><li>b</li><li>a</li><li>c</li></ul>`,
    `<ul><li>c</li><li>a</li><li>b</li></ul>`,
  );
  assert.equal(html, `<ul><li>c</li><li>a</li><li>b</li></ul>`);
  assert.equal(kinds(res, "both-reordered").length, 1);
});

test("T-M3 class tokens merge", () => {
  const { html } = mergeBodies(
    `<div class="a">x</div>`,
    `<div class="a b">x</div>`,
    `<div class="a c">x</div>`,
  );
  assert.equal(html, `<div class="a b c">x</div>`);
  const removed = mergeBodies(
    `<div class="a b">x</div>`,
    `<div class="b">x</div>`,
    `<div class="a b c">x</div>`,
  );
  assert.equal(removed.html, `<div class="b c">x</div>`);
});

test("T-M4 style declarations merge", () => {
  const { html } = mergeBodies(
    `<div style="color: red">x</div>`,
    `<div style="color: red; margin: 0">x</div>`,
    `<div style="color: blue">x</div>`,
  );
  assert.equal(html, `<div style="color: blue; margin: 0">x</div>`);
});

test("T-M5 remote deletes a container local moved content into", () => {
  const base = `<div class="a"><p>keep me</p></div><div class="b"></div>`;
  const local = `<div class="a"></div><div class="b"><p>keep me</p></div>`;
  const remote = `<div class="a"><p>keep me</p></div>`;
  const { html, res } = mergeBodies(base, local, remote);
  assert.equal(
    html,
    `<div class="a"></div><div class="b"><p>keep me</p></div>`,
  );
  assert.ok(kinds(res, "edit-beats-delete").length >= 1);
});

test("T-M6 ignored regions: local kept verbatim (absent from output), remote dropped", () => {
  const ignore = (el) => el.hasAttribute("no-save");
  const { html } = mergeBodies(
    `<div><p>a</p></div>`,
    `<div><aside no-save>chrome</aside><p>a</p></div>`,
    `<div><p>a</p><aside no-save>remote chrome</aside></div>`,
    { ignore },
  );
  assert.equal(html, `<div><p>a</p></div>`);
});

test("T-M7 JSON merge script three-way; executable script whole-value", () => {
  const base = `<script type="application/json" merge="s">{"a":1,"b":2}</script><script>f(1)</script>`;
  const local = `<script type="application/json" merge="s">{"a":1,"b":2,"c":3}</script><script>f(2)</script>`;
  const remote = `<script type="application/json" merge="s">{"a":9,"b":2}</script><script>f(3)</script>`;
  const { res } = mergeBodies(base, local, remote);
  const scripts = res.doc.querySelectorAll("script");
  assert.deepEqual(JSON.parse(scripts[0].textContent), { a: 9, b: 2, c: 3 });
  assert.ok(res.mergedScripts.has(scripts[0]));
  assert.equal(scripts[1].textContent, "f(3)");
  assert.equal(kinds(res, "text").length, 1);
});

test("T-M8 head: title change is a text change; stylesheet replaced; duplicate preloads kept", () => {
  const { head, res } = mergeBodies("", "", "", {
    baseHead: `<meta charset="utf-8"><title>a</title><link rel="stylesheet" href="/x.css"><link rel="preload" href="/f.woff"><link rel="preload" href="/f.woff">`,
    localHead: `<meta charset="utf-8"><title>a local</title><link rel="stylesheet" href="/x.css"><link rel="preload" href="/f.woff"><link rel="preload" href="/f.woff">`,
    remoteHead: `<meta charset="utf-8"><title>a</title><link rel="stylesheet" href="/y.css"><link rel="preload" href="/f.woff"><link rel="preload" href="/f.woff">`,
  });
  assert.equal(
    head,
    `<meta charset="utf-8"><title>a local</title><link rel="stylesheet" href="/y.css"><link rel="preload" href="/f.woff"><link rel="preload" href="/f.woff">`,
  );
  const title = res.doc.querySelector("title");
  assert.ok(res.provenance.get(title).local);
});

test("T-M9 provenance covers every output node", () => {
  const { res } = mergeBodies(
    `<div><p>a<b>b</b></p></div>`,
    `<div><p>a<b>b</b></p><p>new</p></div>`,
    `<div><p>a!<b>b</b></p></div>`,
  );
  const walk = (n) => {
    for (const c of n.childNodes) {
      assert.ok(res.provenance.has(c), c.nodeName);
      walk(c);
    }
  };
  walk(res.doc.body);
});

test("T-M10 base = null (local is base) equals a two-way morph", () => {
  const { html, res } = mergeBodies(
    `<p>old</p><p>x</p>`,
    `<p>old</p><p>x</p>`,
    `<p>new</p>`,
    { localIsBase: true },
  );
  assert.equal(html, `<p>new</p>`);
  assert.equal(res.localDiverged, false);
});

test("T-M11 an insertion anchored on a sibling the other side deleted survives", () => {
  const { html } = mergeBodies(
    `<ul><li>A</li><li>B</li></ul>`,
    `<ul><li>A</li><li>B</li><li>N</li></ul>`,
    `<ul><li>A</li></ul>`,
  );
  assert.equal(html, `<ul><li>A</li><li>N</li></ul>`);
});

test("T-M12 mutual moves terminate with a conflict", () => {
  const base = `<div id="a"><p>a</p></div><div id="b"><p>b</p></div>`;
  const local = `<div id="b"><p>b</p><div id="a"><p>a</p></div></div>`;
  const remote = `<div id="a"><p>a</p><div id="b"><p>b</p></div></div>`;
  const { html, res } = mergeBodies(base, local, remote);
  assert.ok(html.includes('id="a"'), html);
  assert.ok(html.includes('id="b"'), html);
  assert.ok(kinds(res, "both-moved").length >= 1);
});

test("T-M13 echoed insertion pairs by identity and keeps later local typing", () => {
  const idOf = (el) => el.getAttribute("data-id");
  const { html } = mergeBodies(
    `<ul><li data-id="1">a</li></ul>`,
    `<ul><li data-id="1">a</li><li data-id="2">new paragraph typed more</li></ul>`,
    `<ul><li data-id="1">a</li><li data-id="2">new paragraph</li></ul>`,
    { idOf },
  );
  assert.equal(
    html,
    `<ul><li data-id="1">a</li><li data-id="2">new paragraph typed more</li></ul>`,
  );
});

test("T-M14 remoteWins region takes remote and ignores local edits", () => {
  const remoteWins = (el) => el.hasAttribute("no-dirty");
  const { html, res } = mergeBodies(
    `<div no-dirty><h4>Filters</h4><p>a</p></div>`,
    `<div no-dirty><h4>Filters</h4><p>local</p></div>`,
    `<div no-dirty><h4>Filters</h4><p>remote</p></div>`,
    { remoteWins },
  );
  assert.equal(html, `<div no-dirty=""><h4>Filters</h4><p>remote</p></div>`);
  assert.equal(res.localDiverged, false);
});

test("T-M15 ignoreAttribute names never appear in decisions", () => {
  const { html, res } = mergeBodies(
    `<div savestatus="saved">x</div>`,
    `<div savestatus="saving">x</div>`,
    `<div>x</div>`,
    { ignoreAttribute: (el, n) => n === "savestatus" },
  );
  assert.equal(html, `<div>x</div>`);
  assert.equal(res.decisions.length, 0);
  assert.equal(res.localDiverged, false);
});

test("T-M16 localDiverged per decision kind", () => {
  assert.equal(
    mergeBodies(`<p>a</p>`, `<p>a</p>`, `<p>b</p>`).res.localDiverged,
    false,
  );
  assert.equal(
    mergeBodies(`<p>a</p>`, `<p>b</p>`, `<p>a</p>`).res.localDiverged,
    true,
  ); // text
  assert.equal(
    mergeBodies(`<p>a</p>`, `<p class="x">a</p>`, `<p>a</p>`).res.localDiverged,
    true,
  ); // attr
  assert.equal(
    mergeBodies(`<p>a</p>`, `<p>a</p><p>b</p>`, `<p>a</p>`).res.localDiverged,
    true,
  ); // insert
  assert.equal(
    mergeBodies(`<p>a</p><p>b</p>`, `<p>a</p>`, `<p>a</p><p>b</p>`).res
      .localDiverged,
    true,
  ); // remove
});

test("text insert collision at the same anchor", () => {
  const { html, res } = mergeBodies(`<p></p>`, `<p>abc</p>`, `<p>xyz</p>`);
  assert.equal(html, `<p>xyz</p>`);
  assert.equal(kinds(res, "insert-collision").length, 1);
});

test("text run split on the local side merges as one run", () => {
  const { l, res } = (() => {
    const r = mergeBodies(
      `<p>Hello world</p>`,
      `<p>Hello world</p>`,
      `<p>Hello there world</p>`,
    );
    return r;
  })();
  assert.equal(res.doc.body.innerHTML, `<p>Hello there world</p>`);
});
