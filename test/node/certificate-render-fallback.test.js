import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certificateGroups,
  certifiedOrigins,
} from "../../src/certificate-groups.js";
import { rejectedCertificateRetentions } from "../../src/rejected-certificate.js";
import { flatten } from "../../src/inline-merge.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const cases = [
  {
    name: "one-word append",
    b: "<p>a1 b1 c1</p><p>d1 e1</p>",
    l: "<p>a1 b1 C1</p><p>d1 e1</p>",
    r: "<p>a1 b1</p><p>d1 e1 c1</p>",
    at: [5, 8],
    source: 0,
  },
  {
    name: "two-word append",
    b: "<p>a1 b1 c1 d1</p><p>n1 n2</p>",
    l: "<p>a1 b1 c1 D1</p><p>n1 n2</p>",
    r: "<p>a1 b1</p><p>n1 n2 c1 d1</p>",
    at: [5, 11],
    source: 0,
  },
  {
    name: "sentence append",
    b: "<p>We met the team. Then we left.</p><p>The client called.</p>",
    l: "<p>We met the team. Then we LEFT.</p><p>The client called.</p>",
    r: "<p>We met the team.</p><p>The client called. Then we left.</p>",
    at: [16, 30],
    source: 0,
  },
  {
    name: "prefix before previous owner",
    b: "<p>a1 b1</p><p>c1 d1 n1 n2</p>",
    l: "<p>a1 b1</p><p>c1 D1 n1 n2</p>",
    r: "<p>c1 d1 a1 b1</p><p>n1 n2</p>",
    at: [0, 6],
    source: 1,
  },
];

function planning(input) {
  const x = mergeBodies(input.b, input.l, input.r);
  const scopes = [x.b, x.l, x.r].map((d) => Array.from(d.body.children));
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    V: {
      units: scopes[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => scopes[side + 1].includes(u),
    },
    idOf: (u) => u.id || null,
  }));
  const eligible = (u) => u.tagName === "P",
    baseId = (u) => u.id || null;
  const suppressed = [];
  const plan = certificateGroups({
    base: scopes[0],
    views,
    eligible,
    ignored: () => false,
    remoteWins: () => false,
    baseId,
    atomKey: (u) => u.outerHTML,
    onUncertainSource: (r) => suppressed.push(r),
  });
  assert.ok(plan?.certificates.length > 0);
  return { ...x, scopes, views, eligible, baseId, plan, suppressed };
}
function retention(x, options = {}) {
  return rejectedCertificateRetentions({
    certificates: x.plan.certificates,
    scopes: x.scopes,
    views: x.views,
    eligible: x.eligible,
    baseId: x.baseId,
    ...options,
  });
}
function expected(input) {
  const l = parse(doc(input.l)),
    r = parse(doc(input.r));
  return Array.from(
    l.body.children,
    (unit, i) => (i === input.source ? unit : r.body.children[i]).outerHTML,
  ).join("");
}

