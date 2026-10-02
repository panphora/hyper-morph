import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import {
  declinedSourceRetentions,
  certifiedSourceRetention,
} from "../../src/source-retention.js";
import { flatten } from "../../src/inline-merge.js";
import { textTokens, allAscii } from "../../src/text-merge.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const words = (prefix, n) =>
  Array.from({ length: n }, (_, i) => prefix + i).join(" ");
const longOwner = words("d", 130),
  moved = words("s", 40),
  owner = words("d", 40);
const cases = {
  duplicate: {
    b: "<p>a1 b1 c1</p><p>d1 e1</p>",
    l: "<p>a1 b1 C1</p><p>d1 e1</p>",
    r: "<p>a1 b1</p><p>c1 d1 e1 NEW c1</p>",
  },
  longOwner: {
    b: `<p>a1 b1 c1</p><p>${longOwner}</p>`,
    l: `<p>a1 b1 C1</p><p>${longOwner}</p>`,
    r: `<p>a1 b1</p><p>c1 ${longOwner} NEW</p>`,
  },
  longResidual: {
    b: `<p>a1 b1 ${moved}</p><p>${owner}</p>`,
    l: `<p>a1 b1 ${moved.replace("s1 ", "S1x ")}</p><p>${owner}</p>`,
    r: `<p>a1 b1</p><p>${moved} ${owner} NEW</p>`,
  },
  repeatedBase: {
    b: "<p>a1 b1 c1</p><p>c1 d1 e1</p>",
    l: "<p>a1 b1 C1</p><p>c1 d1 e1</p>",
    r: "<p>a1 b1</p><p>c1 c1 d1 e1 NEW</p>",
  },
};

function planning(input, options = {}) {
  const x = mergeBodies(input.b, input.l, input.r, options);
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
  const ignored = options.ignore || (() => false),
    remoteWins = options.remoteWins || (() => false),
    records = [];
  const result = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P" && !ignored(u) && !remoteWins(u),
    ignored,
    remoteWins,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    onUncertainSource: (record) => records.push(record),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return { ...x, result, records, units, views };
}

function conservative(input) {
  const l = parse(doc(input.l)),
    r = parse(doc(input.r));
  return l.body.children[0].outerHTML + r.body.children[1].outerHTML;
}

