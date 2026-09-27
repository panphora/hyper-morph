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
