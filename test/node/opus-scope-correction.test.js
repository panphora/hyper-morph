import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";

test("paired whitespace cannot stop an element transfer neighborhood", () => {
  const units = (html) =>
    Array.from(parse(doc(html)).body.childNodes).map((node) =>
      node.nodeType === 1
        ? node
        : { kind: "text", value: node.data, nodes: [node] },
    );
  const base = units("\n<p>a1 b1 c1 d1</p>\n");
  const local = units("\n<p>a1 b1</p>\n<p>c1 d1</p>\n");
  const remote = units("\n<p>a1 b1 c1 D1</p>\n");
  const views = [local, remote].map((side) => {
    const map = new Map(),
      reverse = new Map(),
      identical = new Set();
    for (let i = 0; i < 3; i++) {
      map.set(base[i], side[i]);
      reverse.set(side[i], base[i]);
      if (
        base[i].nodeType === 1
          ? base[i].isEqualNode(side[i])
          : base[i].value === side[i].value
      )
        identical.add(base[i]);
    }
    return {
      A: { map, reverse, identical },
      V: {
        units: side,
        asBase: false,
        twin: (u) => map.get(u),
        baseOf: (u) => reverse.get(u),
        here: (u) => side.includes(u),
      },
      idOf: () => null,
    };
  });
  const plan = certificateGroups({
    base,
    views,
    eligible: (u) => u.kind === "text" || u.tagName === "P",
    ignored: () => false,
    remoteWins: () => false,
    baseId: () => null,
    atomKey: (u) => u.outerHTML,
  });
  assert.ok(plan);
  assert.ok(
    plan.certificates.some(
      (c) => c.source === base[1] && c.target === local[3] && c.runs.length > 0,
    ),
  );
});

