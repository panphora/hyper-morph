import assert from "node:assert/strict";
import { test } from "node:test";
import { planNativeTransfers } from "../../src/native-transfers.js";
import { mergeInline } from "../../src/inline-merge.js";
import { occurrenceBudget } from "../../src/occurrence-map.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const B = "<p>c w</p><p>w a c</p>",
  L = "<p>c w L2</p><p>w a a c</p>",
  R = "<p>c R R2</p><p>w w a c</p>",
  expected = "<p>c R R2 L2</p><p>w w a a c</p>";
function plan(b, l, r, options = {}) {
  const roots = [b, l, r].map((h) => parse(doc(h))),
    sides = Object.fromEntries(
      ["base", "local", "remote"].map((side, i) => [
        side,
        Array.from(roots[i].body.children),
      ]),
    );
  if (options.split)
    for (const list of Object.values(sides))
      for (const node of list) node.firstChild.splitText(1);
  return planNativeTransfers({
    ...sides,
    nodes: sides,
    localTwin: (n) => sides.local[sides.base.indexOf(n)],
    remoteTwin: (n) => sides.remote[sides.base.indexOf(n)],
    eligible: (n) => n.tagName === "P",
    ...(options.budget ? { budget: options.budget } : {}),
  });
}
function render(p) {
  const out = parse(doc(""));
  return mergeInline({
    base: p.owners.map((x) => x.base),
    local: p.owners.map((x) => x.local),
    remote: p.owners.map((x) => x.remote),
    out,
    blocks: p.blocks,
    prepared: p.prepared,
    nativeTransfers: p,
    policy: "both",
  });
}
for (const mirror of [false, true]) {
  test(`native replacement: original mirror ${mirror}, occurrence bounds`, () => {
    const p = plan(B, mirror ? R : L, mirror ? L : R, { split: true });
    assert.ok(p);
    assert.equal(p.transfers.length, 1);
    const e = p.transfers[0],
      side = mirror ? "local" : "remote",
      flat = p.prepared[side],
      map = p.prepared[side + "Map"];
    assert.equal(e.side, side);
    assert.equal(e.deletion.text, "R R2");
    assert.equal(e.insertion.text, "w ");
    assert.equal(e.be - e.bs, 1);
    assert.equal(e.se - e.ss, 1);
    assert.equal(p.prepared.base.text.slice(e.bs, e.be), "w");
    assert.equal(flat.text.slice(e.ss, e.se), "w");
    assert.equal(map.bTo[e.bs], e.ss);
    assert.equal(map.toB[e.ss], e.bs);
    for (let i = e.insertion.ss; i < e.insertion.se; i++)
      if (i < e.ss || i >= e.se) assert.equal(map.toB[i], -1);
    for (let i = e.deletion.ss; i < e.deletion.se; i++)
      assert.equal(map.toB[i], -1);
    for (const side of ["base", "local", "remote"])
      for (const n of p.prepared[side].nodes)
        assert.equal(p.prepared[side].text.slice(n.s, n.e), n.node.data);
    const res = render(p);
    assert.equal(res.nodes.map((n) => n.outerHTML).join(""), expected);
    assert.equal(res.conflicts.length, 0);
    if (!mirror) {
      assert.equal(res.lToM[2], res.text.indexOf("w w") + 2);
      assert.equal(
        res.lToM[p.prepared.local.text.indexOf("w a")],
        res.text.indexOf("w w"),
      );
      assert.equal(res.lToM[3], res.text.indexOf(" L2"));
    }
  });
  for (const conflicts of ["local", "remote", "both"])
    test(`native replacement: original mirror ${mirror}, policy ${conflicts}`, () => {
      const x = mergeBodies(B, mirror ? R : L, mirror ? L : R, { conflicts });
      assert.equal(x.html, expected);
      assert.equal(x.res.conflicts.length, 0);
    });
  test(`native replacement: mirror ${mirror}, native owners and disjoint live typing`, async () => {
    const local = mirror ? R : L,
      remote = mirror ? L : R,
      live = parse(doc(local)),
      captured = parse(doc(local)),
      owners = Array.from(live.body.children),
      texts = owners.map((n) => n.firstChild),
      map = lockstepMap(captured.documentElement, live.documentElement);
    texts[0].data = texts[0].data.replace("c ", "C ");
    texts[1].data += " TYPED";
    const report = await mergeDocument({
      live,
      base: doc(B),
      remote: doc(remote),
      local: {
        root: captured.documentElement,
        toLive: (n) => map.get(n) || null,
      },
      conflicts: "both",
      fastPath: false,
      scripts: { execute: false },
    });
    assert.equal(
      live.body.innerHTML,
      expected.replace("<p>c ", "<p>C ").replace("a c</p>", "a c TYPED</p>"),
    );
    assert.deepEqual(Array.from(live.body.children), owners);
    assert.deepEqual(
      owners.map((n) => n.firstChild),
      texts,
    );
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(
      recoveryProblems(
        report.conflicts,
        finalTree(live.documentElement),
        false,
      ),
      [],
    );
  });
}

