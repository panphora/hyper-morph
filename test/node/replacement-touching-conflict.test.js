import assert from "node:assert/strict";
import { test } from "node:test";
import { planNativeTransfers } from "../../src/native-transfers.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const mid = {
  b: "<p>c w d</p><p>w a c</p>",
  l: "<p>c w! d</p><p>w a c</p>",
  r: "<p>c R d</p><p>w w a c</p>",
};
const round4 = {
  b: '<main id="M"><p>c w</p><p>w a c</p></main>',
  l: '<main id="M"><p>c w L2</p><p>w a a c</p></main>',
  r: '<main id="M"><p>c R R2</p><p>w w a c</p></main>',
};
const orient = (input, mirror) =>
  mirror ? { ...input, l: input.r, r: input.l } : input;
const root = (d) => d.querySelector("main") || d.body;
function nativePlan(x) {
  const sides = Object.fromEntries(
    ["base", "local", "remote"].map((side, i) => [
      side,
      Array.from(root([x.b, x.l, x.r][i]).children),
    ]),
  );
  return planNativeTransfers({
    ...sides,
    nodes: sides,
    localTwin: (n) => x.res.L.map.get(n),
    remoteTwin: (n) => x.res.R.map.get(n),
    eligible: (n) => n.tagName === "P",
  });
}
function pureRecovery(x) {
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
}
async function liveTyping(input, conflicts, expected, conflictCount) {
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const owners = Array.from(root(live).children),
    texts = owners.map((n) => n.firstChild);
  const map = lockstepMap(captured.documentElement, live.documentElement);
  const prose = texts[0].data.startsWith("We ");
  const before = prose ? "We " : "c ",
    after = prose ? "We TYPED " : "c-TYPED ";
  texts[0].data = texts[0].data.replace(before, after);
  texts[1].data += " TYPED-DEST";
  const report = await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    conflicts,
    fastPath: false,
    scripts: { execute: false },
  });
  const wanted = parse(doc(expected));
  const wantedOwners = root(wanted).children;
  wantedOwners[0].textContent = wantedOwners[0].textContent.replace(
    before,
    after,
  );
  wantedOwners[1].textContent += " TYPED-DEST";
  assert.equal(live.body.innerHTML, wanted.body.innerHTML);
  assert.deepEqual(Array.from(root(live).children), owners);
  assert.deepEqual(
    owners.map((n) => n.firstChild),
    texts,
  );
  assert.equal(report.conflicts.length, conflictCount);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
  return report;
}
function exactNativeEvents(p) {
  assert.ok(p);
  assert.ok(p.transfers.length > 0);
  for (const e of p.transfers) {
    const flat = p.prepared[e.side],
      map = p.prepared[e.side + "Map"];
    assert.equal(e.be - e.bs, e.se - e.ss);
    assert.equal(
      p.prepared.base.text.slice(e.bs, e.be),
      flat.text.slice(e.ss, e.se),
    );
    for (let i = e.ss; i < e.se; i++) {
      assert.equal(map.toB[i], e.bs + i - e.ss);
      assert.equal(map.bTo[e.bs + i - e.ss], i);
    }
    for (let i = e.insertion.ss; i < e.insertion.se; i++)
      if (i < e.ss || i >= e.se) assert.equal(map.toB[i], -1);
    for (let i = e.deletion.ss; i < e.deletion.se; i++)
      assert.equal(map.toB[i], -1);
  }
  for (const side of ["base", "local", "remote"])
    for (const n of p.prepared[side].nodes)
      assert.equal(p.prepared[side].text.slice(n.s, n.e), n.node.data);
}

for (const mirror of [false, true])
  for (const policy of ["local", "remote", "both"])
    test(`replacement touching conflict: punctuation, mirror ${mirror}, policy ${policy}`, async () => {
      const input = orient(mid, mirror),
        x = mergeBodies(input.b, input.l, input.r, { conflicts: policy });
      assert.equal(nativePlan(x), null);
      const local = mirror ? "R" : "w!",
        remote = mirror ? "w!" : "R";
      const resolved =
        policy === "both"
          ? local + remote
          : policy === "local"
            ? local
            : remote;
      const expected = `<p>c ${resolved} d</p><p>w w a c</p>`;
      assert.equal(x.html, expected);
      assert.equal(x.res.conflicts.length, 1);
      const c = x.res.conflicts[0];
      assert.deepEqual(
        [c.base, c.local, c.remote, c.resolved],
        ["w", local, remote, resolved],
      );
      assert.equal(c.recovery.localLost, policy === "remote");
      for (const [side, length] of [
        ["base", 1],
        ["local", local.length],
        ["remote", remote.length],
        ["merged", resolved.length],
      ])
        assert.deepEqual(
          [c.recovery.text[side].start, c.recovery.text[side].end],
          [2, 2 + length],
        );
      pureRecovery(x);
      const report = await liveTyping(input, policy, expected, 1);
      assert.equal(report.conflicts[0].recovery.localLost, policy === "remote");
    });

