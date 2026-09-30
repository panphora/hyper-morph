// Occurrence proofs, conflict scope and necessary count bounds. Executed
// assertions run the real engine; every damage wrapper calls the real engine
// first and then alters only its output. Veto and live-state cases are the
// next step and are deliberately absent.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { engine } from "../lib/engines.js";
import { verdict, judge } from "../lib/oracle.js";

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
    violations: (v.violations || []).slice(0, 4),
    ambiguous: (v.ambiguous || []).slice(0, 4),
  };
  try {
    const j = await judge(engine, structuredClone(c));
    out.html = j.obs?.raw?.liveRoot?.body?.innerHTML ?? null;
  } catch (e) {
    out.html = null;
  }
  return out;
};

const notCx = (r) =>
  assert.notEqual(r.status, "counterexample", JSON.stringify(r));
const isCx = (r) => assert.equal(r.status, "counterexample", JSON.stringify(r));

// Both anonymous-across-anchor cases (codex probes2, opus fx/t11) never cx.
const ANCHOR_CODEX = {
  shape: "dirty",
  identity: "plain",
  base: '<main sid="M"><p>base</p><hr sid="H"></main>',
  local: '<main sid="M"><hr sid="H"><p>local</p></main>',
  remote: '<main sid="M"><p>remote</p><hr sid="H"></main>',
};
await check("codex anonymous across anchor is not a cx", async () => {
  const r = await run(ANCHOR_CODEX);
  notCx(r);
  assert.ok(
    r.html.includes("remote") && r.html.includes("local"),
    JSON.stringify(r),
  );
  return r;
});

const ANCHOR_T11_MOVE = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="W"><section class="a">s</section><p sid="P">p</p></div>',
  local:
    '<div sid="W"><section class="a" title="L">s</section><p sid="P">p</p></div>',
  remote: '<div sid="W"><p sid="P">p</p><section class="b">s</section></div>',
};
await check(
  "opus t11 anonymous section moved across anchor is not a cx",
  async () => {
    const r = await run(ANCHOR_T11_MOVE);
    notCx(r);
    return r;
  },
);

await check(
  "opus t11 moved section deleted from the output is a cx",
  async () => {
    const good = await run(ANCHOR_T11_MOVE);
    notCx(good);
    const bad = await run(
      ANCHOR_T11_MOVE,
      wrap((d) => {
        d.querySelector("section")?.remove();
      }),
    );
    isCx(bad);
    assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
    return { good, bad };
  },
);

const ANCHOR_T11_REPLACED = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="W"><p sid="P">p</p><section class="a">one two three</section></div>',
  local:
    '<div sid="W"><p sid="P">p</p><section class="a">one two three four</section></div>',
  remote:
    '<div sid="W"><section class="b">nine ten</section><p sid="P">p</p></div>',
};
await check(
  "opus t11 anonymous section replaced across anchor is not a cx",
  async () => {
    const r = await run(ANCHOR_T11_REPLACED);
    notCx(r);
    return r;
  },
);

// Two same-tag slots, one present in every input and one one-sided insertion:
// the unrelated slot's output presence must not excuse the lost insertion.
const SLOT_PRESENCE = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="W"><hr class="a"><p sid="P">p</p></div>',
  local: '<div sid="W"><hr class="a"><p sid="P">p</p><hr class="n"></div>',
  remote: '<div sid="W"><hr class="a"><p sid="P">p</p></div>',
};
await check(
  "an unrelated same-tag slot does not mute a lost insertion",
  async () => {
    const good = await run(SLOT_PRESENCE);
    notCx(good);
    const bad = await run(
      SLOT_PRESENCE,
      wrap((d) => {
        d.querySelector("hr.n")?.remove();
      }),
    );
    isCx(bad);
    assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
    return { good, bad };
  },
);

// Same-id echo: both sides insert one identity with different attributes.
const ECHO = {
  shape: "dirty",
  identity: "plain",
  base: '<p sid="A">x</p>',
  local: '<p sid="A">x</p><p sid="N" title="L">new</p>',
  remote: '<p sid="A">x</p><p sid="N" title="R">new</p>',
};
await check(
  "same-id echo attribute conflict follows the remote default",
  async () => {
    const r = await run(ECHO);
    assert.equal(r.status, "passes", JSON.stringify(r));
    assert.ok(r.html.includes('title="R"'), JSON.stringify(r));
    return r;
  },
);
await check(
  "same-id echo attribute conflict follows conflicts:local",
  async () => {
    const r = await run({ ...ECHO, options: { conflicts: "local" } });
    assert.equal(r.status, "passes", JSON.stringify(r));
    assert.ok(r.html.includes('title="L"'), JSON.stringify(r));
    return r;
  },
);

