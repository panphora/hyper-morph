import { parse, doc } from "../../node/lib/dom.js";
import { uniqueAuthored } from "../../lib/fast-path-gate.js";
import {
  labelTree,
  finalTree,
  destinations,
  identityList,
  nodeList,
  conflictList,
  decisionList,
  lockstepMap,
} from "../../lib/differential-observe.js";

// One counterexample case, run through one engine. A case is data: three
// HTML bodies (base, local, remote), the API and shape that merge them, the
// identity model, and options. Synthetic ids are written inline as a `sid`
// attribute, read here and stripped before the merge, so a hunter never
// counts preorder indexes and a shrinker keeps each id on its element.

export const SID = "sid";
export const SHAPES = ["clean", "dirty", "pure", "element"];
export const IDENTITIES = ["default", "authored", "clay", "plain"];
/** Properties whose live value a merge must not silently overwrite: the
 * form state a case can type, per tag. */
const FORM_PROPS = {
  INPUT: ["value", "checked", "disabled", "indeterminate"],
  TEXTAREA: ["value", "disabled", "textContent"],
  OPTION: ["selected", "disabled"],
  SELECT: ["value", "disabled"],
};

const WORK = new Set([
  "lazyTwins",
  "hashRejected",
  "certificationPairs",
  "certificationVisited",
]);

export function normalize(c) {
  const n = {
    shape: c.shape || "dirty",
    identity: c.identity || "default",
    head: c.head ?? "",
    base: c.base,
    local: c.local ?? c.base,
    remote: c.remote,
    options: c.options || {},
    live: c.live || null,
    expect: c.expect || null,
    meta: c.meta || {},
    requires: c.requires || [],
  };
  n.heads = {
    base: c.heads?.base ?? n.head,
    local: c.heads?.local ?? n.head,
    remote: c.heads?.remote ?? n.head,
  };
  if (!SHAPES.includes(n.shape)) throw new Error(`unknown shape ${n.shape}`);
  if (!IDENTITIES.includes(n.identity))
    throw new Error(`unknown identity ${n.identity}`);
  for (const k of ["base", "remote"])
    if (typeof n[k] !== "string") throw new Error(`case.${k} must be a string`);
  return n;
}

const elementsOf = (d) => {
  const out = [];
  const go = (el) => {
    out.push(el);
    const parent = el.localName === "template" && el.content ? el.content : el;
    for (let k = parent.firstElementChild; k; k = k.nextElementSibling) go(k);
  };
  go(d.documentElement || d);
  return out;
};

/** Read and strip the inline synthetic ids of a parsed side. */
function takeSids(d) {
  const ids = new Map();
  for (const el of elementsOf(d))
    if (el.hasAttribute(SID)) {
      ids.set(el, el.getAttribute(SID));
      el.removeAttribute(SID);
    }
  return ids;
}

export const serialize = (d) => "<!DOCTYPE html>" + d.documentElement.outerHTML;

function selectorPred(sel) {
  if (!sel) return undefined;
  return (el) => el.nodeType === 1 && el.matches(sel);
}

/** Hooks a case can ask for without code: no-op morph hooks (which turn
 * off the unchanged-subtree shortcut and the fast path) and vetoes by
 * selector or attribute name. */
function buildHooks(h) {
  if (!h) return undefined;
  const m = (sel) => (n) => n && n.nodeType === 1 && sel && n.matches(sel);
  const hooks = {};
  if (h.morph) {
    hooks.beforeNodeMorphed = (a) => (m(h.vetoMorph)(a) ? false : undefined);
    hooks.afterNodeMorphed = () => {};
  }
  if (h.vetoAdd)
    hooks.beforeNodeAdded = (n) => (m(h.vetoAdd)(n) ? false : undefined);
  if (h.vetoRemove)
    hooks.beforeNodeRemoved = (n) => (m(h.vetoRemove)(n) ? false : undefined);
  if (h.vetoAttr)
    hooks.beforeAttributeUpdated = (name) =>
      name === h.vetoAttr ? false : undefined;
  return hooks;
}

