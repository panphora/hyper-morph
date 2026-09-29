// Pass 1b: an identity pair whose two subtrees are equal, and whose every
// identity pairing inside them is the positional counterpart, is certified
// identical in one linear walk under a budget, and everything below it is
// paired eagerly. The shape that must stay correct is an equal-looking
// identity pair whose inner element moved out with a copy left in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { parse, doc } from "./lib/dom.js";
import { tagNodes, survivors, lockstepMap } from "./lib/apply-speed-fuzz.js";
import {
  mergeDocument,
  merge3,
  createIdentityStore,
  importMap,
} from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { align, steps } from "../../src/align.js";
import { createAnalyzer } from "../../src/similarity.js";
import { indexByIdentity, defaultIdentity } from "../../src/identity.js";
import { makeIgnore } from "../../src/ignore.js";

const frame = (r) => parse(doc(r)).body.innerHTML;

/** The pre-E4b1 engine, on this machine or not: the fixtures below pin their
 * result against it when it is there and skip that comparison when it is
 * not. */
const REFERENCE = "/private/tmp/hm-reference-m4/src/index.js";
const reference = existsSync(REFERENCE) ? await import(REFERENCE) : null;
const kinds = (rep) => rep.conflicts.map((c) => `${c.kind}:${c.detail || ""}`);
const sig = (r) =>
  `${kinds(r).sort().join("|")}#dec${r.decisions.length}#m${r.moved.length}#r${r.replaced.length}#d${r.localDiverged ? 1 : 0}`;
const authored = (el) =>
  el.getAttribute("data-id") || el.getAttribute("id") || null;
const paras = (html) =>
  [...parse(doc(html)).querySelectorAll("p")].map((p) => p.textContent);
const counts = (list) => {
  const m = new Map();
  for (const t of list) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

function elementPaths(root) {
  const list = [];
  const visit = (el, path) => {
    list.push([path, el]);
    for (let i = 0; i < el.children.length; i++)
      visit(el.children[i], path === "" ? String(i) : path + "." + i);
  };
  visit(root, "");
  return list;
}

const pathAt = (root, path) =>
  path === "" ? root : path.split(".").reduce((el, i) => el.children[+i], root);

/** Dirty shape: the live tab has local edits, the base is a capture string. */
async function dirtyLive(b, l, r, opts = {}) {
  const live = parse(doc(l));
  const report = await mergeDocument({
    live,
    base: doc(b),
    remote: doc(r),
    ...opts,
  });
  return {
    live,
    html: live.body.innerHTML,
    kinds: kinds(report),
    report,
  };
}

/** The same dirty shape on another engine (the pre-E4b1 reference). */
async function dirtyLiveWith(engine, b, l, r) {
  const live = parse(doc(l));
  const report = await engine.mergeDocument({
    live,
    base: doc(b),
    remote: doc(r),
  });
  return { live, html: live.body.innerHTML, kinds: kinds(report), report };
}

/** Clean shape: live and capture are two parses of the base, local is the
 * capture mapped onto the live tree, remote is the sender's document. */
async function cleanFull(b, r) {
  const live = parse(doc(b)),
    cap = parse(doc(b));
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(r),
  });
  return { live, html: live.body.innerHTML, kinds: kinds(report), report };
}

/** The ClayJS shape with synthetic ids: the receiver's store mints the
 * capture's ids, the sender's map shares them at every path both sides hold,
 * and the case's surgery (a moved card, a permuted id) is the only
 * difference. */
function cleanSynthetic(b, r, surgery) {
  const live = parse(doc(b)),
    cap = parse(doc(b)),
    remote = parse(doc(r));
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const store = createIdentityStore("t");
  const capMap = store.exportMap(cap.documentElement, (n) => n);
  const senderStore = createIdentityStore("t");
  const map = senderStore.exportMap(remote.documentElement, (n) => n);
  for (const k of Object.keys(map))
    if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
  if (surgery) surgery(map, capMap);
  const ids = tagNodes(live.documentElement);
  const labels = new Map(
    elementPaths(live.documentElement).map(([p, el]) => [p, ids.get(el)]),
  );
  const localId = (el) => authored(el) || store.idOf(el) || null;
  const identity = {
    base: localId,
    local: localId,
    remote: { first: authored, map, then: authored },
  };
  const at = (path) => pathAt(live.documentElement, path);
  const merge = async () => {
    const report = await mergeDocument({
      live,
      base: cap,
      local: {
        root: cap.documentElement,
        toLive: (n) => toLive.get(n) || null,
      },
      remote,
      identity,
    });
    return {
      html: live.body.innerHTML,
      frame: parse(doc(r)).body.innerHTML,
      survivors: survivors(live.documentElement, ids),
      kinds: kinds(report),
      report,
    };
  };
  return { live, cap, remote, ids, labels, capMap, map, identity, at, merge };
}

/** The same synthetic ids through the pure merge: the live side is a second
 * parse of the capture carrying the receiver's ids. */
function syntheticMerge3(b, r, surgery) {
  const cap = parse(doc(b)),
    live = parse(doc(b)),
    remote = parse(doc(r));
  const store = createIdentityStore("t");
  const capMap = store.exportMap(cap.documentElement, (n) => n);
  const senderStore = createIdentityStore("t");
  const map = senderStore.exportMap(remote.documentElement, (n) => n);
  for (const k of Object.keys(map))
    if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
  if (surgery) surgery(map, capMap);
  const liveIds = importMap(live.documentElement, capMap);
  const localId = (el) =>
    authored(el) || store.idOf(el) || liveIds.get(el) || null;
  return merge3(cap, live, remote, {
    identity: {
      base: localId,
      local: localId,
      remote: { first: authored, map, then: authored },
    },
  });
}

const card = (t) =>
  `<div class="card"><h3>${t}</h3><p>Body text of the card.</p></div>`;
const SYNC_BODY = `<section class="a">${card("One")}${card("Two")}</section><section class="b"></section>`;

