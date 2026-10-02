import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocument } from "../../src/index.js";
import {
  certificateGroups,
  certifiedOrigins,
} from "../../src/certificate-groups.js";
import { flatten } from "../../src/inline-merge.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const cases = {
  editedJoin: {
    b: "<p>a1 b1 x1 y1</p><p>c1 d1</p>",
    l: "<p>a1 b1 x1 y1 c1 D1</p>",
    r: "<p>a1 b1 x1 Y1</p><p>c1 d1</p>",
    output: "<p>a1 b1 x1 Y1 c1 D1</p>",
  },
  editedDestination: {
    b: "<p>a1 b1 c1</p><p>d1 e1</p>",
    l: "<p>a1 b1 C1</p><p>d1 e1</p>",
    r: "<p>a1 b1</p><p>c1 d1 e1 NEW</p>",
    output: "<p>a1 b1</p><p>C1 d1 e1 NEW</p>",
  },
  slotJoin: {
    b: "<p>w0 w1</p><p>w2 w3 w4 w5</p>",
    l: "<p>n0 n1</p><p>w0 w1 w2 w3 w4 w5</p>",
    r: "<p>w0 w1</p><p>w3 w4 w5</p>",
    output: "<p>n0 n1</p><p>w0 w1 w3 w4 w5</p>",
  },
  slotSplit: {
    b: "<p>w0 w1</p><p>w2 w3 w4</p>",
    l: "<p>w0</p><p>w1</p>",
    r: "<p>w0 w1</p><p>w2 w3</p><p>w4</p>",
    output: "<p>w0</p><p>w1</p><p>w2 w3</p><p>w4</p>",
  },
};

function planning(input, options = {}) {
  const x = mergeBodies(input.b, input.l, input.r);
  const units = [x.b, x.l, x.r].map((d) => Array.from(d.body.children));
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    V: {
      units: units[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[side + 1].includes(u),
    },
    idOf: (u) => u.id || null,
  }));
  const result = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    ...options,
  });
  return { ...x, result, units, views };
}

async function dirty(input, typing = []) {
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const owners = Array.from(live.body.children);
  const map = lockstepMap(captured.documentElement, live.documentElement);
  for (const [index, text] of typing) owners[index].firstChild.data = text;
  const report = await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    scripts: { execute: false },
    fastPath: false,
  });
  return { live, owners, captured, report };
}

for (const [name, input] of Object.entries(cases)) {
  test(`exact admission: ${name} preserves both readings in pure output`, () => {
    const x = mergeBodies(input.b, input.l, input.r);
    assert.equal(x.html, input.output);
    assert.equal(x.res.conflicts.length, name === "slotSplit" ? 1 : 0);
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
    if (name === "slotSplit") {
      const conflict = x.res.conflicts[0];
      assert.equal(conflict.kind, "text");
      assert.equal(conflict.base, "<p>w2 w3 w4</p>");
      assert.equal(conflict.local, "");
      assert.equal(conflict.remote, "<p>w2 w3</p><p>w4</p>");
    }
  });
  test(`exact admission: ${name} preserves each live local owner once`, async () => {
    const x = await dirty(input);
    assert.equal(x.live.body.innerHTML, input.output);
    for (const [i, owner] of x.owners.entries()) {
      assert.equal(x.live.body.children[i], owner);
      assert.equal(
        Array.from(x.live.body.children).filter((n) => n === owner).length,
        1,
      );
    }
    assert.deepEqual(
      recoveryProblems(
        x.report.conflicts,
        finalTree(x.live.documentElement),
        false,
      ),
      [],
    );
  });
}