for (const input of cases)
  test(`rejected certificate: ${input.name} retains native source edit and recovery`, () => {
    const x = planning(input);
    assert.deepEqual(x.suppressed, []);
    const flats = x.scopes.map((units) =>
      flatten(units, { blocks: x.plan.blocks }),
    );
    assert.equal(
      certifiedOrigins({
        certificates: x.plan.certificates,
        scopes: x.scopes,
        flats,
        keys: [(a) => a.el, (a) => a.el, (a) => a.el],
      }).fallback,
      true,
    );
    const result = retention(x);
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    assert.equal(record.source, x.scopes[0][input.source]);
    assert.equal(record.flat.nodes[0].node, record.source.firstChild);
    assert.equal(record.flat.nodes[0].s, 0);
    assert.equal(record.flat.nodes[0].e, record.source.textContent.length);
    assert.equal(x.html, expected(input));
    assert.equal(x.res.conflicts.length, 1);
    const c = x.res.conflicts[0];
    assert.equal(c.remote, "");
    assert.equal(c.resolved, c.local);
    assert.equal(c.recovery.localLost, false);
    assert.deepEqual(
      [c.recovery.text.base.start, c.recovery.text.base.end],
      input.at,
    );
    assert.deepEqual(
      [c.recovery.text.local.start, c.recovery.text.local.end],
      input.at,
    );
    assert.deepEqual(
      [c.recovery.text.remote.start, c.recovery.text.remote.end],
      [input.at[0], input.at[0]],
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
  });

test("rejected certificate: source retention follows the losing side without changing both", () => {
  const input = cases[2];
  for (const conflicts of ["local", "remote", "both"]) {
    const x = mergeBodies(input.b, input.r, input.l, { conflicts });
    assert.equal(x.html, expected(input));
    assert.equal(x.res.conflicts[0].resolved, x.res.conflicts[0].remote);
    assert.equal(x.res.conflicts[0].recovery.localLost, conflicts !== "both");
  }
});

test("rejected certificate: live native owners, text nodes and later typing survive", async () => {
  const input = cases[2],
    live = parse(doc(input.l)),
    captured = parse(doc(input.l));
  const owners = Array.from(live.body.children),
    texts = owners.map((u) => u.firstChild);
  const map = lockstepMap(captured.documentElement, live.documentElement);
  texts[0].data = texts[0].data.replace("We met", "We TYPED met");
  texts[1].data = texts[1].data.replace("client", "client TYPED");
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
  assert.equal(
    live.body.innerHTML,
    expected(input)
      .replace("We met", "We TYPED met")
      .replace("client", "client TYPED"),
  );
  for (let i = 0; i < owners.length; i++) {
    assert.equal(live.body.children[i], owners[i]);
    assert.equal(owners[i].firstChild, texts[i]);
  }
  assert.equal(report.conflicts[0].recovery.localLost, false);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
});

test("rejected certificate: accepted render keeps exactly one transferred copy", () => {
  const controls = [
    {
      ...cases[0],
      r: "<p>a1 b1</p><p>c1 d1 e1</p>",
      output: "<p>a1 b1</p><p>C1 d1 e1</p>",
    },
    {
      ...cases[1],
      r: "<p>a1 b1</p><p>c1 d1 n1 n2</p>",
      output: "<p>a1 b1</p><p>c1 D1 n1 n2</p>",
    },
    {
      ...cases[2],
      r: "<p>We met the team.</p><p>Then we left. The client called.</p>",
      output: "<p>We met the team.</p><p>Then we LEFT. The client called.</p>",
    },
    {
      b: "<p>a1 b1</p><p>n1 n2</p>",
      l: "<p>a1 B1</p><p>n1 n2</p>",
      r: "<p>n1 n2 a1 b1</p>",
      output: "<p>n1 n2 a1 B1</p>",
    },
  ];
  for (const input of controls) {
    const x = mergeBodies(input.b, input.l, input.r);
    assert.equal(x.html, input.output);
    assert.deepEqual(x.res.conflicts, []);
  }
});

function twoSources() {
  const first = cases[0],
    second = {
      b: "<p>x1 y1 z1</p><p>j1 k1</p>",
      l: "<p>x1 y1 Z1</p><p>j1 k1</p>",
      r: "<p>x1 y1</p><p>j1 k1 z1</p>",
    };
  return planning(
    Object.fromEntries(["b", "l", "r"].map((k) => [k, first[k] + second[k]])),
  );
}

test("rejected certificate: a refused group cannot retain a source outside its physical scopes", () => {
  const x = twoSources();
  assert.equal(retention(x).records.length, 2);
  const result = retention(x, {
    scopes: x.scopes.map((units) => units.slice(0, 2)),
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].source, x.scopes[0][0]);
  assert.deepEqual(
    retention(x, { scopes: [x.scopes[0], x.scopes[1], [x.scopes[2][0]]] })
      .records,
    [],
  );
});

test("rejected certificate: only complete native ranges can authorize retention", () => {
  const x = planning(cases[0]);
  assert.equal(retention(x).records.length, 1);
  const c = x.plan.certificates[0];
  const original = c.models.get(c.source).flat.nodes[0];
  const end = original.e;
  original.e--;
  assert.deepEqual(retention(x).records, []);
  original.e = end;
  c.target.firstChild.data += " changed";
  assert.deepEqual(retention(x).records, []);
});

test("rejected certificate: finite cap preserves a completed source and discards the incomplete source", () => {
  const x = twoSources(),
    limit = 100000;
  const certificates = x.plan.certificates.filter(
    (c) => c.source === x.scopes[0][0],
  );
  assert.equal(certificates.length, 1);
  const first = retention(x, { certificates, limit });
  assert.equal(first.records.length, 1);
  const spent = limit - first.budget.remaining;
  assert.deepEqual(
    retention(x, { certificates, limit: spent - 1 }).records,
    [],
  );
  const partial = retention(x, {
    limit: spent + 2 * (x.plan.certificates.length - certificates.length),
  });
  assert.equal(partial.records.length, 1);
  assert.equal(partial.records[0].source, x.scopes[0][0]);
  assert.equal(partial.budget.remaining, 0);
  assert.equal(retention(x, { limit }).records.length, 2);
});
