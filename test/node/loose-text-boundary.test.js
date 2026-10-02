import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const cases = [
  {
    name: "serialized join retains the trailing run through recovery",
    b: "<div>lead<p>a1 b1</p>mid words<p>c1 d1</p>tail</div>",
    l: "<div>lead<p>a1 b1 c1 d1</p>mid wordstail</div>",
    r: "<div>lead<p>a1 b1</p>mid WORDS<p>c1 d1</p>tail</div>",
    expected: "<div>lead<p>a1 b1 c1 d1</p>mid WORDS<p>c1 d1</p>tail</div>",
    conflicts: ["text"],
  },
  {
    name: "separated trailing run survives the preceding edit",
    b: "<div>lead<p>a1 b1</p>mid words<p>c1 d1</p>tail</div>",
    l: "<div>lead<p>a1 b1 c1 d1</p>mid words tail</div>",
    r: "<div>lead<p>a1 b1</p>mid WORDS<p>c1 d1</p>tail</div>",
    expected: "<div>lead<p>a1 b1 c1 d1</p>mid WORDS tail</div>",
    conflicts: [],
  },
  {
    name: "edit of a fused trailing run applies once",
    b: "<div>lead<p>a1 b1</p>mid words<p>c1 d1</p>tail end</div>",
    l: "<div>lead<p>a1 b1 c1 d1</p>mid wordstail end</div>",
    r: "<div>lead<p>a1 b1</p>mid words<p>c1 d1</p>tail END</div>",
    expected: "<div>lead<p>a1 b1 c1 d1</p>mid wordstail END</div>",
    conflicts: [],
  },
  ...["local", "remote"].map((policy) => ({
    name: `list loose text retains its remote edit under ${policy} policy`,
    policy,
    b: "<ul><li>Intro: <p>a1 b1</p> see also <p>c1 d1</p> end note</li></ul>",
    l: "<ul><li>Intro: <p>a1 b1 c1 d1</p> see also  end note</li></ul>",
    r: "<ul><li>Intro: <p>a1 b1</p> see also <p>c1 d1</p> end NOTE</li></ul>",
    expected: "<ul><li>Intro: <p>a1 b1 c1 d1</p> see also  end NOTE</li></ul>",
    conflicts: [],
  })),
];

for (const input of cases)
  test(`retained loose-text boundary: ${input.name}`, async () => {
    const x = mergeBodies(input.b, input.l, input.r, {
      conflicts: input.policy || "remote",
    });
    assert.equal(x.html, input.expected);
    assert.deepEqual(
      x.res.conflicts.map((c) => c.kind),
      input.conflicts,
    );
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
    assert.ok(x.res.segments.length > 0);
    for (const segment of x.res.segments)
      for (const range of segment.localNodes) {
        assert.equal(range.e - range.s, range.node.data.length);
        assert.equal(
          segment.flatLocal.slice(range.s, range.e),
          range.node.data,
        );
      }
    if (input.conflicts.length) {
      assert.equal(x.res.conflicts[0].base, "words<p>c1 d1</p>tail");
      assert.equal(x.res.conflicts[0].local, "wordstail");
      assert.equal(x.res.conflicts[0].remote, "WORDS<p>c1 d1</p>tail");
    }
    const live = parse(doc(input.l));
    const parent = live.querySelector("li") || live.querySelector("div");
    const paragraph = parent.querySelector("p"),
      loose = parent.lastChild;
    const report = await mergeDocument({
      live,
      base: doc(input.b),
      remote: doc(input.r),
      conflicts: input.policy || "remote",
      fastPath: false,
      scripts: { execute: false },
    });
    assert.equal(live.body.innerHTML, input.expected);
    assert.equal(live.querySelector("p"), paragraph);
    assert.ok(live.body.contains(parent));
    assert.ok(parent.contains(loose));
    assert.deepEqual(
      report.conflicts.map((c) => c.kind),
      input.conflicts,
    );
    assert.deepEqual(
      recoveryProblems(
        report.conflicts,
        finalTree(live.documentElement),
        false,
      ),
      [],
    );
  });

test("retained substantive text bounds a certificate neighborhood without becoming a block owner", () => {
  const input = cases[1],
    x = mergeBodies(input.b, input.l, input.r);
  const candidates = [
    [...x.res.L.map.keys(), ...x.res.R.map.keys()],
    [...x.res.L.reverse.keys()],
    [...x.res.R.reverse.keys()],
  ];
  const units = [x.b, x.l, x.r].map((d, i) =>
    Array.from(d.querySelector("div").childNodes, (node) =>
      node.nodeType === 1
        ? node
        : candidates[i].find(
            (u) => u.kind === "text" && u.nodes.includes(node),
          ),
    ),
  );
  assert.ok(units.every((side) => side.every(Boolean)));
  assert.equal(units[0][2].value, "mid words");
  assert.equal(x.res.L.map.get(units[0][2]), units[1][2]);
  assert.equal(units[1][2].value, "mid words tail");
  const views = [x.res.L, x.res.R].map((A, i) => ({
    A,
    idOf: () => null,
    V: {
      units: units[i + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[i + 1].includes(u),
    },
  }));
  const plan = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.kind === "text" || u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: () => null,
    atomKey: (u) => u.outerHTML,
  });
  assert.equal(plan, null);
});

test("retained loose-text boundaries keep captured typing in the original native paragraph", async () => {
  const input = {
    b: "<div>lead <p>a1 b1</p> mid words <p>c1 d1</p> tail</div>",
    l: "<div>lead <p>a1 b1 c1 d1</p> mid words  tail</div>",
    r: "<div>lead <p>a1 b1</p> mid WORDS <p>c1 d1</p> tail</div>",
  };
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const map = lockstepMap(captured.documentElement, live.documentElement);
  const paragraph = live.querySelector("p"),
    text = paragraph.firstChild,
    loose = paragraph.nextSibling;
  text.data = "a1 b1 c1 TYPED d1";
  const report = await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    fastPath: false,
    scripts: { execute: false },
  });
  assert.equal(
    live.body.innerHTML,
    "<div>lead <p>a1 b1 c1 TYPED d1</p> mid WORDS  tail</div>",
  );
  assert.equal(live.querySelector("p"), paragraph);
  assert.equal(paragraph.firstChild, text);
  assert.equal(paragraph.nextSibling, loose);
  assert.deepEqual(report.conflicts, []);
});