// Same-slot anonymous leaf insertions the engine pairs.
const HR = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="A"><p>x</p></div>',
  local: '<div sid="A"><p>x</p><hr class="a"></div>',
  remote: '<div sid="A"><p>x</p><hr class="b"></div>',
};
await check("anonymous hr class a+b is not a cx", async () => {
  const r = await run(HR);
  notCx(r);
  assert.ok(
    r.html.includes("a b") || r.html.includes("b a"),
    JSON.stringify(r),
  );
  return r;
});

const SPAN = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="A"><p>x</p></div>',
  local: '<div sid="A"><p>x</p><span title="a"></span></div>',
  remote: '<div sid="A"><p>x</p><span title="b"></span></div>',
};
await check("empty span title conflict is not a cx", async () => {
  const r = await run(SPAN);
  notCx(r);
  return r;
});

// A conflict in one subtree must not hide a separate loss in the same owner.
const t5 = (wrapHtml) => ({
  shape: "dirty",
  identity: "default",
  base: wrapHtml("<p>alpha</p><p>beta</p>"),
  local: wrapHtml("<p>one</p><p>beta gamma</p>"),
  remote: wrapHtml("<p>two</p><p>beta</p>"),
});
const t5plain = (identity) => {
  const wrapHtml = (inner) => `<div sid="D">${inner}</div><p sid="Z">z</p>`;
  return {
    shape: "dirty",
    identity,
    base: wrapHtml("<p>alpha</p><p>beta</p>"),
    local: wrapHtml("<p>one</p><p>beta gamma</p>"),
    remote: wrapHtml("<p>two</p><p>beta</p>"),
  };
};
await check(
  "conflict beside lost text in another subtree is a cx",
  async () => {
    const good = await run(t5((x) => x));
    notCx(good);
    const bad = await run(
      t5((x) => x),
      wrap((d) => {
        d.body.children[1].textContent = "beta";
      }),
    );
    isCx(bad);
    assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
    return { good, bad };
  },
);
await check(
  "conflict beside lost text with a repeated anonymous p sibling is a cx",
  async () => {
    const good = await run(t5plain("plain"));
    notCx(good);
    const bad = await run(
      t5plain("plain"),
      wrap((d) => {
        d.querySelector("div").children[1].textContent = "beta";
      }),
    );
    isCx(bad);
    assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
    return { good, bad };
  },
);

// Neutral delete/insert: the lower bound is still required.
const NEUTRAL = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p class="a">Same</p><p class="b">Same</p></main>',
  local: '<main id="M"><p class="b">Same</p><p class="c">Same</p></main>',
  remote: '<main id="M"><p class="b">Same</p></main>',
};
await check("NEUTRAL removing every Same is a cx", async () => {
  const bad = await run(
    NEUTRAL,
    wrap((d) => {
      for (const p of [...d.querySelectorAll("main p")]) p.remove();
    }),
  );
  isCx(bad);
  assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
  return bad;
});
await check("NEUTRAL dropping one Same may stay undecidable", async () => {
  const r = await run(
    NEUTRAL,
    wrap((d) => {
      d.querySelector("p.c")?.remove();
    }),
  );
  notCx(r);
  return r;
});

// N2: a textless br/hr insertion on each side is not an edit of the text.
const N2 = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="A"><b>x</b> keep</div><p sid="Z">z</p>',
  local: '<div sid="A"><b>x</b> keep <br></div><p sid="Z">z</p>',
  remote: '<div sid="A"><b>x</b> keep <hr></div><p sid="Z">z</p>',
};
await check("N2 adding br/hr is not a cx", async () => {
  const r = await run(N2);
  notCx(r);
  return r;
});
await check("N2 unchanged word keep dropped is a cx", async () => {
  const bad = await run(
    N2,
    wrap((d) => {
      const a = d.querySelector("div");
      for (const n of [...a.childNodes])
        if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace("keep", "");
    }),
  );
  isCx(bad);
  assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
  return bad;
});