function transportMap(root, ids, reserved) {
  const map = {},
    counts = [],
    tags = [],
    used = new Set([...ids.values(), ...reserved]);
  let counter = 0;
  const fresh = () => {
    let id;
    do {
      id = "oracle-fresh:" + ++counter;
    } while (used.has(id));
    used.add(id);
    return id;
  };
  const visit = (el, path) => {
    map[path] = ids.get(el) || fresh();
    const kids = [];
    for (let k = el.firstElementChild; k; k = k.nextElementSibling)
      kids.push(k);
    counts.push(kids.length);
    tags.push(el.tagName.toLowerCase());
    kids.forEach((child, i) => visit(child, path ? path + "." + i : String(i)));
  };
  visit(root, "");
  map["~"] = counts.join(",");
  map["^"] = tags.join(",");
  return map;
}

function buildIdentity(E, mode, sides) {
  const { sidL, sidR, toLive, remoteRoot, clean, reserved } = sides;
  const sidB = clean ? new Map() : sides.sidB;
  if (mode === "default") return undefined;
  const authored = uniqueAuthored();
  if (mode === "authored")
    return { base: authored, local: authored, remote: authored };
  const sidLocal = (el) => sidL.get(toLive(el) || el) || null;
  if (mode === "plain")
    return {
      base: clean ? sidLocal : (el) => sidB.get(el) || null,
      local: sidLocal,
      remote: (el) => sidR.get(el) || null,
    };
  const map = transportMap(remoteRoot, sidR, reserved);
  const local = (el) => authored(el) || sidLocal(el);
  return {
    base: clean ? local : (el) => authored(el) || sidB.get(el) || null,
    local,
    remote: { first: authored, map, then: authored },
  };
}

/** Parse the three sides of a case and the live page, ids stripped. */
const whole = (html, head) =>
  /^\s*<(!doctype|html)/i.test(html) ? html : doc(html, head);

