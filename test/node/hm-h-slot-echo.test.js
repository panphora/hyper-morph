// HM-H case 3: a block both sides rewrote alike, plus a sibling one side
// inserted in the same parent. The slot pass pairs gap by gap, and a slot
// the other side paired resolves here by adopting the alike leftover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "./lib/merge.js";

const detail = (res) =>
  res.conflicts.map((c) => c.kind + ":" + (c.detail || "")).join(",");

test("HM-H3 alike rewrite on both sides plus an inserted sibling lands once", () => {
  const cases = [
    [
      `<p>a</p><p>c1 c2 <b>c3</b></p>`,
      `<p>a</p><p>x1 x2 <b>c3</b></p><p>n1 n2</p>`,
      `<p>a</p><p><b>x1</b> x2 <b>c3</b></p>`,
      `<p>a</p><p><b>x1</b> x2 <b>c3</b></p><p>n1 n2</p>`,
    ],
    [
      `<p>a</p><p>b</p><p>c1 c2 <b>c3</b></p>`,
      `<p>a</p><p>b</p><p>x1 x2 <b>c3</b></p><p>n1 n2</p>`,
      `<p>a</p><p><b>b</b></p><p><b>x1</b> x2 <b>c3</b></p>`,
      `<p>a</p><p><b>b</b></p><p><b>x1</b> x2 <b>c3</b></p><p>n1 n2</p>`,
    ],
    [
      `<p>w2880 w2881</p><p>w2882 w2883</p><p>w2884 w2885 <b>w2886</b></p>`,
      `<p>w2880 w2881</p><p>w2882 w2883</p><p>w2887 w2889 <b>w2886</b></p><p>w2891 w2892</p>`,
      `<p>w2880 w2881</p><p><b>w2882</b> w2883</p><p><b>w2887</b> w2889 <b>w2886</b></p>`,
      `<p>w2880 w2881</p><p><b>w2882</b> w2883</p><p><b>w2887</b> w2889 <b>w2886</b></p><p>w2891 w2892</p>`,
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const { html, res } = mergeBodies(b, l, r);
    assert.equal(html, want);
    assert.equal(res.conflicts.length, 0, detail(res));
  }
});

test("HM-H3 alike rewrite where one side also formats it, plus a sibling the other side lacks", () => {
  const { html, res } = mergeBodies(
    `<p>old</p>`,
    `<p>new</p>`,
    `<p><b>new</b></p><p>tail</p>`,
  );
  assert.equal(html, `<p><b>new</b></p><p>tail</p>`);
  assert.equal(res.conflicts.length, 0, detail(res));
});
