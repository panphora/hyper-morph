// The historical destination fence for converged leaves. When the output's
// full element structure matches remote, a clean merge's original live leaf
// must sit under the logical parent of its remote occurrence: an original leaf
// that lands elsewhere is a destination counterexample, while a fresh
// identical sibling under the same parent stays legal (fresh-copy identity is
// still off) and anonymous container identity is never checked. Executed
// assertions run the real engines; damage wrappers call the real engine first
// and then alter only its output.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { engine } from "../lib/engines.js";
import { verdict, judge } from "../lib/oracle.js";
import { ownerSnapshot } from "../lib/owner.js";
import { identityCase } from "../lib/gen-identity.js";

// The oracle is judged against a frozen engine, never the live src/, so an
// engine fix the loop accepts cannot turn these checks red.
const E = await engine(process.env.HM_ORACLE_ENGINE || "282339c");

const wrap = (mutate) => ({
  ...E,
  async mergeDocument(o) {
    const r = await E.mergeDocument(o);
    mutate(o.live, r);
    return r;
  },
  async morphElement(el, content, o) {
    const r = await E.morphElement(el, content, o);
    mutate(el.ownerDocument, r);
    return r;
  },
  merge3(b, l, r, o) {
    const res = E.merge3(b, l, r, o);
    mutate(res.doc, res);
    return res;
  },
});

const results = [];
const check = async (name, fn) => {
  let value;
  try {
    value = await fn();
  } catch (e) {
    value = { error: String((e && e.message) || e) };
  }
  results.push({ name, ...value });
};

const props = (v) =>
  [...new Set((v.violations || []).map((x) => x.prop))].sort();

const run = async (c, engine = E) => {
  const v = await verdict(engine, null, structuredClone(c));
  const out = {
    status: v.status,
    props: props(v),
    violations: (v.violations || []).slice(0, 6),
  };
  try {
    const j = await judge(engine, structuredClone(c));
    out.html = j.obs?.raw?.liveRoot?.body?.innerHTML ?? null;
  } catch {
    out.html = null;
  }
  return out;
};

const OK = ["passes", "undecidable"];
const notCx = (r) =>
  assert.ok(
    OK.includes(r.status),
    `expected a good status: ${JSON.stringify(r)}`,
  );
const isCx = (r) => assert.equal(r.status, "counterexample", JSON.stringify(r));
const leafWitnesses = (r) =>
  (r.violations || []).filter(
    (v) => v.prop === "destination" && v.why === "leaf-parent-occurrence",
  );

const casesDir = fileURLToPath(new URL("../cases/", import.meta.url));

// 30c016d is the revision whose copy subtrees receive the original live leaf.
const OLD = await engine("30c016d");

const kids = (el) => [
  ...(el?.localName === "template" && el.content
    ? el.content.children
    : el?.children || []),
];

const pathUnder = (root, el) => {
  const path = [];
  let x = el;
  while (x && x !== root) {
    const parent = x.parentNode;
    if (!parent) return null;
    path.unshift(kids(parent).indexOf(x));
    x = parent;
  }
  return x === root ? path : null;
};

// The original live BB node of the historical g2 case, its remote occurrence
// and the logical parents the destination fence compares, on one engine.
const bbPaths = async (engine, c) => {
  const j = await judge(engine, structuredClone(c));
  const { R, L, G } = ownerSnapshot(c, j.obs);
  const r = R.map.get("$BB");
  const liveEl = j.obs.raw.p.capToLive.get(L.map.get("$BB"));
  return {
    remote: pathUnder(R.scope, r),
    live: pathUnder(G.scope, liveEl),
    remoteParent: pathUnder(R.scope, R.parent(r)),
    liveParent: pathUnder(G.scope, G.parent(liveEl)),
    html: j.obs.html,
  };
};

await check(
  "historical g2 keeps the original live BB in its remote parent occurrence",
  async () => {
    const g2 = JSON.parse(
      readFileSync(path.join(casesDir, "seed-g2-real.json"), "utf8"),
    );
    const good = await run(g2);
    notCx(good);
    const bad = await run(g2, OLD);
    isCx(bad);
    const witness = leafWitnesses(bad)[0];
    assert.ok(witness, JSON.stringify(bad));
    const now = await bbPaths(E, g2);
    const old = await bbPaths(OLD, g2);
    assert.deepEqual(now.remote, [1, 0, 0, 0, 0]);
    assert.deepEqual(now.live, [1, 0, 0, 0, 0]);
    assert.deepEqual(old.remote, [1, 0, 0, 0, 0]);
    assert.deepEqual(old.live, [1, 0, 1, 0, 0, 0, 0]);
    assert.deepEqual(witness.want, [1, 0, 0, 0]);
    assert.deepEqual(witness.got, [1, 0, 1, 0, 0, 0]);
    assert.deepEqual(witness.want, now.remoteParent);
    assert.deepEqual(witness.got, old.liveParent);
    assert.equal(good.html, bad.html);
    return {
      current: { status: good.status, paths: now },
      historical: { status: bad.status, props: bad.props, witness, paths: old },
      sameHtml: good.html === bad.html,
      html: good.html,
    };
  },
);