const movedPath = (from, to) => (map, capMap) => {
  map[to] = capMap[from];
  map[from] = "t:copy";
  for (const k of Object.keys(map))
    if (k.startsWith(from + ".")) map[k] = "t:copy" + k.slice(from.length);
  for (const k of Object.keys(capMap))
    if (k.startsWith(from + ".")) map[to + k.slice(from.length)] = capMap[k];
};

const permute = (map, capMap) => {
  const one = capMap["1.0.0"];
  for (const k of Object.keys(map)) {
    if (k === "1.0.0" || k.startsWith("1.0.0.")) map[k] = "t:new" + k;
    else if (k === "1.0.1" || k.startsWith("1.0.1."))
      map[k] = k === "1.0.1" ? one : capMap["1.0.0" + k.slice(5)];
  }
};

const copied = (map) => {
  for (const k of Object.keys(map))
    if (k.startsWith("1.1.0")) map[k] = "t:copy" + k.slice(5);
};

const swapIds = (a, b) => (map) => {
  const t = map[a];
  map[a] = map[b];
  map[b] = t;
};

const S_CASES = {
  S1: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One")}</section>`,
    surgery: movedPath("1.0.0", "1.1.0"),
  },
  S2: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One edited")}</section>`,
    surgery: movedPath("1.0.0", "1.1.0"),
  },
  S3: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One")}</section>`,
    surgery: copied,
  },
  S4: { remote: SYNC_BODY, surgery: permute },
};

test("I6-S1 copy left in place, original moved out", async () => {
  const c = cleanSynthetic(SYNC_BODY, S_CASES.S1.remote, S_CASES.S1.surgery);
  const got = await c.merge();
  assert.equal(got.html, got.frame);
  assert.deepEqual(got.kinds, []);
  assert.equal(c.ids.get(c.at("1.1.0")), c.labels.get("1.0.0"));
  assert.equal(c.ids.get(c.at("1.0.0")), undefined);
  assert.equal(got.survivors, "0,1,2,3,N,N,N,N,N,9,10,11,12,13,14,4,5,6,7,8");
});

test("I6-S2 same, moved card edited", async () => {
  const c = cleanSynthetic(SYNC_BODY, S_CASES.S2.remote, S_CASES.S2.surgery);
  const got = await c.merge();
  assert.equal(got.html, got.frame);
  assert.deepEqual(got.kinds, []);
  assert.equal(c.ids.get(c.at("1.1.0")), c.labels.get("1.0.0"));
  assert.equal(c.ids.get(c.at("1.0.0")), undefined);
  assert.ok(c.at("1.1.0").textContent.includes("One edited"));
});

test("I6-S3 original copied elsewhere, nothing moved", async () => {
  const c = cleanSynthetic(SYNC_BODY, S_CASES.S3.remote, S_CASES.S3.surgery);
  const got = await c.merge();
  assert.equal(got.html, got.frame);
  assert.equal(c.ids.get(c.at("1.0.0")), c.labels.get("1.0.0"));
  assert.equal(c.ids.get(c.at("1.0.1")), c.labels.get("1.0.1"));
  assert.ok(got.report.stats.certificationPairs >= 1);
  assert.ok(got.report.stats.certificationVisited > 0);
});

test("I6-S4 sender re-minted one id, the other landed on its sibling", async () => {
  const c = cleanSynthetic(SYNC_BODY, S_CASES.S4.remote, S_CASES.S4.surgery);
  const got = await c.merge();
  assert.equal(got.html, got.frame);
  assert.equal(sig(got.report), "#dec3#m0#r0#d0");
});

const C_CASES = [
  {
    name: "I6-C1 equal id subtree, its inner id copied elsewhere on remote",
    b: `<div data-id="A"><p data-id="x">hello world here</p><p>other text</p></div><div data-id="B"><p>bee text</p></div>`,
    l: `<div data-id="A"><p data-id="x">hello world here</p><p>other text</p></div><div data-id="B"><p>bee text</p></div><p>local new</p>`,
    r: `<div data-id="A"><p data-id="x">hello world here</p><p>other text</p></div><div data-id="B"><p>bee text</p><p data-id="x">hello world here</p></div>`,
    replaced: [],
    exact: {},
    conflicts: [],
  },
  {
    name: "I6-C2 inner id duplicated on base, remote drops the copy",
    b: `<div data-id="A"><p data-id="x">hello world here</p></div><div data-id="B"><p data-id="x">hello world here</p><p>bee text</p></div>`,
    l: `<div data-id="A"><p data-id="x">hello world here</p></div><div data-id="B"><p data-id="x">hello world here</p><p>bee text</p></div><p>local new</p>`,
    r: `<div data-id="A"><p data-id="x">hello world here</p></div><div data-id="B"><p>bee text</p></div>`,
    replaced: ["hello world here"],
    exact: { "hello world here": 1 },
    conflicts: [],
  },
  {
    name: "I6-C3 ids swapped between two equal cards",
    b: `<div data-id="A"><p data-id="x">same text</p></div><div data-id="B"><p data-id="y">same text</p></div>`,
    l: `<div data-id="A"><p data-id="x">same text</p></div><div data-id="B"><p data-id="y">same text</p></div><p>local new</p>`,
    r: `<div data-id="A"><p data-id="y">same text</p></div><div data-id="B"><p data-id="x">same text</p></div>`,
    replaced: [],
    exact: {},
    conflicts: [],
  },
  {
    name: "I6-C4 equal id subtree, remote moved the inner id out (subtree no longer equal)",
    b: `<div data-id="A"><p data-id="x">hello world here</p><p>other text</p></div><div data-id="B"><p>bee text</p></div>`,
    l: `<div data-id="A"><p data-id="x">hello world here</p><p>other text</p></div><div data-id="B"><p>bee text</p></div><p>local new</p>`,
    r: `<div data-id="A"><p>other text</p></div><div data-id="B"><p>bee text</p><p data-id="x">hello world HERE</p></div>`,
    replaced: ["hello world here"],
    exact: { "hello world here": 0 },
    conflicts: [],
  },
  {
    name: "I6-C5 equal id subtree whose id moved to another container (id paired, content equal)",
    b: `<section><div data-id="A"><p>hello world here</p></div></section><aside></aside>`,
    l: `<section><div data-id="A"><p>hello world here</p></div></section><aside></aside><p>local new</p>`,
    r: `<section></section><aside><div data-id="A"><p>hello world here</p></div></aside>`,
    replaced: [],
    exact: {},
    conflicts: [],
  },
];

