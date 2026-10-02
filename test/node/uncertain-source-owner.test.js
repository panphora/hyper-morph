import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const cases = {
  append: {
    b: "<p>alpha beta</p><p>gamma delta</p>",
    l: "<p>alpha beta gamma delta</p><p>gamma new</p>",
    r: "<p>alpha beta</p><p>gamma DELTA</p>",
    source: 1,
  },
  prepend: {
    b: "<p>gamma delta</p><p>alpha beta</p>",
    l: "<p>gamma new</p><p>gamma delta alpha beta</p>",
    r: "<p>gamma DELTA</p><p>alpha beta</p>",
    source: 0,
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
  const records = [],
    ignored = options.ignore || (() => false),
    remoteWins = options.remoteWins || (() => false);
  if (options.splitSource)
    for (const list of units) list[input.source].firstChild.splitText(6);
  const result = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P" && !ignored(u) && !remoteWins(u),
    ignored,
    remoteWins,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    onUncertainOwner: (r) => records.push(r),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return { ...x, result, records, units };
}

function expected(input, mirror) {
  const owner =
    input.source === 1
      ? "<p>alpha beta gamma delta</p>"
      : "<p>gamma delta alpha beta</p>";
  const alternatives = mirror
    ? "<p>gamma DELTA</p><p>gamma new</p>"
    : "<p>gamma new</p><p>gamma DELTA</p>";
  return input.source === 1 ? owner + alternatives : alternatives + owner;
}

for (const [name, input] of Object.entries(cases))
  for (const mirror of [false, true]) {
    const fixture = mirror ? { ...input, l: input.r, r: input.l } : input;
    test(`uncertain source owner: ${name}, mirror ${mirror}, native alternatives`, () => {
      const x = planning(fixture);
      assert.equal(x.records.length, 1);
      const record = x.records[0],
        source = x.b.body.children[input.source],
        local = x.l.body.children[input.source],
        remote = x.r.body.children[input.source];
      assert.equal(record.source, source);
      assert.equal(record.local, local);
      assert.equal(record.remote, remote);
      for (const [i, unit] of [source, local, remote].entries()) {
        assert.equal(record.models[i].unit, unit);
        assert.equal(record.models[i].flat.nodes[0].node, unit.firstChild);
        assert.equal(record.models[i].flat.nodes[0].s, 0);
        assert.equal(record.models[i].flat.nodes[0].e, unit.textContent.length);
      }
      assert.equal(x.html, expected(input, mirror));
      assert.equal(x.res.conflicts.length, 1);
      const c = x.res.conflicts[0];
      assert.equal(c.base, "<p>gamma delta</p>");
      assert.equal(c.local, local.outerHTML);
      assert.equal(c.remote, remote.outerHTML);
      assert.equal(c.resolved, local.outerHTML + remote.outerHTML);
      assert.equal(c.recovery.localLost, false);
      for (const side of ["base", "local", "remote"])
        assert.deepEqual(
          [c.recovery.text[side].start, c.recovery.text[side].end],
          [0, 1],
        );
      assert.deepEqual(
        [c.recovery.text.merged.start, c.recovery.text.merged.end],
        [0, 2],
      );
      const localOut = x.res.doc.body.children[input.source],
        remoteOut = x.res.doc.body.children[input.source + 1];
      assert.deepEqual(x.res.provenance.get(localOut), {
        base: null,
        local,
        remote: null,
      });
      assert.deepEqual(x.res.provenance.get(remoteOut), {
        base: null,
        local: null,
        remote,
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
    test(`uncertain source owner: ${name}, mirror ${mirror}, native identity and postcapture typing`, async () => {
      const live = parse(doc(fixture.l)),
        captured = parse(doc(fixture.l)),
        owners = Array.from(live.body.children),
        texts = owners.map((n) => n.firstChild);
      const map = lockstepMap(captured.documentElement, live.documentElement);
      const source = owners[input.source],
        other = owners[1 - input.source];
      source.firstChild.data = source.textContent.replace(
        "gamma ",
        "gamma TYPED ",
      );
      other.firstChild.data = other.textContent.replace(
        "alpha beta",
        "alpha TYPED-OWNER beta",
      );
      const report = await mergeDocument({
        live,
        base: doc(input.b),
        remote: doc(fixture.r),
        local: {
          root: captured.documentElement,
          toLive: (n) => map.get(n) || null,
        },
        scripts: { execute: false },
        fastPath: false,
      });
      const actualSource = mirror ? "gamma TYPED DELTA" : "gamma TYPED new";
      assert.equal(
        live.body.innerHTML,
        expected(input, mirror)
          .replace(
            mirror ? "<p>gamma DELTA</p>" : "<p>gamma new</p>",
            `<p>${actualSource}</p>`,
          )
          .replace("alpha beta", "alpha TYPED-OWNER beta"),
      );
      assert.equal(live.body.children[input.source], source);
      assert.equal(source.textContent, actualSource);
      assert.equal(source.firstChild, texts[input.source]);
      assert.equal(
        live.body.children[input.source + 1].textContent,
        mirror ? "gamma new" : "gamma DELTA",
      );
      const ownerAt = input.source === 1 ? 0 : 2;
      assert.equal(live.body.children[ownerAt], other);
      assert.equal(other.firstChild, texts[1 - input.source]);
      assert.ok(other.textContent.includes("alpha TYPED-OWNER beta"));
      assert.equal(
        Array.from(live.body.children).filter((n) => n === source).length,
        1,
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

test("uncertain source owner: following insertions anchor after both alternatives", async () => {
  const follow = '<h2 id="after">AFTER</h2>',
    extra = "<p>LOCAL INSERT</p>",
    input = cases.append;
  const live = parse(doc(input.l + extra + follow)),
    captured = parse(doc(input.l + extra + follow)),
    owners = Array.from(live.body.children),
    map = lockstepMap(captured.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: doc(input.b + follow),
    remote: doc(input.r + follow),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    scripts: { execute: false },
    fastPath: false,
  });
  assert.equal(live.body.innerHTML, expected(input, false) + extra + follow);
  assert.equal(live.body.children[1], owners[1]);
  assert.equal(live.body.children[3], owners[2]);
  assert.equal(live.body.lastChild, owners[3]);
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
});

test("uncertain source owner: complete models preserve separate original Text nodes", () => {
  const x = planning(cases.append, { splitSource: true });
  assert.equal(x.records.length, 1);
  for (const model of x.records[0].models) {
    assert.equal(model.flat.nodes.length, 2);
    assert.equal(model.flat.nodes[0].node, model.unit.firstChild);
    assert.equal(model.flat.nodes[1].node, model.unit.lastChild);
    assert.deepEqual(
      model.flat.nodes.map((n) => [n.s, n.e]),
      [
        [0, 6],
        [6, model.flat.text.length],
      ],
    );
  }
});

test("uncertain source owner: named sources keep ordinary policy", () => {
  const input = Object.fromEntries(
    Object.entries(cases.append).map(([k, v]) => [
      k,
      typeof v === "string" ? v.replace("<p>gamma", '<p id="source">gamma') : v,
    ]),
  );
  const x = planning(input);
  assert.deepEqual(x.records, []);
  assert.equal(x.res.doc.body.children.length, 2);
});

test("uncertain source owner: exact unchanged copies and equal edits need no alternative", () => {
  for (const replacement of ["gamma delta", "gamma DELTA"]) {
    const x = planning({
      ...cases.append,
      l: cases.append.l.replace("gamma new", replacement),
    });
    assert.deepEqual(x.records, []);
  }
});

test("uncertain source owner: ambiguous gained occurrences refuse", () => {
  const x = planning({
    ...cases.append,
    l: cases.append.l.replace(
      "alpha beta gamma delta",
      "alpha beta gamma delta gamma delta",
    ),
  });
  assert.deepEqual(x.records, []);
});

test("uncertain source owner: atoms and inline marks retain ordinary rendering", () => {
  for (const inserted of ['<img id="atom">', "<b>gamma</b>"]) {
    const input = {
      ...cases.append,
      l: cases.append.l.replace("gamma new", inserted + " new"),
    };
    const x = planning(input);
    assert.deepEqual(x.records, []);
  }
});

test("uncertain source owner: ignored and remote authority prevent alternatives", () => {
  for (const options of [
    { ignore: (n) => n.textContent === "gamma new" },
    { remoteWins: (n) => n.textContent === "gamma new" },
  ]) {
    const x = planning(cases.append, options);
    assert.deepEqual(x.records, []);
  }
});

test("uncertain source owner: whole rewrites without a retained boundary refuse", () => {
  const x = planning({
    ...cases.append,
    l: cases.append.l.replace("gamma new", "unrelated new"),
  });
  assert.deepEqual(x.records, []);
});

test("uncertain source owner: caps make no owner alternatives", () => {
  for (const limit of [0, 1, 64])
    assert.deepEqual(planning(cases.append, { limit }).records, []);
});

test("uncertain source owner: template content stays on ordinary native fallback", () => {
  const input = cases.append,
    wrap = (html) => `<template id="template">${html}</template>`;
  const x = mergeBodies(wrap(input.b), wrap(input.l), wrap(input.r));
  assert.equal(x.html, wrap("<p>alpha beta gamma delta</p><p>gamma DELTA</p>"));
  assert.equal(x.res.conflicts.length, 1);
  assert.equal(x.res.conflicts[0].base, "delta");
  assert.equal(x.res.conflicts[0].local, "new");
  assert.equal(x.res.conflicts[0].remote, "DELTA");
});

test("uncertain source owner: nested element parent in template stays on ordinary fallback", () => {
  const input = cases.append,
    wrap = (html) => `<template id="template"><div>${html}</div></template>`;
  const x = mergeBodies(wrap(input.b), wrap(input.l), wrap(input.r));
  assert.equal(x.html, wrap("<p>alpha beta gamma delta</p><p>gamma DELTA</p>"));
  assert.equal(x.res.conflicts.length, 1);
  assert.equal(x.res.conflicts[0].base, "delta");
  assert.equal(x.res.conflicts[0].resolved, "DELTA");
});

test("uncertain source owner: either retained parent moved into template prevents alternatives", () => {
  const input = cases.append,
    owner = (html) => `<div id="parent">${html}</div>`,
    wrap = (html) => `<template id="template">${html}</template>`;
  for (const mirror of [false, true]) {
    const x = mergeBodies(
      owner(input.b),
      mirror ? owner(input.r) : wrap(owner(input.l)),
      mirror ? wrap(owner(input.l)) : owner(input.r),
    );
    const source = x.b.querySelector("#parent").children[1];
    assert.equal(source.getRootNode().nodeType, 9);
    assert.equal(
      (mirror ? x.res.R : x.res.L).map.get(source).getRootNode().nodeType,
      11,
    );
    assert.equal(
      x.html,
      wrap(
        owner(
          `<p>alpha beta gamma delta</p><p>gamma ${mirror ? "new" : "DELTA"}</p>`,
        ),
      ),
    );
    assert.equal(x.res.conflicts.length, 1);
    assert.equal(x.res.conflicts[0].base, "delta");
    assert.equal(x.res.conflicts[0].resolved, mirror ? "new" : "DELTA");
  }
});
