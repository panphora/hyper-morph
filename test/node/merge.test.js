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

test("both sides made the same text edit: the result is the remote, not diverged", () => {
  const { html, res } = mergeBodies(`<p>a0</p>`, `<p>a1</p>`, `<p>a1</p>`);
  assert.equal(html, `<p>a1</p>`);
  assert.equal(res.localDiverged, false);
});

test("a both-sides conflict the remote won is not diverged; one local kept is", () => {
  const same = mergeBodies(
    `<p>the lazy dog</p>`,
    `<p>the LAZY dog</p>`,
    `<p>the sleepy dog</p>`,
  );
  assert.equal(same.html, `<p>the sleepy dog</p>`);
  assert.equal(same.res.localDiverged, false);

  const attr = mergeBodies(
    `<p title="a">x</p>`,
    `<p title="b">x</p>`,
    `<p title="c">x</p>`,
  );
  assert.equal(attr.html, `<p title="c">x</p>`);
  assert.equal(attr.res.localDiverged, false);

  const kept = mergeBodies(
    `<p>one two</p>`,
    `<p>ONE two</p>`,
    `<p>one TWO</p>`,
  );
  assert.equal(kept.html, `<p>ONE TWO</p>`);
  assert.equal(kept.res.localDiverged, true);
});

// Inline defect table (CHARMERGE, seat A section 4.2 and seat B section 3.1):
// the rows the per-run text merge got wrong. Each row merges through merge3
// and pins the block-level inline merge.
const FOX = "The quick brown fox jumps over the lazy dog.";
const P = (s) => `<p>${s}</p>`;
const BOLD = P("The <b>quick</b> brown fox jumps over the lazy dog.");
const inlineRows = [
  [
    "I1 local bolds, remote edits the same paragraph",
    P(FOX),
    BOLD,
    P("The quick brown fox jumps over the sleepy dog."),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
    0,
  ],
  [
    "I2 local links, remote edits",
    P("See the docs for details."),
    P('See the <a href="/d">docs</a> for details.'),
    P("See the docs for more details."),
    P('See the <a href="/d">docs</a> for more details.'),
    0,
  ],
  [
    "I3 both format different words",
    P(FOX),
    BOLD,
    P("The quick brown fox jumps over the <i>lazy</i> dog."),
    P("The <b>quick</b> brown fox jumps over the <i>lazy</i> dog."),
    0,
  ],
  [
    "I4 both wrap the same word with different tags",
    P(FOX),
    BOLD,
    P("The <i>quick</i> brown fox jumps over the lazy dog."),
    P("The <b><i>quick</i></b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "I5 local unbolds, remote edits elsewhere",
    BOLD,
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    0,
  ],
  [
    "I6 local unbolds, remote edits the bold word",
    BOLD,
    P(FOX),
    P("The <b>fast</b> brown fox jumps over the lazy dog."),
    P("The fast brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "I7 local extends the bold over a word remote edits",
    P("The <b>quick</b> brown fox"),
    P("The <b>quick brown</b> fox"),
    P("The <b>quick</b> red fox"),
    P("The <b>quick red</b> fox"),
    0,
  ],
  [
    "I8 local splits with a br, remote edits",
    P(FOX),
    P("The quick brown fox<br>jumps over the lazy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    P("The quick brown fox<br>jumps over the sleepy dog."),
    0,
  ],
  [
    "I9 span litter wrap vs edit inside",
    P(FOX),
    P(
      'The <span style="color: red;">quick brown</span> fox jumps over the lazy dog.',
    ),
    P("The quick red fox jumps over the lazy dog."),
    P(
      'The <span style="color: red;">quick red</span> fox jumps over the lazy dog.',
    ),
    0,
  ],
  [
    "I10 local deletes the bold word and its tags, remote edits it",
    P("The <b>quick</b> brown fox"),
    P("The brown fox"),
    P("The <b>fast</b> brown fox"),
    P("The <b>fast</b> brown fox"),
    1,
  ],
  [
    "I11 remote rewrites the paragraph, local bolds a word",
    P(FOX),
    BOLD,
    P("Something else entirely."),
    P("Something <b>else</b> entirely."),
    0,
  ],
  [
    "I12 remote deletes the paragraph text, local bolds",
    P(FOX),
    BOLD,
    P(""),
    P(""),
    1,
  ],
  [
    "I13 local wraps, remote wraps a superset",
    P(FOX),
    BOLD,
    P("The <i>quick brown</i> fox jumps over the lazy dog."),
    P("The <i><b>quick</b> brown</i> fox jumps over the lazy dog."),
    0,
  ],
  [
    "I14 local bolds a phrase, remote edits inside it",
    P(FOX),
    P("The <b>quick brown fox</b> jumps over the lazy dog."),
    P("The quick red fox jumps over the lazy dog."),
    P("The <b>quick red fox</b> jumps over the lazy dog."),
    0,
  ],
  [
    "I15 remote bolds, local prepends",
    P(FOX),
    P("Note: " + FOX),
    BOLD,
    P("Note: The <b>quick</b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "I16 both edit inside different inline elements",
    P("<b>one</b> and <i>two</i>"),
    P("<b>ONE</b> and <i>two</i>"),
    P("<b>one</b> and <i>TWO</i>"),
    P("<b>ONE</b> and <i>TWO</i>"),
    0,
  ],
];

for (const [name, base, local, remote, want, count] of inlineRows)
  test(name, () => {
    const { html, res } = mergeBodies(base, local, remote);
    assert.equal(html, want);
    assert.equal(res.conflicts.length, count, JSON.stringify(res.conflicts));
  });

test("I-C a block-level text conflict names the block and its merged range", () => {
  const { res } = mergeBodies(
    P("the lazy dog"),
    P("the <b>LAZY</b> dog"),
    P("the sleepy dog"),
  );
  assert.equal(res.conflicts.length, 1);
  const c = res.conflicts[0];
  assert.equal(c.kind, "text");
  assert.equal(c.node, res.doc.querySelector("p"));
  assert.deepEqual(
    [c.base, c.local, c.remote, c.resolved, c.range],
    ["lazy", "<b>LAZY</b>", "sleepy", "sleepy", [4, 10]],
  );
  assert.equal(res.localDiverged, false);
});

test("I-D localDiverged is the canonical comparison with remote", () => {
  const bold = mergeBodies(
    P(FOX),
    BOLD,
    P("The quick brown fox jumps over the sleepy dog."),
  );
  assert.equal(bold.res.localDiverged, true);
  const same = mergeBodies(P(FOX), BOLD, BOLD);
  assert.equal(same.res.localDiverged, false);
  const local = mergeBodies(
    P("the lazy dog"),
    P("the <b>LAZY</b> dog"),
    P("the sleepy dog"),
    { conflicts: "local" },
  );
  assert.equal(local.html, P("the <b>LAZY</b> dog"));
  assert.equal(local.res.localDiverged, true);
});

test("I-E provenance covers every node of a merged segment and marks reuse local elements", () => {
  const { res, l } = mergeBodies(
    `<div><p>Read <b>the <i>fine</i> print</b> now</p></div>`,
    `<div><p>Read <b>the <i>fine</i> print</b> now!</p></div>`,
    `<div><p>Read <a href="/p"><b>the <i>fine</i> print</b></a> now</p></div>`,
  );
  assert.equal(
    res.doc.body.innerHTML,
    `<div><p>Read <a href="/p"><b>the <i>fine</i> print</b></a> now!</p></div>`,
  );
  const walk = (n) => {
    for (const c of n.childNodes) {
      assert.ok(res.provenance.has(c), c.nodeName);
      walk(c);
    }
  };
  walk(res.doc.body);
  assert.equal(
    res.provenance.get(res.doc.querySelector("b")).local,
    l.querySelector("b"),
  );
  assert.equal(
    res.provenance.get(res.doc.querySelector("i")).local,
    l.querySelector("i"),
  );
  const text = res.doc.querySelector("p").lastChild;
  assert.deepEqual(res.provenance.get(text).local, [
    l.querySelector("p").lastChild,
  ]);
  assert.equal(res.textMappers.get(text)(2), 2);
});

test("I-F segments pair by anchor in a mixed container", () => {
  const { html, res } = mergeBodies(
    `<div>intro <b>x</b> here<p>para</p>tail text</div>`,
    `<div>intro <b>x</b> here!<p>para</p><h2>New</h2>tail text</div>`,
    `<div>intro <b>X</b> here<p>para</p>tail TEXT</div>`,
  );
  assert.equal(
    html,
    `<div>intro <b>X</b> here!<p>para</p><h2>New</h2>tail TEXT</div>`,
  );
  assert.equal(res.conflicts.length, 0);
});

test("I-G a mark moved to another block keeps the per-unit path", () => {
  const { html, res } = mergeBodies(
    `<div><p id="a">one <b>two</b> three</p><p id="b">four</p></div>`,
    `<div><p id="a">one three</p><p id="b">four <b>two</b></p></div>`,
    `<div><p id="a">one <b>two</b> three!</p><p id="b">four</p></div>`,
  );
  assert.ok(html.includes("<b>two</b>"), html);
  assert.equal((html.match(/two/g) || []).length, 1, html);
  assert.ok(
    res.decisions.some((d) => d.kind === "move"),
    JSON.stringify(res.decisions),
  );
});

test("I-H two-way mode takes remote's inline content whole", () => {
  const { html, res } = mergeBodies(
    P("a <b>b</b> c"),
    P("a <b>b</b> c"),
    P("a <i>b</i> c!"),
    { localIsBase: true },
  );
  assert.equal(html, P("a <i>b</i> c!"));
  assert.equal(res.localDiverged, false);
});

test("I-I a remoteWins block takes remote's inline content and ignores local formatting", () => {
  const remoteWins = (el) => el.hasAttribute("no-dirty");
  const { html, res } = mergeBodies(
    `<div no-dirty><p>a b c</p></div>`,
    `<div no-dirty><p>a <b>b</b> c</p></div>`,
    `<div no-dirty><p>a b c!</p></div>`,
    { remoteWins },
  );
  assert.equal(html, `<div no-dirty=""><p>a b c!</p></div>`);
  assert.equal(res.localDiverged, false);
});

test("I-J an ignored element inside a segment stays out of the output", () => {
  const ignore = (el) => el.hasAttribute("no-save");
  const { html } = mergeBodies(
    P("a b"),
    P("a <span no-save>x</span>b"),
    P("a <b>b</b>"),
    { ignore },
  );
  assert.equal(html, P("a <b>b</b>"));
});

test("I-K an unchanged segment beside a changed block never runs the inline merge", () => {
  const { html, res } = mergeBodies(
    `<div>keep <b>this</b><p>a</p></div>`,
    `<div>keep <b>this</b><p>a local</p></div>`,
    `<div>keep <b>this</b><p>a</p></div>`,
  );
  assert.equal(html, `<div>keep <b>this</b><p>a local</p></div>`);
  assert.deepEqual(
    res.decisions.map((d) => d.kind + ":" + d.source),
    ["text:local"],
  );
});

test("I-L a two-way morph keeps swapped images by identity", () => {
  const { res, b } = mergeBodies(
    `<div><img src="a.png"><img src="b.png"></div>`,
    `<div><img src="a.png"><img src="b.png"></div>`,
    `<div><img src="b.png"><img src="a.png"></div>`,
    { localIsBase: true },
  );
  const imgs = res.doc.querySelectorAll("img");
  assert.equal(
    res.doc.body.innerHTML,
    `<div><img src="b.png"><img src="a.png"></div>`,
  );
  assert.equal(res.provenance.get(imgs[0]).local, b.querySelectorAll("img")[1]);
  assert.equal(res.provenance.get(imgs[1]).local, b.querySelectorAll("img")[0]);
});

test("I-M a dropped mark's text is not claimed by the text that replaced it", () => {
  const { res, l } = mergeBodies(
    `<div><a>A</a><b>B</b><c>C</c></div>`,
    `<div><a>A</a><b>B</b><c>C</c></div>`,
    `<div><b>B</b></div>`,
    { localIsBase: true },
  );
  assert.equal(res.doc.body.innerHTML, `<div><b>B</b></div>`);
  const t = res.doc.querySelector("b").firstChild;
  assert.deepEqual(res.provenance.get(t).local, [
    l.querySelector("b").firstChild,
  ]);
});

test("identity `first` outranks the map, so an authored id pairs a moved element", async () => {
  const { JSDOM } = await import("jsdom");
  const { mergeDocument } = await import("../../src/index.js");
  const page = (b) =>
    `<!DOCTYPE html><html><head></head><body>${b}</body></html>`;
  const card = (t, body) =>
    `<div data-id="c2"><h3>${t}</h3><p>${body}</p></div>`;
  const authored = (el) =>
    el.getAttribute("data-id") || el.getAttribute("id") || null;
  const live = new JSDOM(
    page(
      `<div id="A">${card("two (local)", "alpha beta gamma delta")}</div><div id="B"></div>`,
    ),
  ).window.document;
  const report = await mergeDocument({
    live,
    base: page(
      `<div id="A">${card("two", "alpha beta gamma delta")}</div><div id="B"></div>`,
    ),
    remote: page(
      `<div id="A"></div><div id="B">${card("two", "completely rewritten by the agent now")}</div>`,
    ),
    identity: {
      // A synthetic map names the card in base, as a tab's last frame would.
      base: { map: { "1.0.0": "syn:1" }, first: authored, then: authored },
      local: authored,
      remote: authored,
    },
    scripts: { execute: false },
  });
  assert.equal(
    live.body.innerHTML,
    `<div id="A"></div><div id="B">${card("two (local)", "completely rewritten by the agent now")}</div>`,
  );
  assert.equal(report.conflicts.length, 0);
});

test("H6 a literal U+FFFC in text is text, not an atom", () => {
  const O = "￼";
  const a = mergeBodies(
    `<p>see ${O} here now</p>`,
    `<p>see ${O} here now</p>`,
    `<p>see ${O} here later</p>`,
  );
  assert.equal(a.html, `<p>see ${O} here later</p>`);
  assert.equal(a.res.conflicts.length, 0);
  const b = mergeBodies(
    `<p>see ${O} here now</p>`,
    `<p>please see ${O} here now</p>`,
    `<p>see ${O} here later</p>`,
  );
  assert.equal(b.html, `<p>please see ${O} here later</p>`);
  assert.equal(b.res.conflicts.length, 0);
  const c = mergeBodies(
    `<p>a ${O} b<br>c</p>`,
    `<p>a ${O} b<br>c!</p>`,
    `<p>a ${O} B<br>c</p>`,
  );
  assert.equal(c.html, `<p>a ${O} B<br>c!</p>`);
  assert.equal(c.res.conflicts.length, 0);
});

test("H17 a run that merges to nothing still records its conflict", () => {
  const { html, res } = mergeBodies(
    `<div>hello world<p>X</p></div>`,
    `<div><p>new</p>hello big world<p>X</p></div>`,
    `<div><p>X</p></div>`,
  );
  assert.equal(html, `<div><p>new</p><p>X</p></div>`);
  const text = res.conflicts.filter((c) => c.kind === "text");
  assert.equal(text.length, 1);
  assert.equal(text[0].local, "hello big world");
  assert.equal(text[0].remote, "");
  assert.equal(text[0].node, null);
  assert.ok(
    res.decisions.some((d) => d.kind === "text" && d.source === "both"),
  );
  assert.equal(res.localDiverged, true);
  const local = mergeBodies(
    `<div>hello world<p>X</p></div>`,
    `<div><p>new</p>hello big world<p>X</p></div>`,
    `<div><p>X</p></div>`,
    { conflicts: "local" },
  );
  assert.equal(local.html, `<div><p>new</p>hello big world<p>X</p></div>`);
});