for (const c of C_CASES) {
  test(c.name, async () => {
    const got = await dirtyLive(c.b, c.l, c.r);
    const out = counts(paras(got.html));
    for (const [t, n] of counts(paras(c.r)))
      assert.ok(
        (out.get(t) || 0) >= n,
        `${c.name}: remote paragraph lost: ${t} in ${got.html}`,
      );
    for (const [t, n] of counts(paras(c.b)))
      if (!c.replaced.includes(t))
        assert.ok(
          (out.get(t) || 0) >= n,
          `${c.name}: base paragraph lost: ${t} in ${got.html}`,
        );
    for (const [t, n] of Object.entries(c.exact))
      assert.equal(out.get(t) || 0, n, `${c.name}: ${t} in ${got.html}`);
    assert.ok(out.has("local new"), `${c.name}: ${got.html}`);
    assert.deepEqual(got.kinds, c.conflicts, `${c.name}: ${got.html}`);
    const clean = await cleanFull(c.b, c.r);
    assert.equal(clean.html, frame(c.r), `${c.name} clean`);
  });
}

const SWAP_BODY = `<main><div class="card"><p>same text here</p></div><div class="card"><p>same text here</p></div></main>`;

test("I6-C6 synthetic ids swapped on two equal cards", async () => {
  const c = cleanSynthetic(SWAP_BODY, SWAP_BODY, swapIds("1.0.0", "1.0.1"));
  const got = await c.merge();
  assert.equal(got.html, got.frame);
  const idAt = (path) => {
    const el = c.at(path);
    const hit = got.report.identities.find(([n]) => n === el);
    return hit ? hit[1] : null;
  };
  assert.equal(idAt("1.0.0"), c.capMap["1.0.1"]);
  assert.equal(idAt("1.0.1"), c.capMap["1.0.0"]);
});

const chain = (n, text) => {
  let html = `<p>${text}</p>`;
  for (let i = n; i >= 1; i--) html = `<div data-id="d${i}">${html}</div>`;
  return html;
};

/** One alignment alone, built as merge.js builds it. */
function alignOnce(baseRoot, sideRoot) {
  const ignored = makeIgnore(undefined, [baseRoot, sideRoot]);
  const analyzer = createAnalyzer({ ignored, ignoreAttribute: () => false });
  const before = steps.certifyVisited;
  align(baseRoot, sideRoot, {
    analyzer,
    baseIndex: indexByIdentity(
      baseRoot,
      defaultIdentity,
      ignored,
      "[id],[data-id],script,head>*",
    ),
    sideIndex: indexByIdentity(
      sideRoot,
      defaultIdentity,
      ignored,
      "[id],[data-id],script,head>*",
    ),
    baseId: defaultIdentity,
    sideId: defaultIdentity,
  });
  return steps.certifyVisited - before;
}

test("I6-B depth chain is linear", async () => {
  // One alignment alone for n = 800: a full merge of the differing chain
  // 800 levels deep sits at merge.js's own recursion limit, so the number
  // the spec asks for is read off `align` directly (as its table says).
  for (const n of [400, 800]) {
    const b = chain(n, "base text"),
      r = chain(n, "remote text");
    // Bottom-up: a walk visits its own div and its inner div, taken as a leaf
    // once the inner pair is certified or refused. The innermost visits its
    // div, its <p> and the text that differs, so 2n + 1 in all.
    const fail = alignOnce(
      parse(doc(b)).documentElement,
      parse(doc(r)).documentElement,
    );
    assert.ok(
      fail <= 2 * (n + 3),
      `n=${n}: the failing alignment visited ${fail} nodes`,
    );
    assert.equal(
      fail,
      2 * n + 1,
      `n=${n}: the failing alignment visited ${fail}`,
    );
    const pass = alignOnce(
      parse(doc(b)).documentElement,
      parse(doc(b)).documentElement,
    );
    assert.equal(
      pass,
      2 * n + 1,
      `n=${n}: the identical alignment visited ${pass}`,
    );
  }

  const b = chain(400, "base text"),
    r = chain(400, "remote text");
  const before = steps.certifyVisited;
  const got = await dirtyLive(b, b, r);
  const delta = steps.certifyVisited - before;
  assert.ok(delta <= 2 * 2 * (400 + 3), `the merge visited ${delta} nodes`);
  assert.equal(delta, 2 * (2 * 400 + 1));
  assert.equal(got.html, frame(r), got.html);
  // The unchanged local side certifies every div; the changed remote side
  // refuses every one.
  assert.equal(got.report.stats.certificationPairs, 400);
  assert.equal(got.report.stats.certificationVisited, delta);

  const same = chain(800, "same text");
  const mark = steps.certifyVisited;
  const sameGot = await dirtyLive(same, same, same);
  assert.equal(sameGot.html, frame(same));
  assert.equal(steps.certifyVisited - mark, 2 * (2 * 800 + 1));
});

const bijection = (A, label) => {
  assert.equal(A.map.size, A.reverse.size, `${label}: map and reverse sizes`);
  for (const [b, s] of A.map)
    assert.equal(A.reverse.get(s), b, `${label}: not an inverse`);
};

test("I6-O one-to-one", () => {
  for (const [name, c] of Object.entries(S_CASES)) {
    const res = syntheticMerge3(SYNC_BODY, c.remote, c.surgery);
    bijection(res.L, `${name} L`);
    bijection(res.R, `${name} R`);
  }
  for (const c of C_CASES) {
    const { res } = mergeBodies(c.b, c.l, c.r);
    bijection(res.L, `${c.name} L`);
    bijection(res.R, `${c.name} R`);
  }
  const res = syntheticMerge3(SWAP_BODY, SWAP_BODY, swapIds("1.0.0", "1.0.1"));
  bijection(res.L, "I6-C6 L");
  bijection(res.R, "I6-C6 R");
});

