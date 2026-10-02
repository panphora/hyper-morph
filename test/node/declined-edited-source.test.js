import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { merge3, mergeDocument, createIdentityStore } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const base = {
  b: "<p>We met the team. Then we left.</p><p>The client called.</p>",
  l: "<p>We met the team. Then we LEFT.</p><p>The client called.</p>",
  r: "<p>We met the TEAM.</p><p>The client called. Then we left.</p>",
};

function planning(input, options = {}) {
  const x = mergeBodies(input.b, input.l, input.r, options);
  const units = [x.b, x.l, x.r].map((d) => Array.from(d.body.children));
  if (options.splitSource)
    for (const list of units) list[0].firstChild.splitText(7);
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
  const records = [],
    retentions = [],
    ignored = options.ignore || (() => false),
    remoteWins = options.remoteWins || (() => false);
  const result = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P" && !ignored(u) && !remoteWins(u),
    ignored,
    remoteWins,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    onUncertainOwner: (record) => records.push(record),
    onUncertainSource: (record) => retentions.push(record),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return { ...x, result, records, retentions, units };
}

function expected(input) {
  const l = parse(doc(input.l)),
    r = parse(doc(input.r));
  const destination = [l, r].find((d) =>
    d.body.children[1].textContent.includes("Then we left."),
  );
  return (
    l.body.children[0].outerHTML +
    r.body.children[0].outerHTML +
    destination.body.children[1].outerHTML
  );
}

const cases = [];
for (const prefix of [false, true])
  for (const prepend of [false, true])
    for (const mirror of [false, true]) {
      let input = { ...base };
      if (prefix)
        input = {
          b: "<p>Then we left. We met the team today.</p><p>The client called.</p>",
          l: "<p>Then we LEFT. We met the team today.</p><p>The client called.</p>",
          r: "<p>We met the TEAM today.</p><p>The client called. Then we left.</p>",
        };
      if (prepend)
        input.r = input.r.replace(
          "The client called. Then we left.",
          "Then we left. The client called.",
        );
      if (mirror) [input.l, input.r] = [input.r, input.l];
      const name = `${prefix ? "prefix" : "suffix"}, ${prepend ? "prepend" : "append"}, mirror ${mirror}`;
      cases.push({ name, input });
    }

