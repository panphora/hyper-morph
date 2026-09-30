// Ancestor-aware, operation-specific policy checks and frozen live-state
// evidence. Executed assertions run the real engine and wrappers that alter
// only its output. A "good" status is passes or undecidable, never invalid or
// counterexample.
import assert from "node:assert/strict";
import { engine } from "../lib/engines.js";
import { verdict, judge } from "../lib/oracle.js";
import { runCase, normalize } from "../lib/runner.js";

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

/** The engine's own output with one hook promise dropped: what a promise not
 * honored would have produced. */
const withoutHook = (name) => ({
  ...E,
  async mergeDocument(o) {
    const hooks = { ...o.hooks };
    delete hooks[name];
    return E.mergeDocument({ ...o, hooks });
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
    violations: (v.violations || []).slice(0, 4),
    ambiguous: (v.ambiguous || []).slice(0, 4),
  };
  try {
    const j = await judge(engine, structuredClone(c));
    const root = j.obs?.raw?.liveRoot;
    out.html = root?.body ? root.body.innerHTML : null;
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
const hasProp = (r, prop) =>
  assert.ok(r.props.includes(prop), `no ${prop} witness: ${JSON.stringify(r)}`);
const htmlOf = (r) => {
  assert.equal(typeof r.html, "string", JSON.stringify(r));
  return r.html;
};

const V_BASE = `<div id="v"><p id="a">A</p><p id="b">B</p></div><p id="out">OUT</p>`;
const V_LOCAL = `<div id="v"><p id="a">A</p><p id="b">B LOCAL</p></div><p id="out">OUT</p>`;

// --- veto morph ancestor: descendant attr/edit/deletion -----------------
const vetoMorph = (remote) => ({
  shape: "dirty",
  identity: "default",
  base: V_BASE,
  local: V_LOCAL,
  remote,
  options: { hooks: { morph: true, vetoMorph: "#v" } },
});
await check("vetoMorph ancestor protects a descendant edit", async () => {
  const c = vetoMorph(
    `<div id="v"><p id="a">A2</p><p id="b">B</p></div><p id="out">OUT</p>`,
  );
  const good = await run(c);
  notCx(good);
  assert.ok(
    !/>A2</.test(htmlOf(good)),
    `the vetoed edit reached the output: ${good.html}`,
  );
  const member = await run(
    c,
    wrap((d) => d.querySelector("#v p#a").remove()),
  );
  isCx(member);
  hasProp(member, "veto-changed");
  const outside = await run(
    c,
    wrap((d) => d.querySelector("#out").remove()),
  );
  isCx(outside);
  hasProp(outside, "loss");
  return { good, member, outside };
});

await check("vetoMorph ancestor protects a descendant attribute", async () => {
  const c = vetoMorph(
    `<div id="v"><p id="a" data-x="2">A</p><p id="b">B</p></div><p id="out">OUT</p>`,
  );
  const good = await run(c);
  notCx(good);
  assert.ok(
    !/data-x="2"/.test(htmlOf(good)),
    `the vetoed attribute reached the output: ${good.html}`,
  );
  const attr = await run(
    c,
    wrap((d) => d.querySelector("#v p#a").setAttribute("data-x", "2")),
  );
  isCx(attr);
  hasProp(attr, "veto-changed");
  return { good, attr };
});

await check("vetoMorph ancestor protects a descendant deletion", async () => {
  const c = vetoMorph(`<div id="v"><p id="a">A</p></div><p id="out">OUT</p>`);
  const good = await run(c);
  notCx(good);
  assert.ok(
    /A/.test(htmlOf(good)),
    `the vetoed deletion removed A: ${good.html}`,
  );
  const member = await run(
    c,
    wrap((d) => d.querySelector("#v p#a").remove()),
  );
  isCx(member);
  hasProp(member, "veto-changed");
  return { good, member };
});

// --- ignore ancestor: descendant attrs -----------------------------------
await check("ignore ancestor protects descendant attributes", async () => {
  const c = {
    shape: "dirty",
    identity: "plain",
    base: `<div sid="v" class="ig"><p sid="a" data-x="1">A</p></div><p sid="o">OUT</p>`,
    local: `<div sid="v" class="ig"><p sid="a" data-x="1">A</p></div><p sid="o">OUT LOCAL</p>`,
    remote: `<div sid="v" class="ig"><p sid="a" data-x="2">A2</p></div><p sid="o">OUT</p>`,
    options: { ignore: ".ig" },
  };
  const good = await run(c);
  notCx(good);
  assert.ok(
    /data-x="1"/.test(htmlOf(good)) && !/A2/.test(htmlOf(good)),
    `the ignored region was merged: ${good.html}`,
  );
  const attr = await run(
    c,
    wrap((d) => d.querySelector(".ig p").setAttribute("data-x", "2")),
  );
  isCx(attr);
  hasProp(attr, "ignored-changed");
  const outside = await run(
    c,
    wrap((d) => d.querySelector("p:not(.ig p)").remove()),
  );
  isCx(outside);
  hasProp(outside, "loss");
  return { good, attr, outside };
});

// --- vetoRemove: identified and anonymous box with P ---------------------
const vetoRemove = (box, sel) => ({
  shape: "clean",
  identity: "plain",
  base: `<div class="box">${box}</div>`,
  local: `<div class="box">${box}</div>`,
  remote: ``,
  options: { hooks: { vetoRemove: sel } },
});
await check("vetoRemove: an identified box with P survives", async () => {
  const c = {
    shape: "clean",
    identity: "plain",
    base: `<div sid="box" class="box"><p sid="p">P</p></div>`,
    local: `<div sid="box" class="box"><p sid="p">P</p></div>`,
    remote: ``,
    options: { hooks: { vetoRemove: ".box" } },
  };
  const good = await run(c);
  notCx(good);
  assert.ok(/class="box"/.test(htmlOf(good)), good.html);
  const member = await run(
    c,
    wrap((d) => d.querySelector(".box p").remove()),
  );
  isCx(member);
  hasProp(member, "veto-changed");
  return { good, member };
});
await check("vetoRemove: an anonymous box with P survives", async () => {
  const c = vetoRemove(`<p sid="p">P</p>`, ".box");
  const good = await run(c);
  notCx(good);
  assert.ok(/<div class="box">/.test(htmlOf(good)), good.html);
  const noVeto = await run({ ...c, options: {} });
  notCx(noVeto);
  assert.ok(!/class="box"/.test(htmlOf(noVeto)), noVeto.html);
  return { good, noVeto };
});

// --- vetoAdd: identified and anonymous section ---------------------------
const vetoAdd = (section) => ({
  shape: "dirty",
  identity: "plain",
  base: `<main sid="m"><p sid="x">X</p></main>`,
  local: `<main sid="m"><p sid="x">X LOCAL</p></main>`,
  remote: `<main sid="m"><p sid="x">X</p>${section}</main>`,
  options: { hooks: { vetoAdd: ".add" } },
});
await check(
  "vetoAdd: an identified section with a new child never lands",
  async () => {
    const c = vetoAdd(
      `<section sid="s" class="add"><p sid="y">Y</p></section>`,
    );
    const good = await run(c);
    notCx(good);
    assert.ok(!/class="add"/.test(htmlOf(good)), good.html);
    const added = await run(c, withoutHook("beforeNodeAdded"));
    isCx(added);
    hasProp(added, "veto-added");
    return { good, added };
  },
);
await check(
  "vetoAdd: an anonymous section with a new child never lands",
  async () => {
    const c = vetoAdd(`<section class="add"><p sid="y">Y</p></section>`);
    const good = await run(c);
    notCx(good);
    assert.ok(!/class="add"/.test(htmlOf(good)), good.html);
    return { good };
  },
);

// --- unused vetoes must not mask ordinary content ------------------------
await check(
  "unused vetoAdd/vetoRemove do not mask a kept paragraph",
  async () => {
    const c = {
      shape: "dirty",
      identity: "plain",
      base: `<div sid="d"><p class="keep">KEEP</p><p class="other">OUT</p></div>`,
      local: `<div sid="d"><p class="keep">KEEP</p><p class="other">OUT LOCAL</p></div>`,
      remote: `<div sid="d"><p class="keep">KEEP</p><p class="other">OUT</p></div>`,
      options: { hooks: { vetoAdd: ".keep", vetoRemove: ".keep" } },
    };
    const good = await run(c);
    notCx(good);
    const emptied = await run(
      c,
      wrap((d) => {
        d.querySelector(".keep").textContent = "";
      }),
    );
    isCx(emptied);
    hasProp(emptied, "loss");
    return { good, emptied };
  },
);
await check(
  "vetoMorph without morph is unused, ordinary checks still bite",
  async () => {
    const c = {
      shape: "clean",
      identity: "plain",
      base: `<div sid="d"><p sid="a">A</p><p sid="b">B</p></div>`,
      local: `<div sid="d"><p sid="a">A</p><p sid="b">B</p></div>`,
      remote: `<div sid="d"><p sid="a">A</p><p sid="b">B</p><p sid="c">C</p></div>`,
      options: { hooks: { vetoMorph: "p" } },
    };
    const good = await run(c);
    notCx(good);
    assert.ok(
      /C/.test(htmlOf(good)),
      `the remote addition was masked: ${good.html}`,
    );
    const dropped = await run(
      c,
      wrap((d) => d.querySelectorAll("p")[2].remove()),
    );
    isCx(dropped);
    hasProp(dropped, "loss");
    return { good, dropped };
  },
);

// --- removal veto and an identified child moving elsewhere ---------------
const TWO_LI = {
  shape: "element",
  identity: "authored",
  base: `<ul><li><a id="a">A</a></li><li><b id="b">B</b></li></ul>`,
  local: `<ul><li><a id="a">A</a></li><li><b id="b">B</b></li></ul>`,
  remote: `<ul><li><a id="a">A</a><b id="b">B</b></li></ul>`,
  options: { hooks: { vetoRemove: "li" } },
};
await check(
  "removal veto: the container may empty, b moves elsewhere",
  async () => {
    const good = await run(TWO_LI);
    notCx(good);
    assert.ok(
      /<li><\/li>/.test(htmlOf(good)),
      `the container did not survive: ${good.html}`,
    );
    const noVeto = await run({ ...TWO_LI, options: {} });
    notCx(noVeto);
    assert.ok(!/<li><\/li>/.test(htmlOf(noVeto)), noVeto.html);
    return { good, noVeto };
  },
);

// --- form vetoAttr: value / textarea.value / checkbox.checked ------------
const formCase = (base, remote, prop) => ({
  shape: "clean",
  identity: "default",
  base,
  local: base,
  remote,
  live: { props: [prop] },
  options: { hooks: { vetoAttr: prop[1] } },
});
await check(
  "form vetoAttr: a typed input value survives a remote attr change",
  async () => {
    const c = formCase(
      `<form><input id="i" value="old"></form>`,
      `<form><input id="i" value="new"></form>`,
      ["#i", "value", "typed"],
    );
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const el = obs.raw.liveRoot.querySelector("#i");
    const dom = { attr: el.getAttribute("value"), prop: el.value };
    assert.deepEqual(dom, { attr: "old", prop: "typed" }, JSON.stringify(dom));
    const damaged = await run(
      c,
      wrap((d) => {
        d.querySelector("#i").value = "new";
      }),
    );
    isCx(damaged);
    hasProp(damaged, "live-property");
    return { good, dom, damaged };
  },
);
await check(
  "form vetoAttr: a typed textarea value survives a remote attr change",
  async () => {
    const c = formCase(
      `<form><textarea id="t">old</textarea></form>`,
      `<form><textarea id="t" value="new">old</textarea></form>`,
      ["#t", "value", "typed"],
    );
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const el = obs.raw.liveRoot.querySelector("#t");
    const dom = { attr: el.getAttribute("value"), prop: el.value };
    assert.deepEqual(dom, { attr: null, prop: "typed" }, JSON.stringify(dom));
    const damaged = await run(
      c,
      wrap((d) => {
        d.querySelector("#t").value = "new";
      }),
    );
    isCx(damaged);
    hasProp(damaged, "live-property");
    return { good, dom, damaged };
  },
);
await check(
  "form vetoAttr: a typed checkbox survives a remote checked change",
  async () => {
    const c = formCase(
      `<form><input id="c" type="checkbox"></form>`,
      `<form><input id="c" type="checkbox" checked></form>`,
      ["#c", "checked", true],
    );
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const el = obs.raw.liveRoot.querySelector("#c");
    const dom = { attr: el.getAttribute("checked"), prop: el.checked };
    assert.deepEqual(dom, { attr: null, prop: true }, JSON.stringify(dom));
    const damaged = await run(
      c,
      wrap((d) => {
        d.querySelector("#c").checked = false;
      }),
    );
    isCx(damaged);
    hasProp(damaged, "live-property");
    return { good, dom, damaged };
  },
);

await check(
  "form vetoAttr: a vetoed textarea text change keeps the live text",
  async () => {
    const c = formCase(
      `<form><textarea id="t" title="keep">old</textarea></form>`,
      `<form><textarea id="t" title="keep">new</textarea></form>`,
      ["#t", "value", "typed"],
    );
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const el = obs.raw.liveRoot.querySelector("#t");
    const dom = {
      attr: el.getAttribute("value"),
      prop: el.value,
      text: el.textContent,
    };
    assert.deepEqual(
      dom,
      { attr: null, prop: "typed", text: "old" },
      JSON.stringify(dom),
    );
    const text = await run(
      c,
      wrap((d) => {
        d.querySelector("#t").textContent = "new";
      }),
    );
    isCx(text);
    const textWitness = (text.violations || []).find(
      (x) => x.prop === "live-property" && x.property === "textContent",
    );
    assert.ok(textWitness, `no textContent witness: ${JSON.stringify(text)}`);
    assert.equal(textWitness.attr, "value");
    const prop = await run(
      c,
      wrap((d) => {
        d.querySelector("#t").value = "new";
      }),
    );
    isCx(prop);
    const propWitness = (prop.violations || []).find(
      (x) => x.prop === "live-property" && x.property === "value",
    );
    assert.ok(propWitness, `no value witness: ${JSON.stringify(prop)}`);
    assert.equal(propWitness.attr, "value");
    const title = await run(
      c,
      wrap((d) => {
        d.querySelector("#t").setAttribute("title", "broken");
      }),
    );
    isCx(title);
    hasProp(title, "attr");
    return { good, dom, text, prop, title };
  },
);

// --- live.attrs with a broad selector and an unchanged subtree -----------
const TWO_P = {
  shape: "dirty",
  identity: "plain",
  base: `<div sid="box"><p sid="a">A</p><p sid="b">B</p></div>`,
  local: `<div sid="box"><p sid="a">A</p><p sid="b">B!</p></div>`,
  remote: `<div sid="box"><p sid="a">A</p><p sid="b">B</p></div>`,
  live: { attrs: [["p", "title", "runtime"]] },
};
await check(
  "live.attrs broad selector: only the first p is mutated",
  async () => {
    const good = await run(TWO_P);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(TWO_P)));
    const ps = [...obs.raw.liveRoot.querySelectorAll("div p")];
    const dom = ps.map((p) => p.getAttribute("title"));
    assert.deepEqual(dom, ["runtime", null], JSON.stringify(dom));
    const stripped = await run(
      TWO_P,
      wrap((d) => {
        d.querySelector("p").removeAttribute("title");
      }),
    );
    isCx(stripped);
    hasProp(stripped, "attr");
    const echoed = await run(
      TWO_P,
      wrap((d) => {
        d.querySelectorAll("p")[1].setAttribute("title", "runtime");
      }),
    );
    isCx(echoed);
    hasProp(echoed, "attr");
    return { good, dom, stripped, echoed };
  },
);
await check(
  "live.attrs with a morph hook synchronizes the runtime title",
  async () => {
    const c = { ...TWO_P, options: { hooks: { morph: true } } };
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const dom = [...obs.raw.liveRoot.querySelectorAll("div p")].map((p) =>
      p.getAttribute("title"),
    );
    assert.deepEqual(dom, [null, null], JSON.stringify(dom));
    return { good, dom };
  },
);

// --- runtime head evidence ----------------------------------------------
const headDoc = (body) =>
  `<!DOCTYPE html><html sid="R"><head sid="HD"><title sid="TT">base</title></head><body sid="BD">${body}</body></html>`;
const headCase = (head) => ({
  shape: "clean",
  identity: "plain",
  base: headDoc(`<main sid="M"><p sid="P">old</p></main>`),
  local: headDoc(`<main sid="M"><p sid="P">old</p></main>`),
  remote: headDoc(`<main sid="M"><p sid="P">NEW</p></main>`),
  live: { head },
});
await check("a runtime head meta is kept and its loss is caught", async () => {
  const c = headCase(`<meta name="runtime" content="keep">`);
  const good = await run(c);
  notCx(good);
  const dropped = await run(
    c,
    wrap((d) => d.head.querySelector("meta").remove()),
  );
  isCx(dropped);
  hasProp(dropped, "loss");
  return { good, dropped };
});
await check(
  "a runtime head script and style are opaque, not lost content",
  async () => {
    const c = headCase(
      `<script src="runtime.js"></script><style></style><meta name="runtime" content="keep">`,
    );
    const good = await run(c);
    notCx(good);
    assert.ok(
      !good.props.includes("loss"),
      `a runtime head script or style was reported lost: ${JSON.stringify(good)}`,
    );
    const dropped = await run(
      c,
      wrap((d) => d.head.querySelector("meta").remove()),
    );
    isCx(dropped);
    hasProp(dropped, "loss");
    return { good, dropped };
  },
);

// --- an output-only ignore marker cannot hide a lost word ----------------
await check(
  "an output-only ignore marker cannot hide a lost word",
  async () => {
    const c = {
      shape: "dirty",
      identity: "plain",
      base: `<div sid="d"><p sid="a">ALPHA</p><p sid="b">BETA</p></div>`,
      local: `<div sid="d"><p sid="a">ALPHA</p><p sid="b">BETA LOCAL</p></div>`,
      remote: `<div sid="d"><p sid="a">ALPHA</p><p sid="b">BETA</p></div>`,
      options: { ignore: ".ig" },
    };
    const good = await run(c);
    notCx(good);
    const hidden = await run(
      c,
      wrap((d) => {
        d.body.setAttribute("class", "ig");
        d.querySelector("p").remove();
      }),
    );
    isCx(hidden);
    hasProp(hidden, "loss");
    return { good, hidden };
  },
);

// --- frozen ignore membership and frozen member relations ----------------
const IGNORE_REPARENT = {
  shape: "dirty",
  identity: "plain",
  base: `<section><div sid="A"><p sid="P">same</p></div><div sid="B"><p sid="Q">same</p></div></section><p sid="Z">z</p>`,
  local: `<section><div sid="A"><p sid="P">same</p></div><div sid="B"><p sid="Q">same</p></div></section><p sid="Z">z LOCAL</p>`,
  remote: `<section><div sid="A"><p sid="P">same</p></div><div sid="B"><p sid="Q">same</p></div></section><p sid="Z" title="r">z</p>`,
  options: { ignore: "section" },
};
await check(
  "identical ignored children cannot be reparented inside the ignored root",
  async () => {
    const good = await run(IGNORE_REPARENT);
    notCx(good);
    const damaged = await run(
      IGNORE_REPARENT,
      wrap((d) => {
        const [a, b] = [...d.querySelectorAll("section div")];
        const saved = a.firstElementChild;
        a.append(b.firstElementChild);
        b.append(saved);
      }),
    );
    isCx(damaged);
    hasProp(damaged, "ignored-changed");
    return { good, damaged };
  },
);

const IGNORE_REORDER = {
  shape: "dirty",
  identity: "plain",
  base: `<div class="ig"><p>x</p><p>x</p></div><p sid="Z">z</p>`,
  local: `<div class="ig"><p>x</p><p>x</p></div><p sid="Z">z LOCAL</p>`,
  remote: `<div class="ig"><p>x</p><p>x</p></div><p sid="Z">z</p>`,
  options: { ignore: ".ig" },
};
await check(
  "an identical sibling reorder inside a frozen ignored root is caught",
  async () => {
    const good = await run(IGNORE_REORDER);
    notCx(good);
    const damaged = await run(
      IGNORE_REORDER,
      wrap((d) => {
        const ig = d.querySelector(".ig");
        [...ig.children].reverse().forEach((x) => ig.appendChild(x));
      }),
    );
    isCx(damaged);
    hasProp(damaged, "ignored-changed");
    return { good, damaged };
  },
);

const RUNTIME_IGNORE = {
  shape: "dirty",
  identity: "plain",
  base: `<p sid="Z">z</p>`,
  local: `<p sid="Z">z LOCAL</p>`,
  remote: `<p sid="Z">z</p>`,
  live: { body: `<div class="ig">RUNTIME</div>` },
  options: { ignore: ".ig" },
};
await check(
  "a runtime-only ignored node cannot be removed or replaced",
  async () => {
    const good = await run(RUNTIME_IGNORE);
    notCx(good);
    const removed = await run(
      RUNTIME_IGNORE,
      wrap((d) => {
        d.querySelector(".ig").remove();
      }),
    );
    isCx(removed);
    hasProp(removed, "ignored-changed");
    const replaced = await run(
      RUNTIME_IGNORE,
      wrap((d) => {
        const ig = d.querySelector(".ig");
        ig.replaceWith(
          Object.assign(d.createElement("span"), { textContent: "X" }),
        );
      }),
    );
    isCx(replaced);
    hasProp(replaced, "ignored-changed");
    const edited = await run(
      RUNTIME_IGNORE,
      wrap((d) => {
        d.querySelector(".ig").textContent = "CHANGED";
      }),
    );
    isCx(edited);
    hasProp(edited, "ignored-changed");
    return { good, removed, replaced, edited };
  },
);

const ELEMENT_HEADS = {
  shape: "element",
  identity: "plain",
  base: `<div sid="root"><p sid="p">A</p></div>`,
  local: `<div sid="root"><p sid="p">A LOCAL</p></div>`,
  remote: `<div sid="root"><p sid="p">A</p><span sid="s">S</span></div>`,
  heads: {
    base: `<meta class="ig" name="m" content="base"><meta class="rw" name="r" content="base">`,
    local: `<meta class="ig" name="m" content="local"><meta class="rw" name="r" content="local">`,
    remote: `<meta class="ig" name="m" content="remote"><meta class="rw" name="r" content="remote">`,
  },
  options: { ignore: ".ig", remoteWins: ".rw" },
};
await check(
  "regions outside an element merge scope are not compared",
  async () => {
    const good = await run(ELEMENT_HEADS);
    notCx(good);
    assert.ok(
      !good.props.includes("ignored-changed") &&
        !good.props.includes("remote-wins-differs"),
      `a head region outside the element scope was compared: ${JSON.stringify(good)}`,
    );
    return { good };
  },
);

// --- templates -----------------------------------------------------------
await check(
  "pure template-inner reorder is real; a reversal is an order cx",
  async () => {
    const c = {
      shape: "pure",
      identity: "plain",
      base: `<div sid="w"><template sid="t"><p sid="a">A</p><p sid="b">B</p></template></div>`,
      local: `<div sid="w"><template sid="t"><p sid="a">A</p><p sid="b">B</p></template></div>`,
      remote: `<div sid="w"><template sid="t"><p sid="b">B</p><p sid="a">A</p></template></div>`,
    };
    const good = await run(c);
    assert.equal(good.status, "passes", JSON.stringify(good));
    const reversed = await run(
      c,
      wrap((d) => {
        const t = d.querySelector("template");
        [...t.content.children]
          .reverse()
          .forEach((x) => t.content.appendChild(x));
      }),
    );
    isCx(reversed);
    hasProp(reversed, "order");
    return { good, reversed };
  },
);
await check(
  "dirty template: a local inner reorder loses live A/B identity",
  async () => {
    const c = {
      shape: "dirty",
      identity: "plain",
      base: `<div sid="w"><template sid="t"><p sid="a">A</p><p sid="b">B</p></template><section sid="s">S</section></div>`,
      local: `<div sid="w"><section sid="s">S</section><template sid="t"><p sid="b">B</p><p sid="a">A</p></template></div>`,
      remote: `<div sid="w"><section sid="s">S</section><template sid="t"><p sid="a">A</p><p sid="b">B</p></template></div>`,
    };
    const r = await run(c);
    assert.equal(
      r.status,
      "counterexample",
      `the reproduced identity loss changed: ${JSON.stringify(r)}`,
    );
    hasProp(r, "identity-lost");
    return { reproduced: r };
  },
);

// --- the transport map reserves every declared sid ------------------------
await check(
  "a declared fresh-looking sid is never allocated to remote",
  async () => {
    const c = {
      shape: "clean",
      identity: "clay",
      base: `<div sid="oracle-fresh:1"><p sid="p1">A</p></div>`,
      local: `<div sid="oracle-fresh:1"><p sid="p1">A</p></div>`,
      remote: `<div><p sid="p1">A</p></div>`,
    };
    const good = await run(c);
    notCx(good);
    const obs = await runCase(E, normalize(structuredClone(c)));
    const ids = (obs.raw.report.identities || []).map(([, id]) => id);
    assert.ok(
      !ids.includes("oracle-fresh:1"),
      `the sender reallocated a declared sid: ${JSON.stringify(ids)}`,
    );
    assert.ok(ids.includes("oracle-fresh:2"), JSON.stringify(ids));
    return { good, ids };
  },
);

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(`policies ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
