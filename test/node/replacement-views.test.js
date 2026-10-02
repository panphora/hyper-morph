import assert from "node:assert/strict";
import { test } from "node:test";
import { replacementViews } from "../../src/certificate-groups.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

function repair(B, L, R, localPairs, remotePairs, options = {}) {
  const base = Array.from(parse(doc(B)).body.children);
  const local = Array.from(parse(doc(L)).body.children);
  const remote = Array.from(parse(doc(R)).body.children);
  const views = [local, remote].map((units, side) => {
    const forward = new Map(),
      reverse = new Map();
    for (const [bi, si] of side === 0 ? localPairs : remotePairs) {
      forward.set(base[bi], units[si]);
      reverse.set(units[si], base[bi]);
    }
    return {
      A: { map: forward, reverse },
      V: {
        units,
        asBase: false,
        twin: (u) => forward.get(u),
        baseOf: (u) => reverse.get(u),
        here: (u) => units.includes(u),
      },
      idOf: (u) => u.id || null,
    };
  });
  const result = replacementViews({
    base,
    views,
    eligible: (u) => u.nodeType === 1 && u.tagName === "P",
    baseId: (u) => u.id || null,
    ignored: () => false,
    remoteWins: () => false,
    atomKey: (u) => u.outerHTML,
    ...options,
  });
  return { result, base, local, remote, views };
}

test("replacement view adopts a formatted rewrite without mutating alignment", () => {
  const x = repair(
    "<p>old</p>",
    "<p>new</p>",
    "<p><b>new</b></p><p>tail</p>",
    [[0, 0]],
    [],
  );
  assert.ok(x.result);
  assert.equal(x.result[1].twin(x.base[0]), x.remote[0]);
  assert.equal(x.result[1].baseOf(x.remote[0]), x.base[0]);
  assert.equal(x.result[1].baseOf(x.remote[1]), undefined);
  assert.equal(x.views[1].A.reverse.has(x.remote[0]), false);
  assert.equal(x.views[1].A.map.has(x.base[0]), false);
});

test("replacement view adopts a unique whole-token extension beside an insertion", () => {
  const x = repair(
    "<p>one two three</p>",
    "<p>new para here</p><p>uno dos tres cuatro</p>",
    "<p>uno dos tres</p>",
    [],
    [[0, 0]],
  );
  assert.ok(x.result);
  assert.equal(x.result[0].twin(x.base[0]), x.local[1]);
  assert.equal(x.result[0].baseOf(x.local[0]), undefined);
});

test("replacement view rejects partial tokens, repeated endpoints, and ambiguous candidates", () => {
  for (const candidate of ["news", "new new", "before new after"])
    assert.equal(
      repair("<p>old</p>", "<p>new</p>", `<p>${candidate}</p>`, [[0, 0]], [])
        .result,
      null,
    );
  assert.equal(
    repair("<p>old</p>", "<p>new</p>", "<p>new</p><p>new</p>", [[0, 0]], [])
      .result,
    null,
  );
});

test("replacement view respects fresh identities and atom identity", () => {
  assert.equal(
    repair(
      "<p>old</p>",
      '<p id="one">new</p>',
      '<p id="two">new</p>',
      [[0, 0]],
      [],
    ).result,
    null,
  );
  assert.equal(
    repair(
      "<p>old</p>",
      '<p>new<img src="a"></p>',
      '<p>new<img src="b"></p>',
      [[0, 0]],
      [],
    ).result,
    null,
  );
});

test("replacement view does not cross a retained anchor or claim an unchanged copy", () => {
  assert.equal(
    repair(
      "<p>old</p><h2>anchor</h2>",
      "<p>new</p><h2>anchor</h2>",
      "<h2>anchor</h2><p>new</p>",
      [
        [0, 0],
        [1, 1],
      ],
      [[1, 0]],
    ).result,
    null,
  );
  assert.equal(
    repair("<p>old</p>", "<p>old</p>", "<p>old</p><p>tail</p>", [[0, 0]], [])
      .result,
    null,
  );
});

test("an exhausted replacement slot does not consume another slot allowance", () => {
  const large = "long ".repeat(300);
  const x = repair(
    `<h1>a</h1><p>${large}</p><h2>b</h2><p>old</p><h3>c</h3>`,
    `<h1>a</h1><p>${large}changed</p><h2>b</h2><p><b>new</b></p><h3>c</h3>`,
    `<h1>a</h1><p>${large}changed</p><h2>b</h2><p>new</p><h3>c</h3>`,
    [
      [0, 0],
      [2, 2],
      [4, 4],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ],
    { limit: 2048 },
  );
  assert.ok(x.result);
  assert.equal(x.result[0].twin(x.base[1]), undefined);
  assert.equal(x.result[0].twin(x.base[3]), x.local[3]);
  assert.equal(
    repair("<p>old</p>", "<p>new</p>", "<p>new</p>", [[0, 0]], [], { limit: 0 })
      .result,
    null,
  );
});

for (const conflicts of ["local", "remote", "both"]) {
  test(`replacement owner keeps formatted rewrite and insertion, ${conflicts}`, () => {
    const x = mergeBodies(
      "<p>old</p>",
      "<p>new</p>",
      "<p><b>new</b></p><p>tail</p>",
      { conflicts },
    );
    assert.equal(x.html, "<p><b>new</b></p><p>tail</p>");
    assert.equal(x.res.conflicts.length, 0);
  });
  test(`replacement owner keeps echoed extension and insertion, ${conflicts}`, () => {
    const B = "<h2>t</h2><p>one two three</p><h3>u</h3>";
    const L =
      "<h2>t</h2><p>new para here</p><p>uno dos tres cuatro</p><h3>u</h3>";
    const R = "<h2>t</h2><p>uno dos tres</p><h3>u</h3>";
    const x = mergeBodies(B, L, R, { conflicts });
    assert.equal(x.html, L);
    assert.equal(x.res.conflicts.length, 0);
  });
}