for (const [name, input] of Object.entries(cases)) {
  test(`source retention: ${name} keeps native edit without a certificate`, () => {
    const x = planning(input);
    assert.equal(x.result, null);
    assert.equal(x.records.length, 1);
    const record = x.records[0];
    assert.equal(record.source, x.b.body.children[0]);
    assert.equal(record.side, 1);
    assert.equal(record.from, 5);
    assert.equal(record.to, record.flat.text.length);
    assert.equal(record.flat.nodes[0].node, record.source.firstChild);
    assert.equal(x.html, conservative(input));
    assert.equal(x.res.conflicts.length, 1);
    const conflict = x.res.conflicts[0];
    assert.equal(conflict.kind, "text");
    assert.equal(conflict.resolved, conflict.local);
    assert.equal(conflict.remote, "");
    assert.equal(conflict.recovery.localLost, false);
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
    assert.equal(conflict.recovery.text.base.start, 5);
    assert.equal(conflict.recovery.text.base.end, record.to);
    assert.equal(conflict.recovery.text.merged.fragment, conflict.local);
  });
  test(`source retention: ${name} keeps live owners and typing on both paragraphs`, async () => {
    const live = parse(doc(input.l)),
      captured = parse(doc(input.l));
    const owners = Array.from(live.body.children),
      texts = owners.map((n) => n.firstChild);
    const map = lockstepMap(captured.documentElement, live.documentElement);
    texts[0].data = texts[0].data.replace("a1 b1", "a1 TYPED b1");
    texts[1].data += " TYPED-DEST";
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
    assert.equal(live.body.children[0].textContent, texts[0].data);
    assert.equal(
      live.body.children[0].textContent,
      captured.body.children[0].textContent.replace("a1 b1", "a1 TYPED b1"),
    );
    assert.ok(live.body.children[1].textContent.includes("TYPED-DEST"));
    assert.equal(
      live.body.children[1].textContent,
      parse(doc(input.r)).body.children[1].textContent.replace(
        " NEW",
        " TYPED-DEST NEW",
      ),
    );
    for (let i = 0; i < owners.length; i++) {
      assert.equal(live.body.children[i], owners[i]);
      assert.equal(owners[i].firstChild, texts[i]);
    }
    assert.equal(report.conflicts[0].recovery.localLost, false);
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

test("source retention: mirror uses local policy without changing global both", () => {
  const { b, l, r } = cases.duplicate;
  const mirror = planning({ b, l: r, r: l }, { conflicts: "local" });
  assert.equal(mirror.html, conservative(cases.duplicate));
  assert.equal(mirror.records[0].side, 0);
  const both = planning(cases.duplicate, { conflicts: "both" });
  assert.equal(both.html, conservative(cases.duplicate));
  assert.equal(both.res.conflicts[0].recovery.localLost, false);
});

test("source retention: a successful exact transfer keeps no source copy", () => {
  const input = { ...cases.duplicate, r: "<p>a1 b1</p><p>c1 d1 e1 NEW</p>" };
  const x = planning(input);
  assert.ok(x.result.certificates.length > 0);
  assert.deepEqual(x.records, []);
  assert.equal(x.html, "<p>a1 b1</p><p>C1 d1 e1 NEW</p>");
});

test("source retention: genuine deletion remains a remote text conflict", () => {
  for (const target of ["d1 e1", "c1 d1 e1"]) {
    const input = {
      b: `<p>a1 b1 c1</p><p>${target}</p>`,
      l: `<p>a1 b1 C1</p><p>${target}</p>`,
      r: `<p>a1 b1</p><p>${target} NEW</p>`,
    };
    const x = planning(input);
    assert.deepEqual(x.records, []);
    assert.equal(x.html, input.r);
    assert.equal(x.res.conflicts[0].resolved, "");
    assert.equal(x.res.conflicts[0].recovery.localLost, true);
  }
});

const negatives = [
  [
    "rewritten target owner",
    { ...cases.duplicate, r: "<p>a1 b1</p><p>c1 NEW c1</p>" },
  ],
  [
    "ambiguous retained owner",
    { ...cases.duplicate, r: "<p>a1 b1</p><p>c1 d1 e1 NEW d1 e1 c1</p>" },
  ],
  [
    "source atom",
    {
      b: '<p>a1 <img id="x"> b1 c1</p><p>d1 e1</p>',
      l: '<p>a1 <img id="x"> b1 C1</p><p>d1 e1</p>',
      r: '<p>a1 <img id="x"> b1</p><p>c1 d1 e1 NEW c1</p>',
    },
  ],
  [
    "target atom",
    {
      b: '<p>a1 b1 c1</p><p>d1 <img id="x"> e1</p>',
      l: '<p>a1 b1 C1</p><p>d1 <img id="x"> e1</p>',
      r: '<p>a1 b1</p><p>c1 d1 <img id="x"> e1 NEW c1</p>',
    },
  ],
  [
    "ignored pin",
    {
      b: "<p>a1 <i data-skip>PIN</i> b1 c1</p><p>d1 e1</p>",
      l: "<p>a1 <i data-skip>PIN</i> b1 C1</p><p>d1 e1</p>",
      r: "<p>a1 <i data-skip>PIN</i> b1</p><p>c1 d1 e1 NEW c1</p>",
    },
    { ignore: (u) => u.hasAttribute?.("data-skip") },
  ],
  [
    "remote owned inline",
    {
      b: "<p>a1 <b data-wins>PIN</b> b1 c1</p><p>d1 e1</p>",
      l: "<p>a1 <b data-wins>PIN</b> b1 C1</p><p>d1 e1</p>",
      r: "<p>a1 <b data-wins>PIN</b> b1</p><p>c1 d1 e1 NEW c1</p>",
    },
    { remoteWins: (u) => u.hasAttribute?.("data-wins") },
  ],
  [
    "remote owned source",
    Object.fromEntries(
      Object.entries(cases.duplicate).map(([k, v]) => [
        k,
        v.replace("<p>", "<p data-wins>"),
      ]),
    ),
    { remoteWins: (u) => u.hasAttribute?.("data-wins") },
  ],
  [
    "ignored source",
    Object.fromEntries(
      Object.entries(cases.duplicate).map(([k, v]) => [
        k,
        v.replace("<p>", "<p data-skip>"),
      ]),
    ),
    { ignore: (u) => u.hasAttribute?.("data-skip") },
  ],
  [
    "different source identities",
    {
      b: '<p id="a">a1 b1 c1</p><p>d1 e1</p>',
      l: '<p id="other">a1 b1 C1</p><p>d1 e1</p>',
      r: '<p id="a">a1 b1</p><p>c1 d1 e1 NEW c1</p>',
    },
  ],
  [
    "identified rewritten slot",
    {
      b: '<p>alpha beta</p><p id="a">gamma delta</p>',
      l: '<p>alpha beta gamma delta</p><p id="a">gamma new</p>',
      r: '<p>alpha beta</p><p id="a">gamma DELTA</p>',
    },
  ],
  [
    "two endpoint interpretations",
    {
      b: "<p>a a</p><p>d1 e1</p>",
      l: "<p>a A</p><p>d1 e1</p>",
      r: "<p>a</p><p>a d1 e1 NEW a</p>",
    },
  ],
  [
    "partial source token",
    {
      b: "<p>a1 b1 word</p><p>d1 e1</p>",
      l: "<p>a1 b1 WORD</p><p>d1 e1</p>",
      r: "<p>a1 b1 wo</p><p>rd d1 e1 NEW rd</p>",
    },
  ],
  [
    "full copy",
    { ...cases.duplicate, r: "<p>a1 b1 c1</p><p>a1 b1 c1 d1 e1 NEW</p>" },
  ],
];
for (const [name, input, options] of negatives)
  test(`source retention: ${name} grants no refusal authority`, () => {
    const x = planning(input, options);
    assert.deepEqual(x.records, []);
  });

test("source retention: only accepted coverage of every hard endpoint character suppresses a record", () => {
  const source = parse(doc("<p>a1 b1 c1 d1</p>")).body.firstChild;
  const record = {
    source,
    side: 1,
    from: 5,
    to: 11,
    flat: flatten(Array.from(source.childNodes)),
  };
  const exhausted = Symbol();
  const charge = (budget, amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
  };
  const run = (from, to) => ({ source, from, to });
  const certificate = (runs) => ({ source, side: 1, runs });
  const check = (certificates) => {
    const budget = { remaining: 1000 };
    const result = certifiedSourceRetention(
      record,
      certificates,
      budget,
      charge,
    );
    assert.ok(budget.remaining < 1000);
    return result;
  };
  assert.equal(check([certificate([run(0, 5)])]), false);
  assert.equal(check([certificate([run(6, 8)])]), false);
  assert.equal(check([certificate([run(6, 7), run(9, 11)])]), false);
  assert.equal(
    check([certificate([run(6, 8)]), { source, side: 0, runs: [run(9, 11)] }]),
    false,
  );
  assert.equal(
    check([certificate([run(6, 8)]), certificate([run(9, 11)])]),
    true,
  );
  assert.throws(
    () =>
      certifiedSourceRetention(
        record,
        [certificate([run(6, 8)])],
        { remaining: 2 },
        charge,
      ),
    (error) => error === exhausted,
  );
});

test("source retention: a finite proof cap publishes no partial evidence", () => {
  const x = planning(cases.duplicate, { limit: 32 });
  assert.equal(x.result, null);
  assert.deepEqual(x.records, []);
});

function directProof(input, limit, failSource = null) {
  const x = planning(input);
  const exhausted = Symbol(),
    models = new Map();
  let charged = 0;
  const charge = (budget, amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
    charged += amount;
  };
  const model = (unit, alignment, budget) => {
    if (unit === failSource?.(x)) charge(budget, budget.remaining + 1);
    if (models.has(unit)) return models.get(unit);
    const flat = flatten(Array.from(unit.childNodes));
    charge(budget, flat.text.length * 8 + flat.nodes.length + 1);
    const value = { flat, alignment, tokens: null };
    models.set(unit, value);
    return value;
  };
  const tokensOf = (value, budget) => {
    if (value.tokens) return value.tokens;
    charge(budget, value.flat.text.length * 8);
    let at = 0;
    return (value.tokens = textTokens(
      value.flat.text,
      allAscii(value.flat.text),
    ).map((token) => {
      const from = at;
      at += token.len;
      return { ...token, from, to: at };
    }));
  };
  const records = declinedSourceRetentions({
    base: x.units[0],
    views: x.views,
    side: 1,
    attempt: [0, x.units[0].length - 1, 0, x.units[2].length - 1],
    eligible: (u) => u.tagName === "P",
    blocked: new Set(),
    baseId: (u) => u.id || null,
    model,
    tokensOf,
    certificates: [],
    charge,
    exhausted,
    limit,
  });
  return { ...x, records, charged };
}

test("source retention: completed native proof survives a later exhausted source", () => {
  const first = cases.duplicate;
  const second = {
    b: "<p>x1 y1 z1</p><p>j1 k1</p>",
    l: "<p>x1 y1 Z1</p><p>j1 k1</p>",
    r: "<p>x1 y1</p><p>z1 j1 k1 NEW z1</p>",
  };
  const input = Object.fromEntries(
    ["b", "l", "r"].map((k) => [k, first[k] + second[k]]),
  );
  const x = directProof(input, 100000, (x) => x.units[0][2]);
  assert.equal(x.records.length, 1);
  assert.equal(x.records[0].source, x.units[0][0]);
  assert.equal(x.records[0].from, 5);
  assert.equal(x.records[0].to, 8);
});

test("source retention: repetitive substring proof fits a linear work budget", () => {
  for (const length of [40, 400, 4000]) {
    const residual = "ab".repeat(length) + "z",
      target = "d".repeat(length);
    const input = {
      b: `<p>start ${residual}</p><p>${target}</p>`,
      l: `<p>start ${residual.toUpperCase()}</p><p>${target}</p>`,
      r: `<p>start</p><p>${residual} ${target} NEW ${residual}</p>`,
    };
    const characters = input.b.length + input.l.length + input.r.length;
    const x = directProof(input, characters * 80);
    assert.equal(x.records.length, 1);
    assert.ok(x.charged < characters * 80);
  }
});