test("native replacement: whitespace remains physical and only the core maps", () => {
  const b = "<p>keep word</p><p>stay</p>",
    l = "<p>keep word L</p><p>stay</p>",
    r = "<p>keep NEW</p><p>stay  word </p>";
  const p = plan(b, l, r);
  assert.ok(p);
  const e = p.transfers[0],
    h = e.insertion;
  assert.equal(h.text, "  word ");
  assert.equal(p.prepared.remote.text.slice(e.ss, e.se), "word");
  for (let i = h.ss; i < h.se; i++)
    assert.equal(
      p.prepared.remoteMap.toB[i],
      i >= e.ss && i < e.se ? e.bs + i - e.ss : -1,
    );
  assert.equal(
    render(p)
      .nodes.map((n) => n.outerHTML)
      .join(""),
    "<p>keep NEW L</p><p>stay  word </p>",
  );
});

test("native replacement: echoed insertion uses event side despite shifted side offsets", () => {
  const b = "<p>c w</p><p>x y</p>",
    l = "<p>LOCAL c R</p><p>x y w </p>",
    r = "<p>c R</p><p>x y w </p>";
  const p = plan(b, l, r);
  assert.ok(p);
  assert.equal(p.transfers.length, 2);
  const a = p.transfers.find((e) => e.side === "local"),
    z = p.transfers.find((e) => e.side === "remote");
  assert.equal(a.key, z.key);
  assert.notEqual(a.ss, z.ss);
  const res = render(p);
  assert.equal(
    res.nodes.map((n) => n.outerHTML).join(""),
    "<p>LOCAL c R</p><p>x y w </p>",
  );
  assert.equal(res.lToM[a.ss], res.text.lastIndexOf("w"));
  assert.equal(res.conflicts.length, 0);
});

test("native replacement: complete multiple-word run transports exactly", () => {
  const b = "<p>keep red blue</p><p>stay</p>",
    l = "<p>keep red blue L</p><p>stay</p>",
    r = "<p>keep NEW</p><p>stay red blue</p>";
  const p = plan(b, l, r);
  assert.ok(p);
  const e = p.transfers[0];
  assert.equal(p.prepared.base.text.slice(e.bs, e.be), "red blue");
  assert.equal(p.prepared.remote.text.slice(e.ss, e.se), "red blue");
  assert.equal(
    render(p)
      .nodes.map((n) => n.outerHTML)
      .join(""),
    "<p>keep NEW L</p><p>stay red blue</p>",
  );
});

test("native replacement: duplicate removed or inserted cores refuse", () => {
  const b = "<p>a word</p><p>b word</p><p>c</p><p>d</p>";
  assert.equal(plan(b, b, "<p>a X</p><p>b Y</p><p>c word</p><p>d</p>"), null);
  const one = "<p>a word</p><p>b</p><p>c</p>";
  assert.equal(plan(one, one, "<p>a X</p><p>b word</p><p>c word </p>"), null);
});

test("native replacement: competing replacement invalidates an old exact deletion event", () => {
  const b = "<p>a word</p><p>b word</p><p>c</p>";
  assert.equal(plan(b, b, "<p>a</p><p>b X</p><p>c word</p>"), null);
});

