// Local-frame evidence. An element merge reads the live local root, so the
// oracle freezes a separate local snapshot after the case's live edits;
// document merges keep the captured local. Plus the input-derived certificate
// for two inserted copies of one identity whose texts cannot be typed out of
// each other. Executed assertions run the real engine and wrappers that damage
// only its output. A "good" status is passes or undecidable, never invalid or
// counterexample.
import assert from "node:assert/strict";
import { engine } from "../lib/engines.js";
import { verdict, judge, facts } from "../lib/oracle.js";
import { runCase, normalize, serialize } from "../lib/runner.js";

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
    reason: v.reason || null,
    violations: (v.violations || []).slice(0, 6),
    ambiguous: (v.ambiguous || []).slice(0, 6),
  };
  try {
    const j = await judge(engine, structuredClone(c));
    const root = j.obs?.raw?.liveRoot;
    out.html = root && root.body ? root.body.innerHTML : null;
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
const isInvalid = (r) => assert.equal(r.status, "invalid", JSON.stringify(r));
const hasProp = (r, prop) =>
  assert.ok(r.props.includes(prop), `no ${prop} witness: ${JSON.stringify(r)}`);
const bodyOf = (r) => {
  assert.equal(typeof r.html, "string", JSON.stringify(r));
  return r.html;
};
const count = (html, re) => (html.match(re) || []).length;

// --- an element frame freezes the live local root ---------------------------

const ELEM_LIVE = {
  shape: "element",
  identity: "plain",
  base: `<main sid="M"><p sid="P" title="old">one</p></main>`,
  local: `<main sid="M"><p sid="P" title="old">one LOCAL</p></main>`,
  remote: `<main sid="M" class="R"><p sid="P" title="old">one</p></main>`,
  live: { attrs: [["p", "title", "LIVE"]] },
};

await check(
  "parent element live attr case: root, children and twoWay",
  async () => {
    const whole = await run(ELEM_LIVE);
    notCx(whole);
    const big = bodyOf(whole);
    assert.match(big, /title="LIVE"/);
    assert.match(big, /class="R"/);
    assert.match(big, /one LOCAL/);
    const children = await run({
      ...ELEM_LIVE,
      options: { children: true },
    });
    notCx(children);
    assert.match(bodyOf(children), /title="LIVE"/);
    assert.match(bodyOf(children), /one LOCAL/);
    const twoWay = await run({ ...ELEM_LIVE, options: { twoWay: true } });
    notCx(twoWay);
    const tw = bodyOf(twoWay);
    assert.match(tw, /class="R"/);
    assert.match(tw, /title="old"/);
    assert.ok(!/LIVE/.test(tw), JSON.stringify(tw));
    const twoWayChildren = await run({
      ...ELEM_LIVE,
      options: { twoWay: true, children: true },
    });
    notCx(twoWayChildren);
    assert.match(bodyOf(twoWayChildren), /title="old"/);
    return { whole, children, twoWay, twoWayChildren };
  },
);

await check("element frame damage is still caught", async () => {
  const dropLive = await run(
    ELEM_LIVE,
    wrap((d) => {
      d.querySelector("p").setAttribute("title", "old");
    }),
  );
  isCx(dropLive);
  hasProp(dropLive, "attr");
  const dropRemote = await run(
    ELEM_LIVE,
    wrap((d) => {
      d.querySelector("main").removeAttribute("class");
    }),
  );
  isCx(dropRemote);
  hasProp(dropRemote, "attr");
  const dropLocal = await run(
    ELEM_LIVE,
    wrap((d) => {
      d.querySelector("p").textContent = "one";
    }),
  );
  isCx(dropLocal);
  hasProp(dropLocal, "loss");
  return { dropLive, dropRemote, dropLocal };
});

await check(
  "the element snapshot is separate and leaves the captured inputs alone",
  async () => {
    const obs = await runCase(E, normalize(structuredClone(ELEM_LIVE)));
    const { p } = obs.raw;
    assert.ok(p.elementLocal, "no element snapshot was frozen");
    assert.notEqual(p.elementLocal.cap, p.cap, JSON.stringify("same document"));
    assert.match(
      p.elementLocal.cap.body.firstElementChild.outerHTML,
      /title="LIVE"/,
    );
    assert.ok(
      !/title="LIVE"/.test(serialize(p.cap)),
      `the captured local was rewritten: ${serialize(p.cap)}`,
    );
    assert.equal(serialize(p.cap), p.inputsBefore.cap);
    assert.equal(serialize(p.base), p.inputsBefore.base);
    assert.equal(serialize(p.remote), p.inputsBefore.remote);
    const doc = await runCase(
      E,
      normalize({
        shape: "dirty",
        identity: "plain",
        base: `<div sid="b"><p sid="a">A</p></div>`,
        local: `<div sid="b"><p sid="a">A</p><p sid="c">C</p></div>`,
        remote: `<div sid="b"><p sid="a">A</p></div>`,
        live: { attrs: [["p", "title", "runtime"]] },
      }),
    );
    assert.equal(
      doc.raw.p.elementLocal,
      null,
      "a document frame got a snapshot",
    );
    return {
      elementLocal: serialize(p.elementLocal.cap),
      cap: serialize(p.cap),
    };
  },
);

const CHILD_LIVE = {
  shape: "element",
  identity: "plain",
  base: `<main sid="M"><p sid="P1" title="old">one</p><p sid="P2">two</p></main>`,
  local: `<main sid="M"><p sid="P1" title="old">one</p><p sid="P2">two</p></main>`,
  remote: `<main sid="M"><p sid="P2">two</p></main>`,
  live: { attrs: [["p", "title", "LIVE"]] },
};

await check(
  "a runtime attr on a child beats remote deletion of that child",
  async () => {
    const good = await run(CHILD_LIVE);
    notCx(good);
    const html = bodyOf(good);
    assert.match(html, /title="LIVE"/);
    assert.match(html, /one/);
    assert.match(html, /two/);
    assert.equal(count(html, /<p/g), 2, html);
    const stripped = await run(
      CHILD_LIVE,
      wrap((d) => {
        d.querySelector("p").remove();
      }),
    );
    isCx(stripped);
    hasProp(stripped, "loss");
    return { good, stripped };
  },
);

// --- document frames keep the captured local --------------------------------

const DOC_SYNC = {
  shape: "dirty",
  identity: "plain",
  base: `<div sid="box"><p sid="a">A</p><p sid="b">B</p></div>`,
  local: `<div sid="box"><p sid="a">A</p><p sid="b">B LOCAL</p></div>`,
  remote: `<div sid="box"><p sid="a" title="remote">A REMOTE</p><p sid="b">B</p></div>`,
  live: { attrs: [["p", "title", "runtime"]] },
};
const DOC_KEEP = {
  shape: "dirty",
  identity: "plain",
  base: `<div sid="box"><p sid="a">A</p><p sid="c">C</p></div>`,
  local: `<div sid="box"><p sid="a">A</p><p sid="c">C</p><p sid="d">D</p></div>`,
  remote: `<div sid="box"><p sid="a">A</p><p sid="c">C REMOTE</p></div>`,
  live: { attrs: [["p", "title", "runtime"]] },
};

await check("document frames keep the captured local", async () => {
  const synced = await run(DOC_SYNC);
  notCx(synced);
  const s = bodyOf(synced);
  assert.match(s, /title="remote"/);
  assert.ok(
    !/runtime/.test(s),
    `the runtime attr survived in a document merge: ${s}`,
  );
  assert.match(s, /A REMOTE/);
  assert.match(s, /B LOCAL/);
  const stripped = await run(
    DOC_SYNC,
    wrap((d) => {
      d.querySelector("p").removeAttribute("title");
    }),
  );
  isCx(stripped);
  hasProp(stripped, "attr");
  const kept = await run(DOC_KEEP);
  notCx(kept);
  const k = bodyOf(kept);
  assert.match(k, /title="runtime"/);
  assert.match(k, /C REMOTE/);
  assert.match(k, /<p>D<\/p>/);
  const lost = await run(
    DOC_KEEP,
    wrap((d) => {
      d.querySelector("p").removeAttribute("title");
    }),
  );
  isCx(lost);
  hasProp(lost, "attr");
  return { synced, stripped, kept, lost };
});

// --- property-only drift is a real difference -------------------------------

const propCase = (shape, live, extra = {}) => {
  const inner = `<input sid="I" value="old">`;
  const one = (attrs) => `<input sid="I" value="old"${attrs}>`;
  if (shape === "element")
    return {
      shape,
      identity: "plain",
      base: `<main sid="M">${inner}</main>`,
      local: `<main sid="M">${inner}</main>`,
      remote: `<main sid="M">${one(' title="new"')}</main>`,
      live,
      ...extra,
    };
  if (shape === "clean")
    return {
      shape,
      identity: "plain",
      base: inner,
      local: inner,
      remote: one(' title="new"'),
      live,
      ...extra,
    };
  return {
    shape,
    identity: "plain",
    base: inner,
    local: one(' class="l"'),
    remote: one(' title="new"'),
    live,
    ...extra,
  };
};

await check("property-only liveDiffers is a real difference", async () => {
  const rows = {};
  for (const shape of ["clean", "dirty", "element"]) {
    const c = propCase(
      shape,
      { props: [["input", "value", "typed"]] },
      {
        requires: ["liveDiffers"],
      },
    );
    assert.equal(facts(normalize(structuredClone(c))).liveDiffers, true, shape);
    const r = await run(c);
    notCx(r);
    rows[shape] = r;
  }
  const checked = propCase(
    "clean",
    { props: [["input", "checked", true]] },
    { requires: ["liveDiffers"] },
  );
  assert.equal(
    facts(normalize(structuredClone(checked))).liveDiffers,
    true,
    "checked",
  );
  const boolean = await run(checked);
  notCx(boolean);
  const noop = propCase(
    "clean",
    { props: [["input", "value", "old"]] },
    {
      requires: ["liveDiffers"],
    },
  );
  assert.equal(
    facts(normalize(structuredClone(noop))).liveDiffers,
    false,
    "no-op",
  );
  const nothing = await run(noop);
  isInvalid(nothing);
  return { ...rows, boolean, nothing };
});

// --- one inserted identity, two colliding texts -----------------------------

const collisionMarkup = (identity, side) => {
  const sid =
    identity === "plain"
      ? ' sid="X"'
      : identity === "clay"
        ? ` sid="${side === "local" ? "A" : "B"}"`
        : "";
  const attr = side === "local" ? ' title="local-own"' : ' lang="remote-own"';
  return `<p${sid} data-id="X"${attr}>${side}</p>`;
};
const collisionCase = (identity, shape, conflicts) => ({
  shape,
  identity,
  base: `<p>keep</p>`,
  local: `<p>keep</p>${collisionMarkup(identity, "local")}`,
  remote: `<p>keep</p>${collisionMarkup(identity, "remote")}`,
  ...(conflicts ? { options: { conflicts } } : {}),
});

await check(
  "one inserted identity with two texts: the policy picks one whole copy",
  async () => {
    const rows = {};
    for (const identity of ["default", "authored", "plain", "clay"])
      for (const shape of ["dirty", "pure"])
        for (const conflicts of [null, "local", "both"]) {
          const name = `${identity}-${shape}-${conflicts || "default"}`;
          const chosen = conflicts === "local" ? "local" : "remote";
          const other = chosen === "local" ? "remote" : "local";
          const c = collisionCase(identity, shape, conflicts);
          const good = await run(c);
          notCx(good);
          const html = bodyOf(good);
          assert.match(html, new RegExp(chosen), name);
          assert.match(html, new RegExp(`${chosen}-own`), name);
          assert.ok(
            !html.includes(`${other}-own`),
            `the nonchosen copy's attribute was merged: ${name} ${html}`,
          );
          assert.equal(count(html, /<p/g), 2, name);
          const dropped = await run(
            c,
            wrap((d) => {
              const p = [...d.querySelectorAll("p")][1];
              if (p) p.textContent = "";
            }),
          );
          isCx(dropped);
          hasProp(dropped, "loss");
          const restored = await run(
            c,
            wrap((d) => {
              const p = [...d.querySelectorAll("p")][1];
              if (p)
                p.setAttribute(
                  chosen === "local" ? "lang" : "title",
                  chosen === "local" ? "remote-own" : "local-own",
                );
            }),
          );
          isCx(restored);
          hasProp(restored, "attr");
          rows[name] = { good, dropped, restored };
        }
    return rows;
  },
);

await check(
  "identical and extension insertions merge their independent attributes",
  async () => {
    const identical = {
      shape: "dirty",
      identity: "plain",
      base: `<p>keep</p>`,
      local: `<p>keep</p><p sid="X" data-id="X" title="local-only">same</p>`,
      remote: `<p>keep</p><p sid="X" data-id="X" lang="en">same</p>`,
    };
    const good = await run(identical);
    notCx(good);
    const html = bodyOf(good);
    assert.match(html, /title="local-only"/);
    assert.match(html, /lang="en"/);
    const gone = await run(
      identical,
      wrap((d) => {
        d.body.querySelector('p[data-id="X"]').textContent = "";
      }),
    );
    isCx(gone);
    hasProp(gone, "loss");
    const extension = {
      shape: "dirty",
      identity: "plain",
      base: `<p>keep</p>`,
      local: `<p>keep</p><p sid="X" data-id="X" title="local-only">local</p>`,
      remote: `<p>keep</p><p sid="X" data-id="X" lang="en">local extended</p>`,
    };
    const grown = await run(extension);
    notCx(grown);
    const g = bodyOf(grown);
    assert.match(g, /title="local-only"/);
    assert.match(g, /lang="en"/);
    assert.match(g, /local extended/);
    const stripped = await run(
      extension,
      wrap((d) => {
        d.body.querySelector('p[data-id="X"]').removeAttribute("lang");
      }),
    );
    isCx(stripped);
    hasProp(stripped, "attr");
    return { good, gone, grown, stripped };
  },
);

await check(
  "a forged insert-collision report cannot excuse lost text",
  async () => {
    const nested = {
      shape: "dirty",
      identity: "plain",
      base: `<p>keep</p>`,
      local: `<p>keep</p><p sid="X" data-id="X" title="local-only">local <b>bold</b></p>`,
      remote: `<p>keep</p><p sid="X" data-id="X" lang="en">remote</p>`,
    };
    // Keeping one whole copy of a same-id insertion is a correct merge
    // (review, 2026-09-30): the discarded copy's text is not required.
    const nestedRun = await run(nested);
    notCx(nestedRun);
    const ordinary = {
      shape: "dirty",
      identity: "plain",
      base: `<p sid="A">one</p>`,
      local: `<p sid="A">one</p><p sid="Z">zeta</p>`,
      remote: `<p sid="A">one</p>`,
    };
    const good = await run(ordinary);
    notCx(good);
    const forged = {
      ...E,
      async mergeDocument(o) {
        const r = await E.mergeDocument(o);
        for (const p of [...o.live.body.querySelectorAll("p")])
          if (p.textContent === "zeta") p.remove();
        const p = o.live.body.querySelector("p");
        return {
          ...r,
          conflicts: [
            ...(r.conflicts || []),
            {
              kind: "structure",
              detail: "insert-collision",
              el: p,
              local: p,
              remote: p,
              resolved: p,
            },
          ],
        };
      },
    };
    const excused = await run(ordinary, forged);
    isCx(excused);
    hasProp(excused, "loss");
    return { nestedRun, good, excused };
  },
);

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(`frames ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
