// Round 3 review fixes (HM-I).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";

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