test("native replacement: unrelated exact deletion event keeps its original single claim", () => {
  const b = "<p>a word</p><p>b red</p><p>c</p><p>d</p>",
    r = "<p>a</p><p>b X</p><p>c word</p><p>d red</p>";
  const p = plan(b, b, r);
  assert.ok(p);
  assert.equal(p.transfers.length, 2);
  const deletions = new Set(p.transfers.map((e) => e.deletion)),
    insertions = new Set(p.transfers.map((e) => e.insertion));
  assert.equal(deletions.size, 2);
  assert.equal(insertions.size, 2);
  for (const e of p.transfers) {
    assert.equal(e.deletion.transferOut, e);
    assert.equal(e.insertion.transferIn, e);
    assert.equal(e.be - e.bs, e.se - e.ss);
  }
});

test("native replacement: same-owner move, full-owner replacement and copies refuse", () => {
  assert.equal(
    plan(
      "<p>c w a</p><p>b</p>",
      "<p>c w a</p><p>b</p>",
      "<p>c R a w</p><p>b</p>",
    ),
    null,
  );
  assert.equal(
    plan(
      "<p>word</p><p>b</p>",
      "<p>word</p><p>b</p>",
      "<p>NEW</p><p>b word</p>",
    ),
    null,
  );
  assert.equal(plan(B, L, "<p>c w</p><p>w w a c</p>"), null);
});

test("native replacement: opposite edits through the transported original still conflict", () => {
  const l = "<p>c W</p><p>w a c</p>";
  assert.equal(plan(B, l, R), null);
  const x = mergeBodies(B, l, R, { conflicts: "remote" });
  assert.ok(x.res.conflicts.length > 0);
  const roots = {
    base: x.b.documentElement,
    local: x.l.documentElement,
    remote: x.r.documentElement,
    merged: x.res.doc.documentElement,
  };
  assert.deepEqual(
    recoveryProblems(x.res.conflicts, finalTree(roots.merged), true, roots),
    [],
  );
});

test("native replacement: no partial token match or cap claim", () => {
  assert.equal(
    plan("<p>c aw</p><p>b</p>", "<p>c aw</p><p>b</p>", "<p>c aR</p><p>b w</p>"),
    null,
  );
  const budget = occurrenceBudget(1);
  assert.equal(plan(B, L, R, { budget }), null);
  assert.equal(budget.mapCells, 0);
});

test("native replacement: typing on the moved native occurrence follows it once", async () => {
  const live = parse(doc(L)),
    captured = parse(doc(L)),
    map = lockstepMap(captured.documentElement, live.documentElement),
    owner = live.body.firstChild,
    text = owner.firstChild;
  text.data = "c w! L2";
  const report = await mergeDocument({
    live,
    base: doc(B),
    remote: doc(R),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    conflicts: "both",
    fastPath: false,
    scripts: { execute: false },
  });
  assert.equal(live.body.innerHTML, "<p>c R R2 L2</p><p>w w! a a c</p>");
  assert.equal(live.body.firstChild, owner);
  assert.equal(owner.firstChild, text);
  assert.deepEqual(report.conflicts, []);
});

test("native replacement: earlier destination preserves native owner order on both sides", () => {
  const b = "<p>w a c</p><p>c w</p>",
    l = "<p>w a a c</p><p>c w L2</p>",
    r = "<p>w w a c</p><p>c R R2</p>";
  for (const mirror of [false, true]) {
    const p = plan(b, mirror ? r : l, mirror ? l : r);
    assert.ok(p);
    assert.equal(p.transfers.length, 1);
    const e = p.transfers[0];
    assert.equal(e.source, p.owners[1].base);
    assert.equal(e.destination, p.owners[0].base);
    assert.equal(p.prepared[e.side + "Map"].monotone, false);
    assert.equal(
      render(p)
        .nodes.map((n) => n.outerHTML)
        .join(""),
      "<p>w w a a c</p><p>c R R2 L2</p>",
    );
  }
});
