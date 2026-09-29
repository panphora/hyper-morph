// Differential harness: run a frozen reference engine and the current tree on
// the same inputs and compare every observable field, so each engine
// milestone can list exactly what changed and why. Byte-comparing gates
// cannot see a merge that produces the right bytes with the wrong live nodes,
// identities or conflicts.
//
// The parent freezes `src/` into a reference directory before an engine
// milestone and points HM_REFERENCE_ENTRY at its `src/index.js`. Differences
// are accepted only through test/fuzz/differential-accepted.json, keyed by
// reference revision, then `mode:seed:shape`, with the differing fields and a
// classification. A new reference revision starts a new file: nothing
// carries over.
//
//   HM_REFERENCE_ENTRY=/private/tmp/hm-reference-m2/src/index.js \
//   HM_REFERENCE_REV=dea289b npm run test:diff
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, doc } from "../node/lib/dom.js";
import { generate, setIdMode } from "../lib/structure-fuzz.js";
import * as candidate from "../../src/index.js";

const MODES = [0, 1, 2, 3, 4, 5, 6];
const SEEDS = 1000;
const SHAPES = ["pure", "dirty", "clean"];
const FIELDS = [
  "html",
  "nodeDestinations",
  "adoptedIdentities",
  "conflicts",
  "decisions",
  "localDiverged",
  "moved",
  "replaced",
];
const ACCEPTED = fileURLToPath(
  new URL("./differential-accepted.json", import.meta.url),
);

const contentOf = (n) =>
  n.nodeType === 1 && n.tagName === "TEMPLATE" && n.content ? n.content : null;

/** Number every node of a tree, template content included, so two engines'
 * trees can be compared by position. */
function labelTree(root) {
  const ids = new WeakMap();
  const nodes = [];
  const visit = (n) => {
    ids.set(n, nodes.length);
    nodes.push(n);
    const content = contentOf(n);
    if (content) visit(content);
    for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
  };
  visit(root);
  return { ids, nodes };
}

/** The nodes still reachable from the live root after the merge. */
function reachable(root) {
  const seen = new Set();
  const visit = (n) => {
    seen.add(n);
    const content = contentOf(n);
    if (content) visit(content);
    for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
  };
  visit(root);
  return seen;
}

/** Where every pre-merge live node went: connected or not, and, when it is
 * connected, the label of its parent (or "new") and its index there. */
function destinations(root, label) {
  const live = reachable(root);
  return label.nodes.map((n, i) => {
    if (!live.has(n)) return [i, 0];
    const parent = n.parentNode;
    const p = label.ids.get(parent);
    return [
      i,
      1,
      p === undefined ? "new" : p,
      Array.prototype.indexOf.call(parent.childNodes, n),
    ];
  });
}

/** The capture's nodes, paired with the live nodes they became. */
function lockstepMap(a, b) {
  const m = new WeakMap();
  const wa = a.ownerDocument.createTreeWalker(a),
    wb = b.ownerDocument.createTreeWalker(b);
  let x = a,
    y = b;
  do {
    m.set(x, y);
    x = wa.nextNode();
    y = wb.nextNode();
  } while (x && y);
  return m;
}

const conflictList = (conflicts) =>
  conflicts
    .map((c) =>
      JSON.stringify([c.kind, c.detail === undefined ? null : c.detail]),
    )
    .sort();

const decisionList = (decisions) => [
  decisions.length,
  decisions.map((d) => d.kind).sort(),
];

const identityList = (identities, label) =>
  identities
    .map(([el, id]) => {
      const n = label.ids.get(el);
      return JSON.stringify([n === undefined ? null : n, id]);
    })
    .sort();

/**
 * One engine's view of one (mode, seed, shape): the merged bytes and every
 * live-node, identity, conflict and decision field a merge can observe.
 */
