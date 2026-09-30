// Mode-correct order, pure provenance lookup, duplicate-output enforcement,
// input validation and the independent sender map. Executed assertions run the
// real engine and wrappers that damage its output.
import assert from "node:assert/strict";
import { engine } from "../lib/engines.js";
import { verdict, judge, facts, invalid } from "../lib/oracle.js";
import { normalize } from "../lib/runner.js";

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

const reverseChildren = (sel) => (doc) => {
  const host = doc.querySelector(sel) || doc.body.firstElementChild;
  if (!host) return;
  [...host.children].reverse().forEach((c) => host.append(c));
};

const orderByText = (sel, texts) => (doc) => {
  const host = doc.querySelector(sel);
  if (!host) return;
  const by = new Map([...host.children].map((c) => [c.textContent, c]));
  for (const t of texts) host.append(by.get(t));
};

const duplicateOwner = (doc, report) => {
  const owner = doc.querySelector("div p");
  if (!owner) return;
  const clone = owner.cloneNode(true);
  owner.after(clone);
  if (Array.isArray(report?.identities)) report.identities.push([clone, "a"]);
};

const results = [];
const record = (name, value) => {
  results.push({ name, ...value });
};
const check = async (name, fn) => {
  let value;
  try {
    value = await fn();
  } catch (e) {
    value = { error: String((e && e.message) || e) };
  }
  record(name, value);
};
const props = (v) => [...new Set((v.violations || []).map((x) => x.prop))];

const run = async (c, engine = E, ref = null) => {
  const v = await verdict(engine, ref, structuredClone(c));
  return {
    status: v.status,
    props: props(v),
    reason: v.reason || null,
    violations: (v.violations || []).slice(0, 4),
    ambiguous: (v.ambiguous || []).slice(0, 4),
    referenceSame: v.reference?.same ?? null,
  };
};

const A = {
  shape: "clean",
  identity: "default",
  base: '<div id="box"><p id="a">A</p><p id="b">B</p></div>',
  local: '<div id="box"><p id="a">A</p><p id="b">B</p></div>',
  remote: '<div id="box"><p id="b">B</p><p id="a">A</p></div>',
};
await check("default authored reorder is correct", async () => {
  const good = await run(A);
  assert.equal(good.status, "passes", JSON.stringify(good));
  const bad = await run(A, wrap(reverseChildren("#box")));
  assert.equal(bad.status, "counterexample", JSON.stringify(bad));
  assert.ok(bad.props.includes("order"), JSON.stringify(bad));
  return { good, bad };
});

const P = {
  shape: "pure",
  identity: "plain",
  base: '<div sid="box"><p sid="a">A</p><p sid="b">B</p></div>',
  local: '<div sid="box"><p sid="a">A</p><p sid="b">B</p></div>',
  remote: '<div sid="box"><p sid="b">B</p><p sid="a">A</p></div>',
};
await check("pure plain reorder is caught", async () => {
  const good = await run(P);
  assert.equal(good.status, "passes", JSON.stringify(good));
  const bad = await run(P, wrap(reverseChildren("div")));
  assert.equal(bad.status, "counterexample", JSON.stringify(bad));
  assert.ok(bad.props.includes("order"), JSON.stringify(bad));
  return { good, bad };
});

const C = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="box"><p sid="a">A</p><p sid="b">B</p><p sid="c">C</p></div>',
  local:
    '<div sid="box"><p sid="b">B</p><p sid="a">A</p><p sid="c">C</p></div>',
  remote:
    '<div sid="box"><p sid="a">A</p><p sid="c">C</p><p sid="b">B</p></div>',
};
await check("two-sided reorder: correct output is not a cx", async () => {
  const good = await run(C);
  assert.notEqual(good.status, "counterexample", JSON.stringify(good));
  const toR = await run(C, wrap(orderByText("div", ["A", "C", "B"])));
  assert.notEqual(toR.status, "counterexample", JSON.stringify(toR));
  const toL = await run(C, wrap(orderByText("div", ["B", "A", "C"])));
  assert.equal(toL.status, "counterexample", JSON.stringify(toL));
  assert.ok(toL.props.includes("order"), JSON.stringify(toL));
  return { good, toR, toL };
});

const T = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="wrap"><template sid="t"><p sid="a">A</p></template><section sid="s">S</section></div>',
  local:
    '<div sid="wrap"><section sid="s">S</section><template sid="t"><p sid="a">A</p></template></div>',
  remote:
    '<div sid="wrap"><section sid="s">S</section><template sid="t"><p sid="a">A</p></template></div>',
};
await check("template plain reorder is caught", async () => {
  const good = await run(T);
  assert.equal(good.status, "passes", JSON.stringify(good));
  const bad = await run(T, wrap(reverseChildren("div")));
  assert.equal(bad.status, "counterexample", JSON.stringify(bad));
  assert.ok(bad.props.includes("order"), JSON.stringify(bad));
  return { good, bad };
});