// E4b2: every refusal condition in Pass 1b's `certify` gets a fixture that
// fails when that condition is removed. The escapes (I6-E) travel in the
// sender's id map rather than in `data-id`: an authored id is an attribute, and
// the walk compares attributes position by position before it ever reads the
// map, so with `data-id` on both sides the pair is refused for the attribute
// and the map check the fixture is meant to pin never runs.

test("I6-E outgoing identity escape", async () => {
  const b = `<div data-id="A"><p>hello world here</p></div><aside></aside>`;
  const r = `<div data-id="A"><p>hello world here</p></div><aside><p>spare text</p></aside>`;
  // The id of the p inside A lands on the p outside A on the remote.
  const escape = (map, capMap) => {
    map["1.0.0"] = "t:new";
    map["1.1.0"] = capMap["1.0.0"];
  };
  const c = cleanSynthetic(b, r, escape);
  const x = c.live.body.children[0].children[0];
  const got = await c.merge();
  // The control is the same two documents with the id left inside A.
  const control = await cleanSynthetic(b, r).merge();
  assert.equal(
    got.report.stats.certificationPairs,
    control.report.stats.certificationPairs - 2,
    `A certified: control ${control.report.stats.certificationPairs}, escaped ${got.report.stats.certificationPairs}`,
  );
  assert.equal(got.html, got.frame);
  assert.equal(
    x.parentElement && x.parentElement.tagName,
    "ASIDE",
    `the escaping live node did not follow the remote: ${got.html}`,
  );
});

test("I6-E incoming identity escape", async () => {
  const b = `<div data-id="A"><p>hello world here</p></div><aside><p>spare text</p></aside>`;
  const r = `<div data-id="A"><p>hello world here</p></div><aside></aside>`;
  // The id of the p outside A pairs to the p inside A on the remote.
  const escape = (map, capMap) => {
    map["1.0.0"] = capMap["1.1.0"];
  };
  const c = cleanSynthetic(b, r, escape);
  const x = c.live.body.children[1].children[0];
  const got = await c.merge();
  const control = await cleanSynthetic(b, r).merge();
  assert.equal(
    got.report.stats.certificationPairs,
    control.report.stats.certificationPairs - 2,
    `A certified: control ${control.report.stats.certificationPairs}, escaped ${got.report.stats.certificationPairs}`,
  );
  assert.equal(got.html, got.frame);
  assert.equal(
    x.parentElement && x.parentElement.tagName,
    "DIV",
    `the escaping live node did not follow the remote: ${got.html}`,
  );
});

test("I6-P internal permutation", async () => {
  const b = `<div data-id="A"><p data-id="x">same text</p><p data-id="y">same text</p></div>`;
  const r = `<div data-id="A"><p data-id="y">same text</p><p data-id="x">same text</p></div>`;
  const got = await dirtyLive(b, b, r);
  const control = await dirtyLive(b, b, b);
  const ids = [...got.live.body.querySelectorAll("p")].map((p) =>
    p.getAttribute("data-id"),
  );
  assert.deepEqual(ids, ["y", "x"], got.html);
  assert.equal(got.html, frame(r));
  // A itself is refused: its two ids are not the positional counterparts, so
  // the children certify as the cross pairs the remote's ids name instead of
  // the subtree, one certificate fewer than the control leaves.
  assert.equal(
    got.report.stats.certificationPairs,
    control.report.stats.certificationPairs - 1,
    `control ${control.report.stats.certificationPairs}, permuted ${got.report.stats.certificationPairs}`,
  );
});

test("I6-U duplicate identity outside the pair", async () => {
  const b = `<div data-id="A"><p data-id="x">hello words</p></div><p>tail</p>`;
  const r = `<div data-id="A"><p data-id="x">hello words</p></div><p data-id="x">hello words</p><p>tail</p>`;
  const got = await dirtyLive(b, b, r);
  // The same documents without the duplicate: the duplicated id identifies
  // nothing, so the remote side drops it from its index and the pair is lost,
  // and there is no conflict either.
  const control = await dirtyLive(b, b, b);
  assert.equal(got.html, frame(r));
  assert.equal(
    got.report.stats.certificationPairs,
    control.report.stats.certificationPairs - 1,
    `control ${control.report.stats.certificationPairs}, duplicated ${got.report.stats.certificationPairs}`,
  );
  assert.deepEqual(got.kinds, []);
  if (reference) {
    const refLive = parse(doc(b));
    const refReport = await reference.mergeDocument({
      live: refLive,
      base: doc(b),
      remote: doc(r),
    });
    assert.equal(refLive.body.innerHTML, got.html);
    assert.deepEqual(kinds(refReport), got.kinds);
  }
});

test("I6-K split text declines", async () => {
  const b = `<div data-id="A"><p>alpha beta</p></div>`;
  const run = async (remote) => {
    const live = parse(doc(b)),
      cap = parse(doc(b));
    const toLive = lockstepMap(cap.documentElement, live.documentElement);
    const ids = tagNodes(live.documentElement);
    const p = live.body.querySelector("p");
    const report = await mergeDocument({
      live,
      base: cap,
      local: {
        root: cap.documentElement,
        toLive: (n) => toLive.get(n) || null,
      },
      remote,
    });
    return {
      html: live.body.innerHTML,
      pairs: report.stats.certificationPairs,
      kept: live.body.querySelector("p") === p,
      survivors: survivors(live.documentElement, ids),
    };
  };
  const split = parse(doc(b));
  split.body.querySelector("p").firstChild.splitText(6);
  const a = await run(split);
  const c = await run(doc(b));
  assert.equal(a.pairs, 0, `the split pair certified ${a.pairs} times`);
  assert.equal(a.html, c.html, `split ${a.html} unsplit ${c.html}`);
  assert.equal(a.survivors, c.survivors, `split ${a.survivors}`);
  assert.ok(a.kept && c.kept, `a live <p> was replaced: ${a.html}`);
});

