// Group F: text and inline atoms that cross a block boundary. A block one
// side deleted or inserted between two runs of text joins the runs into one
// inline merge, with the block as an atom; atoms key by what they are, not
// by tag, and an atom moved into another block merges at its destination.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument, morph } from "../../src/index.js";

const detail = (res) =>
  res.conflicts.map((c) => c.kind + ":" + (c.detail || "")).join(",");

const count = (html, needle) => html.split(needle).length - 1;

async function live(base, local, remote) {
  const d = parse(doc(local));
  const report = await mergeDocument({
    live: d,
    base: doc(base),
    remote: doc(remote),
  });
  return { d, html: d.body.innerHTML, report };
}

test("HG-F a block one side deleted between two runs joins them", () => {
  const cases = [
    // [base, local, remote, expected]
    [
      `<div>hello there <p>P</p> big world</div>`,
      `<div>hello there  big world</div>`,
      `<div>hello there <p>P</p> big world again</div>`,
      `<div>hello there  big world again</div>`,
    ],
    [
      `<div>hello there <p>P</p> big world</div>`,
      `<div>hello there <p>P</p> big wide world</div>`,
      `<div>hello there  big world</div>`,
      `<div>hello there  big wide world</div>`,
    ],
    [
      `<ul><li>head <ul><li>s</li></ul> tail text</li></ul>`,
      `<ul><li>head  tail text</li></ul>`,
      `<ul><li>head <ul><li>s</li></ul> tail text more</li></ul>`,
      `<ul><li>head  tail text more</li></ul>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want);
    assert.equal(res.conflicts.length, 0, detail(res));
  }
});

test("HG-F runs fused with no space between them never duplicate", () => {
  const { html, res } = mergeBodies(
    `<div>hello<p>P</p>world</div>`,
    `<div>helloworld</div>`,
    `<div>hello<p>P</p>world!</div>`,
  );
  assert.equal(count(html, "world"), 1, html);
  assert.equal(count(html, "hello"), 1, html);
  if (res.conflicts.length === 0) assert.equal(html, `<div>helloworld!</div>`);
});

test("HG-F a block one side inserted into a run splits it once", () => {
  const cases = [
    [
      `<div>hello there big world</div>`,
      `<div>hello there <p>P</p> big world</div>`,
      `<div>hello there big world again</div>`,
      `<div>hello there <p>P</p> big world again</div>`,
    ],
    [
      `<div>hello there big world</div>`,
      `<div>hello there <p>P</p> big world</div>`,
      `<div>hi there big world</div>`,
      `<div>hi there <p>P</p> big world</div>`,
    ],
    [
      `<div>one two three four</div>`,
      `<div>one <p>L</p> two three four</div>`,
      `<div>one two three <p>R</p> four</div>`,
      `<div>one <p>L</p> two three <p>R</p> four</div>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want);
    assert.equal(res.conflicts.length, 0, detail(res));
  }
});

test("HG-F a joined block deleted by one side and edited by the other is kept", () => {
  for (const [l, r] of [
    [
      `<div>hello there  big world</div>`,
      `<div>hello there <p>P2</p> big world</div>`,
    ],
    [
      `<div>hello there <p>P2</p> big world</div>`,
      `<div>hello there  big world</div>`,
    ],
  ]) {
    const { html, res } = mergeBodies(
      `<div>hello there <p>P</p> big world</div>`,
      l,
      r,
    );
    // The block lands between the two runs; the spaces the deleting side
    // merged into one run fall on one side of it.
    assert.match(html, /^<div>hello there ?<p>P2<\/p> ? ?big world<\/div>$/);
    assert.equal(count(html, "P2"), 1);
    assert.equal(detail(res), "structure:edit-beats-delete");
  }
});

