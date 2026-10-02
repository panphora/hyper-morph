import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocument } from "../../src/index.js";
import {
  certificateGroups,
  certifiedOrigins,
} from "../../src/certificate-groups.js";
import { flatten } from "../../src/inline-merge.js";
import { generate, setIdMode } from "../lib/structure-fuzz.js";
import {
  finalTree,
  recoveryProblems,
  lockstepMap,
} from "../lib/differential-observe.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";

function fixture(seed, mode) {
  setIdMode(mode);
  try {
    return generate(seed);
  } finally {
    setIdMode(0);
  }
}
function pure(input) {
  const x = mergeBodies(input.b, input.l, input.r);
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
  return x;
}
async function dirty(input, type) {
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const originals = [...live.querySelectorAll("p,b,img")];
  const map = lockstepMap(captured.documentElement, live.documentElement);
  type?.(live);
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
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
  return { live, report, originals };
}
function check706(root, conflicts, input) {
  const expected = parse(doc(input.l));
  expected.body.lastElementChild.lastChild.data = " w20 w14 w8 w9 w10 w11 w12";
  assert.equal(root.body.innerHTML, expected.body.innerHTML);
  for (const selector of [
    '[data-id="b2"]',
    'img[src="i6.png"]',
    'img[src="i13.png"]',
  ])
    assert.equal(root.querySelectorAll(selector).length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, "text");
  assert.equal(conflicts[0].base, "w7");
  assert.equal(conflicts[0].local, "w15 w14");
  assert.equal(conflicts[0].remote, "w20 w14");
}
function check695(root, conflicts) {
  assert.equal(
    root.body.firstElementChild.innerHTML,
    '<p data-id="b1">w0 w1</p><p><b>w3</b></p><p data-id="b5">w16</p>',
  );
  assert.equal(root.querySelectorAll("b").length, 1);
  assert.equal(root.querySelectorAll('img[src="i10.png"]').length, 1);
  assert.equal(
    (root.body.innerHTML.replace(/<[^>]*>/g, " ").match(/\bw3\b/g) || [])
      .length,
    1,
  );
  assert.equal(root.body.textContent.includes("w2"), false);
  assert.equal(root.body.children[1].textContent, "w12 w13 w14 w15");
  assert.equal(
    root.body.lastElementChild.innerHTML,
    'w11 w4 <img src="i10.png"> w5 w6 w7 w8 w9',
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, "attr");
  assert.equal(conflicts[0].local, "b4");
  assert.equal(conflicts[0].remote, "b5");
}
for (const mode of [1, 4, 6]) {
  test(`certified port: exact706 mode${mode} preserves independent output and native provenance`, () => {
    const input = fixture(706, mode),
      x = pure(input);
    check706(x.res.doc, x.res.conflicts, input);
    const native = x.l.body.children[1];
    assert.equal(
      x.res.provenance.get(x.res.doc.body.children[1]).local,
      native,
    );
    assert.equal(x.res.L.reverse.has(native), false);
    const tail = x.l.body.children[2];
    const segment = x.res.segments.find((s) =>
      s.localNodes.some((n) => n.node === tail.firstChild),
    );
    assert.ok(segment);
    assert.equal(segment.flatLocal, "w1 w2 \ufffc w3 w4 w5");
    for (const range of segment.localNodes) {
      assert.equal(segment.flatLocal.slice(range.s, range.e), range.node.data);
      assert.equal(range.e - range.s, range.node.data.length);
    }
    assert.equal(segment.lToM.length, segment.flatLocal.length + 1);
  });
  test(`certified port: exact706 mode${mode} preserves all live owners and atoms`, async () => {
    const input = fixture(706, mode),
      x = await dirty(input);
    check706(x.live, x.report.conflicts, input);
    for (const node of x.originals) assert.equal(x.live.contains(node), true);
    assert.equal(x.live.body.children[1], x.originals[1]);
    assert.equal(x.live.body.children[2], x.originals[2]);
  });
  test(`certified port: exact695 mode${mode} keeps the local word replacement and complete native ranges`, () => {
    const x = pure(fixture(695, mode));
    check695(x.res.doc, x.res.conflicts);
    const tail = x.l.body.firstElementChild.lastElementChild;
    const segment = x.res.segments.find((s) =>
      s.localNodes.some((n) => n.node === tail.lastChild),
    );
    assert.ok(segment);
    assert.equal(segment.flatLocal, "w3 w16");
    assert.equal(segment.localNodes[0].node, tail.firstChild.firstChild);
    assert.equal(segment.localNodes[1].node, tail.lastChild);
    assert.deepEqual(
      segment.localNodes.map((n) => [n.s, n.e]),
      [
        [0, 2],
        [2, 6],
      ],
    );
    assert.equal(segment.lToM.length, 7);
    assert.equal(segment.lToM[3] >= 0, true);
  });
  test(`certified port: exact695 mode${mode} keeps the original live split owner and mark`, async () => {
    const x = await dirty(fixture(695, mode));
    check695(x.live, x.report.conflicts);
    for (const node of x.originals) assert.equal(x.live.contains(node), true);
    assert.equal(x.live.querySelector('[data-id="b5"]'), x.originals[1]);
    assert.equal(x.live.querySelector("b"), x.originals[2]);
  });
}