test("I6-X many failing walks stay linear", async () => {
  // 200 pairs whose walks all fail at their last text node. Each walk visits
  // nine nodes (the div, four p's and four text nodes), so the two alignments
  // visit one node per node of the base body.
  const divs = (tail) =>
    Array.from(
      { length: 200 },
      (_, i) =>
        `<div data-id="d${i}"><p>w1 w2 w3</p><p>w4 w5 w6</p><p>w7 w8 w9</p><p>w10 w11 ${tail}</p></div>`,
    ).join("");
  const b = divs("FINAL"),
    r = divs("final");
  const live = parse(doc(b));
  const divsBefore = [...live.body.children];
  // Every node is walked by at most one pair's walk, plus once as the leaf of
  // the enclosing pair's walk, in each of the two alignments.
  const N = nodeCount(live.body) * 2;
  const report = await mergeDocument({
    live,
    base: doc(b),
    remote: doc(r),
  });
  assert.ok(
    report.stats.certificationVisited <= 2 * N,
    `the merge visited ${report.stats.certificationVisited} nodes`,
  );
  assert.equal(report.stats.certificationVisited, 3600);
  assert.equal(live.body.innerHTML, frame(r), live.body.innerHTML);
  for (const d of divsBefore)
    assert.ok(
      live.body.contains(d),
      `a live <div> was replaced: ${d.outerHTML}`,
    );
});

test("I6-W certification used", async () => {
  const sections = Array.from(
    { length: 50 },
    (_, i) =>
      `<section data-id="s${i}"><h2>title ${i}</h2><p>body ${i} words</p></section>`,
  ).join("");
  const b = sections + `<p>tail</p>`;
  const r = sections + `<p>tail edited</p>`;
  const got = await dirtyLive(b, b, r);
  assert.equal(got.html, frame(r), got.html);
  assert.ok(
    got.report.stats.certificationPairs >= 1,
    `no pair certified: ${got.report.stats.certificationPairs}`,
  );
  const c = cleanSynthetic(b, r);
  const syn = await c.merge();
  assert.equal(syn.html, syn.frame);
  assert.ok(
    syn.report.stats.certificationPairs >= 1,
    `no pair certified: ${syn.report.stats.certificationPairs}`,
  );
  if (reference) {
    const ref = await dirtyLiveWith(reference, b, b, r);
    assert.equal(ref.html, got.html);
    assert.deepEqual(ref.kinds, got.kinds);
    // A second synthetic shape: the same store order mints the same ids, so
    // the two engines' traces compare node for node.
    const rc = cleanSynthetic(b, r);
    const toLive = lockstepMap(rc.cap.documentElement, rc.live.documentElement);
    const refIds = tagNodes(rc.live.documentElement);
    const report = await reference.mergeDocument({
      live: rc.live,
      base: rc.cap,
      local: {
        root: rc.cap.documentElement,
        toLive: (n) => toLive.get(n) || null,
      },
      remote: rc.remote,
      identity: rc.identity,
    });
    assert.equal(rc.live.body.innerHTML, syn.html);
    assert.equal(
      survivors(rc.live.documentElement, refIds),
      syn.survivors,
      "the reference kept different live nodes",
    );
    assert.deepEqual(
      report.identities.map(([el, id]) => [refIds.get(el), id]),
      syn.report.identities.map(([el, id]) => [c.ids.get(el), id]),
      "the reference paired different ids",
    );
  }
});

const tplCard = (t, tpl = "Old") =>
  `<div class="card"><h3>${t}</h3><template><li class="row">${tpl} label</li></template><ul></ul></div>`;

// The four cases of review-probes/echo0.mjs, with their outputs pinned after
// checking each by the rule: the img and the b the local split out of a
// certified li appear once, and no case reports both-moved.
const ECHO_CASES = [
  {
    name: "no ids: L splits li 1, R edits list 2 (seed 3135 shape)",
    b: `<ul><li>w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li>w5</li><li><img src="i14.png"> w9</li></ul><ul><li>w15 <b>w19</b></li></ul>`,
    l: `<ul><li>w0</li><li>w1</li><li><img src="i4.png"> <b>w3</b> w2</li><li>w5</li><li><img src="i14.png"> w9</li></ul><ul><li>w15 <b>w19</b></li></ul>`,
    r: `<ul><li>w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li>w5</li><li>w9</li></ul><ul><li>w15 <img src="i14.png"> <b>w19</b></li></ul>`,
    pairs: 0,
    out: `<ul><li>w0</li><li>w1</li><li><img src="i4.png"> <b>w3</b> w2</li><li>w5</li><li>w9</li></ul><ul><li>w15 <img src="i14.png"> <b>w19</b></li></ul>`,
  },
  {
    name: "ids as seed 3135",
    b: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li data-id="b2">w5</li><li data-id="b3"><img src="i14.png"> w9</li></ul><ul data-id="b4"><li data-id="b5">w15 <b>w19</b></li></ul>`,
    l: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li><li data-id="b2">w5</li><li data-id="b3"><img src="i14.png"> w9</li></ul><ul data-id="b4"><li data-id="b5">w15 <b>w19</b></li></ul>`,
    r: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li data-id="b2">w5</li><li data-id="b3">w9</li></ul><ul data-id="b4"><li data-id="b5">w15 <img src="i14.png"> <b>w19</b></li></ul>`,
    pairs: 6,
    out: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li><li data-id="b2">w5</li><li data-id="b3">w9</li></ul><ul data-id="b4"><li data-id="b5">w15 <img src="i14.png"> <b>w19</b></li></ul>`,
  },
  {
    name: "ids, R only removes img from b3",
    b: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li data-id="b3"><img src="i14.png"> w9</li></ul>`,
    l: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li><li data-id="b3"><img src="i14.png"> w9</li></ul>`,
    r: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li><li data-id="b3">w9</li></ul>`,
    pairs: 2,
    out: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li><li data-id="b3">w9</li></ul>`,
  },
  {
    name: "ids, R only inserts img into b5",
    b: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li></ul><ul data-id="b4"><li data-id="b5">w15 <b>w19</b></li></ul>`,
    l: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li></ul><ul data-id="b4"><li data-id="b5">w15 <b>w19</b></li></ul>`,
    r: `<ul data-id="b0"><li data-id="b1">w0 w1 <img src="i4.png"> <b>w3</b> w2</li></ul><ul data-id="b4"><li data-id="b5">w15 <img src="i14.png"> <b>w19</b></li></ul>`,
    pairs: 4,
    out: `<ul data-id="b0"><li data-id="b1">w0</li><li data-id="b7">w1</li><li data-id="b6"><img src="i4.png"> <b>w3</b> w2</li></ul><ul data-id="b4"><li data-id="b5">w15 <img src="i14.png"> <b>w19</b></li></ul>`,
  },
];

