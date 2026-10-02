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

const fixture = {
  b: '<ul><li>w0 w1 w2 w3</li><li>w4 w5 w6 w7 <b>w9</b> w8</li><li>w10 w11 <b>w13 w14</b> <img src="i15.png"> w12</li></ul><p>w16 w17 w18 w19 w20</p>',
  l: '<ul><li>w0 w1 w2 w3</li><li>w4 w5 w6 w7 <b>w9</b> w8 w10 w11 <b>w13 w14</b> <img src="i15.png"> w12</li><li>w21 w22 <b>w24 w25</b> w23</li></ul><p>w16 w17 w18 w19 w20</p>',
  r: '<ul><li>w0 w1 w2 w3</li><li>w26 w27</li><li>w10 w11 <b>w13 w14</b> <img src="i15.png"> w12</li></ul><p>w16 w17 w18 w19 w20</p>',
};
const expected =
  '<ul><li>w0 w1 w2 w3</li><li>w26 w27 w10 w11 <b>w13 w14</b> <img src="i15.png"> w12</li><li>w21 w22 <b>w24 w25</b> w23</li></ul><p>w16 w17 w18 w19 w20</p>';

function planning(input = fixture, omitAtomAlignment = false) {
  const x = mergeBodies(input.b, input.l, input.r);
  const units = [x.b, x.l, x.r].map((d) =>
    Array.from(d.querySelector("ul").children),
  );
  if (omitAtomAlignment) x.res.L.reverse.delete(x.l.querySelector("img"));
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    idOf: (u) => u.id || null,
    V: {
      units: units[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[side + 1].includes(u),
    },
  }));
  const plan = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "LI",
    ignored: () => false,
    remoteWins: () => false,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
  });
  return { ...x, units, plan };
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

async function dirty(input = fixture, mutate = () => {}, conflicts = "remote") {
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const owners = Array.from(live.querySelector("ul").children);
  const mark = owners[1].querySelectorAll("b")[1],
    image = live.querySelector("img"),
    insertedMark = owners[2].querySelector("b");
  const map = lockstepMap(captured.documentElement, live.documentElement);
  mutate(owners);
  const report = await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    conflicts,
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    fastPath: false,
    scripts: { execute: false },
  });
  for (const [i, owner] of owners.entries())
    assert.equal(live.querySelector("ul").children[i], owner);
  assert.equal(owners[1].querySelector("b"), mark);
  assert.equal(owners[1].querySelector("img"), image);
  assert.equal(owners[2].querySelector("b"), insertedMark);
  assert.equal(live.querySelectorAll("img").length, 1);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
  return { live, report, owners, image };
}

for (const policy of ["local", "remote"]) {
  for (const reversed of [false, true]) {
    test(`seed 3133: exact atom transfer survives ${policy} policy, reversed=${reversed}`, () => {
      const x = mergeBodies(
        fixture.b,
        reversed ? fixture.r : fixture.l,
        reversed ? fixture.l : fixture.r,
        { conflicts: policy },
      );
      assert.equal(x.html, expected);
      assert.deepEqual(x.res.conflicts, []);
      pureRecovery(x);
    });
  }
}

test("seed 3133: the full native source and its aligned image have nonzero origins", () => {
  const x = planning();
  assert.ok(x.plan);
  const source = x.units[0][2],
    target = x.units[1][1];
  assert.equal(x.res.L.weak.has(source), true);
  assert.equal(x.res.L.identityPaired.has(source), false);
  const certificates = x.plan.certificates.filter(
    (c) => c.side === 0 && c.source === source && c.target === target,
  );
  assert.equal(certificates.length, 1);
  assert.deepEqual(
    certificates[0].runs.map((r) => [r.from, r.to, r.targetFrom]),
    [[0, 21, 18]],
  );
  const sourceModel = x.plan.models.get(source).flat;
  assert.equal(sourceModel.atoms.length, 1);
  assert.equal(sourceModel.atoms[0].i, 16);
  assert.equal(
    x.res.L.reverse.get(target.querySelector("img")),
    sourceModel.atoms[0].el,
  );
  for (const { flat } of x.plan.models.values())
    for (const range of flat.nodes) {
      assert.equal(range.e - range.s, range.node.data.length);
      assert.equal(flat.text.slice(range.s, range.e), range.node.data);
    }
  const flats = x.units.map((units) =>
    flatten(units, { blocks: x.plan.blocks }),
  );
  const origins = certifiedOrigins({
    certificates: x.plan.certificates,
    scopes: x.units,
    flats,
    keys: [
      (a) => a.el,
      (a) => x.res.L.reverse.get(a.el) || a.el,
      (a) => x.res.R.reverse.get(a.el) || a.el,
    ],
  });
  assert.equal(origins.local.status, "ready");
  assert.ok(origins.local.runs.some((r) => r.kind === "transfer"));
  const baseAtom = flats[0].atoms.find(
    (a) => a.el === source.querySelector("img"),
  );
  const localAtom = flats[1].atoms.find(
    (a) => a.el === target.querySelector("img"),
  );
  assert.equal(origins.local.bTo[baseAtom.i], localAtom.i);
  for (const segment of x.res.segments)
    for (const range of segment.localNodes) {
      assert.equal(range.e - range.s, range.node.data.length);
      assert.equal(segment.flatLocal.slice(range.s, range.e), range.node.data);
    }
});

