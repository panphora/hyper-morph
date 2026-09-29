// Differential harness: run a frozen reference engine and the current tree on
// the same inputs and compare every observable field, so each engine
// milestone can list exactly what changed and why. Byte-comparing gates
// cannot see a merge that produces the right bytes with the wrong live nodes,
// identities or conflicts.
//
// The parent freezes `src/` into a reference directory before an engine
// milestone and points HM_REFERENCE_ENTRY at its `src/index.js`. Differences
// are accepted only through test/fuzz/differential-accepted.json, keyed by
// reference revision, then `mode:seed:shape` or `fixture:<name>:<shape>`,
// with the differing fields, a digest of both engines' values in them, and a
// classification. A difference whose values change is unaccepted again until
// its digest is rewritten, and an entry no difference matches any more fails
// the test. A new reference revision starts a new file: nothing carries over.
//
//   HM_REFERENCE_ENTRY=/private/tmp/hm-reference-m2/src/index.js \
//   HM_REFERENCE_REV=dea289b npm run test:diff
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { observe, staticRecovery } from "../lib/differential-observe.js";
import { generate, setIdMode } from "../lib/structure-fuzz.js";
import * as candidate from "../../src/index.js";
import { emptyStats } from "../../src/stats.js";

const MODES = [0, 1, 2, 3, 4, 5, 6];
const SEEDS = 1000;
const SHAPES = ["pure", "dirty", "clean", "element"];
// The fields the reference must agree on. The conflict report's `recovery`
// (E4b) is not among them: the reference has none, so it is checked on the
// candidate alone, below. A conflict's `node`/`el` the candidate filled where
// the reference had null (or a node the merge detached) is not a difference
// when recovery says it is the subject's live node: `projectPointers` puts
// the reference's value back before the comparison and counts the fill.
const FIELDS = [
  "html",
  "nodeDestinations",
  "adoptedIdentities",
  "conflicts",
  "decisions",
  "stats",
  "localDiverged",
  "moved",
  "replaced",
];
const ACCEPTED = fileURLToPath(
  new URL("./differential-accepted.json", import.meta.url),
);

// Hand-written fixtures from the E2e/E2f twin-routing work, the template
// content path and the D1 to D7 `localDiverged` rows of diverged.test.js, run
// in id mode 0 in every shape: the generator makes no templates, so nothing
// else here covers template content, and its corpus has no local-reorder shape
// for the `localDiverged` rows.
const B = `<template><p>w0 w1 w2 w3 w4</p></template>`;
const FIXTURES = [
  {
    name: "moved-out-to-new-section",
    b: B,
    l: B,
    r: `<section><p>w0 w1 w2 w3 w4</p></section><template></template>`,
  },
  {
    name: "moved-out-local-edit-elsewhere",
    b: `${B}<p>tail x y</p>`,
    l: `${B}<p>tail x Y</p>`,
    r: `<section><p>w0 w1 w2 w3 w4</p></section><template></template><p>tail x y</p>`,
  },
  {
    name: "moved-out-inline-child",
    b: `<template><p>w0 <b>w1</b> w2 w3</p></template>`,
    l: `<template><p>w0 <b>w1</b> w2 w3</p></template>`,
    r: `<section><p>w0 <b>w1</b> w2 w3</p></section><template></template>`,
  },
  {
    name: "moved-out-whole-div-subtree",
    b: `<template><div><p>w0 w1</p><p>w2 w3</p></div></template>`,
    l: `<template><div><p>w0 w1</p><p>w2 w3</p></div></template>`,
    r: `<section><div><p>w0 w1</p><p>w2 w3</p></div></section><template></template>`,
  },
  {
    name: "moved-out-nested-template-below-a-section",
    b: `<section><template><p>w0 w1 w2 w3 w4</p></template></section>`,
    l: `<section><template><p>w0 w1 w2 w3 w4</p></template></section>`,
    r: `<article><p>w0 w1 w2 w3 w4</p></article><section><template></template></section>`,
  },
  {
    name: "moved-out-div-source-control",
    b: `<div><p>w0 w1 w2 w3 w4</p></div>`,
    l: `<div><p>w0 w1 w2 w3 w4</p></div>`,
    r: `<section><p>w0 w1 w2 w3 w4</p></section><div></div>`,
  },
  {
    name: "cross-rewrite-under-containers",
    b: `<div><p>first block words</p></div><section><p>second block words</p></section>`,
    l: `<div><p>brand new text here</p></div><section><p>second block words</p></section>`,
    r: `<div><p>first block words</p></div><section><p>brand new text here</p></section>`,
  },
  {
    name: "echo-under-containers",
    b: `<div><p>alpha bravo</p></div><section><p>beta gamma</p></section>`,
    l: `<div><p>Done</p></div><section><p>beta gamma</p></section>`,
    r: `<div><p>alpha bravo</p></div><section><p>beta gamma</p><p>Done</p></section>`,
  },
  {
    name: "split-inside-a-template",
    b: `<template><p>alpha bravo charlie delta echo foxtrot</p><p>golf hotel india</p></template>`,
    l: `<template><p>alpha bravo charlie</p><p>delta echo foxtrot</p><p>golf hotel india</p></template>`,
    r: `<template><p>alpha bravo charlie delta echo FOXTROT</p><p>golf hotel india</p></template>`,
  },
  {
    name: "morph-children-crash",
    b: `<section><p>alpha bravo charlie</p></section><p>tail words</p>`,
    l: `<section></section><p>alpha bravo charlie</p><p>tail words</p>`,
    r: `<section><p>alpha bravo charlie</p></section><p>tail words here</p>`,
  },
  {
    name: "nested-template",
    b: `<template><section><template><p>w0 w1 w2</p></template></section></template><p>tail a b</p>`,
    l: `<template><section><template><p>w0 w1 w2</p></template></section></template><p>tail a b</p>`,
    r: `<template><section><template><p>w0 w1 w2</p></template></section></template><p>tail a B</p>`,
  },
  {
    name: "diverged-d1",
    b: `<ul><li>A one</li></ul><ul><li>B two</li></ul>`,
    l: `<ul><li>B two</li></ul><ul><li>A one</li></ul>`,
    r: `<ul><li>A one</li></ul><ul><li>B two</li></ul>`,
  },
  {
    name: "diverged-d2",
    b: `<ul data-id="u1"><li>A one</li></ul><ul data-id="u2"><li>B two</li></ul>`,
    l: `<ul data-id="u2"><li>B two</li></ul><ul data-id="u1"><li>A one</li></ul>`,
    r: `<ul data-id="u1"><li>A one</li></ul><ul data-id="u2"><li>B two</li></ul>`,
  },
  {
    name: "diverged-d3",
    b: `<ul data-id="u1"><li data-id="a">A one</li></ul><ul data-id="u2"><li data-id="b">B two</li></ul>`,
    l: `<ul data-id="u2"><li data-id="b">B two</li></ul><ul data-id="u1"><li data-id="a">A one</li></ul>`,
    r: `<ul data-id="u1"><li data-id="a">A one</li></ul><ul data-id="u2"><li data-id="b">B two</li></ul>`,
  },
  {
    name: "diverged-d4",
    b: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
    l: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
    r: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
  },
  {
    name: "diverged-d6",
    b: `<section><p>a b</p></section><aside></aside><p>c d</p>`,
    l: `<section><p>a b</p></section><aside></aside><p>c D</p>`,
    r: `<section></section><aside><p>a b</p></aside><p>c d</p>`,
  },
  {
    name: "diverged-d7",
    b: `<p>alpha beta</p><p>gamma delta</p>`,
    l: `<p>alpha beta</p><p>gamma delta</p>`,
    r: `<p>alpha BETA</p><p>gamma delta</p>`,
  },
];