export function prepare(c) {
  const base = parse(whole(c.base, c.heads.base));
  const cap = parse(whole(c.local, c.heads.local));
  const remote = parse(whole(c.remote, c.heads.remote));
  const sidB = takeSids(base);
  const sidCap = takeSids(cap);
  const sidR = takeSids(remote);
  const live = parse(serialize(cap));
  const capToLive = lockstepMap(cap.documentElement, live.documentElement);
  const sameHead =
    base.head.outerHTML === cap.head.outerHTML &&
    cap.head.outerHTML === remote.head.outerHTML;
  const liveToCap =
    sameHead && !(c.options?.hooks || {}).morph
      ? lockstepMap(live.documentElement, cap.documentElement)
      : null;
  const sidL = new Map();
  for (const [el, id] of sidCap) sidL.set(capToLive.get(el), id);
  const headBefore = new Set(live.head.children);
  if (c.live?.head) live.head.insertAdjacentHTML("beforeend", c.live.head);
  const insertedHead = [...live.head.children].filter(
    (el) => !headBefore.has(el),
  );
  if (c.live?.body) live.body.insertAdjacentHTML("afterbegin", c.live.body);
  for (const [sel, prop, value] of c.live?.props || []) {
    const el = live.querySelector(sel);
    if (el) el[prop] = value;
  }
  for (const [sel, name, value] of c.live?.attrs || []) {
    const el = live.querySelector(sel);
    if (el) el.setAttribute(name, value);
  }
  const liveHeadLeaves = [];
  if (liveToCap)
    for (const el of elementsOf(live.head)) {
      if (el === live.head || liveToCap.has(el)) continue;
      if (el.children.length || el.textContent.trim()) continue;
      let parentCap = null;
      for (let x = el.parentElement; x && !parentCap; x = x.parentElement)
        parentCap = liveToCap.get(x) || null;
      liveHeadLeaves.push({ parentCap, html: el.outerHTML, tag: el.tagName });
    }
  // Without a node-for-node map (the heads differ, or a morph hook runs),
  // the tags the live page added are still expected in the output.
  if (!liveToCap)
    for (const el of insertedHead) {
      if (el.children.length || el.textContent.trim()) continue;
      liveHeadLeaves.push({
        parentCap: cap.head,
        html: el.outerHTML,
        tag: el.tagName,
      });
    }
  const h = c.options?.hooks || {};
  const selectors = [
    ...new Set(
      [
        c.options?.ignore,
        c.options?.remoteWins,
        h.vetoMorph,
        h.vetoRemove,
        h.vetoAdd,
      ].filter((s) => typeof s === "string" && s.trim()),
    ),
  ];
  const selectedSet = new Set();
  for (const sel of selectors)
    for (const el of live.querySelectorAll(sel)) selectedSet.add(el);
  for (const el of elementsOf(live))
    if (el.localName === "template" && el.content)
      for (const sel of selectors)
        for (const x of el.content.querySelectorAll(sel)) selectedSet.add(x);
  const extraProps = new Map();
  for (const [sel, prop] of c.live?.props || []) {
    const el = live.querySelector(sel);
    if (!el) continue;
    if (!extraProps.has(el)) extraProps.set(el, new Set());
    extraProps.get(el).add(prop);
  }
  const preMerge = new Map();
  for (const el of elementsOf(live)) {
    const names = new Set(extraProps.get(el) || []);
    for (const name of FORM_PROPS[el.tagName] || []) names.add(name);
    const props = new Map();
    for (const name of names) props.set(name, el[name]);
    const matched = selectedSet.has(el)
      ? selectors.filter((s) => el.matches(s))
      : [];
    preMerge.set(el, {
      attrs: new Map([...el.attributes].map((a) => [a.name, a.value])),
      parent: el.parentNode,
      nextSibling: el.nextSibling,
      selectors: new Set(matched),
      html: matched.length ? el.outerHTML : null,
      members: matched.length ? elementsOf(el) : [],
      props,
    });
  }
  const scopeBefore =
    c.shape === "element"
      ? new Set(
          live.body.firstElementChild
            ? elementsOf(live.body.firstElementChild)
            : [],
        )
      : new Set(elementsOf(live.documentElement));
  let elementLocal = null;
  if (c.shape === "element" && c.live) {
    const elementCap = parse(serialize(live));
    const liveToElementCap = lockstepMap(
      live.documentElement,
      elementCap.documentElement,
    );
    const elementSids = new Map();
    for (const [el, id] of sidL) {
      const copy = liveToElementCap.get(el);
      if (copy) elementSids.set(copy, id);
    }
    elementLocal = {
      cap: elementCap,
      sidCap: elementSids,
      capToLive: lockstepMap(elementCap.documentElement, live.documentElement),
    };
  }
  return {
    base,
    cap,
    remote,
    live,
    // The document URL the engine resolves against, frozen before it runs.
    baseURI: live.baseURI,
    sidB,
    sidR,
    sidL,
    sidCap,
    capToLive,
    preMerge,
    elementLocal,
    scopeBefore,
    liveHeadLeaves,
    liveBefore: serialize(live),
    inputsBefore: {
      base: serialize(base),
      cap: serialize(cap),
      remote: serialize(remote),
    },
  };
}

function childrenInput(root, sids) {
  const doc = root.ownerDocument.implementation.createHTMLDocument("");
  const clone = root.cloneNode(true);
  const mapped = lockstepMap(root, clone);
  const clonedSids = new Map();
  for (const [el, id] of sids) {
    const copy = mapped.get(el);
    if (copy) clonedSids.set(copy, id);
  }
  doc.replaceChild(clone, doc.documentElement);
  return { doc, sids: clonedSids };
}

function reportFields(report, label, final) {
  const stats = {};
  for (const [k, v] of Object.entries(report.stats || {}))
    if (!k.startsWith("fastPath") && !WORK.has(k)) stats[k] = v;
  return {
    identities: identityList(report.identities || [], label, final),
    conflicts: conflictList(report.conflicts, label, final),
    decisions: decisionList(report.decisions, label, final),
    moved: nodeList(report.moved || [], label, final),
    replaced: nodeList(report.replaced || [], label, final),
    localDiverged: report.localDiverged,
    stats,
  };
}

/**
 * Run a normalized case through engine E. `fastPath` is passed through for
 * the document shapes. Returns an observation: comparable fields (html,
 * destinations, report projections) plus `raw`, the live objects the
 * oracle's properties read.
 */