test("HG-F an inline element moved to another block lands once", () => {
  const cases = [
    [
      `<p>a1 <img src="x"> b1 c1</p><p>d1</p>`,
      `<p>a1  b1 c1</p><p>d1 <img src="x"></p>`,
      `<p>a1 <img src="x"> b1 C1</p><p>d1</p>`,
      `<p>a1  b1 C1</p><p>d1 <img src="x"></p>`,
    ],
    [
      `<p>a1 <img src="x"> b1 c1</p><p>d1</p>`,
      `<p>a1  b1 c1</p><p>d1 <img src="x"></p>`,
      `<p>A1 <img src="x"> b1 c1</p><p>d1</p>`,
      `<p>A1  b1 c1</p><p>d1 <img src="x"></p>`,
    ],
    [
      `<p>a1 <b>x1</b> b1 c1</p><p>d1</p>`,
      `<p>a1  b1 c1</p><p>d1 <b>x1</b></p>`,
      `<p>a1 <b>x1</b> b1 C1</p><p>d1</p>`,
      `<p>a1  b1 C1</p><p>d1 <b>x1</b></p>`,
    ],
    [
      `<p>a1 <img src="x"> b1 c1</p><p>d1</p>`,
      `<p>a1 <img src="x"> b1 C1</p><p>d1</p>`,
      `<p>a1  b1 c1</p><p>d1 <img src="x"></p>`,
      `<p>a1  b1 C1</p><p>d1 <img src="x"></p>`,
    ],
    // The other side's change to the moved element lands at its destination.
    [
      `<p>a <img src="x" alt="1"> b</p><p>c</p>`,
      `<p>a  b</p><p>c <img src="x" alt="1"></p>`,
      `<p>a <img src="x" alt="2"> b</p><p>c</p>`,
      `<p>a  b</p><p>c <img src="x" alt="2"></p>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want);
    assert.equal(res.conflicts.length, 0, detail(res));
  }
});

test("HG-F moved and swapped images are never lost or duplicated", () => {
  const cases = [
    [
      `<p>a1 <img src="x"> b1 c1</p>`,
      `<p>a1 b1 c1 <img src="x"></p>`,
      `<p><img src="x"> a1 b1 c1</p>`,
    ],
    [
      `<p><img src="a"> t1 <img src="b"> t2 <img src="c"></p>`,
      `<p><img src="b"> t1 <img src="a"> t2 <img src="c"></p>`,
      `<p> t1 <img src="b"> t2 <img src="c"><img src="a"></p>`,
    ],
    [
      `<p><img src="a"><img src="b"><img src="c"></p>`,
      `<p><img src="b"><img src="a"><img src="c"></p>`,
      `<p><img src="a"><img src="c"><img src="b"></p>`,
    ],
    [
      `<p><img src="a"><img src="b"><img src="c"></p>`,
      `<p><img src="c"><img src="a"><img src="b"></p>`,
      `<p><img src="b"><img src="a"><img src="c"></p>`,
    ],
  ];
  for (const [b, l, r] of cases) {
    const { html } = mergeBodies(b, l, r);
    for (const src of new Set(b.match(/src="\w"/g)))
      assert.equal(count(html, src), 1, `${src} in ${html}`);
  }
});

test("HG-F the live nodes survive a cross-block merge", async () => {
  const base = `<p>a1 <img src="x"> b1 c1</p><p>d1</p>`;
  const local = `<p>a1  b1 c1</p><p>d1 <img src="x"></p>`;
  const d = parse(doc(local));
  const img = d.querySelector("img");
  const [p1, p2] = d.querySelectorAll("p");
  await mergeDocument({
    live: d,
    base: doc(base),
    remote: doc(`<p>a1 <img src="x"> b1 C1</p><p>d1</p>`),
  });
  assert.equal(d.body.innerHTML, `<p>a1  b1 C1</p><p>d1 <img src="x"></p>`);
  assert.equal(d.querySelector("img"), img);
  assert.deepEqual([...d.querySelectorAll("p")], [p1, p2]);

  const joined = await live(
    `<div>hello there <p id="k">P</p> big world</div>`,
    `<div>hello there <p id="k">P</p> big wide world</div>`,
    `<div>hello there <p id="k">P</p> big world</div><p>new</p>`,
  );
  assert.equal(
    joined.html,
    `<div>hello there <p id="k">P</p> big wide world</div><p>new</p>`,
  );
});

test("HG-F an inline element the other side wrapped in a new block keeps its live node", async () => {
  const d = parse(
    doc(`<div id="w"><div><input id="c" type="checkbox"></div></div>`),
  );
  const root = d.getElementById("w").firstElementChild;
  const c = d.getElementById("c");
  await morph(root, `<div><input id="c" type="checkbox"></div>`, {
    morphStyle: "innerHTML",
  });
  assert.equal(
    d.body.innerHTML,
    `<div id="w"><div><div><input id="c" type="checkbox"></div></div></div>`,
  );
  assert.equal(d.getElementById("c"), c);
});

test("HG-F content a side moved out of joined text lands at its destination", async () => {
  const text = mergeBodies(
    `<div>intro text<p>A</p></div>`,
    `<div><p>A</p>intro text</div>`,
    `<div>intro text<p>A</p></div>`,
  );
  assert.equal(text.html, `<div><p>A</p>intro text</div>`);

  const base = `<div>intro <b id="x">bold</b> text<p>A</p></div>`;
  const local = `<div>intro  text<p>A</p><b id="x">bold</b></div>`;
  const d = parse(doc(local));
  const b = d.getElementById("x");
  await mergeDocument({
    live: d,
    base: doc(base),
    remote: doc(`<div>intro <b id="x">bold!</b> text<p>A</p></div>`),
  });
  assert.equal(
    d.body.innerHTML,
    `<div>intro  text<p>A</p><b id="x">bold!</b></div>`,
  );
  assert.equal(d.getElementById("x"), b);
});

test("HG-F a mark the remote moved to another block keeps its live node", async () => {
  const d = parse(doc(`<p>a1 <b id="x">x1</b> b1</p><p>d1</p>`));
  const b = d.getElementById("x");
  await mergeDocument({
    live: d,
    base: doc(`<p>a1 <b id="x">x1</b> b1</p><p>d1</p>`),
    remote: doc(`<p>a1  b1</p><p>d1 <b id="x">x1</b></p>`),
  });
  assert.equal(d.body.innerHTML, `<p>a1  b1</p><p>d1 <b id="x">x1</b></p>`);
  assert.equal(d.getElementById("x"), b);
});

test("HG-F2 an atom moved out of a block is not re-emitted by that block", () => {
  const cases = [
    // The other side made the same edit next to the moved mark.
    [
      `<p>a0 a1</p><p>w5 <b>w7</b> w6</p>`,
      `<p>a0 <b>w7</b> a1</p><p>w8 w6</p>`,
      `<p>a0 a1</p><p>w8 <b>w7</b> w6</p>`,
      "<b>w7</b>",
    ],
    // An echoed word beside the image the other side moved away.
    [
      `<p>w0 w1 w2</p><div><p>w6 w7 <img src="x"> w8 w9</p></div>`,
      `<p>w0 w1 w2</p><div><p>w6 w7 <img src="x"> w12 w8 w9</p></div>`,
      `<p>w0 w1 <img src="x"> w2</p><div><p>w6 w7 w12 w8 w9</p></div>`,
      "w12",
    ],
  ];
  for (const [b, l, r, needle] of cases) {
    const { html } = mergeBodies(b, l, r);
    assert.equal(count(html, needle), 1, html);
  }
});

test("HG-F2 an atom moved into a block the other side rewrote still lands", () => {
  const { html } = mergeBodies(
    `<p>w0 w1 w2 w3 <img src="x"> w4</p><p>w6 w7 w8 w9</p>`,
    `<p>w0 w1 w2 w3 w4</p><p>w11 <img src="x"> w12 w13</p>`,
    `<p>w14 w1 w2 w3 <img src="x"> w4</p><p>w9 w10</p>`,
  );
  assert.equal(count(html, `<img src="x">`), 1, html);
});

test("HG-F2 the side that kept a moved atom in place names it for the move", () => {
  const { res } = mergeBodies(
    `<p>w3 w4 w5</p><p>w9 w10 <img src="x"> w11</p>`,
    `<p>w16 <img src="x"> w4 w5</p><p>w9 w10 w11</p>`,
    `<p>w17 w4 w5</p><p>w9 w10 <img src="x"> w11</p>`,
  );
  assert.ok(
    !res.conflicts.some((c) => c.detail === "move-beats-delete"),
    detail(res),
  );
});

test("HG-F2 a block deleted on one side and edited on the other loses what the deleting side moved out", () => {
  const cases = [
    [
      `<ul><li>w4 w5 w6 w7</li></ul><ul><li>w15 w16 <b>w18</b> w17</li></ul>`,
      `<ul><li>w4 w5 w6 w7</li></ul><ul><li>w20 w16 <b>w18</b> w17</li></ul>`,
      `<ul><li>w4 w5 w6 w7 <b>w18</b></li></ul><ul></ul>`,
      "<b>w18</b>",
    ],
    [
      `<p>a b c</p><p>d e <img src="x"> f g</p>`,
      `<p>a <img src="x"> b c</p>`,
      `<p>a b c</p><p>d e <img src="x"> f g h</p>`,
      `<img src="x">`,
    ],
  ];
  for (const [b, l, r, needle] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(count(html, needle), 1, html);
    assert.match(detail(res), /edit-beats-delete/);
  }
});

test("HG-F2 an element wrapped in a new container, or moved out of one, moves", () => {
  const wrap = mergeBodies(
    `<p>hello world foo baz</p><p>x</p>`,
    `<section><p>hello world foo baz</p></section><p>x</p>`,
    `<p>hello world foo bar</p><p>x</p>`,
  );
  assert.equal(
    wrap.html,
    `<section><p>hello world foo bar</p></section><p>x</p>`,
  );
  assert.equal(wrap.res.conflicts.length, 0, detail(wrap.res));
  const unwrap = mergeBodies(
    `<div><p>hello world foo baz</p></div><p>x</p>`,
    `<p>hello world foo baz</p><p>x</p>`,
    `<div><p>hello world foo bar</p></div><p>x</p>`,
  );
  assert.equal(count(unwrap.html, "hello"), 1, unwrap.html);
});

test("HG-F2 a slot paired by position yields to a move with content evidence", () => {
  const { html } = mergeBodies(
    `<p><img src="i4.png"> w0 w1 w2 w3</p><div><p>w5 w6 w7 w8 w9 w10</p><p>w11 w12 w13</p></div>`,
    `<p>w18 w6 w7 w8 w9 w10</p><div><p>w11 w12 w13</p></div>`,
    `<div><p>w18 w6 w7 w8 w9 w10</p><p>w11 w12 w13</p></div>`,
  );
  assert.equal(html, `<p>w18 w6 w7 w8 w9 w10</p><div><p>w11 w12 w13</p></div>`);
});

test("HG-F2 a rewritten element keeps its slot after an insertion above it", () => {
  const { html } = mergeBodies(
    `<p>w0 w1 w2 w3</p><ul><li>w8 w9 w10 w11</li><li>w12 w13 w14 w15</li></ul>`,
    `<p>w18 w19 w20</p><p>w0 w1 w2 w3</p><ul><li>w17 w9 w10 w11</li><li>w21 w22 w23 w24</li></ul>`,
    `<p>w0 w1 w2 w3</p><ul><li>w17 w9 w10 w11</li><li>w12 w13 w14 w15</li></ul><p>w25 w26</p>`,
  );
  assert.equal(count(html, "<ul>"), 1, html);
  assert.equal(count(html, "w17"), 1, html);
});

test("HG-F2 an atom both sides moved, one into a new block, lands once", () => {
  const base = `<p>w0 w1 w2 w3</p><p>w6 w7 <img src="x"> w8</p>`;
  const toP = `<p>w0 w1 <img src="x"> w2 w3</p><p>w6 w7 w8</p>`;
  for (const [l, r] of [
    [`<p>n1 n2 <img src="x"> n3</p><p>w0 w1 w2 w3</p><p>w6 w7 w8</p>`, toP],
    [toP, `<p>n1 n2 <img src="x"> n3</p><p>w0 w1 w2 w3</p><p>w6 w7 w8</p>`],
    [`<p>w0 w1 w2 w3</p><p>w6 w7 w8</p><p>n1 n2 <img src="x"> n3</p>`, toP],
  ]) {
    const { html, res } = mergeBodies(base, l, r);
    assert.equal(count(html, `<img src="x">`), 1, html);
    assert.match(detail(res), /both-moved/);
  }
});

test("HG-F2 a block kept for an edit ahead of the moved atom's destination leaves it to the destination", () => {
  const { html } = mergeBodies(
    `<p>d e <img src="x"> f g</p><p>a b c</p>`,
    `<p>a <img src="x"> b c</p>`,
    `<p>d e <img src="x"> f g h</p><p>a b c</p>`,
  );
  assert.equal(count(html, `<img src="x">`), 1, html);
  assert.match(html, /<p>a <img src="x"> b c<\/p>/);
});

test("HG-F2 a container keeps its slot when the only thing before it moved in", () => {
  // Remote moved the paragraph out of the div to before it and put an echo
  // of local's new paragraph inside: the div is the same div on both sides.
  const { html } = mergeBodies(
    `<div><p>w0 w1 w2 w3 w4</p></div><ul><li>w5 w6 w7</li></ul>`,
    `<div><p>w17 w20 w18 w19</p><p>w0 w1 w2 w3 w4</p></div><ul><li>w5 w6 w7</li></ul>`,
    `<p>w0 w1 w2 w3 w4</p><div><p>w17 w20 w18 w19</p></div><ul><li>w5 w6 w7</li></ul>`,
  );
  assert.equal(count(html, "w17"), 1, html);
  assert.equal(count(html, "w0"), 1, html);
});

test("HG-F2 an element moved out of its container, its slot refilled, is a move", () => {
  const { html } = mergeBodies(
    `<div><p>w0 w1 w2 w3 w4</p></div><p>z1 z2</p>`,
    `<p>w0 w1 w2 w3 w4</p><div><p>n1 n2 n3</p></div><p>z1 z2</p>`,
    `<div><p>w0 w1 w2 w3 w4 w5</p></div><p>z1 z2</p>`,
  );
  assert.equal(
    html,
    `<p>w0 w1 w2 w3 w4 w5</p><div><p>n1 n2 n3</p></div><p>z1 z2</p>`,
  );
});

test("HG-F2 a weak pair is not stolen by its own descendant (unwrap keeps the outer element)", async () => {
  const w = document.createElement("div");
  w.innerHTML = `<div><input type="checkbox" id="first"><div><input type="checkbox" id="second"></div></div>`;
  document.body.appendChild(w);
  const first = w.querySelector("#first"),
    second = w.querySelector("#second");
  await morph(
    w,
    `<div><input type="checkbox" id="first"><input type="checkbox" id="second"></div>`,
    { morphStyle: "innerHTML" },
  );
  assert.equal(w.querySelector("#first"), first);
  assert.equal(w.querySelector("#second"), second);
  w.remove();
});