for (const [name, side, range] of [
  ["editedDestination", 1, [6, 8, 0]],
  ["slotJoin", 0, [0, 5, 0]],
  ["slotSplit", 0, [3, 5, 0]],
]) {
  test(`exact admission: ${name} retains nonzero native occurrence provenance`, () => {
    const x = planning(cases[name]);
    const source = x.units[0][0],
      target = x.units[side + 1][1];
    const certificates = x.result.certificates.filter(
      (c) => c.side === side && c.source === source && c.target === target,
    );
    assert.equal(certificates.length, 1);
    assert.deepEqual(
      certificates[0].runs.map((r) => [r.from, r.to, r.targetFrom]),
      [range],
    );
    for (const model of x.result.models.values())
      for (const native of model.flat.nodes) {
        assert.equal(native.node.parentNode, model.unit);
        assert.equal(native.s, 0);
        assert.equal(native.e, native.node.data.length);
        assert.equal(model.flat.text, native.node.data);
      }
    const flats = x.units.map((units) =>
      flatten(units, { blocks: x.result.blocks }),
    );
    const origins = certifiedOrigins({
      certificates: x.result.certificates,
      scopes: x.units,
      flats,
      keys: [(a) => a.el, (a) => a.el, (a) => a.el],
    });
    const projected = side ? origins.remote : origins.local;
    assert.equal(projected.status, "ready");
    assert.ok(projected.runs.some((r) => r.kind === "transfer"));
    const sourceStart = flats[0].nodes.find(
      (r) => r.node === source.firstChild,
    ).s;
    const targetStart = flats[side + 1].nodes.find(
      (r) => r.node === target.firstChild,
    ).s;
    assert.equal(projected.bTo[sourceStart + range[0]], targetStart + range[2]);
  });
}

test("exact admission: disjoint typing survives on both sides of an edited destination transfer", async () => {
  const x = await dirty(cases.editedDestination, [
    [0, "a1 TYPED b1 C1"],
    [1, "d1 TYPED e1"],
  ]);
  assert.equal(
    x.live.body.innerHTML,
    "<p>a1 TYPED b1</p><p>C1 d1 TYPED e1 NEW</p>",
  );
  assert.equal(x.report.localDiverged, true);
  for (const [i, owner] of x.owners.entries())
    assert.equal(x.live.body.children[i], owner);
});

test("exact admission: disjoint typing survives in a joined owner and its unrelated weak slot", async () => {
  const x = await dirty(cases.slotJoin, [
    [0, "n0 TYPED n1"],
    [1, "w0 TYPED w1 w2 w3 w4 TYPED w5"],
  ]);
  assert.equal(
    x.live.body.innerHTML,
    "<p>n0 TYPED n1</p><p>w0 TYPED w1 w3 w4 TYPED w5</p>",
  );
  assert.equal(x.report.localDiverged, true);
  for (const [i, owner] of x.owners.entries())
    assert.equal(x.live.body.children[i], owner);
});

test("exact admission: duplicate missing-residual occurrences leave membership unclaimed", () => {
  const input = {
    ...cases.editedDestination,
    r: "<p>a1 b1</p><p>c1 d1 e1 NEW c1</p>",
  };
  const x = planning(input);
  assert.equal(x.views[1].V.twin(x.units[0][0]), x.units[2][0]);
  assert.equal(x.views[1].V.twin(x.units[0][1]), x.units[2][1]);
  assert.equal((x.units[2][1].textContent.match(/c1/g) || []).length, 2);
  assert.equal(x.result, null);
});

test("exact admission: duplicate interior whole-owner occurrences leave membership unclaimed", () => {
  const input = {
    ...cases.editedDestination,
    r: "<p>a1 b1</p><p>c1 d1 e1 NEW d1 e1 END</p>",
  };
  const x = planning(input);
  assert.equal(x.views[1].V.twin(x.units[0][1]), x.units[2][1]);
  assert.equal((x.units[2][1].textContent.match(/d1 e1/g) || []).length, 2);
  assert.equal(x.result, null);
});

test("exact admission: a weak target retaining hard owner text is not an unrelated slot", () => {
  const x = planning({
    b: "<p>w0 w1</p><p>old here there</p>",
    l: "<p>w0</p><p>w1 there NEW</p>",
    r: "<p>w0 w1</p><p>old here there END</p>",
  });
  assert.equal(x.res.L.weak.has(x.units[0][1]), true);
  assert.equal(x.res.L.map.get(x.units[0][1]), x.units[1][1]);
  assert.equal(x.units[1][1].textContent.includes("there"), true);
  assert.equal(x.result, null);
});