for (const { name, input } of cases) {
  test(`declined edited source: ${name}, native alternatives and recovery`, () => {
    const x = planning(input);
    assert.equal(x.records.length, 1);
    assert.equal(x.retentions.length, 0);
    assert.equal(x.result, null);
    assert.equal(x.html, expected(input));
    const record = x.records[0];
    assert.equal(record.source, x.b.body.firstChild);
    assert.equal(record.local, x.l.body.firstChild);
    assert.equal(record.remote, x.r.body.firstChild);
    for (const [i, unit] of [
      record.source,
      record.local,
      record.remote,
    ].entries()) {
      assert.equal(record.models[i].unit, unit);
      assert.deepEqual(record.models[i].flat.nodes, [
        { node: unit.firstChild, s: 0, e: unit.textContent.length },
      ]);
    }
    assert.equal(x.res.conflicts.length, 1);
    const conflict = x.res.conflicts[0];
    assert.equal(conflict.base, record.source.outerHTML);
    assert.equal(conflict.local, record.local.outerHTML);
    assert.equal(conflict.remote, record.remote.outerHTML);
    assert.equal(
      conflict.resolved,
      record.local.outerHTML + record.remote.outerHTML,
    );
    assert.equal(conflict.recovery.localLost, false);
    for (const side of ["base", "local", "remote"])
      assert.deepEqual(
        [conflict.recovery.text[side].start, conflict.recovery.text[side].end],
        [0, 1],
      );
    assert.deepEqual(
      [conflict.recovery.text.merged.start, conflict.recovery.text.merged.end],
      [0, 2],
    );
    assert.deepEqual(x.res.provenance.get(x.res.doc.body.children[0]), {
      base: null,
      local: record.local,
      remote: null,
    });
    assert.deepEqual(x.res.provenance.get(x.res.doc.body.children[1]), {
      base: null,
      local: null,
      remote: record.remote,
    });
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

  test(`declined edited source: ${name}, live identity and captured typing`, async () => {
    const captured = parse(doc(input.l)),
      live = parse(doc(input.l));
    const source = live.body.firstChild,
      destination = live.body.lastChild;
    const sourceText = source.firstChild,
      destinationText = destination.firstChild;
    const map = lockstepMap(captured.documentElement, live.documentElement);
    sourceText.data = sourceText.data.replace("We met", "We TYPED met");
    destinationText.data = destinationText.data.replace(
      "client",
      "client TYPED-OWNER",
    );
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
        .replace("client", "client TYPED-OWNER"),
    );
    assert.equal(live.body.children[0], source);
    assert.equal(source.firstChild, sourceText);
    assert.equal(live.body.children[2], destination);
    assert.equal(destination.firstChild, destinationText);
    assert.equal(
      live.body.children[1].textContent,
      parse(doc(input.r)).body.firstChild.textContent,
    );
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

test("declined edited source: source models retain multiple native Text offsets", () => {
  const x = planning(base, { splitSource: true });
  assert.equal(x.records.length, 1);
  for (const model of x.records[0].models) {
    assert.deepEqual(
      model.flat.nodes.map((n) => [n.s, n.e]),
      [
        [0, 7],
        [7, model.flat.text.length],
      ],
    );
    assert.equal(model.flat.nodes[0].node, model.unit.firstChild);
    assert.equal(model.flat.nodes[1].node, model.unit.lastChild);
  }
});

test("declined edited source: following insertion attaches after both source alternatives", async () => {
  const extra = "<h3>LOCAL INSERT</h3>",
    anchor = '<h2 id="after">AFTER</h2>';
  const input = {
    b: base.b + anchor,
    l: base.l.replace("</p><p>", "</p>" + extra + "<p>") + anchor,
    r: base.r + anchor,
  };
  const live = parse(doc(input.l)),
    captured = parse(doc(input.l)),
    nodes = Array.from(live.body.children);
  const map = lockstepMap(captured.documentElement, live.documentElement);
  await mergeDocument({
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
    "<p>We met the team. Then we LEFT.</p><p>We met the TEAM.</p>" +
      extra +
      "<p>The client called. Then we left.</p>" +
      anchor,
  );
  assert.equal(live.body.children[0], nodes[0]);
  assert.equal(live.body.children[2], nodes[1]);
  assert.equal(live.body.children[3], nodes[2]);
  assert.equal(live.body.children[4], nodes[3]);
});

const refusals = {
  "gained endpoint edited": {
    ...base,
    r: base.r.replace("called. Then we left.", "called. Then we departed."),
  },
  "gained text on both destination edges": {
    ...base,
    r: base.r.replace("The client called.", "NEW The client called."),
  },
  "repeated gained occurrence": {
    ...base,
    r: base.r.replace(
      "called. Then we left.",
      "called. Then we left. Then we left.",
    ),
  },
  "source occurrence repeated": {
    ...base,
    b: base.b.replace("team. Then", "team. Then we left. Then"),
    l: base.l.replace("team. Then", "team. Then we left. Then"),
  },
  "source endpoint still present": {
    ...base,
    r: base.r.replace("TEAM.</p>", "TEAM. Then we left.</p>"),
  },
  "retained destination rewritten": {
    ...base,
    r: base.r.replace("client called", "CLIENT called"),
  },
  "opposite residual also rewritten": {
    ...base,
    l: base.l.replace("team.", "CREW."),
  },
  "opposite endpoint empty": {
    ...base,
    l: base.l.replace(" Then we LEFT.", ""),
  },
  "unrelated source rewrite": {
    ...base,
    r: base.r.replace("We met the TEAM.", "Totally unrelated."),
  },
  "competing original owner occurrence": Object.fromEntries(
    Object.entries(base).map(([k, v]) => [
      k,
      v + '<p id="other">Then we left.</p>',
    ]),
  ),
  "two gained destination owners": Object.fromEntries(
    Object.entries(base).map(([k, v]) => [
      k,
      v +
        (k === "r"
          ? "<p>The editor called. Then we left.</p>"
          : "<p>The editor called.</p>"),
    ]),
  ),
  "authored source identity": Object.fromEntries(
    Object.entries(base).map(([k, v]) => [
      k,
      v.replace("<p>", '<p id="source">'),
    ]),
  ),
  "source inline mark": { ...base, l: base.l.replace("LEFT", "<b>LEFT</b>") },
  "source atom": { ...base, l: base.l.replace("LEFT", 'LEFT<img id="atom">') },
};
for (const [name, input] of Object.entries(refusals))
  test(`declined edited source refuses ${name}`, () =>
    assert.equal(planning(input).records.length, 0));

test("declined edited source: caps, ignore and remote authority refuse", () => {
  for (const limit of [0, 1, 64])
    assert.equal(planning(base, { limit }).records.length, 0);
  for (const key of ["ignore", "remoteWins"])
    assert.equal(
      planning(base, { [key]: (n) => n.textContent === "We met the TEAM." })
        .records.length,
      0,
    );
});

test("declined edited source: templates retain ordinary fallback", () => {
  for (const wrap of [
    (s) => `<template id="t">${s}</template>`,
    (s) => `<template id="t"><div>${s}</div></template>`,
  ]) {
    const x = mergeBodies(wrap(base.b), wrap(base.l), wrap(base.r));
    assert.equal(
      x.html,
      wrap("<p>We met the TEAM.</p><p>The client called. Then we left.</p>"),
    );
    assert.equal(x.res.conflicts.length, 1);
    assert.equal(x.res.conflicts[0].remote, "TEAM");
  }
});

test("declined edited source: complete certificate keeps priority over alternatives", () => {
  const x = planning({ ...base, r: base.r.replace("TEAM", "team") });
  assert.equal(x.records.length, 0);
  assert.ok(x.result?.certificates.length > 0);
});

test("declined edited source: physical endpoint whitespace is preserved", () => {
  const input = {
    b: "<p> \tWe met the team. Then we left.\n </p><p>The client called.</p>",
    l: "<p> \tWe met the team. Then we LEFT.\n </p><p>The client called.</p>",
    r: "<p> \tWe met the TEAM.\n </p><p>The client called.\tThen we left.\n</p>",
  };
  const x = planning(input);
  assert.equal(x.records.length, 1);
  assert.equal(x.html, expected(input));
  for (const model of x.records[0].models) {
    assert.equal(model.flat.text, model.unit.textContent);
    assert.equal(model.flat.nodes[0].e, model.flat.text.length);
  }
});

test("declined edited source: full identities refuse shared owner and preserve independent alternatives", async () => {
  const spec = (source) => ({
    map: {
      "1.0": source,
      1.1: "session:destination",
      "~": "2,0,2,0,0",
      "^": "html,head,body,p,p",
    },
  });
  for (const shared of [true, false]) {
    const ids = shared
      ? ["source:one", "source:one", "source:one"]
      : ["source:base", "source:local", "source:remote"];
    const identity = {
      base: spec(ids[0]),
      local: spec(ids[1]),
      remote: spec(ids[2]),
    };
    const b = parse(doc(base.b)),
      l = parse(doc(base.l)),
      r = parse(doc(base.r));
    const pure = merge3(b, l, r, { identity });
    const html = shared
      ? "<p>We met the TEAM.</p><p>The client called. Then we left.</p>"
      : expected(base);
    assert.equal(pure.doc.body.innerHTML, html);
    const live = parse(doc(base.l)),
      source = live.body.firstChild,
      destination = live.body.lastChild;
    const sourceText = source.firstChild,
      destinationText = destination.firstChild;
    const store = createIdentityStore("new");
    store.adopt(source, ids[1]);
    store.adopt(destination, "session:destination");
    const report = await mergeDocument({
      live,
      base: doc(base.b),
      remote: doc(base.r),
      identity,
      scripts: { execute: false },
      fastPath: false,
    });
    for (const [node, id] of report.identities) store.adopt(node, id);
    assert.equal(live.body.innerHTML, html);
    assert.equal(live.body.firstChild, source);
    assert.equal(source.firstChild, sourceText);
    assert.equal(live.body.lastChild, destination);
    assert.equal(destination.firstChild, destinationText);
    const outputIds = Array.from(live.body.children, store.idOf);
    assert.equal(new Set(outputIds).size, outputIds.length);
    assert.equal(outputIds[0], ids[1]);
    if (!shared) assert.equal(outputIds[1], ids[2]);
    assert.deepEqual(
      recoveryProblems(
        report.conflicts,
        finalTree(live.documentElement),
        false,
      ),
      [],
    );
  }
});
