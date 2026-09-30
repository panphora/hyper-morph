// Edit/move beats delete from immutable inputs, including descendants of a
// surviving container, and a fresh transport id is not a known logical
// parent. Executed assertions run the real engine and a wrapper that damages
// its output.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engine } from "../lib/engines.js";
import { verdict, judge } from "../lib/oracle.js";
import { identityCase } from "../lib/gen-identity.js";
import { MUTANTS } from "../lib/mutants.js";

// The oracle is judged against a frozen engine, never the live src/, so an
// engine fix the loop accepts cannot turn these checks red.
const E = await engine(process.env.HM_ORACLE_ENGINE || "282339c");

const OK = ["passes", "undecidable"];
const FAIL = ["counterexample"];

const damaged = (fn) => ({
  ...E,
  async mergeDocument(o) {
    const r = await E.mergeDocument(o);
    const x = fn(o.live, r);
    return x ? { ...r, ...x } : r;
  },
  async morphElement(el, content, o) {
    const r = await E.morphElement(el, content, o);
    const x = fn(el.ownerDocument, r);
    return x ? { ...r, ...x } : r;
  },
  merge3(base, local, remote, o) {
    const res = E.merge3(base, local, remote, o);
    const x = fn(res.doc, res);
    return x ? { ...res, ...x } : res;
  },
});

const deleteSection = (doc) => {
  doc.querySelector("section")?.remove();
};
const pruneA = (doc) => {
  [...doc.querySelectorAll("p")]
    .find((p) => p.textContent.includes("A"))
    ?.remove();
};

const rows = [];
const row = (name, damage, damageFn, c, want, words = [], contains = []) =>
  rows.push({ name, damage, damageFn, case: c, want, words, contains });

const shapes = ["dirty", "pure", "element"];
const asRoot = (shape, inner) =>
  shape === "element" ? `<main>${inner}</main>` : inner;
const deleted = (shape) => (shape === "element" ? "<main></main>" : "");

for (const identity of ["plain", "authored"]) {
  const at = (n) => (identity === "authored" ? ` id="${n}"` : ` sid="${n}"`);
  const box = at("box"),
    a = at("a"),
    b = at("b"),
    c = at("c");
  const pA = `<p${a}>A</p>`,
    pB = `<p${b}>B</p>`,
    pC = `<p${c}>C</p>`;
  const section = (extra, inner) => `<section${box}${extra}>${inner}</section>`;
  const base = section("", pA + pB);
  const swap = section("", pB + pA);
  const added = section("", pA + pB + pC);
  const attr = section(' class="x"', pA + pB);
  const attrChanged = section(' class="y"', pA + pB);

  for (const shape of shapes) {
    const keeper = asRoot(shape, base);
    const localMove = asRoot(shape, swap);
    const removed = deleted(shape);
    row(
      `1-${identity}-${shape}-local-moved-remote-deleted`,
      null,
      null,
      { shape, identity, base: keeper, local: localMove, remote: removed },
      OK,
      ["A", "B"],
    );
    row(
      `1-${identity}-${shape}-remote-moved-local-deleted`,
      null,
      null,
      { shape, identity, base: keeper, local: removed, remote: localMove },
      OK,
      ["A", "B"],
    );
    row(
      `1-${identity}-${shape}-local-moved-section-deleted`,
      "delete-section",
      deleteSection,
      { shape, identity, base: keeper, local: localMove, remote: removed },
      FAIL,
    );
    row(
      `1-${identity}-${shape}-remote-moved-section-deleted`,
      "delete-section",
      deleteSection,
      { shape, identity, base: keeper, local: removed, remote: localMove },
      FAIL,
    );

    const localAdd = asRoot(shape, added);
    row(
      `2-${identity}-${shape}-local-added-remote-deleted`,
      null,
      null,
      { shape, identity, base: keeper, local: localAdd, remote: removed },
      OK,
      ["A", "B", "C"],
    );
    row(
      `2-${identity}-${shape}-remote-added-local-deleted`,
      null,
      null,
      { shape, identity, base: keeper, local: removed, remote: localAdd },
      OK,
      ["A", "B", "C"],
    );
    row(
      `2-${identity}-${shape}-local-added-prune-A`,
      "prune-A",
      pruneA,
      { shape, identity, base: keeper, local: localAdd, remote: removed },
      FAIL,
    );
    row(
      `2-${identity}-${shape}-remote-added-prune-A`,
      "prune-A",
      pruneA,
      { shape, identity, base: keeper, local: removed, remote: localAdd },
      FAIL,
    );

    const attrKeep = asRoot(shape, attr);
    const attrLocal = asRoot(shape, attrChanged);
    row(
      `3-${identity}-${shape}-attribute-only-remote-deleted`,
      null,
      null,
      { shape, identity, base: attrKeep, local: attrLocal, remote: removed },
      OK,
      ["A", "B"],
      ["<section"],
    );
    row(
      `3-${identity}-${shape}-attribute-only-section-deleted`,
      "delete-section",
      deleteSection,
      { shape, identity, base: attrKeep, local: attrLocal, remote: removed },
      FAIL,
    );
  }

  for (const shape of ["dirty", "element"]) {
    row(
      `4-${identity}-${shape}-independent-deletions`,
      null,
      null,
      {
        shape,
        identity,
        base: asRoot(shape, `<div${a}>Same</div><div${b}>Same</div>`),
        local: asRoot(shape, `<div${a}>Same</div>`),
        remote: asRoot(shape, `<div${b}>Same</div>`),
      },
      OK,
    );
  }
}