test("seed 3133: live owners, moved mark, atom, and captured typing remain native", async () => {
  const x = await dirty(fixture, (owners) => {
    owners[1].childNodes[2].data = owners[1].childNodes[2].data.replace(
      "w10 w11",
      "w10 TYPED w11",
    );
    owners[2].firstChild.data = owners[2].firstChild.data.replace(
      "w21 w22",
      "w21 TYPED w22",
    );
  });
  assert.equal(
    x.live.body.innerHTML,
    expected
      .replace("w10 w11", "w10 TYPED w11")
      .replace("w21 w22", "w21 TYPED w22"),
  );
  assert.deepEqual(x.report.conflicts, []);
});

test("seed 3133: remote native text, mark, and atom edits follow the exact transfer", async () => {
  const input = {
    ...fixture,
    r: fixture.r
      .replace("w10 w11", "w10 W11")
      .replace("w13 w14", "W13 w14")
      .replace("i15.png", "remote.png"),
  };
  const output = expected
    .replace("w10 w11", "w10 W11")
    .replace("w13 w14", "W13 w14")
    .replace("i15.png", "remote.png");
  const pure = mergeBodies(input.b, input.l, input.r);
  assert.equal(pure.html, output);
  assert.deepEqual(pure.res.conflicts, []);
  const x = await dirty(input);
  assert.equal(x.live.body.innerHTML, output);
  assert.deepEqual(x.report.conflicts, []);
});

for (const policy of ["local", "remote"]) {
  test(`seed 3133: an identified moved image keeps ${policy} attribute recovery`, async () => {
    const input = {
      b: fixture.b.replace("<img", '<img id="photo"'),
      l: fixture.l
        .replace("<img", '<img id="photo"')
        .replace("i15.png", "local.png"),
      r: fixture.r
        .replace("<img", '<img id="photo"')
        .replace("i15.png", "remote.png"),
    };
    const output = expected
      .replace("<img", '<img id="photo"')
      .replace("i15.png", `${policy}.png`);
    const pure = mergeBodies(input.b, input.l, input.r, { conflicts: policy });
    assert.equal(pure.html, output);
    assert.equal(pure.res.conflicts.length, 1);
    assert.equal(pure.res.conflicts[0].kind, "attr");
    assert.equal(pure.res.conflicts[0].name, "src");
    pureRecovery(pure);
    const x = await dirty(input, () => {}, policy);
    assert.equal(x.live.body.innerHTML, output);
    assert.equal(x.report.conflicts.length, 1);
    assert.equal(x.report.conflicts[0].recovery.unavailable, null);
    assert.ok(x.report.conflicts[0].recovery.subject.live.includes(x.image));
  });
}

test("seed 3133: a content-identical unpaired atom cannot certify the native source", () => {
  const admitted = planning();
  assert.ok(admitted.plan?.certificates.length > 0);
  const x = planning(fixture, true);
  assert.equal(
    x.b.querySelector("img").outerHTML,
    x.l.querySelector("img").outerHTML,
  );
  assert.equal(x.res.L.reverse.has(x.l.querySelector("img")), false);
  assert.equal(x.plan, null);
});

test("seed 3133: two complete residual occurrences remain ambiguous", () => {
  const x = planning({
    ...fixture,
    l: fixture.l.replace(
      " w12</li>",
      ' w12 w10 w11 <b>w13 w14</b> <img src="i15.png"> w12</li>',
    ),
  });
  assert.equal(x.l.querySelectorAll("img").length, 2);
  assert.equal(x.plan, null);
});