const D = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="box"><p sid="a">A</p></div>',
  local: '<div sid="box"><p sid="a">A2</p></div>',
  remote: '<div sid="box"><p sid="a">A</p></div>',
};
await check("duplicate output owner is a cx", async () => {
  const good = await run(D);
  assert.equal(good.status, "passes", JSON.stringify(good));
  const bad = await run(D, wrap(duplicateOwner));
  assert.equal(bad.status, "counterexample", JSON.stringify(bad));
  assert.ok(bad.props.includes("identity-duplicated"), JSON.stringify(bad));
  return { good, bad };
});

await check("sid-only changes are input changes", async () => {
  const local = {
    shape: "dirty",
    identity: "plain",
    base: '<p sid="a">A</p>',
    local: '<p sid="b">A</p>',
    remote: '<p sid="a">A</p>',
  };
  const remote = {
    shape: "dirty",
    identity: "plain",
    base: '<p sid="a">A</p>',
    local: '<p sid="a">A2</p>',
    remote: '<p sid="b">A</p>',
  };
  const fl = facts(normalize(local));
  const fr = facts(normalize(remote));
  assert.equal(fl.localChanged, true, JSON.stringify(fl));
  assert.equal(fr.remoteChanged, true, JSON.stringify(fr));
  assert.equal(invalid(normalize(local)), null);
  assert.equal(invalid(normalize(remote)), null);
  return { fl, fr, local: await run(local), remote: await run(remote) };
});

await check("unknown requires and pure veto are invalid", async () => {
  const unknown = {
    shape: "dirty",
    identity: "plain",
    base: '<p sid="a">A</p>',
    local: '<p sid="a">B</p>',
    remote: '<p sid="a">A</p>',
    requires: ["bogus"],
  };
  const veto = {
    shape: "pure",
    identity: "plain",
    base: '<p sid="a">A</p>',
    local: '<p sid="a">A</p>',
    remote: '<p sid="b">A</p>',
    options: { hooks: { vetoRemove: "p" } },
  };
  const morph = {
    shape: "pure",
    identity: "plain",
    base: '<p sid="a">A</p>',
    local: '<p sid="a">A</p>',
    remote: '<p sid="b">A</p>',
    options: { hooks: { morph: true } },
  };
  const u = await run(unknown);
  const v = await run(veto);
  assert.equal(u.status, "invalid", JSON.stringify(u));
  assert.match(u.reason, /unknown requires/, JSON.stringify(u));
  assert.equal(v.status, "invalid", JSON.stringify(v));
  assert.match(
    v.reason,
    /pure merge ignores hooks.vetoRemove/,
    JSON.stringify(v),
  );
  assert.equal(invalid(normalize(morph)), null);
  return { unknown: u, veto: v, morph: await run(morph) };
});

await check("malformed shape and fields return invalid", async () => {
  const cases = [
    { shape: "bogus", base: "<p>a</p>", remote: "<p>b</p>" },
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="a">A</p>',
      local: '<p sid="a">B</p>',
      remote: '<p sid="a">A</p>',
      options: "x",
    },
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="a">A</p>',
      local: '<p sid="a">B</p>',
      remote: '<p sid="a">A</p>',
      requires: "localChanged",
    },
  ];
  const out = [];
  for (const c of cases) {
    const v = await run(c);
    assert.equal(v.status, "invalid", JSON.stringify(v));
    out.push(v);
  }
  return out;
});

const CLAY = {
  shape: "dirty",
  identity: "clay",
  base: '<div sid="box"><p sid="a">A</p></div>',
  local: '<div sid="box"><p sid="a">A2</p></div>',
  remote: '<div sid="box"><p sid="a">A</p></div>',
};
await check(
  "poisoned createIdentityStore does not break the runner",
  async () => {
    const poisoned = {
      ...E,
      createIdentityStore() {
        throw new Error("poisoned");
      },
    };
    const v = await run(CLAY, poisoned);
    assert.ok(!v.props.includes("crash"), JSON.stringify(v));
    assert.equal(v.status, "passes", JSON.stringify(v));
    return v;
  },
);

await check("wrong expected HTML is a cx against itself", async () => {
  const c = {
    shape: "dirty",
    identity: "plain",
    base: '<div sid="box"><p sid="a">A</p></div>',
    local: '<div sid="box"><p sid="a">A2</p></div>',
    remote: '<div sid="box"><p sid="a">A</p></div>',
    expect: { html: "<p>wrong</p>" },
  };
  const v = await run(c, E, E);
  assert.equal(v.status, "counterexample", JSON.stringify(v));
  assert.ok(v.props.includes("intent"), JSON.stringify(v));
  return v;
});

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(`modes ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
