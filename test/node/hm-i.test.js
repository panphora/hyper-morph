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

test("HM-I5 a paragraph with an inline remote-wins region still splits and joins as text", async () => {
  const remoteWins = (el) => el.hasAttribute("no-watch");
  const base = `<p>alpha bravo <span no-watch>LIVE</span> charlie delta</p>`;
  const split = (span) =>
    `<p>alpha bravo <span no-watch>${span}</span></p><p>charlie delta</p>`;
  const edit = (span) =>
    `<p>alpha bravo <span no-watch>${span}</span> charlie DELTA</p>`;
  const cases = [
    [
      split("LIVE"),
      edit("LIVE"),
      `<p>alpha bravo <span no-watch="">LIVE</span></p><p>charlie DELTA</p>`,
    ],
    [
      split("LIVE"),
      edit("LIVE2"),
      `<p>alpha bravo <span no-watch="">LIVE2</span></p><p>charlie DELTA</p>`,
    ],
    [
      split("MINE"),
      edit("LIVE2"),
      `<p>alpha bravo <span no-watch="">LIVE2</span></p><p>charlie DELTA</p>`,
    ],
    [
      edit("LIVE2"),
      split("LIVE"),
      `<p>alpha bravo <span no-watch="">LIVE</span></p><p>charlie DELTA</p>`,
    ],
    [
      `<p>alpha bravo <span no-watch>LIVE</span> charlie delta</p>`,
      `<p>alpha bravo</p><p><span no-watch>LIVE2</span> charlie delta</p>`,
      `<p>alpha bravo</p><p><span no-watch="">LIVE2</span> charlie delta</p>`,
    ],
  ];
  for (const [local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote, { remoteWins });
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    const live = parse(doc(local));
    const span = live.querySelector("[no-watch]");
    await mergeDocument({
      live,
      base: doc(base),
      remote: doc(remote),
      remoteWins,
    });
    assert.equal(live.body.innerHTML, expected);
    assert.ok(live.contains(span), "the live remote-wins span is kept");
  }
});

