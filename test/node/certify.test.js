// Pass 1b: an identity pair whose two subtrees are equal, and whose every
// identity pairing inside them is the positional counterpart, is certified
// identical in one linear walk under a budget, and everything below it is
// paired eagerly. The shape that must stay correct is an equal-looking
// identity pair whose inner element moved out with a copy left in place.
import { test } from "node:test";
import assert from "node:assert/strict";
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
async function dirtyLive(b, l, r) {
  const live = parse(doc(l));
  const report = await mergeDocument({ live, base: doc(b), remote: doc(r) });
  return {
    live,
    html: live.body.innerHTML,
    kinds: kinds(report),
    report,
  };
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
  assert.equal(got.report.stats.certificationBudgetExhausted, 0);
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

test("I6-B depth chain budget", async () => {
  // One alignment alone for n = 800: a full merge of the differing chain
  // 800 levels deep sits at merge.js's own recursion limit, so the number
  // the spec asks for is read off `align` directly (as its table says).
  for (const n of [400, 800]) {
    const b = chain(n, "base text"),
      r = chain(n, "remote text");
    const fail = alignOnce(
      parse(doc(b)).documentElement,
      parse(doc(r)).documentElement,
    );
    // The walk that runs out of budget visits one node past `budget.left`
    // before it stops, so a failing alignment visits 8 * pairs + 64 + 1.
    assert.ok(
      fail <= 8 * n + 65,
      `n=${n}: the failing alignment visited ${fail} nodes`,
    );
    // The n divs, the <p> and its text node: the walk certifies at the root
    // and stops there, everything below is covered.
    const pass = alignOnce(
      parse(doc(b)).documentElement,
      parse(doc(b)).documentElement,
    );
    assert.equal(
      pass,
      n + 2,
      `n=${n}: the identical alignment visited ${pass}`,
    );
    assert.ok(
      fail + pass <= 2 * (8 * n + 64),
      `n=${n}: two alignments visited ${fail + pass} nodes`,
    );
  }

  const b = chain(400, "base text"),
    r = chain(400, "remote text");
  const before = steps.certifyVisited;
  const got = await dirtyLive(b, b, r);
  const delta = steps.certifyVisited - before;
  assert.ok(delta <= 2 * (8 * 400 + 64), `the merge visited ${delta} nodes`);
  assert.equal(got.html, frame(r), got.html);
  assert.equal(got.report.stats.certificationPairs, 1);
  assert.equal(got.report.stats.certificationVisited, delta);
  assert.equal(got.report.stats.certificationBudgetExhausted, 1);

  const same = chain(800, "same text");
  const mark = steps.certifyVisited;
  const sameGot = await dirtyLive(same, same, same);
  assert.equal(sameGot.html, frame(same));
  assert.equal(steps.certifyVisited - mark, 2 * (800 + 2));
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
