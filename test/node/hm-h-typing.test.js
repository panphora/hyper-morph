// Typing that lands after the local snapshot, at a text node edge or in a
// text node the browser split off after the snapshot, is replayed once and
// never read as a deletion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeDocument } from "../../src/index.js";

async function typed(html, remote, edit) {
  const live = parse(doc(html));
  const snap = live.cloneNode(true);
  const map = new Map();
  (function pair(a, b) {
    map.set(a, b);
    for (let i = 0; i < a.childNodes.length; i++)
      pair(a.childNodes[i], b.childNodes[i]);
  })(snap, live);
  edit(live);
  await mergeDocument({
    live,
    base: doc(html),
    local: { root: snap.documentElement, toLive: (n) => map.get(n) || null },
    remote: doc(remote),
  });
  return live.body.innerHTML;
}

test("HM-H6 typing at the end of a text node before or inside a mark lands once", async () => {
  const p = `<p>a1 b1 <b>x</b> c1 d1</p>`;
  assert.equal(
    await typed(p, `<p>a1 b1 <b>x</b> c1 D1</p>`, (d) => {
      d.body.querySelector("p").firstChild.nodeValue += "zz";
    }),
    `<p>a1 b1 zz<b>x</b> c1 D1</p>`,
  );
  assert.equal(
    await typed(p, `<p>A1 b1 <b>x</b> c1 d1</p>`, (d) => {
      d.body.querySelector("p").firstChild.nodeValue += "zz";
    }),
    `<p>A1 b1 zz<b>x</b> c1 d1</p>`,
  );
  assert.equal(
    await typed(p, `<p>a1 b1 <b>x</b> c1 D1</p>`, (d) => {
      d.body.querySelector("b").firstChild.nodeValue += "zz";
    }),
    `<p>a1 b1 <b>xzz</b> c1 D1</p>`,
  );
});

test("HM-H6 a text node split off after the snapshot keeps its text", async () => {
  const p = `<p>a1 b1 c1 d1</p>`;
  assert.equal(
    await typed(p, `<p>A1 b1 c1 d1</p>`, (d) => {
      d.body.querySelector("p").firstChild.splitText(6);
    }),
    `<p>A1 b1 c1 d1</p>`,
  );
  assert.equal(
    await typed(p, `<p>a1 b1 c1 D1</p>`, (d) => {
      d.body.querySelector("p").firstChild.splitText(6);
    }),
    `<p>a1 b1 c1 D1</p>`,
  );
  assert.equal(
    await typed(p, `<p>A1 b1 c1 d1</p>`, (d) => {
      const el = d.body.querySelector("p");
      el.firstChild.splitText(6);
      el.lastChild.nodeValue = "zz" + el.lastChild.nodeValue;
    }),
    `<p>A1 b1 zzc1 d1</p>`,
  );
  assert.equal(
    await typed(
      `<p><b>q</b> a1 b1 c1 d1</p>`,
      `<p><b>q</b> a1 b1 c1 D1</p>`,
      (d) => {
        const el = d.body.querySelector("p");
        el.lastChild.splitText(7);
        el.lastChild.nodeValue = "zz" + el.lastChild.nodeValue;
      },
    ),
    `<p><b>q</b> a1 b1 zzc1 D1</p>`,
  );
});
