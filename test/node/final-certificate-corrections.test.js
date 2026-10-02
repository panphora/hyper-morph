import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

function plan(B, L, R, localPairs, remotePairs) {
  const base = Array.from(parse(doc(B)).body.children);
  const sides = [L, R].map((html) =>
    Array.from(parse(doc(html)).body.children),
  );
  const views = sides.map((units, side) => {
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
  return {
    base,
    local: sides[0],
    remote: sides[1],
    result: certificateGroups({
      base,
      views,
      eligible: (u) => u.nodeType === 1 && u.tagName === "P",
      ignored: () => false,
      remoteWins: () => false,
      baseId: (u) => u.id || null,
      atomKey: (u) => u.outerHTML,
    }),
  };
}

const B = "<p>alpha beta gamma delta</p>";
const R = "<p>alpha beta gamma DELTA</p>";

test("an exact remaining fragment excludes a competing partial insertion", async () => {
  const L = "<p>alpha beta</p><p>gamma new</p><p>gamma delta</p>";
  const x = plan(B, L, R, [[0, 0]], [[0, 0]]);
  assert.ok(x.result);
  assert.ok(x.result.certificates.length > 0);
  assert.ok(x.result.certificates.every((c) => c.target === x.local[2]));
  assert.equal(x.result.blocks.has(x.local[1]), false);
  const expected = "<p>alpha beta</p><p>gamma new</p><p>gamma DELTA</p>";
  for (const policy of ["local", "remote"])
    for (const reversed of [false, true]) {
      const local = reversed ? R : L,
        remote = reversed ? L : R;
      const merged = mergeBodies(B, local, remote, { conflicts: policy });
      assert.equal(merged.html, expected);
      assert.equal(merged.res.conflicts.length, 0);
      const live = parse(doc(local));
      const independent = reversed ? null : live.body.children[1];
      const report = await mergeDocument({
        live,
        base: doc(B),
        remote: doc(remote),
        conflicts: policy,
      });
      assert.equal(live.body.innerHTML, expected);
      assert.equal(report.conflicts.length, 0);
      if (independent) assert.equal(live.body.children[1], independent);
    }
});

test("two complete remaining-fragment candidates are refused without losing either insertion", () => {
  const L = "<p>alpha beta</p><p>gamma delta</p><p>gamma delta</p>";
  const x = plan(B, L, R, [[0, 0]], [[0, 0]]);
  assert.equal(x.result, null);
  const merged = mergeBodies(B, L, R);
  const root = parse(doc(merged.html)).body;
  assert.equal(
    Array.from(root.children).filter((p) => p.textContent === "gamma delta")
      .length,
    2,
  );
  assert.ok(root.textContent.includes("gamma DELTA"));
  assert.ok(merged.res.conflicts.length > 0);
});

test("an edited join has one exact adjacent owner interval", () => {
  const x = plan(
    "<p>A one</p><p>B two</p>",
    "<p>A uno B two</p>",
    "<p>A eins</p><p>B two</p>",
    [[1, 0]],
    [
      [0, 0],
      [1, 1],
    ],
  );
  assert.ok(x.result);
  const transferred = x.result.certificates.filter(
    (c) => c.source === x.base[0],
  );
  assert.equal(transferred.length, 1);
  assert.equal(transferred[0].target, x.local[0]);
  for (const run of transferred[0].runs)
    assert.equal(
      x.base[0].textContent.slice(run.from, run.to),
      x.local[0].textContent.slice(
        run.targetFrom,
        run.targetFrom + run.to - run.from,
      ),
    );
});

test("two adjacent owner intervals cannot claim one edited missing source", () => {
  const x = plan(
    "<p>A one</p><p>B two</p><p>C three</p>",
    "<p>A one B xxx</p><p>B yyy C three</p>",
    "<p>A one</p><p>B TWO</p><p>C three</p>",
    [
      [0, 0],
      [2, 1],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
  );
  assert.equal(x.result, null);
});

test("mixed exterior insertion runs route a named collision exactly once", async () => {
  const base = '<p id="source">a b c d</p>';
  for (const before of [true, false]) {
    const source = '<p id="source">a b c D</p>';
    const namedLocal = '<p id="port">local</p>';
    const namedRemote = '<p id="port">remote</p>';
    const anonymous = "<p>anonymous</p>";
    const split = '<p id="source">a b</p><p>c d</p>';
    const mergedSplit = '<p id="source">a b</p><p>c D</p>';
    const local = before ? namedLocal + source : source + namedLocal;
    const remote = before
      ? anonymous + namedRemote + split
      : split + namedRemote + anonymous;
    const expected = before
      ? anonymous + namedRemote + mergedSplit
      : mergedSplit + namedRemote + anonymous;
    const merged = mergeBodies(base, local, remote);
    assert.equal(merged.html, expected);
    assert.deepEqual(
      merged.res.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
      ["structure:insert-collision"],
    );
    const live = parse(doc(local));
    const port = live.getElementById("port");
    await mergeDocument({ live, base: doc(base), remote: doc(remote) });
    assert.equal(live.body.innerHTML, expected);
    assert.equal(live.querySelectorAll("#port").length, 1);
    assert.equal(live.getElementById("port"), port);
  }
});