test("exact admission: a source that retains hard content plus a rewrite cannot claim a full transfer", () => {
  const x = planning({
    b: "<p>w0 w1 w2</p><p>w3 w4 w5</p>",
    l: "<p>w0 NEW</p><p>w1 w2 w3 w4 w5</p>",
    r: "<p>w0 w1 w2</p><p>w3 w4 END</p>",
  });
  assert.equal(x.res.L.map.get(x.units[0][0]), x.units[1][0]);
  assert.equal(x.units[1][0].textContent.includes("w0"), true);
  assert.equal(x.result, null);
});

test("exact admission: genuine complete copies retain separate outputs without transfer claims", () => {
  const input = {
    b: "<p>w0 w1</p><p>w2 w3 w4</p>",
    l: "<p>w0 w1</p><p>w0 w1</p>",
    r: "<p>w0 W1</p><p>w2 w3 w4</p>",
  };
  const x = planning(input);
  assert.equal(x.res.L.map.get(x.units[0][0]), x.units[1][0]);
  assert.equal(x.units[1][0].textContent, x.units[1][1].textContent);
  assert.equal(x.result, null);
  assert.equal(x.html, "<p>w0 W1</p><p>w0 w1</p>");
});

for (const [name, input, owner, side] of [
  [
    "source",
    {
      b: '<p id="a">w0 w1</p><p>w2 w3 w4 w5</p>',
      l: '<p id="a">n0 n1</p><p>w0 w1 w2 w3 w4 w5</p>',
      r: '<p id="a">w0 w1</p><p>w3 w4 w5</p>',
    },
    0,
    0,
  ],
  [
    "target",
    {
      b: '<p>w0 w1</p><p id="b">w2 w3 w4</p>',
      l: '<p>w0</p><p id="b">w1</p>',
      r: '<p>w0 w1</p><p id="b">w2 w3</p><p>w4</p>',
    },
    1,
    0,
  ],
]) {
  test(`exact admission: an explicit ${name} identity pair is not an unrelated weak slot`, () => {
    const x = planning(input);
    assert.equal(x.views[side].A.identityPaired.has(x.units[0][owner]), true);
    assert.equal(
      x.views[side].V.twin(x.units[0][owner]),
      x.units[side + 1][owner],
    );
    assert.equal(
      (x.result?.certificates || []).some(
        (c) => c.side === side && c.source === x.units[0][0],
      ),
      false,
    );
  });
}

test("exact admission: a bounded proof declines the complete window when its work is exhausted", () => {
  const admitted = planning(cases.editedDestination);
  assert.ok(admitted.result.certificates.length > 0);
  const refused = planning(cases.editedDestination, { limit: 32 });
  assert.equal(refused.result, null);
});

test("exact admission: split residual typing retains both complete local owner mappers", async () => {
  const input = {
    b: "<p>left keep right tail</p><p>other owner words</p>",
    l: "<p>left keep</p><p>right tail</p>",
    r: "<p>left keep right tail</p><p>other owner</p><p>words</p>",
  };
  const p = planning(input);
  assert.equal(p.res.L.weak.has(p.units[0][1]), true);
  assert.ok(
    p.result.certificates.some(
      (c) =>
        c.side === 0 &&
        c.source === p.units[0][0] &&
        c.target === p.units[1][1],
    ),
  );
  for (const local of p.units[1]) {
    const segment = p.res.segments.find((s) =>
      s.localNodes.some((n) => n.node === local.firstChild),
    );
    assert.ok(segment);
    const native = segment.localNodes.find((n) => n.node === local.firstChild);
    assert.equal(native.e - native.s, local.firstChild.data.length);
    assert.equal(
      segment.flatLocal.slice(native.s, native.e),
      local.firstChild.data,
    );
    assert.equal(segment.lToM.length, segment.flatLocal.length + 1);
  }
  const x = await dirty(input, [
    [0, "left TYPED keep"],
    [1, "right TYPED tail"],
  ]);
  assert.equal(
    x.live.body.innerHTML,
    "<p>left TYPED keep</p><p>right TYPED tail</p><p>other owner</p><p>words</p>",
  );
  assert.equal(x.report.localDiverged, true);
  for (const [i, owner] of x.owners.entries())
    assert.equal(x.live.body.children[i], owner);
  assert.deepEqual(
    recoveryProblems(
      x.report.conflicts,
      finalTree(x.live.documentElement),
      false,
    ),
    [],
  );
});
