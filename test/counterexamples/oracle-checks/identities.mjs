// Input-derived clay authored aliases, explicit template parent links and
// natural metadata-head keys. Executed assertions run the real engine and
// wrappers that alter only its output. A "good" status is passes or
// undecidable, never invalid or counterexample.
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
    out.head = root ? root.head.innerHTML : null;
  } catch {
    out.html = null;
    out.head = null;
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
const count = (html, re) => (html.match(re) || []).length;
const headOf = (r) => {
  assert.equal(typeof r.head, "string", JSON.stringify(r));
  return r.head;
};
const bodyOf = (r) => {
  assert.equal(typeof r.html, "string", JSON.stringify(r));
  return r.html;
};

// The original live head nodes, still the same objects after the merge.
const retention = async (c) => {
  const obs = await runCase(E, normalize(structuredClone(c)));
  const { p } = obs.raw;
  const head = p.live.head;
  const before = [...p.preMerge.entries()]
    .filter(([, rec]) => rec.parent === head)
    .map(([el]) => el);
  return {
    elements: before.map((el) => el.tagName),
    retained: before.map((el) => obs.raw.liveRoot.contains(el)),
    head: obs.raw.liveRoot.head.innerHTML,
  };
};

// --- clay authored aliases -------------------------------------------------

const aliasBase = `<p sid="A" data-id="X">base</p>`;
const aliasLocal = `<p sid="A" data-id="X">base LOCAL</p>`;
const aliasRemote = `<p sid="B" data-id="X" title="remote">base</p>`;
const aliasCase = (shape, extra = {}) => ({
  shape,
  identity: "clay",
  base: aliasBase,
  local: aliasLocal,
  remote: aliasRemote,
  ...extra,
});

await check(
  "a unique authored id is one identity despite clay lineage drift",
  async () => {
    const dirty = await run(aliasCase("dirty"));
    notCx(dirty);
    assert.match(bodyOf(dirty), /base LOCAL/);
    assert.match(bodyOf(dirty), /title="remote"/);
    assert.equal(count(bodyOf(dirty), /<p/g), 1);
    const pure = await run(aliasCase("pure"));
    notCx(pure);
    assert.match(bodyOf(pure), /base LOCAL/);
    assert.match(bodyOf(pure), /title="remote"/);
    assert.equal(count(bodyOf(pure), /<p/g), 1);
    const dropLocal = await run(
      aliasCase("dirty"),
      wrap((d) => {
        d.querySelector("p").textContent = "base";
      }),
    );
    isCx(dropLocal);
    hasProp(dropLocal, "loss");
    const oldTitle = await run(
      aliasCase("dirty"),
      wrap((d) => {
        d.querySelector("p").removeAttribute("title");
      }),
    );
    isCx(oldTitle);
    hasProp(oldTitle, "attr");
    return { dirty, pure, dropLocal, oldTitle };
  },
);

await check(
  "clay author alias in element shape, root and children",
  async () => {
    const mk = (inner) => `<main sid="M">${inner}</main>`;
    const whole = await run({
      ...aliasCase("element"),
      base: mk(aliasBase),
      local: mk(aliasLocal),
      remote: mk(aliasRemote),
    });
    notCx(whole);
    assert.equal(count(bodyOf(whole), /<p/g), 1);
    const children = await run({
      ...aliasCase("element", { options: { children: true } }),
      base: mk(aliasBase),
      local: mk(aliasLocal),
      remote: mk(aliasRemote),
    });
    notCx(children);
    assert.equal(count(bodyOf(children), /<p/g), 1);
    const damaged = await run(
      {
        ...aliasCase("element", { options: { children: true } }),
        base: mk(aliasBase),
        local: mk(aliasLocal),
        remote: mk(aliasRemote),
      },
      wrap((d) => {
        d.querySelector("main > p").textContent = "base";
      }),
    );
    isCx(damaged);
    hasProp(damaged, "loss");
    return { whole, children, damaged };
  },
);

await check(
  "clay author alias survives an absent sid on either side",
  async () => {
    const noRemoteSid = {
      ...aliasCase("dirty"),
      remote: `<p data-id="X" title="remote">base</p>`,
    };
    const noLocalSid = {
      ...aliasCase("dirty"),
      local: `<p data-id="X">base LOCAL</p>`,
    };
    const rows = {};
    for (const [name, c] of [
      ["noRemoteSidDirty", noRemoteSid],
      ["noRemoteSidPure", { ...noRemoteSid, shape: "pure" }],
      ["noLocalSidDirty", noLocalSid],
      ["noLocalSidPure", { ...noLocalSid, shape: "pure" }],
    ]) {
      const r = await run(c);
      notCx(r);
      assert.match(bodyOf(r), /base LOCAL/);
      assert.equal(count(bodyOf(r), /<p/g), 1);
      rows[name] = r;
    }
    return rows;
  },
);

await check(
  "both sides insert one authored id under different sids",
  async () => {
    const shared = `<p sid="A" data-id="X">inserted</p>`;
    const peer = `<p sid="B" data-id="X">inserted</p>`;
    const same = await run({
      shape: "dirty",
      identity: "clay",
      base: `<p>keep</p>`,
      local: `<p>keep</p>${shared}`,
      remote: `<p>keep</p>${peer}`,
    });
    notCx(same);
    assert.equal(count(bodyOf(same), /data-id="X"/g), 1);
    const samePure = await run({
      shape: "pure",
      identity: "clay",
      base: `<p>keep</p>`,
      local: `<p>keep</p>${shared}`,
      remote: `<p>keep</p>${peer}`,
    });
    notCx(samePure);
    assert.equal(count(bodyOf(samePure), /data-id="X"/g), 1);
    // Different inserted text: one effective identity, so the structural
    // collision is resolved by policy (the remote copy by default) and the
    // oracle accepts it whole; the alias must not name a phantom second owner.
    const differ = await run({
      shape: "dirty",
      identity: "clay",
      base: `<p>keep</p>`,
      local: `<p>keep</p><p sid="A" data-id="X">local</p>`,
      remote: `<p>keep</p><p sid="B" data-id="X">remote</p>`,
    });
    notCx(differ);
    assert.match(bodyOf(differ), /remote/);
    assert.ok(
      !/local/.test(bodyOf(differ)),
      `the nonchosen copy survived: ${bodyOf(differ)}`,
    );
    const witnesses = differ.violations || [];
    assert.ok(
      !witnesses.some((v) => v.owner === "$B" || v.owner === "$A"),
      `a phantom lineage owner survived: ${JSON.stringify(differ)}`,
    );
    assert.ok(
      !witnesses.some((v) => v.atom === "element"),
      `the shared authored id was split into two elements: ${JSON.stringify(differ)}`,
    );
    assert.equal(count(differ.html, /data-id="X"/g), 1);
    return { same, samePure, differ };
  },
);

await check(
  "plain mode keeps its sid identities for the same page",
  async () => {
    const plain = await run({ ...aliasCase("dirty"), identity: "plain" });
    notCx(plain);
    assert.equal(
      count(bodyOf(plain), /data-id="X"/g),
      2,
      `plain mode must keep both sid owners: ${bodyOf(plain)}`,
    );
    assert.ok(
      !(plain.violations || []).some((v) => v.atom === "element"),
      JSON.stringify(plain),
    );
    return { plain };
  },
);

// --- template fragments ----------------------------------------------------

const tpl = (inner) => `<template sid="T">${inner}</template><p sid="Z">z</p>`;
const tplBase = tpl(`<p sid="A">alpha</p><p sid="B">beta</p>`);
const tplLocal = tpl(`<p sid="A">alpha LOCAL</p><p sid="B">beta</p>`);
const tplDeleted = `<p sid="Z">z</p>`;
const tplCase = (shape, identity = "plain") => ({
  shape,
  identity,
  base: tplBase,
  local: tplLocal,
  remote: tplDeleted,
});

const templateP = (doc) => {
  const out = [];
  const go = (root) => {
    for (const t of root.querySelectorAll("template")) {
      out.push(...t.content.querySelectorAll("p"));
      go(t.content);
    }
  };
  go(doc);
  return out;
};

await check(
  "pure template edit beats delete through the fragment",
  async () => {
    const good = await run(tplCase("pure"));
    notCx(good);
    const html = bodyOf(good);
    assert.match(html, /alpha LOCAL/);
    assert.match(html, /beta/);
    const dropB = await run(
      tplCase("pure"),
      wrap((d) => {
        templateP(d)
          .find((p) => p.textContent === "beta")
          ?.remove();
      }),
    );
    isCx(dropB);
    hasProp(dropB, "loss");
    const dropWord = await run(
      tplCase("pure"),
      wrap((d) => {
        const b = templateP(d).find((p) => p.textContent === "beta");
        if (b) b.textContent = "";
      }),
    );
    isCx(dropWord);
    hasProp(dropWord, "loss");
    return { good, dropB, dropWord };
  },
);

await check("nested templates inherit through both fragments", async () => {
  const nested = (inner) =>
    `<template sid="T"><template sid="U">${inner}</template></template><p sid="Z">z</p>`;
  const inner = `<p sid="A">alpha</p><p sid="B">beta</p>`;
  const c = {
    shape: "pure",
    identity: "plain",
    base: nested(inner),
    local: nested(`<p sid="A">alpha LOCAL</p><p sid="B">beta</p>`),
    remote: tplDeleted,
  };
  const good = await run(c);
  notCx(good);
  assert.match(bodyOf(good), /alpha LOCAL/);
  assert.match(bodyOf(good), /beta/);
  const damaged = await run(
    c,
    wrap((d) => {
      templateP(d)
        .find((p) => p.textContent === "beta")
        ?.remove();
    }),
  );
  isCx(damaged);
  hasProp(damaged, "loss");
  return { good, damaged };
});

await check(
  "dirty and element template cases record the live-identity bug",
  async () => {
    const mk = (inner) => `<main sid="M">${inner}</main>`;
    const rows = {};
    for (const [name, c] of [
      ["dirty", tplCase("dirty")],
      [
        "element",
        {
          ...tplCase("element"),
          base: mk(tplBase),
          local: mk(tplLocal),
          remote: mk(tplDeleted),
        },
      ],
      [
        "elementChildren",
        {
          ...tplCase("element", "plain"),
          options: { children: true },
          base: mk(tplBase),
          local: mk(tplLocal),
          remote: mk(tplDeleted),
        },
      ],
    ]) {
      const r = await run(c);
      assert.notEqual(r.status, "invalid", JSON.stringify(r));
      // The merge output is the correct one; the verdict exposes the known
      // live-side identity bug and must not be suppressed or relabelled.
      assert.match(bodyOf(r), /alpha LOCAL/);
      assert.match(bodyOf(r), /beta/);
      rows[name] = { ...r, recorded: true };
    }
    return rows;
  },
);

await check(
  "an ignored template protects its identified descendants",
  async () => {
    const local = `<template sid="T"><p sid="A" title="one">alpha</p></template><p sid="Z">z LOCAL</p>`;
    const remoteAttr = `<template sid="T"><p sid="A" title="two">alpha</p></template><p sid="Z">z</p>`;
    const remoteDelete = `<p sid="Z">z</p>`;
    const attrCase = {
      shape: "dirty",
      identity: "plain",
      base: `<template sid="T"><p sid="A" title="one">alpha</p></template><p sid="Z">z</p>`,
      local,
      remote: remoteAttr,
      options: { ignore: "template" },
    };
    const attr = await run(attrCase);
    notCx(attr);
    assert.match(bodyOf(attr), /title="one"/);
    const removed = await run({ ...attrCase, remote: remoteDelete });
    notCx(removed);
    assert.match(bodyOf(removed), /title="one"/);
    assert.match(bodyOf(removed), /alpha/);
    const damageAttr = await run(
      attrCase,
      wrap((d) => {
        d.querySelector("template")
          .content.querySelector("p")
          .setAttribute("title", "two");
      }),
    );
    isCx(damageAttr);
    hasProp(damageAttr, "ignored-changed");
    const damageText = await run(
      attrCase,
      wrap((d) => {
        d.querySelector("template").content.querySelector("p").textContent =
          "alpha CHANGED";
      }),
    );
    isCx(damageText);
    hasProp(damageText, "ignored-changed");
    const damageRemove = await run(
      attrCase,
      wrap((d) => {
        d.querySelector("template")?.remove();
      }),
    );
    isCx(damageRemove);
    hasProp(damageRemove, "ignored-changed");
    return { attr, removed, damageAttr, damageText, damageRemove };
  },
);

// --- natural metadata-head keys -------------------------------------------

const metaHeads = {
  base: `<meta name="a" content="one"><meta name="b" content="two">`,
  local: `<meta name="a" content="ONE"><meta name="b" content="two">`,
  remote: `<meta name="a" content="one"><meta name="b" content="TWO">`,
};
const metaCase = (identity, shape = "dirty") => ({
  shape,
  identity,
  base: `<main>body</main>`,
  local: `<main>body</main>`,
  remote: `<main>body</main>`,
  heads: metaHeads,
});

await check("two metadata elements take their own named edits", async () => {
  const c = metaCase("default");
  const good = await run(c);
  notCx(good);
  const head = headOf(good);
  assert.match(head, /name="a" content="ONE"/);
  assert.match(head, /name="b" content="TWO"/);
  const dropA = await run(
    c,
    wrap((d) => {
      d.querySelector('meta[name="a"]').setAttribute("content", "one");
    }),
  );
  isCx(dropA);
  hasProp(dropA, "attr");
  const dropB = await run(
    c,
    wrap((d) => {
      d.querySelector('meta[name="b"]').setAttribute("content", "two");
    }),
  );
  isCx(dropB);
  hasProp(dropB, "attr");
  return { good, dropA, dropB };
});

await check("a stable metadata key overrides a changed sid", async () => {
  const rows = {};
  for (const identity of ["default", "plain", "clay"]) {
    const c = {
      shape: "clean",
      identity,
      base: `<main>body</main>`,
      local: `<main>body</main>`,
      remote: `<main>body</main>`,
      heads: {
        base: `<meta sid="S1" name="theme" content="dark">`,
        local: `<meta sid="S1" name="theme" content="dark">`,
        remote: `<meta sid="S2" name="theme" content="light">`,
      },
    };
    const good = await run(c);
    notCx(good);
    assert.match(headOf(good), /name="theme" content="light"/);
    const damaged = await run(
      c,
      wrap((d) => {
        d.querySelector("meta").setAttribute("content", "dark");
      }),
    );
    isCx(damaged);
    hasProp(damaged, "attr");
    rows[identity] = { good, damaged };
  }
  return rows;
});

await check(
  "a title keeps a local text edit and a remote attribute",
  async () => {
    const c = {
      shape: "dirty",
      identity: "default",
      base: `<main>old</main>`,
      local: `<main>old</main>`,
      remote: `<main>old NEW</main>`,
      heads: {
        base: `<title>hello</title>`,
        local: `<title>hello world</title>`,
        remote: `<title lang="en">hello</title>`,
      },
    };
    const good = await run(c);
    notCx(good);
    assert.match(headOf(good), /lang="en"/);
    assert.match(headOf(good), /hello world/);
    const dropText = await run(
      c,
      wrap((d) => {
        d.querySelector("title").textContent = "hello";
      }),
    );
    isCx(dropText);
    hasProp(dropText, "loss");
    const dropAttr = await run(
      c,
      wrap((d) => {
        d.querySelector("title").removeAttribute("lang");
      }),
    );
    isCx(dropAttr);
    hasProp(dropAttr, "attr");
    return { good, dropText, dropAttr };
  },
);

await check(
  "a stylesheet link merges across a fragment-only change",
  async () => {
    const c = {
      shape: "dirty",
      identity: "default",
      base: `<main>old</main>`,
      local: `<main>old</main>`,
      remote: `<main>old NEW</main>`,
      heads: {
        base: `<link rel="stylesheet" href="css/a.css#one" class="x">`,
        local: `<link rel="stylesheet" href="css/a.css#one" class="x y">`,
        remote: `<link rel="stylesheet" href="css/a.css#two" class="x" title="t">`,
      },
    };
    const good = await run(c);
    notCx(good);
    const head = headOf(good);
    assert.match(head, /class="x y"/, JSON.stringify(good));
    assert.match(head, /title="t"/);
    const pure = await run({ ...c, shape: "pure" });
    notCx(pure);
    assert.match(headOf(pure), /class="x y"/);
    assert.match(headOf(pure), /title="t"/);
    const dropClass = await run(
      c,
      wrap((d) => {
        d.querySelector("link").setAttribute("class", "x");
      }),
    );
    isCx(dropClass);
    hasProp(dropClass, "attr");
    const dropTitle = await run(
      c,
      wrap((d) => {
        d.querySelector("link").removeAttribute("title");
      }),
    );
    isCx(dropTitle);
    hasProp(dropTitle, "attr");
    return { good, pure, dropClass, dropTitle };
  },
);

await check("the engine keeps the live head nodes it keeps", async () => {
  const c = {
    shape: "dirty",
    identity: "default",
    base: `<main>old</main>`,
    local: `<main>old</main>`,
    remote: `<main>old NEW</main>`,
    heads: {
      base: `<meta charset="utf-8"><title>hello</title>`,
      local: `<meta charset="utf-8"><title>hello world</title>`,
      remote: `<meta charset="utf-8"><title lang="en">hello</title>`,
    },
  };
  const kept = await retention(c);
  assert.deepEqual(kept.elements, ["META", "TITLE"], JSON.stringify(kept));
  assert.deepEqual(kept.retained, [true, true], JSON.stringify(kept));
  assert.match(kept.head, /hello world/);
  assert.match(kept.head, /lang="en"/);
  const good = await run(c);
  notCx(good);
  return { kept, good };
});

await check("a repeated metadata key certifies nothing", async () => {
  const c = {
    shape: "clean",
    identity: "default",
    base: `<main>body</main>`,
    local: `<main>body</main>`,
    remote: `<main>body</main>`,
    heads: {
      base: `<meta name="dup" content="one"><meta name="dup" content="one">`,
      local: `<meta name="dup" content="one"><meta name="dup" content="one">`,
      remote: `<meta name="dup" content="TWO"><meta name="dup" content="one">`,
    },
  };
  const r = await run(c);
  notCx(r);
  assert.ok(
    !(r.violations || []).some((v) =>
      String(v.owner || "").startsWith("#head:"),
    ),
    `an ambiguous metadata key was certified: ${JSON.stringify(r)}`,
  );
  return { ambiguousKey: r };
});

// --- pure provenance sanity ------------------------------------------------

const provCase = {
  shape: "pure",
  identity: "plain",
  base: `<p sid="A">base</p>`,
  local: `<p sid="A">base LOCAL</p>`,
  remote: `<p sid="A" title="r">base</p>`,
};
const foreignProv = (field) => ({
  ...E,
  merge3(b, l, r, o) {
    const res = E.merge3(b, l, r, o);
    const target = res.doc.body.firstElementChild;
    if (target)
      res.provenance.set(target, {
        ...(res.provenance.get(target) || {}),
        [field]: res.doc.createElement("p"),
      });
    return res;
  },
});

await check("a foreign provenance source is a hard violation", async () => {
  const good = await run(provCase);
  notCx(good);
  const rows = {};
  for (const field of ["base", "local", "remote"]) {
    const r = await run(provCase, foreignProv(field));
    isCx(r);
    hasProp(r, "provenance");
    rows[field] = r;
  }
  const template = await run(
    {
      shape: "pure",
      identity: "plain",
      base: tplBase,
      local: tplLocal,
      remote: tplDeleted,
    },
    foreignProv("local"),
  );
  isCx(template);
  hasProp(template, "provenance");
  return { good, ...rows, template };
});

// --- identities the bench already covers -----------------------------------

const DEL2 = (identity) => ({
  shape: "dirty",
  identity,
  base: `<div id="a">Same</div><div id="b">Same</div>`,
  local: `<div id="a">Same</div>`,
  remote: `<div id="b">Same</div>`,
});
const T2 = {
  shape: "dirty",
  identity: "clay",
  base: `<div class="box"><p sid="P1">Note</p></div><div class="box"><p sid="P2">Note</p></div><p>end</p>`,
  local: `<p>end</p><div class="box"><p sid="P1">Note</p></div>`,
  remote: `<div class="box"></div><div class="box"><p sid="P2">Note</p></div><p>end</p>`,
};

await check(
  "duplicated authored ids stay green and T2 stays a relabel",
  async () => {
    const rows = {};
    for (const identity of ["default", "authored"]) {
      const good = await run(DEL2(identity));
      notCx(good);
      rows[identity] = good;
    }
    const kept = await run(
      DEL2("authored"),
      wrap((d) => {
        if (!d.body.children.length)
          d.body.innerHTML = '<div id="a">Same</div>';
      }),
    );
    isCx(kept);
    hasProp(kept, "duplication");
    const relabel = await run(T2, {
      ...E,
      async mergeDocument(o) {
        const r = await E.mergeDocument(o);
        const body = o.live.body;
        const notes = [...body.querySelectorAll("p")].filter(
          (p) => p.textContent === "Note",
        );
        const p1 = notes[0];
        for (const n of notes.slice(1)) n.remove();
        for (const b of [...body.querySelectorAll(".box")])
          if (!b.contains(p1)) b.remove();
        body.append(p1.parentNode);
        return {
          ...r,
          identities: [[p1, "P2"]],
          conflicts: [],
          moved: [],
          replaced: [],
        };
      },
    });
    isCx(relabel);
    hasProp(relabel, "identity-relabelled");
    return { ...rows, kept, relabel };
  },
);

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(`identities ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