row("5-gen39-dirty", null, null, identityCase(E, 39, "full", true), ["passes"]);
for (const [seed, dirty] of [
  [33, false],
  [33, true],
  [49, false],
  [50, false],
])
  row(
    `5-fresh-id-${seed}-${dirty ? "dirty" : "clean"}`,
    null,
    null,
    identityCase(E, seed, "full", dirty),
    ["passes"],
  );

const results = [];
let failed = 0;
for (const r of rows) {
  const engine = r.damageFn ? damaged(r.damageFn) : E;
  let v;
  try {
    v = await verdict(engine, null, structuredClone(r.case));
  } catch (e) {
    v = {
      status: "CRASH",
      violations: [],
      ambiguous: [],
      reason: String((e && e.message) || e),
    };
  }
  let html = null;
  if (r.words.length || r.contains.length) {
    try {
      const j = await judge(E, structuredClone(r.case));
      html = j.obs?.raw?.liveRoot?.body?.innerHTML ?? null;
    } catch (e) {
      html = null;
    }
  }
  const checks = [];
  for (const w of r.words)
    checks.push({
      kind: "word",
      value: w,
      ok: html != null && new RegExp(`\\b${w}\\b`).test(html),
    });
  for (const s of r.contains)
    checks.push({
      kind: "contains",
      value: s,
      ok: html != null && html.includes(s),
    });
  const ok = r.want.includes(v.status) && checks.every((c) => c.ok);
  if (!ok) failed++;
  results.push({
    name: r.name,
    damage: r.damage,
    want: r.want,
    status: v.status,
    ok,
    checks,
    violations: v.violations || [],
    ambiguous: v.ambiguous || [],
    reason: v.reason || null,
    html,
  });
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cdir = path.join(root, "test/counterexamples/cases/");
const pool = readdirSync(cdir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(cdir + f, "utf8")));
for (let seed = 1; seed <= 12; seed++)
  for (const dirty of [false, true]) {
    const c = identityCase(E, seed, "full", dirty);
    if (c) pool.push(c);
  }

const mutations = {};
for (const [kind, wrap] of Object.entries(MUTANTS)) {
  const bad = wrap(E);
  let green = 0,
    caught = 0;
  for (const c of pool) {
    if ((await judge(E, c)).violations.length) continue;
    green++;
    if ((await judge(bad, c)).violations.length) caught++;
  }
  mutations[kind] = { green, caught, ok: caught > 0 };
  if (!(caught > 0)) failed++;
}

for (const r of results)
  if (!r.ok)
    console.log(
      `FAIL ${r.name}: ${r.status} ` +
        JSON.stringify(r.violations.slice(0, 2)) +
        " " +
        JSON.stringify(r.checks.filter((c) => !c.ok)) +
        (r.reason ? " reason=" + r.reason : ""),
    );
for (const [kind, m] of Object.entries(mutations))
  if (!m.ok)
    console.log(
      `FAIL planted ${kind}: no green case turned red (${m.green} green)`,
    );
console.log(
  `survival ${results.filter((r) => r.ok).length}/${results.length}, ` +
    `mutations ${Object.values(mutations).filter((m) => m.ok).length}/${Object.keys(mutations).length}`,
);
if (failed) process.exitCode = 1;