// Transfer: an aggregate necessary bound, no page-wide exemption.
const TRANSFER = {
  shape: "dirty",
  identity: "plain",
  base: '<p sid="A">x y</p><p sid="B">z</p>',
  local: '<p sid="A">y</p><p sid="B">z x</p>',
  remote: '<p sid="A">x y REMOTE</p><p sid="B">z</p>',
};
await check("transfer real is not a cx", async () => {
  const r = await run(TRANSFER);
  notCx(r);
  return r;
});
await check("dropping the transferred x everywhere is a cx", async () => {
  const bad = await run(
    TRANSFER,
    wrap((d) => {
      d.body.children[1].textContent = "z";
    }),
  );
  isCx(bad);
  assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
  assert.ok(
    (bad.violations || []).some((v) => Array.isArray(v.owners)),
    JSON.stringify(bad),
  );
  return bad;
});

// Output-only anonymous leaves: a resurrection and an anonymous clone.
const IMG = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="W"><img sid="I" src="a.png"><p sid="Q">q</p></div><p sid="Z">z</p>',
  local:
    '<div sid="W"><img sid="I" src="a.png"><p sid="Q">q</p></div><p sid="Z">z LOCAL</p>',
  remote: '<div sid="W"><p sid="Q">q</p></div><p sid="Z">z</p>',
};
await check("anonymous resurrection of a deleted img is a cx", async () => {
  const good = await run(IMG);
  notCx(good);
  const bad = await run(
    IMG,
    wrap((d) => {
      const i = d.createElement("img");
      i.setAttribute("src", "a.png");
      d.querySelector("div").prepend(i);
    }),
  );
  isCx(bad);
  return bad;
});
const IMG_KEPT = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="W"><img sid="I" src="a.png"><p sid="Q">q</p></div><p sid="Z">z</p>',
  local:
    '<div sid="W"><img sid="I" src="a.png"><p sid="Q">q</p></div><p sid="Z">z LOCAL</p>',
  remote:
    '<div sid="W"><img sid="I" src="a.png"><p sid="Q">q REMOTE</p></div><p sid="Z">z</p>',
};
await check("anonymous clone of a kept identified img is a cx", async () => {
  const good = await run(IMG_KEPT);
  notCx(good);
  const bad = await run(
    IMG_KEPT,
    wrap((d) => {
      const i = d.querySelector("img");
      i.after(i.cloneNode(true));
    }),
  );
  isCx(bad);
  return bad;
});

// The invented output-only img from the reproduced failure: absent from every
// input and from the frozen pre-merge live DOM, so its appearance is a cx.
const INVENTED_IMG = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="D"><p>hi</p></div>',
  local: '<div sid="D"><p>hi LOCAL</p></div>',
  remote: '<div sid="D" title="R"><p>hi</p></div>',
};
await check("an invented output-only img is a cx", async () => {
  const good = await run(INVENTED_IMG);
  notCx(good);
  const bad = await run(
    INVENTED_IMG,
    wrap((d) => {
      const i = d.createElement("img");
      i.setAttribute("src", "invented");
      d.body.appendChild(i);
    }),
  );
  isCx(bad);
  assert.ok(bad.props.includes("duplication"), JSON.stringify(bad));
  return { good, bad };
});

// A runtime head insertion is frozen pre-merge live evidence: it must survive
// the merge, and deleting it from the output must be a cx.
const HEAD_LIVE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../cases/seed-head-live-insert-plain.json", import.meta.url),
    ),
    "utf8",
  ),
);
await check(
  "deleting the runtime head meta from the output is a cx",
  async () => {
    const good = await run(HEAD_LIVE);
    notCx(good);
    const bad = await run(
      HEAD_LIVE,
      wrap((d) => {
        d.querySelector('meta[name="runtime"]')?.remove();
      }),
    );
    isCx(bad);
    assert.ok(bad.props.includes("loss"), JSON.stringify(bad));
    return { good, bad };
  },
);

const failed = results.filter((r) => r.error);
for (const r of failed) console.log(`FAIL ${r.name}: ${r.error}`);
console.log(`occurrences ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