test("HM-I9 an echoed rewrite beside a new sibling lands once", async () => {
  const cases = [
    [
      `<h2>t</h2><p>one two three</p><h3>u</h3>`,
      `<h2>t</h2><p>new para here</p><p>uno dos tres</p><h3>u</h3>`,
      `<h2>t</h2><p>uno dos tres</p><h3>u</h3>`,
      `<h2>t</h2><p>new para here</p><p>uno dos tres</p><h3>u</h3>`,
    ],
    [
      `<h2>t</h2><p>one two three</p><h3>u</h3>`,
      `<h2>t</h2><p>uno dos tres</p><h3>u</h3>`,
      `<h2>t</h2><p>uno dos tres</p><p>new para here</p><h3>u</h3>`,
      `<h2>t</h2><p>uno dos tres</p><p>new para here</p><h3>u</h3>`,
    ],
    [
      `<h2>t</h2><p>one two three</p><h3>u</h3>`,
      `<h2>t</h2><p>new para here</p><p>uno dos tres cuatro</p><h3>u</h3>`,
      `<h2>t</h2><p>uno dos tres</p><h3>u</h3>`,
      `<h2>t</h2><p>new para here</p><p>uno dos tres cuatro</p><h3>u</h3>`,
    ],
    [
      `<ul><li>one two three</li></ul>`,
      `<ul><li>new item</li><li>uno dos tres</li></ul>`,
      `<ul><li>uno dos tres</li></ul>`,
      `<ul><li>new item</li><li>uno dos tres</li></ul>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("HM-I13 two paragraphs each side rewrote to the same text both land", async () => {
  const cases = [
    [
      `<p>alpha beta gamma</p><hr><p>delta epsilon zeta</p>`,
      `<p>all tasks complete</p><hr><p>delta epsilon zeta</p>`,
      `<p>alpha beta gamma</p><hr><p>all tasks complete</p>`,
      `<p>all tasks complete</p><hr><p>all tasks complete</p>`,
    ],
    [
      `<div id="a"><p>alpha beta gamma</p></div><div id="b"><p>delta epsilon zeta</p></div>`,
      `<div id="a"><p>all tasks complete</p></div><div id="b"><p>delta epsilon zeta</p></div>`,
      `<div id="a"><p>alpha beta gamma</p></div><div id="b"><p>all tasks complete</p></div>`,
      `<div id="a"><p>all tasks complete</p></div><div id="b"><p>all tasks complete</p></div>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("R4 a join beside the other side's Enter or deletion keeps every word inside a block", async () => {
  const base = `<p>alpha bravo</p><p>charlie delta</p>`;
  const join = `<p>alpha bravocharlie delta</p>`;
  const cases = [
    [
      base,
      join,
      `<p>alpha bravo</p><p><br></p><p>charlie delta</p>`,
      `<p>alpha bravo</p><p><br></p><p>charlie delta</p>`,
      1,
    ],
    [base, `<p>alpha bravo</p><p><br></p><p>charlie delta</p>`, join, join, 1],
    [base, join, `<p>alpha bravo</p>`, `<p>alpha bravo</p>`, 0],
    [
      `<p>alpha bravo</p><p>charlie delta</p><p>new para text</p>`,
      `<p>alpha bravo</p><p>new para text</p>`,
      `<p>alpha bravocharlie delta</p><p>new para text</p>`,
      `<p>alpha bravo</p><p>new para text</p>`,
      0,
    ],
    [
      `<p>w0 w1</p><p>w2 w3</p>`,
      `<p>w0 w1w2 w3</p>`,
      `<p>w0 w1</p>`,
      `<p>w0 w1</p>`,
      0,
    ],
  ];
  for (const [b, local, remote, expected, conflicts] of cases) {
    const m = mergeBodies(b, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, conflicts, local + " | " + remote);
    assert.equal(await onLivePage(b, local, remote), expected);
  }
});

test("R4 an empty line typed where a paragraph was deleted does not take its place, so a join beside it keeps its words", async () => {
  const cases = [
    [
      `<p>alpha bravo</p><p>charlie delta</p>`,
      `<p>alpha bravocharlie delta</p>`,
      `<p>charlie delta</p><p><br></p>`,
      `<p>charlie delta</p><p><br></p>`,
    ],
    [
      `<p>w0 w1 w2 w3</p><p>w4 w5 w6 w7</p>`,
      `<p>w0 w1 w2 w3 w4 w5 w6 w7</p>`,
      `<p>w4 w5 w6 w7</p><p><br></p>`,
      `<p>w4 w5 w6 w7</p><p><br></p>`,
    ],
  ];
  for (const [b, local, remote, expected] of cases) {
    assert.equal(
      mergeBodies(b, local, remote).html,
      expected,
      local + " | " + remote,
    );
    assert.equal(await onLivePage(b, local, remote), expected);
  }
});

test("R4 a paragraph rewritten whole beside the other side's join conflicts, and the echoed paragraph lands once", async () => {
  const base = `<p>alpha bravo</p><p>charlie delta</p>`;
  const cases = [
    [
      `<p>alpha bravo</p><p>new para text</p>`,
      `<p>alpha bravo charlie delta</p><p>new para text</p>`,
      `<p>alpha bravo charlie delta</p><p>new para text</p>`,
    ],
    [
      `<p>alpha bravo</p><p>new para text</p>`,
      `<p>alpha bravocharlie delta</p><p>new para text</p>`,
      `<p>alpha bravocharlie delta</p><p>new para text</p>`,
    ],
  ];
  for (const [local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 1, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("R4 a new block that starts or ends like its neighbour is new text when the neighbour kept it", async () => {
  const cases = [
    [
      `<p>hello</p>`,
      `<p>he</p><p>hello</p>`,
      `<p>HELLO</p>`,
      `<p>he</p><p>HELLO</p>`,
    ],
    [
      `<p>hello</p>`,
      `<p>hello</p><p>llo</p>`,
      `<p>HELLO</p>`,
      `<p>HELLO</p><p>llo</p>`,
    ],
    [`<p>hello</p>`, `<p>he</p><p>hello</p>`, ``, `<p>he</p>`],
    [
      `<ol><li>10 apples</li></ol>`,
      `<ol><li>1</li><li>10 apples</li></ol>`,
      `<ol><li>12 apples</li></ol>`,
      `<ol><li>1</li><li>12 apples</li></ol>`,
    ],
    [
      `<p>hello</p>`,
      `<p>he</p><p>llo</p>`,
      `<p>hello there</p>`,
      `<p>he</p><p>llo there</p>`,
    ],
    [`<p>你好世界</p>`, `<p>你好</p><p>你好世界</p>`, ``, `<p>你好</p>`],
    [
      `<p>Hello world</p>`,
      `<p>Hello</p><p>Hello world</p>`,
      `<p>Hello there world</p>`,
      `<p>Hello</p><p>Hello there world</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("R4 a remote-wins span with an id keeps its live node when remote adds another beside it", async () => {
  const live = parse(
    doc(`<p>one <span id="a" no-watch>A</span> two</p><p>three</p>`),
  );
  const a = live.querySelector("#a");
  await mergeDocument({
    live,
    base: doc(`<p>one <span id="a" no-watch>A</span> two three</p>`),
    remote: doc(
      `<p>one <span id="x" no-watch>X</span><span id="a" no-watch>A2</span> two THREE</p>`,
    ),
    remoteWins: (el) => el.hasAttribute("no-watch"),
  });
  assert.equal(
    live.body.innerHTML,
    `<p>one <span id="x" no-watch="">X</span><span id="a" no-watch="">A2</span> two</p><p>THREE</p>`,
  );
  assert.equal(live.querySelector("#a"), a);
});

test("R5 a split whose halves repeat a word is still a split", async () => {
  const cases = [
    [
      `<p>ha ha ha</p>`,
      `<p>ha ha</p><p>ha</p>`,
      `<p>ha ha HA</p>`,
      `<p>ha ha</p><p>HA</p>`,
    ],
    [
      `<p>ha ha ha</p>`,
      `<p>ha ha HA</p>`,
      `<p>ha ha</p><p>ha</p>`,
      `<p>ha ha</p><p>HA</p>`,
    ],
    [
      `<p>Row, row, row your boat</p>`,
      `<p>Row,</p><p>row, row your boat</p>`,
      `<p>ROW, row, row your boat</p>`,
      `<p>ROW,</p><p>row, row your boat</p>`,
    ],
    [
      `<p>ha ha ha</p>`,
      `<p>ha ha</p><p>ha</p>`,
      `<p><b>ha ha ha</b></p>`,
      `<p><b>ha ha</b></p><p><b>ha</b></p>`,
    ],
    [
      `<ul><li>a a b</li></ul>`,
      `<ul><li>a</li><li>a b</li></ul>`,
      `<ul><li>A a b</li></ul>`,
      `<ul><li>A</li><li>a b</li></ul>`,
    ],
    [
      `<p>yes yes yes</p>`,
      `<p>yes yes</p><p>yes</p>`,
      `<p>yes yes no</p>`,
      `<p>yes yes</p><p>no</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("R5 a join that fused an echoed edit is found by the edit, so the joined paragraph lands once", async () => {
  const base = `<p>red fox</p><p>the quick brown dog</p>`;
  const local = `<p>blue fox</p><p>the quick brown dog</p>`;
  const remote = `<p>blue foxthe quick brown dog</p><p><br></p>`;
  const expected = remote;
  assert.equal(mergeBodies(base, local, remote).html, expected);
  assert.equal(await onLivePage(base, local, remote), expected);
});

test("R5 a join beside the other side's new line keeps the second block's own element", async () => {
  const cases = [
    [
      `<ul><li>milk</li><li class="done">eggs</li></ul>`,
      `<ul><li>milkeggs</li></ul>`,
      `<ul><li>milk</li><li><br></li><li class="done">eggs</li></ul>`,
    ],
    [
      `<h2>alpha bravo</h2><p>charlie delta</p>`,
      `<h2>alpha bravocharlie delta</h2>`,
      `<h2>alpha bravo</h2><p><br></p><p>charlie delta</p>`,
    ],
  ];
  for (const [base, local, remote] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, remote, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 1, local + " | " + remote);
    assert.equal(await onLivePage(base, local, remote), remote);
  }
});

test("R6 a join beside the other side's split of the same block keeps the split half's own element", async () => {
  const cases = [
    [
      `<ul><li class="a">milk tea</li><li class="done">eggs</li></ul>`,
      `<ul><li class="a">milk teaeggs</li></ul>`,
      `<ul><li class="a">milk</li><li class="a">tea</li><li class="done">eggs</li></ul>`,
      `<ul><li class="a">milk</li><li class="a">teaeggs</li></ul>`,
    ],
    [
      `<h2>Title words</h2><p>body text</p>`,
      `<h2>Title wordsbody text</h2>`,
      `<h2>Title</h2><h2>words</h2><p>body text</p>`,
      `<h2>Title</h2><h2>wordsbody text</h2>`,
    ],
    [
      `<p>alpha bravo</p><blockquote>charlie</blockquote>`,
      `<p>alpha bravocharlie</p>`,
      `<p>alpha</p><p>bravo</p><blockquote>charlie</blockquote>`,
      `<p>alpha</p><p>bravocharlie</p>`,
    ],
  ];
  for (const [base, a, b, expected] of cases)
    for (const [local, remote] of [
      [a, b],
      [b, a],
    ]) {
      assert.equal(
        mergeBodies(base, local, remote).html,
        expected,
        local + " | " + remote,
      );
      assert.equal(await onLivePage(base, local, remote), expected);
    }
});

test("R6 a new block repeating a word its edited neighbour kept is new text, not a split half", async () => {
  const base = `<p id="a">Buy milk</p>`;
  const a = `<p id="a">Buy eggs</p><p>eggs</p>`;
  const b = `<p id="a"><a href="/shop">Buy milk</a></p>`;
  const expected = `<p id="a"><a href="/shop">Buy eggs</a></p><p>eggs</p>`;
  for (const [local, remote] of [
    [a, b],
    [b, a],
  ]) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts.length, 0);
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});

test("R6 an edited block deleted beside a neighbour that ends with the edit keeps edit-beats-delete", async () => {
  const cases = [
    [
      `<p>Pending</p><p>Undone</p>`,
      `<p>Done</p><p>Undone</p>`,
      `<p>Undone</p>`,
      `<p>Done</p><p>Undone</p>`,
    ],
    [
      `<p>Total: 120</p><p>tbd</p>`,
      `<p>Total: 120</p><p>20</p>`,
      `<p>Total: 120</p>`,
      `<p>Total: 120</p><p>20</p>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const m = mergeBodies(base, local, remote);
    assert.equal(m.html, expected, local + " | " + remote);
    assert.equal(m.res.conflicts[0].kind, "structure");
    assert.equal(await onLivePage(base, local, remote), expected);
  }
});
