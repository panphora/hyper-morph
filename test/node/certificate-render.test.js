import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certificateGroups,
  certifiedOrigins,
  inlineScopeUnits,
} from "../../src/certificate-groups.js";
import { flatten } from "../../src/inline-merge.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

function plan(B, L, R, localPairs, remotePairs, options = {}) {
  const base = Array.from(parse(doc(B)).body.children);
  const local = Array.from(parse(doc(L)).body.children);
  const remote = Array.from(parse(doc(R)).body.children);
  const views = [local, remote].map((units, side) => {
    const map = new Map(),
      reverse = new Map(),
      identical = new Set();
    for (const [bi, si] of side === 0 ? localPairs : remotePairs) {
      map.set(base[bi], units[si]);
      reverse.set(units[si], base[bi]);
      if (base[bi].isEqualNode(units[si])) identical.add(base[bi]);
    }
    return {
      A: { map, reverse, identical },
      V: {
        units,
        asBase: false,
        twin: (u) => map.get(u),
        baseOf: (u) => reverse.get(u),
        here: (u) => units.includes(u),
      },
      idOf: (u) => u.id || null,
    };
  });
  const result = certificateGroups({
    base,
    views,
    eligible: (u) => u.nodeType === 1 && u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    ...options,
  });
  return { result, base, local, remote, views };
}

test("certified split projects actual origins around an opaque insertion port", () => {
  const x = plan(
    "<p>a b c d</p>",
    "<p>a b</p><p>new port</p><p>c d</p>",
    "<p>a b c D</p>",
    [[0, 0]],
    [[0, 0]],
  );
  assert.ok(x.result);
  assert.ok(x.result.certificates.length > 0);
  assert.equal(x.result.blocks.has(x.local[1]), false);
  const scopes = [x.base, x.local, x.remote];
  const flats = scopes.map((units) =>
    flatten(units, { blocks: x.result.blocks }),
  );
  const ranges = flats[1].nodes.map((n) => [n.node, n.s, n.e]);
  const origins = certifiedOrigins({
    certificates: x.result.certificates,
    scopes,
    flats,
    keys: [(a) => a.el, (a) => a.el, (a) => a.el],
  });
  assert.equal(origins.local.status, "ready");
  assert.ok(origins.local.runs.some((r) => r.kind === "transfer"));
  assert.equal(origins.local.bTo[4], flats[1].text.indexOf("c d"));
  assert.deepEqual(
    flats[1].nodes.map((n) => [n.node, n.s, n.e]),
    ranges,
  );
  assert.equal(flats[1].atoms[0].el, x.local[1]);
  const wrongFlats = scopes.map((units) =>
    flatten(
      units.map((n) => n.cloneNode(true)),
      { blocks: x.result.blocks },
    ),
  );
  assert.equal(
    certifiedOrigins({
      certificates: x.result.certificates,
      scopes,
      flats: wrongFlats,
      keys: [(a) => a.el, (a) => a.el, (a) => a.el],
    }).fallback,
    true,
  );
});

test("partition scope enumerates empty cells and every intervening anchor", () => {
  const units = [
    "head",
    "x",
    "port1",
    "A",
    "port2",
    "B",
    "port3",
    "C",
    "port4",
    "y",
    "tail",
  ];
  const partition = {
    units,
    list: [
      { bLo: 0, from: 0, to: 3, inlineStart: 1, inlineEnd: 2, next: 3 },
      { bLo: -1, from: 4, to: 5, inlineStart: -1, inlineEnd: -1, next: 5 },
      { bLo: -1, from: 6, to: 7, inlineStart: -1, inlineEnd: -1, next: 7 },
      { bLo: 4, from: 8, to: 11, inlineStart: 9, inlineEnd: 10, next: 11 },
    ],
  };
  assert.deepEqual(inlineScopeUnits(partition, { lo: 0, hi: 4 }, true), units);
  assert.deepEqual(
    inlineScopeUnits(partition, { lo: 0, hi: 4 }),
    units.slice(1, -1),
  );
});

test("multiple orphan prefixes and punctuation cannot claim an incomplete source", () => {
  for (const L of [
    "<p>common xx yy zz</p><p>one aa bb cc</p>",
    "<p>common</p><p>. xx yy zz</p>",
  ]) {
    const x = plan(
      "<p>common one two.</p>",
      L,
      "<p>common one IMPORTANT.</p>",
      [],
      [[0, 0]],
    );
    assert.equal(x.result, null);
  }
  assert.equal(
    plan(
      "<p>common one two.</p>",
      "<p>common xx yy zz.</p>",
      "<p>common one IMPORTANT.</p>",
      [],
      [[0, 0]],
    ).result,
    null,
  );
});

test("a rejected identity target cannot complete orphan coverage", () => {
  const x = plan(
    '<p id="source">one two</p>',
    '<p id="source">one</p><p id="different">two</p>',
    '<p id="source">one TWO</p>',
    [],
    [[0, 0]],
  );
  assert.equal(x.result, null);
});