for (const c of ECHO_CASES)
  test(`I6-Q eager completion under a certified pair: ${c.name}`, async () => {
    // A no-op hook makes the merge descend into the certified subtree, which
    // is what reads the pairs eager completion under a certified pair leaves.
    const pure = merge3(parse(doc(c.b)), parse(doc(c.l)), parse(doc(c.r)), {
      hooks: { beforeNodeMorphed: () => {} },
    });
    const got = await dirtyLive(c.b, c.l, c.r);
    assert.equal(pure.doc.body.innerHTML, c.out);
    assert.equal(got.html, c.out);
    for (const html of [pure.doc.body.innerHTML, got.html]) {
      for (const needle of [
        `src="i4.png"`,
        `src="i14.png"`,
        `<b>w3</b>`,
        `<b>w19</b>`,
      ])
        assert.ok(
          html.split(needle).length - 1 <= 1,
          `${needle} twice: ${html}`,
        );
    }
    for (const rep of [pure, got.report])
      assert.ok(
        !kinds(rep).includes("structure:both-moved"),
        `${c.name}: ${kinds(rep).join("|")}`,
      );
    assert.equal(got.report.stats.certificationPairs, c.pairs);
  });

// The ten cross-echo cases of review-probes/crossecho.mjs and crossecho2.mjs:
// both sides insert the same element (an echo) into a container of their own.
// Each output is pinned after checking it by the rule: every block of base,
// local and remote appears as often as the merge rules say, each side's insert
// into a different identified container is kept with no both-moved, and the two
// id-less-container cases and "telling 3 words" keep the echo heuristic's
// behaviour (finding (c) of deep-fable-A.md) and are marked as such.
const X_B = `<section><div id="b"><p>one</p></div></section><div id="c"><p>two</p></div>`;
const X_H = `<section><div id="b"><p>one</p><hr></div></section><div id="c"><p>two</p></div>`;
const X_R = `<section><div id="b"><p>one</p></div></section><div id="c"><p>two</p><hr></div>`;
const X_HD = X_H.replace("<hr>", "<p>Done</p>"),
  X_RD = X_R.replace("<hr>", "<p>Done</p>");

const CROSS_ECHO_CASES = [
  {
    name: "pure hr",
    b: X_B,
    l: X_H,
    r: X_R,
    out: `<section><div id="b"><p></p><hr></div></section><div id="c"><p></p><hr></div>`,
    conflicts: [],
  },
  {
    name: "pure hr noSkip",
    b: X_B,
    l: X_H,
    r: X_R,
    hooks: true,
    out: `<section><div id="b"><p>one</p><hr></div></section><div id="c"><p>two</p><hr></div>`,
    conflicts: [],
  },
  {
    name: "dirty hr",
    b: X_B,
    l: X_H,
    r: X_R,
    dirty: true,
    out: `<section><div id="b"><p>one</p><hr></div></section><div id="c"><p>two</p><hr></div>`,
    conflicts: [],
  },
  {
    name: "pure Done",
    b: X_B,
    l: X_HD,
    r: X_RD,
    out: `<section><div id="b"><p></p><p>Done</p></div></section><div id="c"><p></p><p>Done</p></div>`,
    conflicts: [],
  },
  {
    name: "dirty Done",
    b: X_B,
    l: X_HD,
    r: X_RD,
    dirty: true,
    out: `<section><div id="b"><p>one</p><p>Done</p></div></section><div id="c"><p>two</p><p>Done</p></div>`,
    conflicts: [],
  },
  {
    name: "no-id containers",
    b: `<div class="b"><p>one</p></div><div class="c"><p>two</p></div>`,
    l: `<div class="b"><p>one</p><hr></div><div class="c"><p>two</p></div>`,
    r: `<div class="b"><p>one</p></div><div class="c"><p>two</p><hr></div>`,
    dirty: true,
    out: `<div class="b"><p>one</p><hr></div><div class="c"><p>two</p><hr></div>`,
    conflicts: [],
  },
  {
    name: "id containers top level",
    b: `<div id="b"><p>one</p></div><div id="c"><p>two</p></div>`,
    l: `<div id="b"><p>one</p><hr></div><div id="c"><p>two</p></div>`,
    r: `<div id="b"><p>one</p></div><div id="c"><p>two</p><hr></div>`,
    dirty: true,
    out: `<div id="b"><p>one</p><hr></div><div id="c"><p>two</p><hr></div>`,
    conflicts: [],
  },
  {
    name: "id b under section, c no id",
    b: `<section><div id="b"><p>one</p></div></section><div class="c"><p>two</p></div>`,
    l: `<section><div id="b"><p>one</p><hr></div></section><div class="c"><p>two</p></div>`,
    r: `<section><div id="b"><p>one</p></div></section><div class="c"><p>two</p><hr></div>`,
    dirty: true,
    out: `<section><div id="b"><p>one</p><hr></div></section><div class="c"><p>two</p><hr></div>`,
    conflicts: [],
  },
  {
    name: "both id'd under sections",
    b: `<section><div id="b"><p>one</p></div></section><section><div id="c"><p>two</p></div></section>`,
    l: `<section><div id="b"><p>one</p><hr></div></section><section><div id="c"><p>two</p></div></section>`,
    r: `<section><div id="b"><p>one</p></div></section><section><div id="c"><p>two</p><hr></div></section>`,
    dirty: true,
    out: `<section><div id="b"><p>one</p><hr></div></section><section><div id="c"><p>two</p><hr></div></section>`,
    conflicts: [],
  },
  {
    name: "telling 3 words (known limitation: echo heuristic)",
    b: X_B,
    l: `<section><div id="b"><p>one</p><p>buy more milk</p></div></section><div id="c"><p>two</p></div>`,
    r: `<section><div id="b"><p>one</p></div></section><div id="c"><p>two</p><p>buy more milk</p></div>`,
    dirty: true,
    out: `<section><div id="b"><p>one</p></div></section><div id="c"><p>two</p><p>buy more milk</p></div>`,
    conflicts: ["structure:both-moved"],
  },
];

