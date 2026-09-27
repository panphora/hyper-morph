// Round 3 review fixes (HM-I).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument, morphElement } from "../../src/index.js";

async function onLivePage(base, local, remote) {
  const live = parse(doc(local));
  await mergeDocument({ live, base: doc(base), remote: doc(remote) });
  return live.body.innerHTML;
}

test("HM-I1 identical short inserts in two different containers are two inserts", async () => {
  const cases = [
    [
      `<div id="a"><p>x</p></div><div id="b"><p>y</p></div>`,
      `<div id="a"><p>x</p><p><br></p></div><div id="b"><p>y</p></div>`,
      `<div id="a"><p>x</p></div><div id="b"><p>y</p><p><br></p></div>`,
      `<div id="a"><p>x</p><p><br></p></div><div id="b"><p>y</p><p><br></p></div>`,
    ],
    [
      `<div id="a"></div><div id="b"></div>`,
      `<div id="a"><p>new item</p></div><div id="b"></div>`,
      `<div id="a"></div><div id="b"><p>new item</p></div>`,
      `<div id="a"><p>new item</p></div><div id="b"><p>new item</p></div>`,
    ],
    [
      `<ul id="a"><li>a</li></ul><ul id="b"><li>b</li></ul>`,
      `<ul id="a"><li>a</li><li>Done</li></ul><ul id="b"><li>b</li></ul>`,
      `<ul id="a"><li>a</li></ul><ul id="b"><li>b</li><li>Done</li></ul>`,
      `<ul id="a"><li>a</li><li>Done</li></ul><ul id="b"><li>b</li><li>Done</li></ul>`,
    ],
    [
      `<section id="a"><p>a</p></section><section id="b"><p>b</p></section>`,
      `<section id="a"><p>a</p><hr></section><section id="b"><p>b</p></section>`,
      `<section id="a"><p>a</p></section><section id="b"><p>b</p><hr></section>`,
      `<section id="a"><p>a</p><hr></section><section id="b"><p>b</p><hr></section>`,
    ],
    [
      `<table><tbody><tr><td id="a">1</td><td id="b">2</td></tr></tbody></table>`,
      `<table><tbody><tr><td id="a">1<p>TODO</p></td><td id="b">2</td></tr></tbody></table>`,
      `<table><tbody><tr><td id="a">1</td><td id="b">2<p>TODO</p></td></tr></tbody></table>`,
      `<table><tbody><tr><td id="a">1<p>TODO</p></td><td id="b">2<p>TODO</p></td></tr></tbody></table>`,
    ],
    [
      `<section id="a"><p>a</p></section><section id="b"><p>b</p></section>`,
      `<section id="a"><p>a</p><p>n</p></section><section id="b"><p>b</p><p>n</p></section>`,
      `<section id="a"><p>a</p></section><section id="b"><p>b</p><p>n</p></section>`,
      `<section id="a"><p>a</p><p>n</p></section><section id="b"><p>b</p><p>n</p></section>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want, l);
    assert.equal(res.conflicts.length, 0, l);
    assert.equal(await onLivePage(b, l, r), want, l);
  }
});

test("HM-I2 a split or join beside a block the other side reordered lands every word once", async () => {
  const cases = [
    [
      `<p>x1 y1</p><p>a1 b1 c1 d1</p>`,
      `<p>x1 y1</p><p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1 c1 d1</p><p>x1 y1</p>`,
      `<p>a1 b1</p><p>c1 d1</p><p>x1 y1</p>`,
    ],
    [
      `<ul><li>x1 y1</li><li>a1 b1 c1 d1</li></ul>`,
      `<ul><li>x1 y1</li><li>a1 b1</li><li>c1 d1</li></ul>`,
      `<ul><li>a1 b1 c1 d1</li><li>x1 y1</li></ul>`,
      `<ul><li>a1 b1</li><li>c1 d1</li><li>x1 y1</li></ul>`,
    ],
    [
      `<p>a1 b1 c1 d1</p><p>x1 y1</p>`,
      `<p>a1 b1</p><p>c1 d1</p><p>x1 y1</p>`,
      `<p>x1 y1</p><p>a1 b1 c1 d1</p>`,
      `<p>x1 y1</p><p>a1 b1</p><p>c1 d1</p>`,
    ],
    [
      `<p>x1 y1</p><p>a1 b1</p><p>c1 d1</p>`,
      `<p>x1 y1</p><p>a1 b1 c1 d1</p>`,
      `<p>c1 d1</p><p>x1 y1</p><p>a1 b1</p>`,
      `<p>x1 y1</p><p>a1 b1 c1 d1</p>`,
    ],
    [
      `<p>x1 y1</p><p>a1 b1 c1 d1</p>`,
      `<p>a1 b1 c1 d1</p><p>x1 y1</p>`,
      `<p>x1 y1</p><p>a1 b1</p><p>c1 d1</p>`,
      `<p>a1 b1</p><p>c1 d1</p><p>x1 y1</p>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    assert.equal(mergeBodies(b, l, r).html, want, l);
    assert.equal(await onLivePage(b, l, r), want, l);
  }
});

test("HM-I3 a block break beside the other side's word edit merges as two edits", async () => {
  const cases = [
    [
      `<div>hello there big world</div>`,
      `<div>hello there<div>big world</div></div>`,
      `<div>hello there big WORLD</div>`,
      `<div>hello there<div>big WORLD</div></div>`,
    ],
    [
      `<div>hello there big world</div>`,
      `<div>hello there big WORLD</div>`,
      `<div>hello there<div>big world</div></div>`,
      `<div>hello there<div>big WORLD</div></div>`,
    ],
    [
      `<div>hello there big world</div>`,
      `<div>hello there<div>big world</div></div>`,
      `<div>hello there big</div>`,
      `<div>hello there<div>big</div></div>`,
    ],
    [
      `<p>alpha bravo</p><p>charlie delta</p>`,
      `<p>alpha bravo</p><p>CHARLIE delta</p>`,
      `<p>alpha bravocharlie delta</p>`,
      `<p>alpha bravoCHARLIE delta</p>`,
    ],
    [
      `<p>alpha bravo</p><p>charlie delta</p>`,
      `<p>alpha bravocharlie delta</p>`,
      `<p>alpha bravo</p><p>CHARLIE delta</p>`,
      `<p>alpha bravoCHARLIE delta</p>`,
    ],
    [
      `<p>alpha bravo</p><p>charlie delta</p>`,
      `<p>alpha BRAVO</p><p>charlie delta</p>`,
      `<p>alpha bravocharlie delta</p>`,
      `<p>alpha BRAVOcharlie delta</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("HM-I3 the caret keeps its character through a join that fuses two words", async () => {
  for (const [at, want] of [
    [0, 11],
    [5, 16],
    [7, 18],
  ]) {
    const ed = document.createElement("div");
    ed.setAttribute("contenteditable", "true");
    ed.innerHTML = "<p>alpha bravo</p><p>charlie delta</p>";
    document.body.appendChild(ed);
    ed.focus();
    const r = document.createRange();
    r.setStart(ed.querySelectorAll("p")[1].firstChild, at);
    r.collapse(true);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(r);
    await morphElement(
      ed,
      `<div contenteditable="true"><p>alpha bravocharlie delta</p></div>`,
      {
        base: `<div contenteditable="true"><p>alpha bravo</p><p>charlie delta</p></div>`,
      },
    );
    const s = document.getSelection();
    assert.equal(s.anchorNode, ed.querySelector("p").firstChild);
    assert.equal(s.anchorOffset, want, "offset " + at);
    ed.remove();
  }
});

test("HM-I4 splits in CJK, emoji and inside a word are splits", async () => {
  const cases = [
    [
      `<p>你好世界这是测试</p>`,
      `<p>你好世界</p><p>这是测试</p>`,
      `<p>你好世界这是测试！</p>`,
      `<p>你好世界</p><p>这是测试！</p>`,
    ],
    [
      `<p>你好世界这是测试</p>`,
      `<p>你好世界这是测试！</p>`,
      `<p>你好世界</p><p>这是测试</p>`,
      `<p>你好世界</p><p>这是测试！</p>`,
    ],
    [
      `<p>😀 😃 😄 😁</p>`,
      `<p>😀 😃</p><p>😄 😁</p>`,
      `<p>😀 😃 😄 😁 APPEND</p>`,
      `<p>😀 😃</p><p>😄 😁 APPEND</p>`,
    ],
    [
      `<p>hello</p>`,
      `<p>he</p><p>llo</p>`,
      `<p>hello there</p>`,
      `<p>he</p><p>llo there</p>`,
    ],
    [
      `<p>hello</p>`,
      `<p>hello there</p>`,
      `<p>he</p><p>llo</p>`,
      `<p>he</p><p>llo there</p>`,
    ],
    [
      `<p>你好世界</p><p>这是测试</p>`,
      `<p>你好世界这是测试</p>`,
      `<p>你好世界</p><p>这是测试！</p>`,
      `<p>你好世界这是测试！</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("HM-I4 a CJK split whose half the splitter also edited is still one block", () => {
  const m = mergeBodies(
    `<p>你好世界这是测试</p>`,
    `<p>你好世界</p><p>这是测验</p>`,
    `<p>你好世界这是测试！</p>`,
  );
  assert.equal(m.html, `<p>你好世界</p><p>这是测试！</p>`);
});

test("HM-I11 a split beside a block both sides deleted keeps the split-off words", async () => {
  const cases = [
    [
      `<p>c d e</p><p>x y</p>`,
      `<p>c d</p><p>e</p>`,
      `<p>c d e</p>`,
      `<p>c d</p><p>e</p>`,
    ],
    [
      `<p>c d e</p><p>x y</p>`,
      `<p>c d e</p>`,
      `<p>c d</p><p>e</p>`,
      `<p>c d</p><p>e</p>`,
    ],
    [
      `<p>a b</p><p>c d e</p><p>x y</p>`,
      `<p>a b</p><p>c d</p><p>e</p>`,
      `<p>q r</p><p>c d e</p>`,
      `<p>q r</p><p>c d</p><p>e</p>`,
    ],
    [
      `<p>w0 w1 w2</p><p>w5 w6 w7 w8 w9</p><p>w10 w11 w12 w13 w14</p>`,
      `<p>w0 w1 w2</p><p>w5 w6 w7 w8</p><p>w9</p>`,
      `<p>w17 w18 w19 w20</p><p>w5 w6 w7 w8 w9</p>`,
      `<p>w17 w18 w19 w20</p><p>w5 w6 w7 w8</p><p>w9</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("HM-I12 a paragraph moved and edited leaves its slot to the paragraph typed there", async () => {
  const base = `<p>w0 w1 w2 w3 w4 w5</p><div><p>w7 w8 w9 w10</p></div>`;
  const moved = `<p>new</p><div><p>w23 w1 w2 w3 w4 w5</p><p>w7 w8 w9 w10</p></div>`;
  const edited = `<p>w0 w1 w2 w3 w4 w5 w6</p><div><p>w7 w8 w9 w10</p></div>`;
  const expected = `<p>new</p><div><p>w23 w1 w2 w3 w4 w5 w6</p><p>w7 w8 w9 w10</p></div>`;
  for (const [local, remote] of [
    [moved, edited],
    [edited, moved],
  ]) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected);
    assert.equal(m.res.conflicts.length, 0);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("HM-I13 a block both sides typed, read as rewrites of two different neighbours, lands once", async () => {
  const base = `<p>a b c</p><ul><li>x</li></ul><p>q r s</p>`;
  const cases = [
    [
      `<ul><li>x</li></ul><p>n m o</p><p>q r s</p>`,
      `<ul><li>x</li></ul><p>n m o</p>`,
      `<ul><li>x</li></ul><p>n m o</p>`,
    ],
    [
      `<ul><li>x</li></ul><p>n m o</p>`,
      `<ul><li>x</li></ul><p>n m o</p><p>q r s</p>`,
      `<ul><li>x</li></ul><p>n m o</p>`,
    ],
    [
      `<ul><li>x</li></ul><p>n <b>m</b> o</p><p>q r s</p>`,
      `<ul><li>X</li></ul><p>n <b>m</b> o</p>`,
      `<ul><li>X</li></ul><p>n <b>m</b> o</p>`,
    ],
  ];
  for (const [local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});
