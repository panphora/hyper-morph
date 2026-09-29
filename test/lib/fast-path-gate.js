import { parse, doc } from "../node/lib/dom.js";
import { generate, setIdMode, idMode } from "./structure-fuzz.js";
import {
  labelTree,
  finalTree,
  destinations,
  nameOf,
  lockstepMap,
  conflictList,
  decisionList,
  recoveryList,
} from "./differential-observe.js";

// The fast path's equivalence gate. One input merges twice in ClayJS's clean
// shape (a fresh capture of the live document as base and local, mapped to
// the live nodes), with `fastPath: false` as the reference and with
// `fastPath: true`, and each run is observed through everything a merge can
// change or report. The fast path may do less work, so the counters that
// measure work are left out of the stats it is compared on.

export const WORK_COUNTERS = new Set([
  "lazyTwins",
  "hashRejected",
  "certificationPairs",
  "certificationVisited",
]);
export const FIELDS = [
  "html",
  "nodeDestinations",
  "identities",
  "formState",
  "applied",
  "conflicts",
  "decisions",
  "moved",
  "replaced",
  "localDiverged",
  "recovery",
  "stats",
  "warnings",
  "calls",
];

const authoredAttr = (el) =>
  el.getAttribute("data-id") || el.getAttribute("id") || null;

function countAuthored(root) {
  const counts = new Map();
  const visit = (el) => {
    const id = authoredAttr(el);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
    const kids =
      el.localName === "template" && el.content
        ? el.content.children
        : el.children;
    for (const kid of kids) visit(kid);
  };
  const tops =
    root.nodeType === 9
      ? [root.documentElement]
      : root.nodeType === 11
        ? root.children
        : [root];
  for (const top of tops) if (top && top.nodeType === 1) visit(top);
  return counts;
}

/** ClayJS's authored identity: an authored id, only where it is unique. */
export function uniqueAuthored() {
  const memo = new WeakMap();
  return (el) => {
    const id = authoredAttr(el);
    if (!id) return null;
    const root = el.getRootNode();
    let counts = memo.get(root);
    if (!counts) memo.set(root, (counts = countAuthored(root)));
    return counts.get(id) === 1 ? id : null;
  };
}

/** ClayJS's clean-branch identity spec. */
export function clayIdentity(store, toLive, map) {
  const authored = uniqueAuthored();
  const local = (el) => authored(el) || store.idOf(toLive(el) || el) || null;
  return {
    base: local,
    local,
    remote: { first: authored, map, then: authored },
  };
}

/** Ids that follow the generator's model nodes: a node's own model id, or
 * the nearest model ancestor's plus the path below it. */