for (const c of CROSS_ECHO_CASES)
  test(`I6-X cross-echo ${c.name}`, async () => {
    if (c.dirty) {
      const got = await dirtyLive(c.b, c.l, c.r);
      assert.equal(got.html, c.out, c.name);
      assert.deepEqual(got.kinds, c.conflicts, c.name);
      return;
    }
    const opts = c.hooks ? { hooks: { beforeNodeMorphed: () => {} } } : {};
    const res = merge3(parse(doc(c.b)), parse(doc(c.l)), parse(doc(c.r)), opts);
    assert.equal(res.doc.body.innerHTML, c.out, c.name);
    assert.deepEqual(kinds(res), c.conflicts, c.name);
  });

const TPL_CASES = [
  {
    name: "I6-T1 template content under identity: id-less template, content changed",
    b: `<template><p>a</p></template><p>x</p>`,
    r: `<template><p>b</p></template><p>x</p>`,
  },
  {
    name: "I6-T2 template content under identity: id'd template, content changed",
    b: `<template id="t"><p>a</p></template><p>x</p>`,
    r: `<template id="t"><p>b</p></template><p>x</p>`,
  },
  {
    name: "I6-T3 template content under identity: id'd div holding an id-less template",
    b: `<div id="d"><template><p>a</p></template></div><p>x</p>`,
    r: `<div id="d"><template><p>b</p></template></div><p>x</p>`,
  },
  {
    name: "I6-T4 template content under identity: five identical cards, the third changes",
    b: tplCard("Same").repeat(5),
    r:
      tplCard("Same").repeat(2) +
      tplCard("Same", "New") +
      tplCard("Same").repeat(2),
  },
  {
    name: "I6-T5 template content under identity: template unchanged, sibling text changed",
    b: `<div><template><p>a</p></template><p>x</p></div>`,
    r: `<div><template><p>a</p></template><p>y</p></div>`,
    template: true,
  },
  {
    name: "I6-T6 template content under identity: template inside template, inner changed",
    b: `<template><div><template><p>a</p></template></div></template><p>x</p>`,
    r: `<template><div><template><p>b</p></template></div></template><p>x</p>`,
  },
];

const tplText = (html) =>
  [...parse(doc(html)).querySelectorAll("template")]
    .map((t) => t.innerHTML)
    .join(" | ");

/** The elements a merge sees under `root`, template content included. */
const logicalKids = (el) =>
  el.tagName === "TEMPLATE" && el.content ? el.content.children : el.children;

function logicalElements(root) {
  const out = [];
  const visit = (el) => {
    out.push(el);
    for (const k of logicalKids(el)) visit(k);
  };
  visit(root);
  return out;
}

/** Number every element of the base in document order and hand the same ids to
 * the corresponding elements of local and remote. */
function tagCase(b, l, r) {
  const docs = [b, l, r].map((html) => parse(doc(html)));
  const n = logicalElements(docs[0].documentElement).length;
  for (const d of docs) {
    const els = logicalElements(d.documentElement);
    assert.equal(els.length, n, "the three documents hold different shapes");
    els.forEach((el, i) => el.setAttribute("data-id", `t${i}`));
  }
  return docs.map((d) => d.body.innerHTML);
}

/** The dirty shape with the live <template> kept, so a case can tell whether
 * the merge reused it. */
async function dirtyTemplate(b, l, r) {
  const live = parse(doc(l));
  const template = live.body.querySelector("template");
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  return {
    live,
    template,
    html: live.body.innerHTML,
    kinds: kinds(report),
  };
}

/** The clean shape, same idea. */
async function cleanTemplate(b, r) {
  const live = parse(doc(b)),
    cap = parse(doc(b));
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const template = live.body.querySelector("template");
  const report = await mergeDocument({
    live,
    base: cap,
    local: {
      root: cap.documentElement,
      toLive: (n) => toLive.get(n) || null,
    },
    remote: doc(r),
  });
  return {
    live,
    template,
    html: live.body.innerHTML,
    kinds: kinds(report),
  };
}

for (const c of TPL_CASES)
  test(c.name, async () => {
    const local = c.b
      .replace("<p>x</p>", "<p>x LOCAL</p>")
      .replace("<h3>Same</h3>", "<h3>Same LOCAL</h3>");
    const [b, l, r] = tagCase(c.b, local, c.r);
    const want = tplText(r);
    const dirty = await dirtyTemplate(b, l, r);
    const clean = await cleanTemplate(b, r);
    for (const got of [dirty, clean]) {
      assert.equal(tplText(got.html), want, got.html);
      if (c.template)
        assert.equal(
          got.live.body.querySelector("template"),
          got.template,
          `the template lost its live node: ${got.html}`,
        );
    }
    assert.deepEqual(clean.kinds, [], clean.kinds.join("|"));
  });