export async function runCase(E, c, { fastPath } = {}) {
  const p = prepare(c);
  const children = c.shape === "element" && !!c.options.children;
  const childBase = children
    ? childrenInput(p.base.body.firstElementChild, p.sidB)
    : null;
  const childRemote = children
    ? childrenInput(p.remote.body.firstElementChild, p.sidR)
    : null;
  const toLive = (n) => p.capToLive.get(n) || null;
  const reservedIds = new Set();
  for (const sids of [p.sidB, p.sidCap, p.sidR])
    for (const id of sids.values()) reservedIds.add(id);

  for (const tree of [p.base, p.cap, p.remote])
    for (const el of elementsOf(tree))
      for (const name of ["id", "data-id"]) {
        const value = el.getAttribute(name);
        if (value) reservedIds.add(value);
      }
  const identity = buildIdentity(E, c.identity, {
    sidB: childBase ? childBase.sids : p.sidB,
    sidL: p.sidL,
    sidR: childRemote ? childRemote.sids : p.sidR,
    reserved: reservedIds,
    toLive,
    remoteRoot: childRemote
      ? childRemote.doc.documentElement
      : c.shape === "element"
        ? p.remote.body.firstElementChild
        : p.remote.documentElement,
    clean: c.shape === "clean",
  });
  const o = c.options;
  const common = {
    ...(identity ? { identity } : {}),
    ...(o.ignore ? { ignore: selectorPred(o.ignore) } : {}),
    ...(o.remoteWins ? { remoteWins: selectorPred(o.remoteWins) } : {}),
    ...(o.conflicts ? { conflicts: o.conflicts } : {}),
    ...(o.hooks ? { hooks: buildHooks(o.hooks) } : {}),
    ...(o.pass || {}),
    scripts: { execute: false, ...(o.pass?.scripts || {}) },
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(" "));
  try {
    if (c.shape === "pure") {
      const res = E.merge3(p.base, p.cap, p.remote, {
        ...common,
        hooks: { beforeNodeMorphed: () => {} },
      });
      const label = labelTree(res.doc.documentElement);
      const final = finalTree(res.doc.documentElement);
      return {
        html: serialize(res.doc),
        destinations: [],
        ...reportFields(
          { ...res, identities: [], moved: [], replaced: [] },
          label,
          final,
        ),
        warnings,
        raw: { p, doc: res.doc, report: res, liveRoot: res.doc },
      };
    }
    const label = labelTree(p.live.documentElement);
    let report;
    if (c.shape === "element") {
      const liveEl = p.live.body.firstElementChild;
      const remoteEl = p.remote.body.firstElementChild;
      const baseEl = p.base.body.firstElementChild;
      report = await E.morphElement(
        liveEl,
        childRemote ? childRemote.doc : remoteEl,
        {
          ...common,
          ...(o.children ? { children: true } : {}),
          ...(o.twoWay ? {} : { base: childBase ? childBase.doc : baseEl }),
        },
      );
    } else {
      const clean = c.shape === "clean";
      report = await E.mergeDocument({
        live: p.live,
        base: clean ? p.cap : p.base,
        local: { root: p.cap.documentElement, toLive },
        remote: p.remote,
        ...common,
        ...(fastPath === undefined ? {} : { fastPath }),
      });
    }
    const final = finalTree(p.live.documentElement);
    return {
      html: serialize(p.live),
      props: formProps(p.live),
      destinations: destinations(label, final),
      ...reportFields(report, label, final),
      warnings,
      fast: report.stats
        ? {
            attempted: report.stats.fastPathAttempted,
            taken: report.stats.fastPathTaken,
            fallback: report.stats.fastPathFallback,
          }
        : null,
      raw: { p, report, label, liveRoot: p.live },
    };
  } finally {
    console.warn = warn;
  }
}

const formProps = (doc) =>
  [...doc.querySelectorAll("input, textarea, select, option")].map((el) =>
    el.localName === "option"
      ? el.selected
      : el.localName === "select"
        ? el.value
        : [el.value, el.checked],
  );

export const COMPARED = [
  "html",
  "props",
  "destinations",
  "identities",
  "conflicts",
  "decisions",
  "moved",
  "replaced",
  "localDiverged",
  "stats",
  "warnings",
];

export function differingFields(a, b) {
  return COMPARED.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}