await check("generated live swaps under one parent stay passes", async () => {
  const rows = [];
  for (const seed of [22, 31]) {
    const c = identityCase(E, seed, "full", false);
    assert.ok(c, `no generated case for seed ${seed}`);
    const r = await run(c);
    assert.equal(r.status, "passes", JSON.stringify(r));
    assert.equal(leafWitnesses(r).length, 0, JSON.stringify(r));
    rows.push({ seed, status: r.status, props: r.props, ops: c.meta.ops });
  }
  return { rows };
});

await check(
  "dirty seed31 stays a counterexample for its misplaced LOCAL edit",
  async () => {
    const c = identityCase(E, 31, "full", true);
    assert.ok(c, "no generated case for seed 31");
    const r = await run(c);
    isCx(r);
    const loss = (r.violations || []).find(
      (v) => v.prop === "loss" && v.word === "LOCAL",
    );
    assert.ok(loss, JSON.stringify(r));
    assert.equal(loss.want, 1);
    assert.equal(loss.got, 0);
    return { status: r.status, props: r.props, loss, ops: c.meta.ops };
  },
);

const TWO_WRAPPERS = {
  shape: "clean",
  identity: "plain",
  base: '<div><section><p sid="L1">same</p></section><section><p sid="L2">same</p></section></div>',
  remote:
    '<div class="r"><section><p sid="L1">same</p></section><section><p sid="L2">same</p></section></div>',
};

// Exchange the two paragraph node objects between their wrappers. The text is
// identical on both sides, so the serialized HTML cannot show the damage.
const swapLeaves = (d) => {
  const before = d.body.innerHTML;
  const ps = [...d.querySelectorAll("p")];
  const mark = d.createComment("");
  ps[0].replaceWith(mark);
  ps[1].replaceWith(ps[0]);
  mark.replaceWith(ps[1]);
  const sections = [...d.querySelectorAll("section")];
  assert.equal(sections[0].firstElementChild, ps[1]);
  assert.equal(sections[1].firstElementChild, ps[0]);
  assert.equal(d.body.innerHTML, before);
};

const swappedLeaves = async (identity) => {
  const c = { ...TWO_WRAPPERS, identity };
  const good = await run(c);
  notCx(good);
  const bad = await run(c, wrap(swapLeaves));
  isCx(bad);
  const byId = new Map(leafWitnesses(bad).map((v) => [v.id, v]));
  assert.deepEqual(byId.get("$L1")?.want, [1, 0, 0]);
  assert.deepEqual(byId.get("$L1")?.got, [1, 0, 1]);
  assert.deepEqual(byId.get("$L2")?.want, [1, 0, 1]);
  assert.deepEqual(byId.get("$L2")?.got, [1, 0, 0]);
  assert.equal(bad.html, good.html);
  return {
    good: { status: good.status, html: good.html },
    bad: {
      status: bad.status,
      props: bad.props,
      witnesses: [...byId.values()],
    },
    sameHtml: good.html === bad.html,
  };
};

await check(
  "swapping live leaves between anonymous wrappers is leaf-parent-occurrence",
  async () => await swappedLeaves("plain"),
);

await check(
  "clay: swapping live leaves between anonymous wrappers is still caught",
  async () => await swappedLeaves("clay"),
);

const STRONG_MOVE = {
  shape: "clean",
  identity: "authored",
  base: '<div data-id="D"><section class="a"><p data-id="P">x</p></section><section class="b"></section></div>',
  remote:
    '<div data-id="D"><section class="a"></section><section class="b"><p data-id="P">x</p></section></div>',
};

await check(
  "a strong leaf the remote moves between wrappers passes",
  async () => {
    const r = await run(STRONG_MOVE);
    notCx(r);
    assert.equal(leafWitnesses(r).length, 0, JSON.stringify(r));
    assert.ok(
      r.html.includes('<section class="b"><p data-id="P">x</p></section>'),
      JSON.stringify(r),
    );
    return r;
  },
);

// Swap the two anonymous container objects but put the identified leaves back
// under the wrappers their remote occurrences name: original container
// identity is excluded, so this must not be flagged.
const swapContainers = (d) => {
  const sections = [...d.querySelectorAll("section")];
  const leaves = [...d.querySelectorAll("p")];
  const mark = d.createComment("");
  sections[0].replaceWith(mark);
  sections[1].replaceWith(sections[0]);
  mark.replaceWith(sections[1]);
  const now = [...d.querySelectorAll("section")];
  now[0].appendChild(leaves[0]);
  now[1].appendChild(leaves[1]);
  assert.equal(now[0], sections[1]);
  assert.equal(now[1], sections[0]);
  assert.equal(now[0].firstElementChild, leaves[0]);
  assert.equal(now[1].firstElementChild, leaves[1]);
};

await check(
  "anonymous containers swapped under correct leaves are not flagged",
  async () => {
    const good = await run(TWO_WRAPPERS);
    notCx(good);
    const swapped = await run(TWO_WRAPPERS, wrap(swapContainers));
    notCx(swapped);
    assert.equal(leafWitnesses(swapped).length, 0, JSON.stringify(swapped));
    assert.equal(swapped.html, good.html);
    return { good, swapped };
  },
);

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(
  `leaf-occurrences ${results.length - failed.length}/${results.length}`,
);
if (failed.length) process.exitCode = 1;