test("full copies and exhausted work leave membership unclaimed", () => {
  const B = '<p id="source">one two three</p>';
  const L = '<p id="source">one TWO three</p><p id="copy">one two three</p>';
  assert.equal(
    plan(B, L, '<p id="source">one two FOUR</p>', [[0, 0]], [[0, 0]]).result,
    null,
  );
  assert.equal(
    plan("<p>a b</p>", "<p>a</p><p>b</p>", "<p>a B</p>", [[0, 0]], [[0, 0]], {
      limit: 0,
    }).result,
    null,
  );
});

test("a nested opaque list stays inside the split owner", () => {
  const x = mergeBodies(
    "<ul><li>a1 b1 c1 d1</li></ul>",
    "<ul><li>a1 b1</li><li>c1 d1</li></ul>",
    "<ul><li>a1 b1 c1 d1<ul><li>sub</li></ul></li></ul>",
  );
  assert.equal(
    x.html,
    "<ul><li>a1 b1</li><li>c1 d1<ul><li>sub</li></ul></li></ul>",
  );
  assert.equal(x.res.conflicts.length, 0);
});

test("an independent port keeps its anchor when the remote joins its next owner", () => {
  const B =
    '<div data-id="b2"><p data-id="b3">w4 <b>w8 w9</b> w5 w6 w7</p><p data-id="b4">w10 w11 w12</p></div>';
  const L =
    '<div data-id="b2"><p data-id="b3">w4 <b>w8 w9</b></p><p data-id="b5">w13 w14 w15</p><p data-id="b4">w10 w11 w12</p></div>';
  const R =
    '<div data-id="b2"><p data-id="b3">w4 <b>w8 w9</b> w5 w6 w7 w10 w11 w12</p></div>';
  const x = mergeBodies(B, L, R);
  assert.equal(
    x.html,
    '<div data-id="b2"><p data-id="b3">w4 <b>w8 w9</b></p><p data-id="b5">w13 w14 w15</p><p data-id="b4"> w10 w11 w12</p></div>',
  );
  assert.equal(x.res.conflicts.length, 0);
});

for (const [name, before, localBefore, remoteBefore] of [
  [
    "more than 256 siblings",
    Array.from(
      { length: 300 },
      (_, i) => `<h2 id="n${i}">anchor ${i}</h2>`,
    ).join(""),
    null,
    null,
  ],
  [
    "long unrelated text",
    `<p id="large">${"unrelated ".repeat(6000)}</p>`,
    null,
    null,
  ],
  [
    "distant sixty-word rewrite",
    `<p id="rewrite">${"old ".repeat(60)}</p><h2>anchor</h2>`,
    `<p id="rewrite">${"new ".repeat(60)}</p><h2>anchor</h2>`,
    null,
  ],
]) {
  test(`a local split survives ${name}`, () => {
    const B = before + '<p id="split">a b c d</p>';
    const L = (localBefore || before) + '<p id="split">a b</p><p>c d</p>';
    const R = (remoteBefore || before) + '<p id="split">a b c D</p>';
    const x = mergeBodies(B, L, R);
    assert.equal(
      x.html,
      (localBefore || before) + '<p id="split">a b</p><p>c D</p>',
    );
    assert.equal(x.res.conflicts.length, 0);
  });
}

test("multiple false orphan targets preserve the remote source edit", () => {
  const x = mergeBodies(
    "<p>common one two.</p>",
    "<p>common xx yy zz</p><p>one aa bb cc</p>",
    "<p>common one IMPORTANT.</p>",
  );
  assert.equal(
    (x.res.doc.body.textContent.match(/IMPORTANT/g) || []).length,
    1,
  );
  assert.equal((x.res.doc.body.textContent.match(/xx yy zz/g) || []).length, 1);
  assert.equal((x.res.doc.body.textContent.match(/aa bb cc/g) || []).length, 1);
});

test("independent owners keep the holdout shared paragraph edit", () => {
  const x = mergeBodies(
    "<section><p>Word here</p><p>Word there</p></section>",
    "<section><p>Word there</p><blockquote>Word again</blockquote></section>",
    "<section><p>Word there</p></section>",
  );
  assert.equal(
    x.html,
    "<section><p>Word there</p><blockquote>Word again</blockquote></section>",
  );
});

test("a split keeps both live structural owners exactly once", async () => {
  const B = '<p id="source">left keep right tail</p>';
  const L = '<p id="source">left keep</p><p>right tail</p>';
  const R = '<p id="source">left keep right END</p>';
  const live = parse(doc(L));
  const first = live.body.firstElementChild,
    second = live.body.lastElementChild;
  await mergeDocument({
    live,
    base: parse(doc(B)),
    remote: parse(doc(R)),
    scripts: { execute: false },
    fastPath: false,
  });
  assert.equal(
    live.body.innerHTML,
    '<p id="source">left keep</p><p>right END</p>',
  );
  assert.equal(live.body.firstElementChild, first);
  assert.equal(live.body.lastElementChild, second);
  assert.notEqual(first, second);
  assert.equal(live.querySelectorAll("#source").length, 1);
});