function operationIds(root, modelOf) {
  const ids = new Map();
  const visit = (el, anchor, path) => {
    const m = modelOf(el);
    const id = m ? "op:" + m : anchor + "/" + path;
    ids.set(el, id);
    const kids = el.children;
    for (let i = 0; i < kids.length; i++)
      visit(kids[i], m ? id : anchor, m ? String(i) : path + "." + i);
  };
  visit(root, "op:root", "0");
  return ids;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function operationsIdentity(E, ctx) {
  const store = E.createIdentityStore("t");
  for (const [el, id] of operationIds(ctx.cap.documentElement, ctx.model.base))
    store.adopt(ctx.toLive(el), id);
  const sender = E.createIdentityStore("s");
  for (const [el, id] of operationIds(
    ctx.remote.documentElement,
    ctx.model.remote,
  ))
    sender.adopt(el, id);
  const map = sender.exportMap(ctx.remote.documentElement, (n) => n);
  return { store, map };
}

// A sender map changed the way a user's operations change identity without
// changing bytes: two elements trade ids, an id is copied onto a second
// element, or an element gets a new one.
function perturb(map, seed) {
  const r = rng(seed * 7919 + 17);
  const keys = Object.keys(map).filter((k) => k !== "~" && k !== "^");
  if (keys.length < 2) return;
  const a = keys[Math.floor(r() * keys.length)],
    b = keys[Math.floor(r() * keys.length)];
  const k = r();
  if (k < 0.4) [map[a], map[b]] = [map[b], map[a]];
  else if (k < 0.7) map[b] = map[a];
  else map[a] = "s:fresh";
}

/** ClayJS's synthetic identity with the sender's ids converged by path,
 * then changed by `surgery(map, capMap)` when given. */
export const syntheticWith =
  (surgery) =>
  (E, { cap, remote, toLive }) => {
    const store = E.createIdentityStore("t");
    const capMap = store.exportMap(cap.documentElement, toLive);
    const map = E.createIdentityStore("s").exportMap(
      remote.documentElement,
      (n) => n,
    );
    for (const k of Object.keys(map))
      if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
    if (surgery) surgery(map, capMap);
    return clayIdentity(store, toLive, map);
  };

export const VARIANTS = {
  authored: null,
  synthetic: syntheticWith(null),
  operations: (E, ctx) => {
    const { store, map } = operationsIdentity(E, ctx);
    return clayIdentity(store, ctx.toLive, map);
  },
  perturbed: (E, ctx) => {
    const { store, map } = operationsIdentity(E, ctx);
    perturb(map, ctx.seed);
    return clayIdentity(store, ctx.toLive, map);
  },
};

/** The page around the generated body: static siblings with ids, form
 * controls holding runtime values, an ignored and a remote-wins region, a
 * head, and a JSON merge tag. The ignored region differs on every third
 * seed. */
const NESTED_HEAD = `<meta charset="utf-8"><title>gate</title><link rel="stylesheet" href="/gate.css">`;
function nested(body, seed, side) {
  const ignoredText = side === "r" && seed % 3 === 0 ? "theirs" : "mine";
  return doc(
    `<header id="top"><nav><a href="#a">A</a> <a href="#b">B</a></nav></header>` +
      `<main><section class="static" data-id="static"><h2>Static</h2><p>one two</p>` +
      `<input name="q" value="v"><textarea name="t">t</textarea>` +
      `<select name="s"><option>a</option><option selected>b</option></select>` +
      `<script type="application/json" merge="cfg">{"a":1}</script></section>` +
      `<section class="fuzz">${body}</section></main>` +
      `<aside data-ignore><p>${ignoredText}</p></aside>` +
      `<div data-wins><p>wins</p></div><footer><p>foot</p></footer>`,
    NESTED_HEAD,
  );
}

const nestedOptions = (calls) => ({
  ignore: (el) => el.hasAttribute("data-ignore"),
  remoteWins: (el) => el.hasAttribute("data-wins"),
  ignoreAttribute: (el, name) => !el.parentElement && name === "data-tab",
  scripts: { execute: false },
  hooks: {
    beforeAttributeUpdated: (name, el, action) => {
      calls.push(["attr", el, name, action]);
      return el.tagName === "HTML" && name === "data-tab" ? false : undefined;
    },
    beforeNodeAdded: (n) => {
      calls.push(["add", n.nodeType === 1 ? n.tagName : n.nodeType]);
    },
    beforeNodeRemoved: (n) => {
      calls.push(["remove", n]);
    },
  },
});

const prepareNested = (live) => {
  const input = live.querySelector('input[name="q"]');
  if (input) input.value = "RUNTIME";
  const area = live.querySelector('textarea[name="t"]');
  if (area) area.value = "typed";
};

/** The live page differs from its capture: a node and an attribute only the
 * live head holds, a node only the live page holds outside the branch (in
 * the header), and with `captureOnly` a node only the capture holds (the
 * footer's paragraph, which a synthetic identity cannot name, so those
 * variants take the full path). */
const prepareLive = (live, captureOnly) => {
  prepareNested(live);
  const style = live.createElement("style");
  style.textContent = "body{color:red}";
  live.head.append(style);
  live.head.setAttribute("data-runtime", "1");
  if (captureOnly) live.body.lastElementChild.lastElementChild.remove();
  const p = live.createElement("p");
  p.textContent = "live only";
  live.body.firstElementChild.append(p);
};

/** Model ids for the elements of a document built from `html`, read from
 * the same document built with every model id written out (id mode 1). */
function modelOf(html, allIds) {
  const a = parse(html),
    b = parse(allIds);
  const ids = new Map();
  const walk = (x, y) => {
    const m = y.getAttribute("data-id");
    if (m) ids.set(x, m);
    for (let i = 0; i < x.children.length && i < y.children.length; i++)
      walk(x.children[i], y.children[i]);
  };
  walk(a.documentElement, b.documentElement);
  return { doc: a, ids };
}

/** The gate's inputs for one seed in the current id mode; every third seed
 * (one the ignored region leaves alone) also merges the nested page into a
 * live page that differs from its capture. */
export function cases(seed) {
  const mode = idMode;
  const g = generate(seed);
  setIdMode(1);
  const all = generate(seed);
  setIdMode(mode);
  const nestedCase = {
    name: "nested",
    b: nested(g.b, seed, "b"),
    r: nested(g.r, seed, "r"),
    bAll: nested(all.b, seed, "b"),
    rAll: nested(all.r, seed, "r"),
    seed,
    options: nestedOptions,
    prepare: prepareNested,
  };
  const out = [
    {
      name: "flat",
      b: doc(g.b),
      r: doc(g.r),
      bAll: doc(all.b),
      rAll: doc(all.r),
      seed,
      options: () => ({ scripts: { execute: false } }),
    },
    nestedCase,
  ];
  if (seed % 3 === 1)
    out.push({
      ...nestedCase,
      name: "live",
      prepare: (live) => prepareLive(live, seed % 2 === 0),
    });
  return out;
}

const projectApplied = (a, name) =>
  JSON.stringify(
    Object.keys(a)
      .sort()
      .map((k) => [
        k,
        a[k] && typeof a[k] === "object" && a[k].nodeType
          ? name(a[k])
          : a[k] === undefined
            ? null
            : a[k],
      ]),
  );

/** One clean-shape merge of `input`, observed. */
export async function observeClean(E, input, variant, fastPath) {
  const base = modelOf(input.b, input.bAll);
  const cap = base.doc;
  const live = parse(input.b);
  const remoteModel = modelOf(input.r, input.rAll);
  const remote = remoteModel.doc;
  if (input.prepare) input.prepare(live);
  const label = labelTree(live.documentElement);
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (n) => lock.get(n) || null;
  const identity = variant
    ? variant(E, {
        cap,
        remote,
        toLive,
        seed: input.seed,
        model: {
          base: (el) => base.ids.get(el) || null,
          remote: (el) => remoteModel.ids.get(el) || null,
        },
      })
    : undefined;
  const calls = [];
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  let report;
  try {
    report = await E.mergeDocument({
      live,
      base: cap,
      local: { root: cap.documentElement, toLive },
      remote,
      ...(identity ? { identity } : {}),
      ...input.options(calls),
      fastPath,
    });
  } finally {
    console.warn = warn;
  }
  const final = finalTree(live.documentElement);
  const name = (n) => nameOf(label, final, n);
  const stats = {};
  for (const [k, v] of Object.entries(report.stats))
    if (!k.startsWith("fastPath") && !WORK_COUNTERS.has(k)) stats[k] = v;
  return {
    html: "<!DOCTYPE html>" + live.documentElement.outerHTML,
    nodeDestinations: destinations(label, final),
    identities: report.identities.map(([el, id]) => [name(el), id]),
    formState: [...live.querySelectorAll("input,textarea,select,option")].map(
      (el) => [name(el), el.value, !!el.checked, !!el.selected],
    ),
    applied: report.applied.map((a) => projectApplied(a, name)),
    conflicts: conflictList(report.conflicts, label, final),
    decisions: decisionList(report.decisions, label, final),
    moved: report.moved.map(name),
    replaced: report.replaced.map(name),
    localDiverged: report.localDiverged,
    recovery: recoveryList(report.conflicts, label, final),
    stats,
    warnings,
    calls: calls.map((c) =>
      c.map((x) => (x && typeof x === "object" && x.nodeType ? name(x) : x)),
    ),
    fast: report.stats,
  };
}

/** The fields two observations differ in. */
export function differences(a, b) {
  return FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}