/** Every node under an element, text nodes and comments included. */
function nodeCount(el) {
  let n = 0;
  const walk = (x) => {
    for (const c of x.childNodes) {
      n++;
      if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  return n;
}

test("I6-V identified wrapper certifies its cards", async () => {
  // One id'd wrapper around 400 id'd cards: bottom-up certification refuses
  // nothing for the wrapper's sake and certifies every unchanged card.
  const cards = Array.from(
    { length: 400 },
    (_, i) =>
      `<section data-id="c${i}"><h2>title ${i}</h2><p>body ${i} words here</p></section>`,
  ).join("");
  const b = `<div id="app">${cards}</div>`;
  const r = b.replace("body 399 words here", "body 399 edited here");
  const live = parse(doc(b));
  const sections = [...live.body.querySelectorAll("section")];
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  assert.equal(live.body.innerHTML, frame(r), live.body.innerHTML);
  assert.ok(
    report.stats.certificationPairs >= 2 * 399,
    `too few pairs certified: ${report.stats.certificationPairs}`,
  );
  // The 400 cards of the unchanged local alignment, the 399 unchanged cards
  // of the remote one and the wrapper itself.
  assert.equal(report.stats.certificationPairs, 800);
  for (const s of sections)
    assert.ok(
      live.body.contains(s),
      `a live <section> was replaced: ${s.outerHTML}`,
    );
});

test("I6-F wide fanout under a deep stem", async () => {
  // A deep id'd stem around one id'd section with 1600 id'd children: the
  // refused stem and section must not reschedule the wide fanout for every
  // ancestor above them.
  let stem = `<section data-id="w"><p>changed</p>${Array.from(
    { length: 1600 },
    (_, j) => `<i data-id="i${j}"></i>`,
  ).join("")}</section>`;
  for (let k = 40; k >= 1; k--) stem = `<div data-id="s${k}">${stem}</div>`;
  const b = stem;
  const r = stem.replace("<p>changed</p>", "<p>CHANGED</p>");
  const N = nodeCount(parse(doc(b)).body);
  const before = steps.certifyVisited,
    beforeScheduled = steps.certifyScheduled;
  const got = await dirtyLive(b, b, r);
  const visited = steps.certifyVisited - before,
    scheduled = steps.certifyScheduled - beforeScheduled;
  assert.equal(got.html, frame(r), got.html);
  assert.ok(visited <= 2 * 2 * N, `visited ${visited} nodes`);
  assert.ok(scheduled <= 2 * 2 * N, `scheduled ${scheduled} children`);
  assert.equal(visited, 4966);
  assert.equal(scheduled, 3284);
});

/** The E4 review's context-dependent `ignore` shapes: an identity pair moved
 * across the ignoring boundary. Pass 1b must refuse the pair, so the raw walk
 * and the unitsOf lists completion reads agree. Each expected value is the
 * pre-E4b1 reference engine's on the same inputs. */
const IGNORE_CASES = [
  {
    name: "I6-G frozen: A moved into the ignoring container",
    b: `<div data-id="A"><p>x one</p><span>keep</span></div><section class="frozen"></section>`,
    l: `<div data-id="A"><p>x one</p><span>keep LOCAL</span></div><section class="frozen"></section>`,
    r: `<section class="frozen"><div data-id="A"><p>x one</p><span>keep</span></div></section>`,
    ignore: (el) => el.matches(".frozen p"),
    out: `<section class="frozen"><div data-id="A"><span>keep LOCAL</span></div></section>`,
    conflicts: [],
  },
  {
    name: "I6-G aside: A moved into the ignoring container",
    b: `<section><div data-id="A"><p>first words</p><p data-id="y">second words</p><!--tail--></div></section><aside></aside>`,
    l: `<section><div data-id="A"><p>first LOCAL words</p><p data-id="y">second words</p><!--tail--></div></section><aside></aside>`,
    r: `<section></section><aside><div data-id="A"><p>first words</p><p data-id="y">second words</p><!--tail--></div></aside>`,
    ignore: (el) => el.matches("aside p:not([data-id])"),
    out: `<section></section><aside><div data-id="A"><p data-id="y">second words</p><!--tail--></div></aside>`,
    conflicts: ["text:"],
  },
  {
    name: "I6-G aside with whitespace: A moved into the ignoring container",
    b: `<section><div data-id="A"><p>first words</p> <p data-id="y">second words</p><!--tail--></div></section><aside></aside>`,
    l: `<section><div data-id="A"><p>first words</p> <p data-id="y">second words</p><!--tail--></div></section><aside></aside>`,
    r: `<section></section><aside><div data-id="A"><p>first words</p> <p data-id="y">second words</p><!--tail--></div></aside>`,
    ignore: (el) => el.matches("aside p:not([data-id])"),
    out: `<section></section><aside><div data-id="A"> <p data-id="y">second words</p><!--tail--></div></aside>`,
    conflicts: [],
  },
];

for (const c of IGNORE_CASES)
  test(c.name, async () => {
    const got = await dirtyLive(c.b, c.l, c.r, { ignore: c.ignore });
    assert.equal(got.html, c.out, got.html);
    assert.deepEqual(got.kinds, c.conflicts, c.name);
    // A no-op hook forces the merge to descend, as the differential's pure
    // shape does: without one the pure output leaves an unchanged subtree to
    // apply and carries no children for it.
    const res = merge3(parse(doc(c.b)), parse(doc(c.l)), parse(doc(c.r)), {
      ignore: c.ignore,
      hooks: { beforeNodeMorphed: () => {} },
    });
    assert.equal(res.doc.body.innerHTML, c.out, c.name);
    assert.deepEqual(kinds(res), c.conflicts, c.name);
    const plain = merge3(parse(doc(c.b)), parse(doc(c.l)), parse(doc(c.r)), {
      ignore: c.ignore,
    });
    bijection(res.L, `${c.name} L`);
    bijection(res.R, `${c.name} R`);
    bijection(plain.L, `${c.name} plain L`);
    bijection(plain.R, `${c.name} plain R`);
  });