test("certified port:706 preserves exact native transfer origins beside the independent atom", () => {
  const x = pure(fixture(706, 1));
  const units = [x.b, x.l, x.r].map((d) => [...d.body.children]);
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    V: {
      units: units[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[side + 1].includes(u),
    },
    idOf: (u) => u.getAttribute("data-id"),
  }));
  const plan = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: (u) => u.getAttribute("data-id"),
    atomKey: (u) => u.outerHTML,
  });
  assert.ok(plan.certificates.length > 0);
  const scopes = [
    units[0].slice(0, 1),
    units[1].slice(0, 3),
    units[2].slice(0, 2),
  ];
  const flats = scopes.map((s) => flatten(s, { blocks: plan.blocks }));
  const origins = certifiedOrigins({
    certificates: plan.certificates,
    scopes,
    flats,
    keys: [(a) => a.el.outerHTML, (a) => a.el.outerHTML, (a) => a.el.outerHTML],
  });
  assert.equal(origins.local.status, "ready");
  assert.equal(origins.remote.status, "ready");
  assert.equal(origins.local.bTo[3], 5);
  assert.equal(origins.remote.bTo[3], 3);
  assert.equal(origins.local.toB[3], -1);
  assert.equal(flats[1].atomAt.get(3).el, units[1][1]);
  for (const model of plan.models.values())
    for (const range of model.flat.nodes)
      assert.equal(model.flat.text.slice(range.s, range.e), range.node.data);
});

test("certified port:706 retains disjoint postcapture typing in the port and split tail", async () => {
  const x = await dirty(fixture(706, 1), (live) => {
    live.body.children[1].firstChild.data = "w16 TYPED w17 w18 w19";
    live.body.children[2].firstChild.data = "w1 TYPED w2 ";
  });
  assert.equal(x.live.body.children[1].textContent, "w16 TYPED w17 w18 w19");
  assert.equal(
    x.live.body.children[2].innerHTML,
    'w1 TYPED w2 <img src="i6.png"> w3 w4 w5',
  );
  assert.equal(x.report.localDiverged, true);
  for (const node of x.originals) assert.equal(x.live.contains(node), true);
});

test("certified port:695 retains typing on its prefix and original live replacement owner", async () => {
  const x = await dirty(fixture(695, 1), (live) => {
    live.querySelector('[data-id="b1"]').firstChild.data = "w0 TYPED w1";
    live.querySelector('[data-id="b4"]').lastChild.data = " w16 TYPED";
  });
  assert.equal(
    x.live.querySelector('[data-id="b1"]').textContent,
    "w0 TYPED w1",
  );
  assert.equal(x.live.querySelector('[data-id="b5"]').textContent, "w16 TYPED");
  assert.equal(x.live.querySelector('[data-id="b5"]'), x.originals[1]);
});

for (const port of [
  '<img src="new.png">',
  "<button>click</button>",
  "<b>bold</b>",
]) {
  test(`certified port: inline ${port} keeps its established touching edit conflict`, () => {
    const x = pure({
      b: '<p id="a">w0 w1 w2</p>',
      l: `<p id="a">w0</p>${port}<p>w1 w2</p>`,
      r: '<p id="a">w0</p><p>w1 w2</p>',
    });
    assert.equal(x.html, '<p id="a">w0</p><p>w1 w2</p>');
    assert.equal(x.res.conflicts.length, 1);
    assert.equal(x.res.conflicts[0].local, port);
    assert.equal(x.res.conflicts[0].remote, "");
  });
}

test("certified port: a base-backed block remains an ordinary move with one live owner", async () => {
  const input = {
    b: '<aside id="old">old</aside><p id="a">w0 w1 w2</p>',
    l: '<p id="a">w0</p><aside id="old">old</aside><p>w1 w2</p>',
    r: '<aside id="old">old</aside><p id="a">w0</p><p>w1 w2</p>',
  };
  const x = pure(input),
    native = x.l.getElementById("old");
  assert.equal(x.res.L.reverse.get(native), x.b.getElementById("old"));
  assert.equal(x.html, input.l);
  assert.equal(x.res.conflicts.length, 0);
  const live = parse(doc(input.l)),
    owner = live.getElementById("old");
  await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    scripts: { execute: false },
  });
  assert.equal(live.getElementById("old"), owner);
  assert.equal(live.querySelectorAll("#old").length, 1);
});

test("certified port: simultaneous break text and block insertions keep established ordering", () => {
  const x = pure({
    b: '<p id="a">onetwo</p>',
    l: '<p id="a">one</p><div id="port">local</div><p>two</p>',
    r: '<p id="a">one</p>TEXT<p>two</p>',
  });
  assert.equal(
    x.html,
    '<p id="a">one</p><div id="port">local</div>TEXT<p>two</p>',
  );
  assert.equal(x.res.conflicts.length, 0);
});

test("certified port: a remote independent paragraph survives the symmetric split", () => {
  const original = fixture(706, 1);
  const x = pure({ b: original.b, l: original.r, r: original.l });
  assert.equal(x.html, original.l);
  assert.equal(x.res.conflicts.length, 1);
  assert.equal(x.res.conflicts[0].remote, "w15 w14");
  assert.equal(
    x.res.provenance.get(x.res.doc.body.children[1]).remote,
    x.r.body.children[1],
  );
  assert.equal(x.res.doc.querySelectorAll('[data-id="b2"]').length, 1);
});

test("certified port: a whole owner replacement retains the existing conflict policy", () => {
  const x = pure({
    b: '<p id="a">one two</p>',
    l: '<p id="a">one</p><div id="port">local</div><p>two</p>',
    r: '<p id="a">REMOTE</p>',
  });
  assert.equal(x.html, "<p>REMOTE</p>");
  assert.equal(x.res.conflicts.length, 1);
  assert.equal(x.res.conflicts[0].kind, "text");
  assert.equal(x.res.conflicts[0].remote, '<p id="a">REMOTE</p>');
});