async function observe(engine, shape, inputs) {
  const { b, l, r } = inputs;
  if (shape === "pure") {
    // The pure merge without hooks omits subtrees identical on both sides:
    // its output is an instruction for apply, not a document. The fuzz gate's
    // pure merge reads the whole output, so ask for a visit.
    const res = engine.merge3(parse(doc(b)), parse(doc(l)), parse(doc(r)), {
      hooks: { beforeNodeMorphed: () => {} },
    });
    return {
      html: res.doc.body.innerHTML,
      nodeDestinations: [],
      adoptedIdentities: [],
      conflicts: conflictList(res.conflicts),
      decisions: decisionList(res.decisions),
      localDiverged: res.localDiverged,
      moved: 0,
      replaced: 0,
    };
  }
  const live = parse(doc(shape === "clean" ? b : l));
  const label = labelTree(live.documentElement);
  let base, local;
  if (shape === "clean") {
    const cap = parse(doc(b));
    const toLive = lockstepMap(cap.documentElement, live.documentElement);
    base = cap;
    local = {
      root: cap.documentElement,
      toLive: (n) => toLive.get(n) || null,
    };
  } else {
    base = doc(b);
  }
  const report = await engine.mergeDocument({
    live,
    base,
    local,
    remote: doc(r),
  });
  return {
    html: live.body.innerHTML,
    nodeDestinations: destinations(live.documentElement, label),
    adoptedIdentities: identityList(report.identities || [], label),
    conflicts: conflictList(report.conflicts),
    decisions: decisionList(report.decisions || []),
    localDiverged: report.localDiverged,
    moved: report.moved.length,
    replaced: report.replaced.length,
  };
}

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
  for (const mode of MODES) {
    setIdMode(mode);
    try {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const shape of SHAPES) {
          runs++;
          const inputs = generate(seed);
          const ref = comparable(await observe(reference, shape, inputs));
          const cand = comparable(await observe(candidate, shape, inputs));
          const fields = FIELDS.filter((f) => ref[f] !== cand[f]);
          if (fields.length)
            diffs.push({ mode, seed, shape, fields, ref, cand, inputs });
        }
      }
    } finally {
      setIdMode(0);
    }
  }

  const unaccepted = diffs.filter((d) => {
    const entry = table[`${d.mode}:${d.seed}:${d.shape}`];
    return !entry || !sameFields(entry.fields, d.fields);
  });
  const classifications = new Map();
  for (const d of diffs) {
    const entry = table[`${d.mode}:${d.seed}:${d.shape}`];
    if (!entry || !sameFields(entry.fields, d.fields)) continue;
    const key = entry.classification;
    classifications.set(key, (classifications.get(key) || 0) + 1);
  }

  const summary = [
    `differential ${rev}: ${runs} runs, ${diffs.length} differences ` +
      `(${diffs.length - unaccepted.length} accepted, ${unaccepted.length} unaccepted)`,
  ];
  for (const [key, n] of countBy(diffs)) summary.push(`  mode ${key}: ${n}`);
  for (const [key, n] of classifications) summary.push(`  "${key}": ${n}`);
  console.log(summary.join("\n"));

  if (unaccepted.length) {
    const blocks = unaccepted.slice(0, 20).map((d) => {
      const { inputs } = d;
      return [
        `mode ${d.mode}, seed ${d.seed}, ${d.shape}: ${d.fields.join(", ")}`,
        `  base:    ${inputs.b}`,
        `  local:   ${inputs.l}`,
        `  remote:  ${inputs.r}`,
        ...d.fields.map((f) => `  ref  ${f}: ${d.ref[f]}`),
        ...d.fields.map((f) => `  cand ${f}: ${d.cand[f]}`),
      ].join("\n");
    });
    console.log(blocks.join("\n"));
    if (unaccepted.length > blocks.length)
      console.log(`... and ${unaccepted.length - blocks.length} more`);
  }
  assert.equal(
    unaccepted.length,
    0,
    `${unaccepted.length} of ${diffs.length} differences are not accepted in ` +
      `${ACCEPTED} for ${rev}`,
  );
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
    assert.ok(
      existsSync(referenceEntry),
      `reference entry not found: ${referenceEntry}`,
    );
    const reference = await import(referenceEntry);
    await classify(reference, referenceRev);
  });
}