const fixtures = [
  {
    name: "ins_before_split_vs_del",
    b: "<p>z</p><p>a1 b1</p>",
    l: "<p>z</p><p>NEW</p><p>a1</p><p>b1</p>",
    r: "<p>z</p>",
    expected: "<p>z</p><p>NEW</p>",
    conflicts: ["text:"],
  },
  {
    name: "ins_after_split_vs_del",
    b: "<p>a1 b1</p><p>z</p>",
    l: "<p>a1</p><p>b1</p><p>NEW</p><p>z</p>",
    r: "<p>z</p>",
    expected: "<p>NEW</p><p>z</p>",
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_rewrite",
    b: "<p>z</p><p>a1 b1</p>",
    l: "<p>z</p><p>NEW</p><p>a1</p><p>b1</p>",
    r: "<p>z</p><p>Q1 Q2</p>",
    expected: "<p>z</p><p>NEW</p><p>Q1 Q2</p>",
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_editcut",
    b: "<p>z</p><p>a1 b1 c1</p>",
    l: "<p>z</p><p>NEW</p><p>a1 b1</p><p>c1</p>",
    r: "<p>z</p><p>a1 B1 C1</p>",
    expected: "<p>z</p><p>NEW</p><p>a1 B1 C1</p>",
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_del_hr",
    b: "<p>z</p><p>a1 b1</p>",
    l: "<p>z</p><hr><p>a1</p><p>b1</p>",
    r: "<p>z</p>",
    expected: "<p>z</p><hr>",
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_del_ul",
    b: "<p>z</p><p>a1 b1</p>",
    l: "<p>z</p><ul><li>item</li></ul><p>a1</p><p>b1</p>",
    r: "<p>z</p>",
    expected: "<p>z</p><ul><li>item</li></ul>",
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_del_named",
    b: "<p>z</p><p>a1 b1</p>",
    l: "<p>z</p><p id=n>NEW</p><p>a1</p><p>b1</p>",
    r: "<p>z</p>",
    expected: '<p>z</p><p id="n">NEW</p>',
    conflicts: ["text:"],
  },
  {
    name: "ins_before_split_vs_del_remote_split",
    b: "<p>z</p><p>a1 b1</p>",
    r: "<p>z</p><p>NEW</p><p>a1</p><p>b1</p>",
    l: "<p>z</p>",
    expected: "<p>z</p><p>NEW</p><p>a1</p><p>b1</p>",
    conflicts: ["text:"],
  },
  {
    name: "pretty_join_vs_edit_joined",
    b: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    l: "\n<p>a1 b1</p>\n<p>c1 D1</p>\n",
    r: "\n<p>a1 b1 c1 d1</p>\n",
    expected: "\n<p>a1 b1 c1 D1</p>\n",
    conflicts: [],
  },
  {
    name: "flat_join_vs_edit_joined",
    b: "<p>a1 b1</p><p>c1 d1</p>",
    l: "<p>a1 b1</p><p>c1 D1</p>",
    r: "<p>a1 b1 c1 d1</p>",
    expected: "<p>a1 b1 c1 D1</p>",
    conflicts: [],
  },
  {
    name: "pretty_join_vs_insert_after",
    b: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n<p>z</p>\n",
    l: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n<p>NEW</p>\n<p>z</p>\n",
    r: "\n<p>a1 b1 c1 d1</p>\n<p>z</p>\n",
    expected: "\n<p>a1 b1 c1 d1</p>\n<p>NEW</p>\n<p>z</p>\n\n",
    conflicts: [],
  },
  {
    name: "flat_join_vs_insert_after",
    b: "<p>a1 b1</p><p>c1 d1</p><p>z</p>",
    l: "<p>a1 b1</p><p>c1 d1</p><p>NEW</p><p>z</p>",
    r: "<p>a1 b1 c1 d1</p><p>z</p>",
    expected: "<p>a1 b1 c1 d1</p><p>NEW</p><p>z</p>",
    conflicts: [],
  },
  {
    name: "pretty_join_vs_insert_before",
    b: "\n<p>z</p>\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    l: "\n<p>z</p>\n<p>NEW</p>\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    r: "\n<p>z</p>\n<p>a1 b1 c1 d1</p>\n",
    expected: "\n<p>z</p>\n<p>NEW</p>\n<p>a1 b1 c1 d1</p>\n",
    conflicts: [],
  },
  {
    name: "pretty_split_vs_edit",
    b: "\n<p>a1 b1 c1 d1</p>\n",
    l: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    r: "\n<p>a1 b1 c1 D1</p>\n",
    expected: "\n<p>a1 b1</p>\n<p>c1 D1</p>\n",
    conflicts: [],
  },
  {
    name: "pretty_join_vs_insert_after_end",
    b: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    l: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n<p>NEW</p>\n",
    r: "\n<p>a1 b1 c1 d1</p>\n",
    expected: "\n<p>a1 b1 c1 d1</p>\n<p>NEW</p>\n",
    conflicts: [],
  },
  {
    name: "pretty_join_vs_insert_after_noedit_ws",
    b: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n<p>z</p>",
    l: "\n<p>a1 b1</p>\n<p>c1 d1</p>\n<p>NEW</p>\n<p>z</p>",
    r: "\n<p>a1 b1 c1 d1</p>\n<p>z</p>",
    expected: "\n<p>a1 b1 c1 d1</p>\n<p>NEW</p>\n<p>z</p>",
    conflicts: [],
  },
  {
    name: "pretty_split_with_independent_insert",
    b: "\n<p>z</p>\n<p>a1 b1 c1 d1</p>\n",
    l: "\n<p>z</p>\n<p>a1 b1</p>\n<p>c1 d1</p>\n",
    r: "\n<p>z</p>\n<p>NEW</p>\n<p>a1 b1 c1 D1</p>\n",
    expected: "\n<p>z</p>\n<p>NEW</p>\n<p>a1 b1</p>\n<p>c1 D1</p>\n",
    conflicts: [],
  },
];

for (const fixture of fixtures)
  test(`ordinary scope: ${fixture.name}`, async () => {
    const { b, l, r, expected, conflicts } = fixture;
    const result = mergeBodies(b, l, r);
    assert.equal(result.html, expected);
    assert.deepEqual(
      result.res.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
      conflicts,
    );
    const live = parse(doc(l));
    const independent = Array.from(live.body.children).find(
      (node) =>
        node.textContent === "NEW" ||
        node.tagName === "HR" ||
        node.tagName === "UL",
    );
    const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
    assert.equal(live.body.innerHTML, expected);
    assert.deepEqual(
      report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
      conflicts,
    );
    if (independent) assert.ok(live.body.contains(independent));
  });