/** The two engines' values in the differing fields, so an entry stops
 * accepting a difference whose values moved. */
const digestOf = (d) =>
  createHash("sha1")
    .update(JSON.stringify(d.fields.map((f) => [f, d.ref[f], d.cand[f]])))
    .digest("hex")
    .slice(0, 16);

const comparable = (o) =>
  Object.fromEntries(FIELDS.map((f) => [f, JSON.stringify(o[f])]));

const sameFields = (a, b) =>
  Array.isArray(a) && [...a].sort().join(",") === [...b].sort().join(",");

function countBy(diffs) {
  const byKey = new Map();
  for (const d of diffs) {
    const key = `${d.mode} ${d.shape}`;
    byKey.set(key, (byKey.get(key) || 0) + 1);
  }
  return byKey;
}

async function classify(reference, rev) {
  const accepted = existsSync(ACCEPTED)
    ? JSON.parse(readFileSync(ACCEPTED, "utf8"))
    : {};
  const table = accepted[rev] || {};
  const diffs = [];
  let runs = 0;
  // The candidate's recovery data, where a case has conflicts: well formed
  // (recoveryProblems), the same on a second run, and, without its live
  // side, the same on the pure and the dirty route.
  const recovered = { validated: 0, routes: 0, pointers: 0 };
  const projectPointers = (refList, candList, pointers) => {
    refList.forEach((r, i) => {
      const c = candList[i];
      if (!c) return;
      for (const k of ["node", "el"])
        if (
          r[k] !== c[k] &&
          (r[k] === null || r[k] === "detached") &&
          c[k] !== null &&
          pointers[i][k]
        ) {
          c[k] = r[k];
          recovered.pointers++;
        }
    });
  };
  // A stats key the reference predates (E5's fast-path keys) holds its
  // all-zero value on the candidate, which never asks for the fast path
  // here, and is left out of the comparison.
  const projectStats = (refStats, stats, key) => {
    const empty = emptyStats();
    for (const k of Object.keys(stats))
      if (!(k in refStats))
        assert.equal(
          stats[k],
          empty[k],
          `${key}: stats.${k} on a merge that never asked for the fast path`,
        );
    return Object.fromEntries(Object.keys(refStats).map((k) => [k, stats[k]]));
  };
  const recovery = async (key, shape, inputs, seen, statics) => {
    if (!seen.recovery.length) return;
    recovered.validated++;
    assert.deepEqual(seen.recoveryProblems, [], `${key}:${shape} recovery`);
    const again = await observe(candidate, shape, inputs);
    assert.equal(
      JSON.stringify(again.recovery),
      JSON.stringify(seen.recovery),
      `${key}:${shape} recovery differs between two runs`,
    );
    statics[shape] = staticRecovery(seen.recovery);
  };
  const runCase = async (key, name, mode, inputs) => {
    const statics = {};
    for (const shape of SHAPES) {
      runs++;
      const refSeen = await observe(reference, shape, inputs);
      const seen = await observe(candidate, shape, inputs);
      projectPointers(refSeen.conflicts, seen.conflicts, seen.pointers);
      seen.stats = projectStats(refSeen.stats, seen.stats, `${key}:${shape}`);
      const ref = comparable(refSeen);
      const cand = comparable(seen);
      await recovery(key, shape, inputs, seen, statics);
      const fields = FIELDS.filter((f) => ref[f] !== cand[f]);
      if (fields.length)
        diffs.push({
          key: `${key}:${shape}`,
          name,
          mode,
          shape,
          fields,
          ref,
          cand,
          inputs,
        });
    }
    if (statics.pure !== undefined || statics.dirty !== undefined) {
      recovered.routes++;
      assert.equal(
        statics.dirty,
        statics.pure,
        `${key}: recovery differs between the pure and the dirty route`,
      );
    }
  };
  for (const mode of MODES) {
    setIdMode(mode);
    try {
      for (let seed = 1; seed <= SEEDS; seed++)
        await runCase(`${mode}:${seed}`, `seed ${seed}`, mode, generate(seed));
    } finally {
      setIdMode(0);
    }
  }
  for (const fixture of FIXTURES)
    await runCase(
      `fixture:${fixture.name}`,
      `fixture ${fixture.name}`,
      0,
      fixture,
    );

  const entryFor = (d) => {
    const entry = table[d.key];
    return entry &&
      sameFields(entry.fields, d.fields) &&
      entry.digest === digestOf(d)
      ? entry
      : null;
  };
  const unaccepted = diffs.filter((d) => !entryFor(d));
  const classifications = new Map();
  for (const d of diffs) {
    const entry = entryFor(d);
    if (!entry) continue;
    const key = entry.classification;
    classifications.set(key, (classifications.get(key) || 0) + 1);
  }
  const used = new Set(diffs.map((d) => d.key));
  const stale = Object.keys(table).filter((k) => !used.has(k));

  const summary = [
    `differential ${rev}: ${runs} runs, ${diffs.length} differences ` +
      `(${diffs.length - unaccepted.length} accepted, ${unaccepted.length} unaccepted)`,
  ];
  for (const [key, n] of countBy(diffs)) summary.push(`  mode ${key}: ${n}`);
  summary.push(
    `  recovery: ${recovered.validated} runs validated and repeated, ` +
      `${recovered.routes} pure/dirty pairs equal, ` +
      `${recovered.pointers} legacy pointers filled and validated`,
  );
  for (const [key, n] of classifications) summary.push(`  "${key}": ${n}`);
  if (stale.length)
    summary.push(`  stale accepted entries: ${stale.join(", ")}`);
  console.log(summary.join("\n"));

  if (unaccepted.length) {
    const blocks = unaccepted.slice(0, 20).map((d) => {
      const { inputs } = d;
      return [
        `mode ${d.mode}, ${d.name}, ${d.shape}: ${d.fields.join(", ")}`,
        `  base:    ${inputs.b}`,
        `  local:   ${inputs.l}`,
        `  remote:  ${inputs.r}`,
        `  digest:  ${digestOf(d)}`,
        ...d.fields.map((f) => `  ref  ${f}: ${d.ref[f]}`),
        ...d.fields.map((f) => `  cand ${f}: ${d.cand[f]}`),
      ].join("\n");
    });
    console.log(blocks.join("\n"));
    if (unaccepted.length > blocks.length)
      console.log(`... and ${unaccepted.length - blocks.length} more`);
  }
  const failures = [];
  if (unaccepted.length)
    failures.push(
      `${unaccepted.length} of ${diffs.length} differences are not accepted in ` +
        `${ACCEPTED} for ${rev}`,
    );
  if (stale.length)
    failures.push(
      `${stale.length} accepted entries no longer occur: ${stale.join(", ")}`,
    );
  assert.deepEqual(failures, []);
}

const referenceEntry = process.env.HM_REFERENCE_ENTRY;
const referenceRev = process.env.HM_REFERENCE_REV;

if (!referenceEntry) {
  test("differential: skipped, no reference", { skip: true }, () => {});
} else {
  test("differential: the current tree against the frozen reference", async () => {
    assert.ok(
      referenceRev,
      "HM_REFERENCE_REV must be set when HM_REFERENCE_ENTRY is set",
    );
    const entry = path.resolve(process.cwd(), referenceEntry);
    assert.ok(
      existsSync(entry),
      `reference entry not found: ${referenceEntry}`,
    );
    const reference = await import(pathToFileURL(entry).href);
    await classify(reference, referenceRev);
  });
}
