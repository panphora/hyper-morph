// HM-H case 1: a paragraph split or joined on one side while the other side
// edits the paragraphs involved. The blocks merge as one word sequence with
// block breaks; the break that ends a run of characters carries the block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";

const detail = (res) =>
  res.conflicts.map((c) => c.kind + ":" + (c.detail || "")).join(",");

test("HM-H1 split and join with edits on the other side", () => {
  const cases = [
    // [name, base, local, remote, expected, conflicts]
    [
      "1a split L, edit R tail",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 D1</p>`,
      `<p>a1 b1</p><p>c1 D1</p>`,
      0,
    ],
    [
      "1b split both differently",
      `<p>a1 b1 c1</p>`,
      `<p>a1</p><p>b1 c1</p>`,
      `<p>a1 b1</p><p>c1</p>`,
      `<p>a1</p><p>b1</p><p>c1</p>`,
      0,
    ],
    [
      "1c join L, edit R first",
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 B1</p><p>c1 d1</p>`,
      `<p>a1 B1 c1 d1</p>`,
      0,
    ],
    [
      "1d join L, edit R second",
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 D1</p>`,
      `<p>a1 b1 c1 D1</p>`,
      0,
    ],
    [
      "1e J3 split L, remote appends",
      `<p>hello there big world</p>`,
      `<p>hello there</p><p>big world</p>`,
      `<p>hello there big world again</p>`,
      `<p>hello there</p><p>big world again</p>`,
      0,
    ],
    [
      "1f J1 div split (Chrome)",
      `<div>hello there big world</div>`,
      `<div>hello there<div>big world</div></div>`,
      `<div>hello there big world again</div>`,
      `<div>hello there<div>big world again</div></div>`,
      0,
    ],
    [
      "1g J2 join with no space",
      `<p>hello there</p><p>big world</p>`,
      `<p>hello therebig world</p>`,
      `<p>hello there</p><p>big world again</p>`,
      `<p>hello therebig world again</p>`,
      0,
    ],
    [
      "1h concurrent split with an id",
      `<p id="p">one two three</p>`,
      `<p id="p">one</p><p>two three</p>`,
      `<p id="p">one two</p><p>three</p>`,
      `<p id="p">one</p><p>two</p><p>three</p>`,
      0,
    ],
    [
      "1i split L, edit R head",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>A1 b1 c1 d1</p>`,
      `<p>A1 b1</p><p>c1 d1</p>`,
      0,
    ],
    [
      "1j split L only",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      0,
    ],
    [
      "1k split R, edit L tail",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1 c1 D1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1</p><p>c1 D1</p>`,
      0,
    ],
    [
      "1l split with a class on the new p",
      `<p class="x">a1 b1 c1 d1</p>`,
      `<p class="x y">a1 b1</p><p class="x">c1 d1</p>`,
      `<p class="x">a1 b1 c1 D1</p>`,
      `<p class="x y">a1 b1</p><p class="x">c1 D1</p>`,
      0,
    ],
    [
      "1m split with bold spanning the point",
      `<p>a1 <b>b1 c1</b> d1</p>`,
      `<p>a1 <b>b1</b></p><p><b>c1</b> d1</p>`,
      `<p>a1 <b>b1 c1</b> D1</p>`,
      `<p>a1 <b>b1</b></p><p><b>c1</b> D1</p>`,
      0,
    ],
    [
      "3236 join then split L, word edits R",
      `<div><p><img src="i9.png"> w5 w6 w7 w8</p><p>w10 w11 w12 w13</p></div>`,
      `<div><p><img src="i9.png"> w5 w6 w7 w8 w10 w11 w12</p><p>w13</p></div>`,
      `<div><p><img src="i9.png"> w14 w5 w6 w7 w8</p><p>w15 w11 w12 w13</p></div>`,
      `<div><p><img src="i9.png"> w14 w5 w6 w7 w8 w15 w11 w12</p><p>w13</p></div>`,
      0,
    ],
    [
      "T1 split L, R edits the word before the point",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 B1 c1 d1</p>`,
      `<p>a1 B1</p><p>c1 d1</p>`,
      0,
    ],
    [
      "T2 split L, R edits the word after the point",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 C1 d1</p>`,
      `<p>a1 b1</p><p>C1 d1</p>`,
      0,
    ],
    [
      "T3 split L, R inserts a word at the point",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 X c1 d1</p>`,
      `<p>a1 b1</p><p>X c1 d1</p>`,
      0,
    ],
    [
      "T4 split L with a typed word, R edits d1",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1 X</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 D1</p>`,
      `<p>a1 b1 X</p><p>c1 D1</p>`,
      0,
    ],
    [
      "T5 echo word, L splits after it",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1 X</p><p>c1 d1</p>`,
      `<p>a1 b1 X c1 d1</p>`,
      `<p>a1 b1 X </p><p>c1 d1</p>`,
      0,
    ],
    [
      "T6 join L, R edits the last word of the first",
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 B1</p><p>c1 d1</p>`,
      `<p>a1 B1 c1 d1</p>`,
      0,
    ],
    [
      "T7 join L, R edits the first word of the second",
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>C1 d1</p>`,
      `<p>a1 b1 C1 d1</p>`,
      0,
    ],
    [
      "T8 both split at one point, edits on both",
      `<p>a1 b1 c1 d1</p>`,
      `<p>A1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1</p><p>c1 D1</p>`,
      `<p>A1 b1</p><p>c1 D1</p>`,
      0,
    ],
    [
      "T9 split L, R deletes the word before the point",
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 c1 d1</p>`,
      `<p>a1 c1 d1</p>`,
      1,
    ],
    [
      "T10 split L, R joins with the next paragraph",
      `<p>a1 b1 c1 d1</p><p>e1 f1</p>`,
      `<p>a1 b1</p><p>c1 d1</p><p>e1 f1</p>`,
      `<p>a1 b1 c1 d1 e1 f1</p>`,
      `<p>a1 b1</p><p>c1 d1 e1 f1</p>`,
      0,
    ],
  ];
  for (const [name, b, l, r, want, conflicts] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want, name);
    assert.equal(res.conflicts.length, conflicts, name + " " + detail(res));
  }
});

// mergeDocument with a local snapshot: the live document typed after it.
async function live(base, local, remote, type = () => {}) {
  const d = parse(doc(local));
  const snap = d.cloneNode(true);
  const map = new Map();
  const walk = (a, b) => {
    map.set(a, b);
    for (let i = 0; i < a.childNodes.length; i++)
      walk(a.childNodes[i], b.childNodes[i]);
  };
  walk(snap, d);
  type(d);
  const before = [...d.body.querySelectorAll("p,div,li,h1")];
  const report = await mergeDocument({
    live: d,
    base: doc(base),
    local: { root: snap, toLive: (n) => map.get(n) || null },
    remote: doc(remote),
  });
  const after = [...d.body.querySelectorAll("p,div,li,h1")];
  return {
    html: d.body.innerHTML,
    report,
    kept: after.map((el) => before.indexOf(el)),
  };
}

test("HM-H1 apply keeps the live halves and their text nodes", async () => {
  let x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 D1</p>`,
  );
  assert.equal(x.html, `<p>a1 b1</p><p>c1 D1</p>`);
  assert.deepEqual(x.kept, [0, 1]);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
  );
  assert.equal(x.html, `<p>a1 b1</p><p>c1 d1</p>`);
  assert.deepEqual(x.kept, [0, -1]);
  assert.equal(x.report.localDiverged, false);
  x = await live(
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1</p><p>c1 D1</p>`,
    `<p>a1 b1 c1 d1</p>`,
  );
  assert.equal(x.html, `<p>a1 b1 c1 D1</p>`);
  assert.deepEqual(x.kept, [0]);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1</p><p>b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 D1</p>`,
  );
  assert.equal(x.html, `<p>a1</p><p>b1</p><p>c1 D1</p>`);
  assert.deepEqual(x.kept, [0, 1, 2]);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>new</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 D1</p>`,
  );
  assert.equal(x.html, `<p>a1 b1</p><p>new</p><p>c1 D1</p>`);
  x = await live(
    `<h1>Title here now</h1>`,
    `<h1>Title</h1><p>here now</p>`,
    `<h1>Title here NOW</h1>`,
  );
  assert.equal(x.html, `<h1>Title</h1><p>here NOW</p>`);
  x = await live(`<p>a1 b1</p>`, `<p>a1 b1</p><p><br></p>`, `<p>a1 B1</p>`);
  assert.equal(x.html, `<p>a1 B1</p><p><br></p>`);
  x = await live(
    `<ul><li>a1 b1 c1</li><li>x</li></ul>`,
    `<ul><li>a1</li><li>b1 c1</li><li>x</li></ul>`,
    `<ul><li>a1 b1 C1</li><li>x</li></ul>`,
  );
  assert.equal(x.html, `<ul><li>a1</li><li>b1 C1</li><li>x</li></ul>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1</p>`,
  );
  assert.equal(x.html, `<p>a1 b1</p>`);
  assert.equal(x.report.conflicts.length, 1);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 X d1</p>`,
  );
  assert.equal(x.html, `<p>a1 X d1</p>`);
  assert.equal(x.report.conflicts.length, 1);
  x = await live(
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1</p><p>b1</p><p>c1 d1</p>`,
  );
  assert.equal(x.html, `<p>a1</p><p>b1 c1 d1</p>`);
  x = await live(
    `<div><p>a1 b1 c1</p></div><div><p>z</p></div>`,
    `<div><p>a1</p><p>b1 c1</p></div><div><p>z</p></div>`,
    `<div></div><div><p>z</p><p>a1 b1 c1</p></div>`,
  );
  assert.equal(x.html, `<div></div><div><p>z</p><p>a1</p><p>b1 c1</p></div>`);
});

test("HM-H1 typing after the snapshot lands once, in the half it was typed in", async () => {
  const tail = (d) => d.body.querySelectorAll("p")[1].firstChild;
  const head = (d) => d.body.querySelectorAll("p")[0].firstChild;
  let x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>A1 b1 c1 d1</p>`,
    (d) => (tail(d).nodeValue += " zz"),
  );
  assert.equal(x.html, `<p>A1 b1</p><p>c1 d1 zz</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>A1 b1 c1 d1</p>`,
    (d) => (tail(d).nodeValue = "zz " + tail(d).nodeValue),
  );
  assert.equal(x.html, `<p>A1 b1</p><p>zz c1 d1</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    (d) => (tail(d).nodeValue = "zz " + tail(d).nodeValue),
  );
  assert.equal(x.html, `<p>a1 b1</p><p>zz c1 d1</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 D1</p>`,
    (d) => (head(d).nodeValue += " zz"),
  );
  assert.equal(x.html, `<p>a1 b1 zz</p><p>c1 D1</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    (d) => (tail(d).nodeValue = "c1 zz d1"),
  );
  assert.equal(x.html, `<p>a1 b1</p><p>c1 zz d1</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    (d) => (head(d).nodeValue += " zz"),
  );
  assert.equal(x.html, `<p>a1 b1</p><p>c1 d1 zz</p>`);
  x = await live(
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    (d) => (head(d).nodeValue = "zz " + head(d).nodeValue),
  );
  assert.equal(x.html, `<p>zz a1 b1</p><p>c1 d1</p>`);
  x = await live(
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1</p><p>c1 d1</p>`,
    `<p>a1 b1 c1 d1</p>`,
    (d) => (tail(d).nodeValue = "c1 zz d1"),
  );
  assert.equal(x.html, `<p>a1 b1 c1 zz d1</p>`);
});

