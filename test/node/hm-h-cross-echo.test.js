// HM-H case 2: a block both sides inserted (an echo) whose copies sit under
// parents that do not correspond after one side moved a neighbour or a
// container. The copies pair globally and one lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "./lib/merge.js";

const count = (html, needle) => html.split(needle).length - 1;
const words = (html) => html.match(/\bw\d+\b/g) || [];
const noDupNoLoss = (b, l, r) => {
  const { html } = mergeBodies(b, l, r);
  const seen = new Map();
  for (const w of words(html)) seen.set(w, (seen.get(w) || 0) + 1);
  for (const [w, n] of seen) assert.equal(n, 1, `${w} x${n} in ${html}`);
  for (const w of words(l))
    if (words(r).includes(w)) assert.ok(seen.has(w), `${w} lost in ${html}`);
  return html;
};

test("HM-H2 structural fuzz seeds 1078, 4113, 4115, 4299 (1.0.0 generator) land every word once", () => {
  noDupNoLoss(
    `<div><p>w0 w1 w2 w3</p></div><div><p><img src="i8.png"> w4 w5 w6 w7</p><p>w9 <b>w13</b> <img src="i14.png"> w10 w11 w12</p></div>`,
    `<div><p>w25 <img src="i32.png"> w26 w27 <b>w30 w31</b> w28 w29</p><p>w15 w0 w1 w2 w3</p></div><div><p>w21 w22 w23 w24</p><p>w9 <b>w13</b> <img src="i14.png"> w10 w11 w12</p><p>w16 w17 w18 w19 w20</p></div>`,
    `<div><p>w33 w34</p></div><p>w9 <b>w13</b> <img src="i14.png"> w10 w11 w12</p><div><p><img src="i8.png"> w4 w5 w6 w7</p><p>w16 w17 w18 w19 w20</p></div>`,
  );
  noDupNoLoss(
    `<div><p>w0 w1 w2 <b>w4</b> w3</p></div><div><p>w5 w6 w7 <b>w9 w10</b> w8</p></div>`,
    `<div><p>w11 w12 <b>w15</b> w13 w14</p><p>w0 w1 w2 w3</p></div><div><p>w16 <b>w4</b> w17</p></div>`,
    `<div><p>w11 w12 <b>w15</b> w13 w14</p><p>w18 w19</p></div><p>w5 w6 w7 <b>w9 w10</b> w8</p><div></div>`,
  );
  noDupNoLoss(
    `<div><p>w0 w1 w2</p></div><div><p>w3 <b>w8 w9</b> w4 w5 w6 w7</p><p>w10 w11 w12 <img src="i14.png"> w13</p></div>`,
    `<div><p>w15 w16 w17</p></div><div><p>w0 w1 w2</p><p>w3 <b>w8 w9</b> w4 w5 w6 w7</p><p>w19 w11 w12 <img src="i14.png"> w13</p></div>`,
    `<div><p>w0 w1 w2</p><p>w15 w16 w17</p></div><div><p>w3 <b>w8 w9</b> w4 w5 w6 w7</p><p>w18 w11 w12 <img src="i14.png"> w13</p></div>`,
  );
  noDupNoLoss(
    `<ul><li><img src="i6.png"> w0 w1 w2 w3 w4 w5</li></ul><ul><li><img src="i11.png"> w7 w8 w9 w10</li><li>w12 w13 w14 w15 w16 w17</li><li><img src="i22.png"> w18 w19 w20 w21</li></ul>`,
    `<ul><li><img src="i6.png"> w0 w1 w2 w3 w4 w5</li><li>w23 w24 w25</li></ul><ul><li><img src="i11.png"> w7 w8 w9 w10</li><li>w12 w13 w14 w15 w16 w17</li><li><img src="i22.png"> w18 w19 w20 w21</li></ul>`,
    `<ul><li>w23 w24 w25</li></ul><ul><li><img src="i11.png"> w7 w8 w9 w10</li><li><img src="i6.png"> w0 w1 w2 w3 w4 w5</li><li>w12 w13 w14 w15 w16 w17</li><li><img src="i22.png"> w18 w19 w20 w26 w21</li></ul>`,
  );
});

test("HM-H2 an echo whose dropped copy is visited first still lands once", () => {
  const { html, res } = mergeBodies(
    `<div><p>a</p><p>b</p></div><div><p>c</p></div>`,
    `<div><p>a</p><p>c</p><p>e</p></div><div></div>`,
    `<div><p>a</p><p>e</p></div><div><p>c</p></div>`,
  );
  assert.equal(count(html, "<p>e</p>"), 1, html);
  assert.equal(count(html, "<p>c</p>"), 1, html);
  assert.ok(res.conflicts.some((c) => c.detail === "both-moved"));
});

test("HM-H2 a block both sides rewrote alike, moved into a container by one side, lands once", () => {
  const { html } = mergeBodies(
    `<p>w</p><div><p>v</p><table><tbody><tr><td>t</td></tr></tbody></table></div>`,
    `<p>x y</p><div><p>v</p><table><tbody><tr><td>t</td></tr></tbody></table></div>`,
    `<div><p>v</p><p>x y</p><table><tbody><tr><td>t</td></tr></tbody></table></div>`,
  );
  assert.equal(
    html,
    `<div><p>v</p><p>x y</p><table><tbody><tr><td>t</td></tr></tbody></table></div>`,
  );
});

test("HM-H2 an echoed list item beside an item the other side moved to another list lands once", () => {
  const remote = `<ul><li>x y z</li></ul><ul><li>d e f</li><li>a b c</li><li>g h j</li></ul>`;
  const { html } = mergeBodies(
    `<ul><li>a b c</li></ul><ul><li>d e f</li><li>g h i</li></ul>`,
    `<ul><li>a b c</li><li>x y z</li></ul><ul><li>d e f</li><li>g h i</li></ul>`,
    remote,
  );
  assert.equal(html, remote);
});
