import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeInline,
  flatten,
  flatSig,
  isInlineUnit,
} from "../../src/inline-merge.js";
import { MAX_TOKENS } from "../../src/text-merge.js";
import { parse, doc } from "./lib/dom.js";
import { block, mergeBlocks, mergeSegment } from "./lib/inline.js";

const FOX = "The quick brown fox jumps over the lazy dog.";
const P = (s) => `<p>${s}</p>`;
const kinds = (x, kind) =>
  x.decisions.filter((d) => d.kind === kind).map((d) => d.source);

// [name, base, local, remote, merged html, conflict count, policy]
// Expected values come from running this module and were checked against
// both prototypes; the rows marked (rule) differ from seat B's prototype
// because its whitespace coalescing and any-touch conflict rule are gone.
const cases = [
  // CONTEXT cases (seat B C1..C7, S1, S1b)
  [
    "C1 local bolds, remote edits the same paragraph",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
    0,
  ],
  [
    "C2 local links, remote edits",
    P("See the docs for details."),
    P('See the <a href="/d">docs</a> for details.'),
    P("See the docs for more details."),
    P('See the <a href="/d">docs</a> for more details.'),
    0,
  ],
  ["C3 same word", P("cat"), P("cut"), P("cap"), P("cap"), 1],
  [
    "C4 same word, longer",
    P("the colr is red"),
    P("the color is red"),
    P("the colour is red"),
    P("the colour is red"),
    1,
  ],
  [
    "C5 rewrite and typo inside it",
    P("The meeting is on Monday at noon."),
    P("The meeting is on Tuesday at noon."),
    P("The meeting is on Mondy at noon."),
    P("The meeting is on Mondy at noon."),
    1,
  ],
  [
    "C6 insertion at the edge of a rewrite",
    P("We will ship it soon."),
    P("We plan to release it next week."),
    P("We will ship it very soon."),
    P("We plan to release it very soon."),
    1,
  ],
  [
    "C7 remote bolds, local edits (mirror)",
    P(FOX),
    P("Note: " + FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("Note: The <b>quick</b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "S1 different places",
    P(FOX),
    P("Note: " + FOX),
    P(FOX.replace("lazy", "sleepy")),
    P("Note: The quick brown fox jumps over the sleepy dog."),
    0,
  ],
  [
    "S1b same word",
    P("the lazy dog"),
    P("the LAZY dog"),
    P("the sleepy dog"),
    P("the sleepy dog"),
    1,
  ],
  // Adversarial (seat B A1..A34)
  [
    "A1 both bold the same word (echo)",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "A2 local bolds, remote italicizes the same word",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The <i>quick</i> brown fox jumps over the lazy dog."),
    P("The <b><i>quick</i></b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "A3 local bolds a phrase, remote edits inside it",
    P(FOX),
    P("The <b>quick brown fox</b> jumps over the lazy dog."),
    P("The quick red fox jumps over the lazy dog."),
    P("The <b>quick red fox</b> jumps over the lazy dog."),
    0,
  ],
  [
    "A4 local bolds a phrase, remote rewrites across its edge",
    P(FOX),
    P("The <b>quick brown</b> fox jumps over the lazy dog."),
    P("The quick brown-ish hound jumps over the lazy dog."),
    P("The <b>quick brown</b>-ish hound jumps over the lazy dog."),
    0,
  ],
  [
    "A5 local unbolds, remote edits inside the bold",
    P("The <b>quick brown</b> fox."),
    P("The quick brown fox."),
    P("The <b>quick red</b> fox."),
    P("The quick red fox."),
    0,
  ],
  [
    "A6 local changes href, remote edits the link text",
    P('See <a href="/old">the docs</a> now.'),
    P('See <a href="/new">the docs</a> now.'),
    P('See <a href="/old">the manual</a> now.'),
    P('See <a href="/new">the manual</a> now.'),
    0,
  ],
  [
    "A7 both change href differently",
    P('See <a href="/old">docs</a>.'),
    P('See <a href="/a">docs</a>.'),
    P('See <a href="/b">docs</a>.'),
    P('See <a href="/b">docs</a>.'),
    1,
  ],
  [
    "A9 remote deletes the bolded word, local edits elsewhere",
    P("The <b>quick</b> brown fox."),
    P("The <b>quick</b> brown hound."),
    P("The brown fox."),
    P("The brown hound."),
    0,
  ],
  [
    "A10 remote deletes the word local bolded",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The brown fox jumps over the lazy dog."),
    P("The brown fox jumps over the lazy dog."),
    1,
  ],
  [
    "A11 local types at the end, remote edits the start",
    P("Hello world"),
    P("Hello world and more"),
    P("Hi world"),
    P("Hi world and more"),
    0,
  ],
  [
    "A12 both append at the same point: local first (rule)",
    P("Hi"),
    P("Hi there"),
    P("Hi friend"),
    P("Hi there friend"),
    0,
  ],
  [
    "A13 lone br placeholder vs typing",
    P("<br>"),
    P("hello"),
    P("<br>"),
    P("hello"),
    0,
  ],
  [
    "A14 both type into the same empty paragraph",
    P("<br>"),
    P("hello"),
    P("world"),
    P("world"),
    1,
  ],
  [
    "A15 empty base, local gets a browser br, remote types",
    P(""),
    P("<br>"),
    P("hi"),
    P("hi"),
    0,
  ],
  [
    "A16 nbsp artifact vs remote edit",
    P("foo bar"),
    P("foo&nbsp;bar"),
    P("foo bar!"),
    P("foo&nbsp;bar!"),
    0,
  ],
  [
    "A17 br inserted by local, remote edits the line",
    P("line one line two"),
    P("line one<br>line two"),
    P("line one line three"),
    P("line one<br>line three"),
    0,
  ],
  [
    "A18 img inside a link: remote changes alt, local changes href",
    P('<a href="/x"><img src="a.png" alt="old"></a>'),
    P('<a href="/y"><img src="a.png" alt="old"></a>'),
    P('<a href="/x"><img src="a.png" alt="new"></a>'),
    P('<a href="/y"><img src="a.png" alt="new"></a>'),
    0,
  ],
  [
    "A19 nested marks, remote adds an outer link",
    P("Read <b>the <i>fine</i> print</b> now"),
    P("Read <b>the <i>fine</i> print</b> now!"),
    P('Read <a href="/p"><b>the <i>fine</i> print</b></a> now'),
    P('Read <a href="/p"><b>the <i>fine</i> print</b></a> now!'),
    0,
  ],
  [
    "A20 CJK: separate edits in one sentence",
    P("我们今天去公园散步。"),
    P("我们明天去公园散步。"),
    P("我们今天去公园跑步。"),
    P("我们明天去公园跑步。"),
    0,
  ],
  [
    "A21 CJK: same word",
    P("我们今天去公园散步。"),
    P("我们明天去公园散步。"),
    P("我们昨天去公园散步。"),
    P("我们昨天去公园散步。"),
    1,
  ],
  [
    "A22 emoji and combining marks",
    P("café 😀 ok"),
    P("café 😀 ok!"),
    P("cafés 😀 ok"),
    P("cafés 😀 ok!"),
    0,
  ],
  [
    "A23 local wraps the whole text in a litter span, remote edits",
    P("Hello world"),
    P('<span style="font-weight:normal">Hello world</span>'),
    P("Hello there world"),
    P('<span style="font-weight:normal">Hello there world</span>'),
    0,
  ],
  [
    "A24 remote rewrites the paragraph, local bolds a word inside it: conflict (rule)",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("A completely different sentence."),
    P("A completely different sentence."),
    1,
  ],
  [
    "A26 policy local on C1",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
    0,
    "local",
  ],
  [
    "A27 same-word conflict, policy local",
    P("the lazy dog"),
    P("the LAZY dog"),
    P("the sleepy dog"),
    P("the LAZY dog"),
    1,
    "local",
  ],
  [
    "A28 same-word conflict, policy both",
    P("the lazy dog"),
    P("the LAZY dog"),
    P("the sleepy dog"),
    P("the LAZYsleepy dog"),
    1,
    "both",
  ],
  [
    "A29 local deletes everything, remote edits",
    P("hello world"),
    P(""),
    P("hello there"),
    P("hello there"),
    1,
  ],
  [
    "A30 code block: separate lines",
    "<pre>a = 1\nb = 2\nc = 3</pre>",
    "<pre>a = 10\nb = 2\nc = 3</pre>",
    "<pre>a = 1\nb = 2\nc = 30</pre>",
    "<pre>a = 10\nb = 2\nc = 30</pre>",
    0,
  ],
  [
    "A31 remote unbolds, local types inside the bold",
    P("The <b>quick brown</b> fox."),
    P("The <b>quick brown furry</b> fox."),
    P("The quick brown fox."),
    P("The quick brown<b> furry</b> fox."),
    0,
  ],
  [
    "A32 local bolds two words, remote inserts between them",
    P("one two three"),
    P("<b>one</b> two <b>three</b>"),
    P("one two and a half three"),
    P("<b>one</b> two and a half <b>three</b>"),
    0,
  ],
  [
    "A33 insertion at the left edge of a new bold",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The very quick brown fox jumps over the lazy dog."),
    P("The very <b>quick</b> brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "A34 punctuation-only edit next to a rewrite",
    P("Hello world"),
    P("Hello, world"),
    P("Hello planet"),
    P("Hello, planet"),
    0,
  ],
  // Extra (seat B E2..E15)
  [
    "E2 img deleted by local, alt edited by remote",
    P('x <img src="a" alt="1"> y'),
    P("x y"),
    P('x <img src="a" alt="2"> y'),
    P('x <img src="a" alt="2"> y'),
    1,
  ],
  [
    "E3 two brs, one removed by each side",
    P("a<br>b<br>c"),
    P("a b<br>c"),
    P("a<br>b c"),
    P("a b c"),
    0,
  ],
  [
    "E4 policy both keeps the formatting of both versions",
    P("the lazy dog"),
    P("the <b>LAZY</b> dog"),
    P("the <i>sleepy</i> dog"),
    P("the <b>LAZY</b><i>sleepy</i> dog"),
    1,
    "both",
  ],
  [
    "E5 local moves the bold to a different word",
    P("The <b>quick</b> brown fox"),
    P("The quick <b>brown</b> fox"),
    P("The <b>quick</b> brown fox!"),
    P("The quick <b>brown</b> fox!"),
    0,
  ],
  [
    "E6 both wrap the same word in links with different hrefs",
    P("See docs now"),
    P('See <a href="/a">docs</a> now'),
    P('See <a href="/b">docs</a> now'),
    P('See <a href="/b">docs</a> now'),
    1,
  ],
  [
    "E7 remote deletes the paragraph text, local formats it",
    P("Hello world"),
    P("<b>Hello world</b>"),
    P(""),
    P(""),
    1,
  ],
  [
    "E8 zero-width space litter vs remote insertion: both land (rule)",
    P("Hello"),
    P("Hello​"),
    P("Hello world"),
    P("Hello​ world"),
    0,
  ],
  [
    "E9 long word replaced vs suffix typed (same token)",
    P("internationalization matters"),
    P("i18n matters"),
    P("internationalizations matters"),
    P("internationalizations matters"),
    1,
  ],
  [
    "E10 sentence rewrite with a shared word",
    P("I like cats."),
    P("I like dogs."),
    P("I really like cats."),
    P("I really like dogs."),
    0,
  ],
  [
    "E11 typing mid-word while remote edits a later word",
    P("The quic brown fox"),
    P("The quick brown fox"),
    P("The quic brown hound"),
    P("The quick brown hound"),
    0,
  ],
  [
    "E12 local deletes a word, remote appends after it (touching)",
    P("quick brown"),
    P("quick"),
    P("quick brown fox"),
    P("quick brown fox"),
    1,
  ],
  [
    "E13 nbsp on both sides, remote edits",
    P("a&nbsp;b"),
    P("a&nbsp;b"),
    P("a b c"),
    P("a b c"),
    0,
  ],
  [
    "E14 nested litter spans, both append punctuation: same point, both land (rule)",
    P("<span><span>x</span></span> y"),
    P("<span><span>x</span></span> y!"),
    P("<span><span>x</span></span> y?"),
    P("<span><span>x</span></span> y!?"),
    0,
  ],
  [
    "E15 empty span kept as an atom",
    P("a<span></span>b"),
    P("a<span></span>bc"),
    P("xa<span></span>b"),
    P("xa<span></span>bc"),
    0,
  ],
  // Seat A rows not covered above
  [
    "SA both format different words",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The quick brown fox jumps over the <i>lazy</i> dog."),
    P("The <b>quick</b> brown fox jumps over the <i>lazy</i> dog."),
    0,
  ],
  [
    "SA crossing marks merge as sets",
    P(FOX),
    P("The <b>quick brown</b> fox jumps over the lazy dog."),
    P("The quick <i>brown fox</i> jumps over the lazy dog."),
    P("The <b>quick <i>brown</i></b><i> fox</i> jumps over the lazy dog."),
    0,
  ],
  [
    "SA local unbolds, remote edits elsewhere",
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    0,
  ],
  [
    "SA local unbolds, remote edits the bold word",
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P(FOX),
    P("The <b>fast</b> brown fox jumps over the lazy dog."),
    P("The fast brown fox jumps over the lazy dog."),
    0,
  ],
  [
    "SA local extends the bold over a word remote edits",
    P("The <b>quick</b> brown fox"),
    P("The <b>quick brown</b> fox"),
    P("The <b>quick</b> red fox"),
    P("The <b>quick red</b> fox"),
    0,
  ],
  [
    "SA local splits with a br, remote edits",
    P(FOX),
    P("The quick brown fox<br>jumps over the lazy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
    P("The quick brown fox<br>jumps over the sleepy dog."),
    0,
  ],
  [
    "SA span litter wrap vs edit inside",
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
    "SA local deletes the bold word and its tags, remote edits it",
    P("The <b>quick</b> brown fox"),
    P("The brown fox"),
    P("The <b>fast</b> brown fox"),
    P("The <b>fast</b> brown fox"),
    1,
  ],
  [
    "SA nbsp typed at the end vs edit at the start",
    P("foo bar"),
    P("foo bar "),
    P("FOO bar"),
    P("FOO bar&nbsp;"),
    0,
  ],
  [
    "SA nested inline edit inside b i",
    P("a <b>x <i>y</i> z</b> b"),
    P("a <b>x <i>Y</i> z</b> b"),
    P("A <b>x <i>y</i> z</b> b"),
    P("A <b>x <i>Y</i> z</b> b"),
    0,
  ],
  [
    "SA local moves the bold word, remote edits inside it: a recorded conflict",
    P("<b>one</b> two three"),
    P("two <b>one</b> three"),
    P("<b>ONE</b> two three"),
    P("<b>ONE</b> two <b>one</b> three"),
    1,
  ],
  [
    "SA both edit inside different inline elements",
    P("<b>one</b> and <i>two</i>"),
    P("<b>ONE</b> and <i>two</i>"),
    P("<b>one</b> and <i>TWO</i>"),
    P("<b>ONE</b> and <i>TWO</i>"),
    0,
  ],
  [
    "SA local wraps, remote wraps a superset: the wider mark goes outside",
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The <i>quick brown</i> fox jumps over the lazy dog."),
    P("The <i><b>quick</b> brown</i> fox jumps over the lazy dog."),
    0,
  ],
  // This module's own rules
  [
    "echo pairing with inheritance: one bold, no nesting",
    P("the quick brown fox"),
    P("the <b>quick red fox</b>"),
    P("the <b>quick brown fox</b>"),
    P("the <b>quick red fox</b>"),
    0,
  ],
  [
    "remote splits local's bold: the second piece is a clone",
    P("The <b>quick brown fox</b> jumps"),
    P("The <b>quick brown fox</b> jumps!"),
    P("The <b>quick</b> brown <b>fox</b> jumps"),
    P("The <b>quick</b> brown <b>fox</b> jumps!"),
    0,
  ],
  [
    "both insert the same atom at one point: once",
    P("a b"),
    P('a <img src="x"> b'),
    P('a <img src="x"> b'),
    P('a <img src="x"> b'),
    0,
  ],
  [
    "both insert different atoms at one point: both, local first",
    P("a b"),
    P('a <img src="x"> b'),
    P('a <img src="y"> b'),
    P('a <img src="x"> <img src="y"> b'),
    0,
  ],
  [
    "br and img inserted at one point are different tokens",
    P("a b"),
    P("a<br> b"),
    P('a<img src="x"> b'),
    P('a<br><img src="x"> b'),
    0,
  ],
  [
    "touching replacements both land",
    P("the quick brown fox"),
    P("the fast brown fox"),
    P("the quick red fox"),
    P("the fast red fox"),
    0,
  ],
  [
    "two edits inside one word conflict",
    P("ab"),
    P("aXb"),
    P("aYb"),
    P("aYb"),
    1,
  ],
  [
    "insertion touching a deletion inside one word conflicts",
    P("abcd"),
    P("abXcd"),
    P("abd"),
    P("abd"),
    1,
  ],
];

for (const [name, b, l, r, want, count, policy] of cases)
  test(name, () => {
    const { html, conflicts } = mergeBlocks(b, l, r, { policy });
    assert.equal(html, want);
    assert.equal(conflicts.length, count, JSON.stringify(conflicts));
  });

test("text conflict records carry both versions as inline HTML and the merged range", () => {
  const { conflicts, node, res } = mergeBlocks(
    P("the lazy dog"),
    P("the <b>LAZY</b> dog"),
    P("the sleepy dog"),
  );
  assert.equal(conflicts.length, 1);
  const c = conflicts[0];
  assert.equal(c.kind, "text");
  assert.equal(c.node, node);
  assert.deepEqual(
    [c.base, c.local, c.remote, c.resolved],
    ["lazy", "<b>LAZY</b>", "sleepy", "sleepy"],
  );
  assert.deepEqual(c.range, [4, 10]);
  assert.equal(res.text.slice(c.range[0], c.range[1]), "sleepy");
  assert.deepEqual(
    [c.bs, c.be, c.lss, c.lse, c.rss, c.rse],
    [4, 8, 4, 8, 4, 10],
  );
});

test("attribute conflicts on a mark are attr records", () => {
  const { conflicts, node } = mergeBlocks(
    P('See <a href="/old">docs</a>.'),
    P('See <a href="/a">docs</a>.'),
    P('See <a href="/b">docs</a>.'),
  );
  assert.equal(conflicts.length, 1);
  const c = conflicts[0];
  assert.equal(c.kind, "attr");
  assert.equal(c.el, node.querySelector("a"));
  assert.deepEqual(
    [c.name, c.base, c.local, c.remote, c.resolved],
    ["href", "/old", "/a", "/b", "/b"],
  );
});

test("decisions: insert, remove, text and move", () => {
  const c1 = mergeBlocks(
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The quick brown fox jumps over the sleepy dog."),
  );
  assert.deepEqual(kinds(c1, "insert"), ["local"]);
  assert.deepEqual(kinds(c1, "text"), ["remote"]);
  assert.equal(c1.res.localDiverged, true);
  const a1 = mergeBlocks(
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
  );
  assert.deepEqual(kinds(a1, "insert"), ["both"]);
  assert.equal(a1.res.localDiverged, false);
  const a5 = mergeBlocks(
    P("The <b>quick brown</b> fox."),
    P("The quick brown fox."),
    P("The <b>quick red</b> fox."),
  );
  assert.deepEqual(kinds(a5, "remove"), ["local"]);
  assert.deepEqual(kinds(a5, "text"), ["remote"]);
  const a10 = mergeBlocks(
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the lazy dog."),
    P("The brown fox jumps over the lazy dog."),
  );
  assert.deepEqual(kinds(a10, "text"), ["both"]);
  const mv = mergeBlocks(
    P("<b>one</b> two three"),
    P("two <b>one</b> three"),
    P("<b>ONE</b> two three"),
  );
  assert.deepEqual(kinds(mv, "move"), ["local"]);
  const edit = mergeBlocks(
    P("<b>one</b> and <i>two</i>"),
    P("<b>ONE</b> and <i>two</i>"),
    P("<b>one</b> and <i>TWO</i>"),
  );
  assert.deepEqual(kinds(edit, "move"), []);
  assert.deepEqual(kinds(edit, "text"), ["local", "remote"]);
});

test("localDiverged is the canonical comparison with remote", () => {
  const same = mergeBlocks(P("hello world"), P(""), P("hello there"));
  assert.equal(same.res.localDiverged, false);
  const attr = mergeBlocks(
    P('See <a href="/old">docs</a>.'),
    P('See <a href="/a">docs</a>.'),
    P('See <a href="/b">docs</a>.'),
  );
  assert.equal(attr.res.localDiverged, false);
  const local = mergeBlocks(
    P('See <a href="/old">docs</a>.'),
    P('See <a href="/a">docs</a>.'),
    P('See <a href="/b">docs</a>.'),
    { policy: "local" },
  );
  assert.equal(local.res.localDiverged, true);
});

test("marks reuse the local element: provenance after a remote wrap", () => {
  const x = mergeBlocks(
    P("Read <b>the <i>fine</i> print</b> now"),
    P("Read <b>the <i>fine</i> print</b> now!"),
    P('Read <a href="/p"><b>the <i>fine</i> print</b></a> now'),
  );
  assert.equal(
    x.provenance.get(x.node.querySelector("b")).local,
    x.l.querySelector("b"),
  );
  assert.equal(
    x.provenance.get(x.node.querySelector("i")).local,
    x.l.querySelector("i"),
  );
  const a = x.provenance.get(x.node.querySelector("a"));
  assert.deepEqual(
    [a.base, a.local, a.remote],
    [null, null, x.r.querySelector("a")],
  );
});

test("text provenance: each local text node is claimed by one output node", () => {
  // local is one text node; remote bolds a word inside it and edits later
  const x = mergeBlocks(
    P(FOX),
    P(FOX),
    P("The <b>quick</b> brown fox jumps over the sleepy dog."),
  );
  const [first, b, last] = x.node.childNodes;
  assert.equal(first.nodeValue, "The ");
  assert.equal(b.tagName, "B");
  const p = x.provenance.get(first);
  assert.deepEqual(p.local, [x.l.firstChild]);
  assert.equal(p.partial, true);
  assert.deepEqual(p.caret, [
    { node: x.l.firstChild, from: 0, to: 4, flatStart: 0 },
  ]);
  assert.deepEqual(x.provenance.get(last).local, []);
  assert.deepEqual(x.provenance.get(last).caret, [
    { node: x.l.firstChild, from: 10, to: 44, flatStart: 0 },
  ]);
  const m = x.textMappers.get(first);
  assert.equal(m(2), 2);
  assert.equal(m(6), 4); // inside the word remote bolded: clamped to this node
  assert.equal(m.flat(44), 4);
  assert.equal(x.textMappers.get(last).flat(44), 37);
  // remote unbolds: local's three text nodes land in one output node
  const y = mergeBlocks(
    P("The <b>quick</b> brown fox!"),
    P("The <b>quick</b> brown fox!"),
    P("The quick brown fox!"),
  );
  const t = y.node.firstChild;
  assert.equal(y.node.childNodes.length, 1);
  const q = y.provenance.get(t);
  assert.equal(q.local.length, 3);
  assert.equal(q.partial, false);
  assert.equal(y.textMappers.get(t)(16), 16);
});

test("browser-split local text nodes merge and are all claimed", () => {
  const ld = parse(doc(P(FOX)));
  const lp = ld.body.firstElementChild;
  lp.firstChild.splitText(6);
  lp.lastChild.splitText(10);
  const x = mergeSegment(
    block(P(FOX)),
    lp,
    block(P("The quick brown fox jumps over the sleepy dog.")),
  );
  assert.equal(
    x.node.innerHTML,
    "The quick brown fox jumps over the sleepy dog.",
  );
  assert.deepEqual(x.provenance.get(x.node.firstChild).local, [
    ...lp.childNodes,
  ]);
  assert.equal(x.textMappers.get(x.node.firstChild)(9), 9);
});

test("mapLocal: the pinned text-merge mappings hold", () => {
  const t6 = mergeBlocks(
    P("The lazy dog sleeps."),
    P("The lazy dog sleeps!"),
    P("The sleepy dog sleeps."),
  ).res;
  assert.equal(t6.text, "The sleepy dog sleeps!");
  assert.deepEqual([2, 6, 13, 20].map(t6.mapLocal), [2, 10, 15, 22]);
  const lost = mergeBlocks(
    P("the lazy dog"),
    P("the LAZY dog"),
    P("the sleepy dog"),
  ).res;
  assert.deepEqual([6, 12].map(lost.mapLocal), [10, 14]);
  const kept = mergeBlocks(
    P("the lazy dog"),
    P("the LAZY dog"),
    P("the sleepy dog"),
    { policy: "local" },
  ).res;
  assert.deepEqual([6, 12].map(kept.mapLocal), [6, 12]);
});

test("identity laws on formatted content", () => {
  const sig = (el) => flatSig(flatten([...el.childNodes]));
  const b = P("Read <b>the <i>fine</i> print</b> now");
  const x = P('Read <a href="/p"><b>the <i>fine</i> print</b></a> now!');
  for (const [l, r, want] of [
    [x, b, x],
    [b, x, x],
    [x, x, x],
  ]) {
    const m = mergeBlocks(b, l, r);
    assert.equal(sig(m.node), sig(block(want)));
    assert.equal(m.conflicts.length, 0);
  }
});

test("a lone br placeholder survives when every side is empty", () => {
  const x = mergeBlocks(P("<br>"), P("<br>"), P("<br>"));
  assert.equal(x.html, P("<br>"));
  assert.equal(x.provenance.get(x.node.firstChild).local, x.l.firstChild);
  assert.equal(x.res.localDiverged, false);
});

test("atoms kept by both sides go through mergeElement; one-sided atoms through cloneUnit", () => {
  const calls = [];
  const x = mergeBlocks(
    P('x <img src="a" alt="1"> y'),
    P('x <img src="a" alt="1"> y<br>'),
    P('x <img src="a" alt="2"> y'),
    {
      inline: {
        mergeElement: (b, l, r) => {
          calls.push(["merge", b.tagName, l.tagName, r.tagName]);
          const el = b.ownerDocument.createElement("img");
          el.setAttribute("data-merged", "1");
          return el;
        },
        cloneUnit: (el, side) => {
          calls.push(["clone", el.tagName, side]);
          return el.ownerDocument.createElement(el.tagName);
        },
      },
    },
  );
  assert.equal(x.node.innerHTML, 'x <img data-merged="1"> y<br>');
  assert.deepEqual(calls, [
    ["merge", "IMG", "IMG", "IMG"],
    ["clone", "BR", "local"],
  ]);
});

test("mergeAttrs from the caller merges a mark's attributes when it has a base", () => {
  const seen = [];
  const x = mergeBlocks(
    P('<span class="a">x</span>'),
    P('<span class="a b">x</span>'),
    P('<span class="a c">x</span>'),
    {
      inline: {
        mergeAttrs: (b, l, r, el) => {
          seen.push([b.className, l.className, r.className]);
          el.setAttribute("class", "a b c");
        },
      },
    },
  );
  assert.equal(x.html, P('<span class="a b c">x</span>'));
  assert.deepEqual(seen, [["a", "a b", "a c"]]);
  assert.equal(x.conflicts.length, 0);
});

test("past the token bound the text merges by line", () => {
  const n = MAX_TOKENS / 2 + 500;
  const lines = Array.from({ length: n }, (_, i) => "w" + i);
  const base = lines.join("\n");
  const local = lines.map((w, i) => (i === 5 ? "LOCAL" : w)).join("\n");
  const remote = lines.map((w, i) => (i === n - 5 ? "REMOTE" : w)).join("\n");
  const t0 = performance.now();
  const x = mergeBlocks(
    `<pre>${base}</pre>`,
    `<pre>${local}</pre>`,
    `<pre>${remote}</pre>`,
  );
  assert.ok(performance.now() - t0 < 1000);
  assert.equal(x.res.granularity, "line");
  assert.equal(x.conflicts.length, 0);
  assert.equal(
    x.node.textContent,
    lines
      .map((w, i) => (i === 5 ? "LOCAL" : i === n - 5 ? "REMOTE" : w))
      .join("\n"),
  );
});

test("a rewrite past the edit bound is one conflict, not a hang", () => {
  const base = Array.from({ length: 6000 }, (_, i) => "w" + i).join(" ");
  const local = Array.from({ length: 6000 }, (_, i) => "L" + i).join(" ");
  const t0 = performance.now();
  const x = mergeBlocks(P(base), P(local), P(base + " tail"));
  assert.ok(performance.now() - t0 < 1000);
  assert.equal(x.conflicts.length, 1);
  assert.equal(x.node.textContent, base + " tail");
});

test("a 2k paragraph with twenty marks on each side merges fast", () => {
  const words = [];
  for (let i = 0; words.join(" ").length < 2000; i++) words.push("word" + i);
  const wrap = (tag, offset, edit) =>
    words
      .map((w, i) => {
        const t = edit && (i + offset) % edit === 0 ? w + "x" : w;
        return (i + offset) % 16 === 0 ? `<${tag}>${t}</${tag}>` : t;
      })
      .join(" ");
  const b = P(words.join(" ")),
    l = P(wrap("b", 0)),
    r = P(wrap("i", 3, 17));
  mergeBlocks(b, l, r);
  const t0 = performance.now();
  const x = mergeBlocks(b, l, r);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${ms} ms`);
  assert.equal(x.conflicts.length, 0);
  assert.equal(
    x.node.querySelectorAll("b").length,
    x.l.querySelectorAll("b").length,
  );
  assert.equal(
    x.node.querySelectorAll("i").length,
    x.r.querySelectorAll("i").length,
  );
});

test("isInlineUnit: text, atoms and inline-only marks; blocks and remoteWins are boundaries", () => {
  const p = block(
    "<div>t<b>x</b><br><span><div>y</div></span><i>z</i><input><p>q</p><x-chip>c</x-chip><script></script></div>",
  );
  const [t, b, br, span, i, input, para, chip, script] = p.childNodes;
  assert.equal(isInlineUnit(t), true);
  assert.equal(isInlineUnit(b), true);
  assert.equal(isInlineUnit(br), true);
  assert.equal(isInlineUnit(span), false);
  assert.equal(isInlineUnit(i), true);
  assert.equal(isInlineUnit(input), true);
  assert.equal(isInlineUnit(para), false);
  assert.equal(isInlineUnit(chip), true);
  assert.equal(isInlineUnit(script), false);
  assert.equal(
    isInlineUnit(i, { remoteWins: (el) => el.tagName === "I" }),
    false,
  );
  assert.equal(
    isInlineUnit(input, { ignored: (el) => el.tagName === "INPUT" }),
    true,
  );
});

test("mergeInline runs without alignments or a policy", () => {
  const out = parse(doc("")).implementation.createHTMLDocument("");
  const res = mergeInline({
    base: [...block(P("a b")).childNodes],
    local: [...block(P("a X b")).childNodes],
    remote: [...block(P("a b Y")).childNodes],
    out,
  });
  assert.equal(res.text, "a X b Y");
  assert.equal(res.conflicts.length, 0);
  assert.equal(res.granularity, "word");
});

test("swapped atoms keep their elements through the alignment, as moves", () => {
  const x = mergeBlocks(
    P('<img src="a.png"> <img src="b.png">'),
    P('<img src="a.png"> <img src="b.png">'),
    P('<img src="b.png"> <img src="a.png">'),
  );
  assert.equal(x.html, P('<img src="b.png"> <img src="a.png">'));
  const [first, , second] = x.node.childNodes;
  assert.equal(x.provenance.get(first).base, x.b.childNodes[2]);
  assert.equal(x.provenance.get(first).local, x.l.childNodes[2]);
  assert.equal(x.provenance.get(second).base, x.b.childNodes[0]);
  assert.deepEqual(kinds(x, "move"), ["remote", "remote"]);
  assert.equal(x.conflicts.length, 0);
});

test("an atom moved by one side takes the other side's attribute edit", () => {
  const x = mergeBlocks(
    P('x <img src="a.png" alt="1"> y z'),
    P('x y z <img src="a.png" alt="1">'),
    P('x <img src="a.png" alt="2"> y z'),
  );
  assert.equal(x.html, P('x y z <img src="a.png" alt="2">'));
  assert.deepEqual(kinds(x, "move"), ["local"]);
  assert.equal(x.conflicts.length, 0);
});

test("a br inserted beside a kept br is an insertion, whatever the alignment paired", () => {
  const x = mergeBlocks(P("a b<br>c d"), P("a<br>b<br>c d"), P("a b<br>c D"));
  assert.equal(x.html, P("a<br>b<br>c D"));
  assert.deepEqual(kinds(x, "move"), []);
  assert.equal(x.conflicts.length, 0);
});

test("a local text node the merge replaced in place is claimed; one in a dropped mark is not", () => {
  const inPlace = mergeBlocks(P("A"), P("A"), P("B"));
  assert.deepEqual(inPlace.provenance.get(inPlace.node.firstChild).local, [
    inPlace.l.firstChild,
  ]);
  const dropped = mergeBlocks(
    "<div><a>A</a><b>B</b></div>",
    "<div><a>A</a><b>B</b></div>",
    "<div><b>B</b></div>",
  );
  assert.equal(dropped.html, "<div><b>B</b></div>");
  const t = dropped.node.querySelector("b").firstChild;
  assert.deepEqual(dropped.provenance.get(t).local, [
    dropped.l.querySelector("b").firstChild,
  ]);
});

test("H15 an insertion at a segment edge does not inherit the other side's mark", () => {
  const cases = [
    [
      P("hello world"),
      P("hello world again"),
      P("hello <b>world</b>"),
      P("hello <b>world</b> again"),
    ],
    [
      P("hello world"),
      P("Oh hello world"),
      P("<b>hello</b> world"),
      P("Oh <b>hello</b> world"),
    ],
    [
      P("one two three"),
      P("one X two three"),
      P("one <b>two</b> three"),
      P("one X <b>two</b> three"),
    ],
    [
      P("one two three"),
      P("one two X three"),
      P("one <b>two</b> three"),
      P("one <b>two</b> X three"),
    ],
    [
      P("one two three four"),
      P("one two X three four"),
      P("one <b>two three</b> four"),
      P("one <b>two X three</b> four"),
    ],
    [
      P("See the docs"),
      P("See the docs for details."),
      P(`See the <a href="/d">docs</a>`),
      P(`See the <a href="/d">docs</a> for details.`),
    ],
  ];
  for (const [b, l, r, expected] of cases) {
    const x = mergeBlocks(b, l, r);
    assert.equal(x.html, expected);
    assert.equal(x.conflicts.length, 0);
  }
});

test("H2 a whitespace anchor does not duplicate a mark beside a conflict", () => {
  const cases = [
    [
      P("w30 <b>w31</b> w32"),
      P("w30 n34 n33 <b>w31</b>"),
      P("w30 <br> <br> <b>w31</b> w32"),
      P("w30 <br> <br> <b>w31</b> w32"),
    ],
    [
      P("a <b>b</b> c"),
      P("a x y <b>b</b>"),
      P("a <br> <b>b</b> c"),
      P("a <br> <b>b</b> c"),
    ],
  ];
  for (const [b, l, r, expected] of cases) {
    const x = mergeBlocks(b, l, r);
    assert.equal(x.html, expected);
    assert.equal(x.conflicts.length, 1);
    assert.equal(x.conflicts[0].kind, "text");
  }
});

test("H14 the inline localDiverged ignores ignored attributes", () => {
  const ignoreAttribute = (el, n) => n === "data-x";
  const mergeAttrs = (b, l, r, el) => {
    for (const a of (r || l || b).attributes)
      if (!ignoreAttribute(el, a.name)) el.setAttribute(a.name, a.value);
  };
  const x = mergeBlocks(
    P(`one <b data-x="1">two</b> three`),
    P(`one <b data-x="1">two</b> three`),
    P(`one <b data-x="1">two</b> four`),
    { inline: { ignoreAttribute, mergeAttrs } },
  );
  assert.equal(x.html, P(`one <b>two</b> four`));
  assert.equal(x.res.localDiverged, false);
  const y = mergeBlocks(
    P(`one <b data-x="1">two</b> three`),
    P(`one <b data-x="1">TWO</b> three`),
    P(`one <b data-x="1">two</b> four`),
    { inline: { ignoreAttribute, mergeAttrs } },
  );
  assert.equal(y.res.localDiverged, true);
});
