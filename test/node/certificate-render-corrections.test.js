import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { prepareInline, BREAK } from "../../src/inline-merge.js";
import { compileOccurrenceMap } from "../../src/occurrence-map.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

function planner(B, L, R, pairs) {
  const base = Array.from(parse(doc(B)).body.children);
  const sides = [L, R].map((html) =>
    Array.from(parse(doc(html)).body.children),
  );
  const views = sides.map((units, side) => {
    const map = new Map(),
      reverse = new Map(),
      identical = new Set();
    for (const [bi, si] of pairs[side]) {
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
  return (limit) =>
    certificateGroups({
      base,
      views,
      limit,
      eligible: (u) => u.nodeType === 1 && u.tagName === "P",
      ignored: () => false,
      remoteWins: () => false,
      baseId: (u) => u.id || null,
      atomKey: (u) => u.outerHTML,
    });
}

test("a certificate window publishes all targets or none at its work boundary", () => {
  const plan = planner(
    "<p>alpha beta gamma</p>",
    "<p>alpha</p><p>beta</p><p>gamma</p>",
    "<p>alpha beta gamma</p>",
    [[], [[0, 0]]],
  );
  const complete = plan();
  assert.ok(complete);
  assert.equal(complete.certificates.length, 3);
  let lo = 0,
    hi = 8192;
  assert.equal(plan(lo), null);
  assert.equal(plan(hi).certificates.length, 3);
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (plan(mid)) hi = mid;
    else lo = mid;
  }
  assert.equal(plan(lo), null);
  assert.equal(plan(hi).certificates.length, 3);
  for (let limit = Math.max(0, hi - 16); limit <= hi + 16; limit++) {
    const result = plan(limit);
    assert.ok(
      !result || result.certificates.length === 3,
      `partial publication at ${limit}`,
    );
  }
});

test("connected repeated joins certify every transferred source", () => {
  const B = "<p>w w w w</p>".repeat(4);
  const L = "<p>w w w w w w w w</p>".repeat(2);
  const plan = planner(B, L, B, [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ],
  ])();
  assert.ok(plan);
  assert.equal(new Set(plan.certificates.map((c) => c.source)).size, 3);
  assert.ok(plan.certificates.every((c) => c.runs.length > 0));
});

test("repeated joins route edits from both ambiguous middle and final sources", async () => {
  const B = "<p>w w w w</p>".repeat(4);
  const L = "<p>w w w w w w w w</p>".repeat(2);
  for (const [R, expected] of [
    [
      "<p>w w w w</p>".repeat(3) + "<p>w w w w X</p>",
      "<p>w w w w w w w w</p><p>w w w w w w w w X</p>",
    ],
    [
      "<p>w w w w</p><p>w w w w X</p>" + "<p>w w w w</p>".repeat(2),
      "<p>w w w w w w w w X</p><p>w w w w w w w w</p>",
    ],
  ]) {
    const merged = mergeBodies(B, L, R);
    assert.equal(merged.html, expected);
    assert.equal(merged.res.conflicts.length, 0);
    const live = parse(doc(L));
    await mergeDocument({ live, base: doc(B), remote: doc(R) });
    assert.equal(live.body.innerHTML, expected);
  }
});

test("a fused join keeps certified hard origins during echoed replacement pairing", () => {
  const base = {
    text: `alpha bravo${BREAK}charlie delta${BREAK}`,
    atoms: [],
    atomAt: new Map(),
    nodes: [],
  };
  const local = {
    text: `alpha bravo${BREAK}new para text${BREAK}`,
    atoms: [],
    atomAt: new Map(),
    nodes: [],
  };
  const remote = {
    text: `alpha bravocharlie delta${BREAK}new para text${BREAK}`,
    atoms: [],
    atomAt: new Map(),
    nodes: [],
  };
  const origins = compileOccurrenceMap({
    base,
    side: remote,
    retained: [
      { from: 0, to: 11, target: 0 },
      { from: 25, to: 26, target: 24 },
    ],
    transfers: [{ from: 12, to: 25, target: 11 }],
  });
  assert.equal(origins.status, "ready");
  const prepared = prepareInline(base, local, remote, {}, { remote: origins });
  for (let b = 0; b < base.text.length; b++) {
    if (!/[A-Za-z]/.test(base.text[b])) continue;
    const s = origins.bTo[b];
    assert.equal(prepared.remoteMap.bTo[b], s);
    assert.equal(prepared.remoteMap.toB[s], b);
  }
  assert.ok(prepared.remoteEdits.hunks.some((h) => h.lead));
});