for (const marked of ['"today"', "(today"])
  for (const mirror of [false, true])
    test(`replacement touching conflict: prose ${marked}, mirror ${mirror}`, async () => {
      const input = orient(
        {
          b: "<p>We ship today and rest.</p><p>Notes follow.</p>",
          l: `<p>We ship ${marked} and rest.</p><p>Notes follow.</p>`,
          r: "<p>We ship soon and rest.</p><p>Notes follow today.</p>",
        },
        mirror,
      );
      const x = mergeBodies(input.b, input.l, input.r);
      assert.equal(nativePlan(x), null);
      const selected = mirror ? marked : "soon";
      const expected = `<p>We ship ${selected} and rest.</p><p>Notes follow today.</p>`;
      assert.equal(x.html, expected);
      assert.equal(x.res.conflicts.length, 1);
      const c = x.res.conflicts[0];
      assert.deepEqual(
        [c.base, c.local, c.remote],
        ["today", mirror ? "soon" : marked, mirror ? marked : "soon"],
      );
      assert.deepEqual(
        [c.recovery.text.base.start, c.recovery.text.base.end],
        [8, 13],
      );
      pureRecovery(x);
      await liveTyping(input, "remote", expected, 1);
    });

for (const mirror of [false, true])
  test(`replacement touching conflict: whitespace at the actual shared edge, mirror ${mirror}`, () => {
    for (const [source, output] of [
      ["c w new d", "c R new d"],
      ["c new w d", "c new R d"],
      ["c w\tnew d", "c R\tnew d"],
      ["c new\tw d", "c new\tR d"],
    ]) {
      const input = orient(
        { ...mid, l: `<p>${source}</p><p>w a c</p>` },
        mirror,
      );
      const x = mergeBodies(input.b, input.l, input.r);
      exactNativeEvents(nativePlan(x));
      assert.equal(x.html, `<p>${output}</p><p>w w a c</p>`);
      assert.equal(x.res.conflicts.length, 0);
    }
    for (const source of ["c w! new d", "c new !w d"]) {
      const input = orient(
        { ...mid, l: `<p>${source}</p><p>w a c</p>` },
        mirror,
      );
      const x = mergeBodies(input.b, input.l, input.r);
      assert.equal(nativePlan(x), null);
      assert.equal(x.res.conflicts.length, 1);
      assert.equal(x.html, `<p>${mirror ? source : "c R d"}</p><p>w w a c</p>`);
      pureRecovery(x);
    }
  });

for (const mirror of [false, true])
  for (const policy of ["local", "remote", "both"])
    test(`replacement touching conflict: original round4 stays native, mirror ${mirror}, ${policy}`, async () => {
      const input = orient(round4, mirror),
        x = mergeBodies(input.b, input.l, input.r, { conflicts: policy });
      const p = nativePlan(x);
      exactNativeEvents(p);
      assert.equal(p.transfers.length, 1);
      const e = p.transfers[0];
      assert.equal(e.deletion.text, "R R2");
      assert.equal(e.insertion.text, "w ");
      assert.equal(e.be - e.bs, 1);
      assert.equal(p.prepared.base.text.slice(e.bs, e.be), "w");
      const expected = '<main id="M"><p>c R R2 L2</p><p>w w a a c</p></main>';
      assert.equal(x.html, expected);
      assert.equal(x.res.conflicts.length, 0);
      await liveTyping(input, policy, expected, 0);
    });

for (const mirror of [false, true])
  test(`replacement touching conflict: pure deletion and transferIn keep existing semantics, mirror ${mirror}`, async () => {
    for (const input0 of [
      {
        b: "<p>c w</p><p>a c</p>",
        l: "<p>c w!</p><p>a c</p>",
        r: "<p>c</p><p>a c w</p>",
        expected: "<p>c!</p><p>a c w</p>",
        deletion: true,
      },
      {
        b: "<p>c w</p><p>a c</p>",
        l: "<p>c w</p><p>A c</p>",
        r: "<p>c R</p><p>w a c</p>",
        expected: "<p>c R</p><p>w A c</p>",
        deletion: false,
      },
    ]) {
      const input = orient(input0, mirror),
        x = mergeBodies(input.b, input.l, input.r);
      const p = nativePlan(x);
      exactNativeEvents(p);
      assert.equal(p.transfers.length, 1);
      assert.equal(p.transfers[0].deletion.text === "", input0.deletion);
      assert.equal(x.html, input0.expected);
      assert.equal(x.res.conflicts.length, 0);
    }
  });

test("replacement touching conflict: genuine overlapping edit still declines", () => {
  for (const mirror of [false, true]) {
    const input = orient({ ...mid, l: "<p>c W d</p><p>w a c</p>" }, mirror);
    const x = mergeBodies(input.b, input.l, input.r);
    assert.equal(nativePlan(x), null);
    assert.equal(x.res.conflicts.length, 1);
    assert.deepEqual(
      [x.res.conflicts[0].local, x.res.conflicts[0].remote],
      mirror ? ["R", "W"] : ["W", "R"],
    );
    pureRecovery(x);
  }
});