test("HM-H1 Astra fixtures: joins, concurrent splits and the nested div", () => {
  const cases = [
    [
      `<p>hello there</p><p>big world</p>`,
      `<p>hello therebig world</p>`,
      `<p>hello there</p><p>big world again</p>`,
      `<p>hello therebig world again</p>`,
    ],
    [
      `<p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p>`,
      `<p>a1 B1</p><p>c1 d1</p>`,
      `<p>a1 B1 c1 d1</p>`,
    ],
    [
      `<p id="p">one two three</p>`,
      `<p id="p">one</p><p>two three</p>`,
      `<p id="p">one</p><p>two</p><p>three</p>`,
      `<p id="p">one</p><p>two</p><p>three</p>`,
    ],
    [
      `<p>alpha beta gamma delta</p>`,
      `<p>alpha beta</p><p>gamma delta</p>`,
      `<p>alpha</p><p>beta gamma delta</p>`,
      `<p>alpha</p><p>beta</p><p>gamma delta</p>`,
    ],
    [
      `<div>hello there big world</div>`,
      `<div>hello there<div>big world</div></div>`,
      `<div>hello there big world again</div>`,
      `<div>hello there<div>big world again</div></div>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want, b);
    assert.equal(res.conflicts.length, 0, b);
  }
});
