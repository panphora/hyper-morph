import { parse } from "../../node/lib/dom.js";
import {
  normalize,
  prepare,
  runCase,
  differingFields,
  serialize,
} from "./runner.js";
import { ownerChecks, ownerSnapshot, allElements } from "./owner.js";

// What "wrong" means (Phase 0): content lost or duplicated, a local edit in
// the wrong element, a live element moved against its identity, or the fast
// and full paths disagreeing on any observable. Each property below reads
// one of those from a case's inputs and one engine's observation; none of
// them needs an expected output written by hand. `expect.html`, when a case
// has one, is checked as well.

const SKIP_TEXT = new Set(["SCRIPT", "STYLE"]);

function textNodes(root, skip) {
  const out = [];
  const go = (n, skipped) => {
    if (n.nodeType === 3) {
      if (!skipped) out.push(n);
      return;
    }
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
    const s =
      skipped ||
      (n.nodeType === 1 && (SKIP_TEXT.has(n.tagName) || (skip && skip(n))));
    if (n.nodeType === 1 && n.localName === "template" && n.content)
      go(n.content, s);
    for (let c = n.firstChild; c; c = c.nextSibling) go(c, s);
  };
  go(root, false);
  return out;
}

const tokens = (s) => s.split(/\s+/).filter(Boolean);

export function wordCounts(root, skip) {
  const m = new Map();
  for (const t of textNodes(root, skip))
    for (const w of tokens(t.nodeValue)) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/** Three-way on one scalar: the side that changed wins; both changed
 * differently is a conflict (undefined). */
export function three(b, l, r) {
  if (l === b) return r;
  if (r === b) return l;
  if (l === r) return l;
  return undefined;
}

function strings(x, out = [], seen = new Set()) {
  if (x == null) return out;
  if (typeof x === "string") {
    out.push(x);
    return out;
  }
  if (typeof x !== "object" || seen.has(x) || x.nodeType) return out;
  seen.add(x);
  for (const v of Array.isArray(x) ? x : Object.values(x))
    strings(v, out, seen);
  return out;
}

/** Words a conflict record carries: a reported clash is not a silent loss. */
function conflictWords(report) {
  const words = new Map();
  for (const c of report.conflicts || [])
    for (const s of strings({
      base: c.base,
      local: c.local,
      remote: c.remote,
      resolved: c.resolved,
      recovery: c.recovery,
    }))
      for (const w of tokens(s.replace(/<[^>]*>/g, " ")))
        words.set(w, (words.get(w) || 0) + 1);
  return words;
}

const regionPred = (c) => {
  const sels = [c.options.ignore, c.options.remoteWins].filter(Boolean);
  if (!sels.length) return null;
  return (el) => sels.some((s) => el.matches(s));
};

/** Content lost or duplicated: every word whose count only one side
 * changed ends with that side's count. */
function conservation(c, obs) {
  const skip = regionPred(c);
  const { p } = obs.raw;
  const B = wordCounts(p.base, skip);
  const L = wordCounts(parse(p.liveBefore), skip);
  const R = wordCounts(p.remote, skip);
  const G = wordCounts(obs.raw.liveRoot, skip);
  const carried = conflictWords(obs.raw.report);
  const exempt = new Set();
  if (skip) {
    const inRegion = (root) => {
      const all = wordCounts(root);
      const outside = wordCounts(root, skip);
      for (const [w, n] of all) if (n !== (outside.get(w) || 0)) exempt.add(w);
    };
    for (const root of [
      p.base,
      parse(p.liveBefore),
      p.remote,
      obs.raw.liveRoot,
    ])
      inRegion(root);
  }
  const out = [];
  for (const w of new Set([
    ...B.keys(),
    ...L.keys(),
    ...R.keys(),
    ...G.keys(),
  ])) {
    const b = B.get(w) || 0,
      l = L.get(w) || 0,
      r = R.get(w) || 0,
      g = G.get(w) || 0;
    const want = three(b, l, r);
    if (want === undefined || want === g || exempt.has(w)) continue;
    if (g < want && want - g <= (carried.get(w) || 0)) continue;
    out.push({
      prop: g < want ? "loss" : "duplication",
      word: w,
      b,
      l,
      r,
      got: g,
      want,
    });
  }
  return out;
}

/** The id an element answers to on one side: its synthetic id, or, for the
 * identities that read authored ids, a unique authored id. */
function idReader(c, sids, root) {
  const counts = new Map();
  const authoredOn = c.identity === "authored" || c.identity === "clay";
  const auth = (el) => el.getAttribute("data-id") || el.getAttribute("id");
  if (authoredOn)
    for (const el of root.querySelectorAll("[data-id],[id]"))
      counts.set(auth(el), (counts.get(auth(el)) || 0) + 1);
  return (el) => {
    if (!el || el.nodeType !== 1) return null;
    const s = sids.get(el);
    if (s) return "$" + s;
    if (authoredOn) {
      const a = auth(el);
      if (a && counts.get(a) === 1) return "@" + a;
    }
    return null;
  };
}

const rawParent = (node) => (node ? node.parentNode : null);

function nearest(el, idOf, parent = rawParent) {
  for (let x = el; x; x = parent(x)) {
    if (x.nodeType !== 1) continue;
    const id = idOf(x);
    if (id) return id;
  }
  return null;
}

const parentId = (el, idOf, parent = rawParent) =>
  nearest(parent(el), idOf, parent) || "(root)";

function index(root, idOf) {
  const m = new Map();
  const dup = new Set();
  for (const el of [
    root.documentElement || root,
    ...(root.documentElement || root).querySelectorAll("*"),
  ]) {
    const id = idOf(el);
    if (!id) continue;
    if (m.has(id)) dup.add(id);
    m.set(id, el);
  }
  for (const id of dup) m.delete(id);
  return m;
}

function sides(c, obs) {
  const evidence = ownerSnapshot(c, obs);
  return {
    idB: evidence.B.key,
    idCap: evidence.L.key,
    idR: evidence.R.key,
    idG: evidence.G.key,
    evidence,
  };
}

function homes(root, idOf, skip) {
  const m = new Map();
  for (const t of textNodes(root, skip))
    for (const w of tokens(t.nodeValue)) {
      if (!m.has(w)) m.set(w, new Set());
      m.get(w).add(nearest(t.parentNode, idOf));
    }
  return m;
}

/** A word only one side added lands inside the element that side put it in,
 * wherever the merge moved that element. */
function placement(c, obs) {
  if (c.shape === "pure" || c.identity === "default") return [];
  const { p } = obs.raw;
  const { idB, idCap, idR, idG } = sides(c, obs);
  const skip = regionPred(c);
  const B = wordCounts(p.base, skip);
  const L = wordCounts(p.cap, skip);
  const R = wordCounts(p.remote, skip);
  const inL = homes(p.cap, idCap, skip);
  const inR = homes(p.remote, idR, skip);
  const got = homes(obs.raw.liveRoot, idG, skip);
  const rIndex = index(p.remote, idR),
    lIndex = index(p.cap, idCap),
    bIndex = index(p.base, idB);
  const out = [];
  const check = (from, other, sideIndex, otherIndex, side) => {
    for (const [w, want] of from) {
      if (B.get(w) || other.get(w)) continue;
      for (const home of want) {
        if (!home || !sideIndex.has(home)) continue;
        if (side === "local" && !otherIndex.has(home)) continue;
        if (side === "remote" && bIndex.has(home) && !otherIndex.has(home))
          continue;
        const g = got.get(w);
        if (!g || g.has(home)) continue;
        out.push({ prop: "placement", word: w, side, want: home, got: [...g] });
      }
    }
  };
  check(inL, R, lIndex, rIndex, "local");
  check(inR, L, rIndex, lIndex, "remote");
  return out;
}

/** A live element keeps its identity: with a unique id on every side it
 * stays connected when the three-way answer keeps it, under the parent the
 * three-way answer names. */
const elementChildren = (el) => {
  const out = [];
  const parent = el?.localName === "template" && el.content ? el.content : el;
  for (let k = parent?.firstElementChild; k; k = k.nextElementSibling)
    out.push(k);
  return out;
};

function sameStructureMap(remote, output) {
  const paired = new Map();
  const walk = (r, g) => {
    if (
      !r ||
      !g ||
      r.nodeType !== 1 ||
      g.nodeType !== 1 ||
      r.namespaceURI !== g.namespaceURI ||
      r.localName !== g.localName
    )
      return false;
    const a = elementChildren(r),
      b = elementChildren(g);
    if (a.length !== b.length) return false;
    paired.set(r, g);
    return a.every((child, i) => walk(child, b[i]));
  };
  return walk(remote, output) ? paired : null;
}

function occurrencePath(side, el) {
  const path = [];
  for (let x = el; x && x !== side.scope; ) {
    const parent = side.parent(x);
    if (!parent || parent.nodeType !== 1) return null;
    path.unshift(elementChildren(parent).indexOf(x));
    x = parent;
  }
  return path;
}

function destination(c, obs) {
  if (c.shape === "pure") return [];
  const { idB, idCap, idR, idG, evidence } = sides(c, obs);
  const { p } = evidence;
  const B = evidence.B.map,
    L = evidence.L.map,
    R = evidence.R.map;
  const out = [];
  const unsettled = (id) => {
    const st = evidence.states?.get(id);
    return !!st && (st.unsettled || st.reason === "unsettled-collision");
  };
  const cleanPairs =
    c.shape === "clean"
      ? sameStructureMap(evidence.R.scope, evidence.G.scope)
      : null;
  const protectedEl = (el) => !!evidence.skip(el);
  const liveOf = new Map();
  for (const [el, id] of p.sidL) liveOf.set("$" + id, el);
  for (const [id, capEl] of L) {
    if (id.startsWith("@") || id.startsWith("#head:")) {
      const liveEl = p.capToLive.get(capEl);
      if (liveEl) liveOf.set(id, liveEl);
    }
  }
  for (const [id, liveEl] of liveOf) {
    if (unsettled(id)) continue;
    if (protectedEl(liveEl)) continue;
    if (!L.has(id)) continue;
    const exists = three(B.has(id), true, R.has(id));
    if (exists !== true) continue;
    const r = R.get(id);
    if (r && r.tagName !== liveEl.tagName) continue;
    const pb = B.has(id)
      ? parentId(B.get(id), idB, evidence.B.parent)
      : undefined;
    const pl = parentId(L.get(id), idCap, evidence.L.parent);
    const pr = r ? parentId(r, idR, evidence.R.parent) : undefined;
    const want = pb === undefined ? (pr ?? pl) : three(pb, pl, pr ?? pb);
    if (
      !obs.raw.liveRoot.contains(liveEl) &&
      !contentContains(obs.raw.liveRoot, liveEl)
    ) {
      out.push({ prop: "identity-lost", id, want });
      continue;
    }
    if (
      cleanPairs &&
      r &&
      L.get(id) &&
      !elementChildren(r).length &&
      !elementChildren(L.get(id)).length &&
      r.namespaceURI === liveEl.namespaceURI &&
      evidence.G.parent(cleanPairs.get(r)) !== evidence.G.parent(liveEl)
    )
      out.push({
        prop: "destination",
        id,
        why: "leaf-parent-occurrence",
        want: occurrencePath(evidence.R, evidence.R.parent(r)),
        got: occurrencePath(evidence.G, evidence.G.parent(liveEl)),
      });
    if (want === undefined) continue;
    const gotParent = parentId(liveEl, idG, evidence.G.parent);
    if (gotParent !== want)
      out.push({ prop: "destination", id, want, got: gotParent });
  }
  // An identified element only remote inserted keeps remote's tag and lands
  // under remote's parent, when that parent is in the output.
  for (const [id, gEl] of evidence.G.map) {
    if (liveOf.has(id) || B.has(id) || L.has(id) || !R.has(id) || unsettled(id))
      continue;
    if (protectedEl(gEl)) continue;
    const r = R.get(id);
    if (r.namespaceURI !== gEl.namespaceURI || r.localName !== gEl.localName)
      out.push({
        prop: "destination",
        id,
        why: "tag",
        want: r.localName,
        got: gEl.localName,
      });
    const want = parentId(r, idR, evidence.R.parent);
    if (want !== "(root)" && !evidence.G.map.has(want)) continue;
    const got = parentId(gEl, idG, evidence.G.parent);
    if (got !== want)
      out.push({ prop: "destination", id, why: "remote-insert", want, got });
  }
  return out;
}

function order(c, obs) {
  const { evidence } = sides(c, obs);
  const views = [evidence.B, evidence.L, evidence.R, evidence.G];
  const orders = views.map((side) => {
    const parents = new WeakMap(),
      paths = new WeakMap(),
      counts = new Map(),
      groups = new Map();
    const walk = (el, path) => {
      if (!el) return;
      paths.set(el, path);
      counts.set(path, (counts.get(path) || 0) + 1);
      for (const child of elementChildren(el)) {
        parents.set(child, el);
        walk(child, path + "/" + child.localName);
      }
    };
    walk(side.scope, side.scope?.localName || "root");
    for (const el of allElements(side.scope)) {
      const id = side.key(el),
        parent = parents.get(el);
      if (!id || !parent) continue;
      let protectedScope = false;
      for (let x = el; x && !protectedScope; x = parents.get(x))
        protectedScope = evidence.skip(x);
      if (protectedScope) continue;
      const path = paths.get(parent),
        owner =
          side.key(parent) || (counts.get(path) === 1 ? "^" + path : null);
      if (!owner) continue;
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(id);
    }
    return groups;
  });
  const out = [];
  const parents = new Set([
    ...orders[0].keys(),
    ...orders[1].keys(),
    ...orders[2].keys(),
  ]);
  for (const parent of parents) {
    const seqs = orders.map((m) => m.get(parent) || []);
    const base = seqs[0];
    const sets = seqs.map((s) => new Set(s));
    const common = new Set(
      base.filter((id) => sets.slice(1).every((s) => s.has(id))),
    );
    const [b, l, r, g] = seqs.map((s) => s.filter((id) => common.has(id)));
    const same = (a, b) =>
      a.length === b.length && a.every((id, i) => id === b[i]);
    const at = new Map(seqs[3].map((id, i) => [id, i]));
    for (const [full, otherKept, otherSet] of [
      [seqs[1], r, sets[2]],
      [seqs[2], l, sets[1]],
    ]) {
      // A side's insertions between the same two kept neighbours keep their
      // relative order, whatever the other side did to the anchors.
      const runs = new Map();
      full.forEach((id, i) => {
        if (sets[0].has(id) || otherSet.has(id) || !at.has(id)) return;
        const prev = full.slice(0, i).findLast((x) => common.has(x)) ?? null;
        const next = full.slice(i + 1).find((x) => common.has(x)) ?? null;
        const k = JSON.stringify([prev, next]);
        if (!runs.has(k)) runs.set(k, []);
        runs.get(k).push(id);
      });
      for (const mine of runs.values())
        for (let i = 1; i < mine.length; i++)
          if (at.get(mine[i - 1]) > at.get(mine[i])) {
            out.push({
              prop: "order",
              owner: parent,
              why: "insertion-sequence",
              want: mine,
              got: seqs[3],
            });
            break;
          }
      if (!same(otherKept, b)) continue;
      full.forEach((id, i) => {
        if (sets[0].has(id) || otherSet.has(id) || !at.has(id)) return;
        const prev = full.slice(0, i).findLast((x) => common.has(x));
        const next = full.slice(i + 1).find((x) => common.has(x));
        if (
          (prev !== undefined && at.get(prev) > at.get(id)) ||
          (next !== undefined && at.get(next) < at.get(id))
        )
          out.push({
            prop: "order",
            owner: parent,
            why: "insertion-anchor",
            id,
            want: { after: prev ?? null, before: next ?? null },
            got: seqs[3],
          });
      });
    }
    if (common.size < 2) continue;
    const want = !same(l, b) && same(r, b) ? l : r;
    if (!same(want, g))
      out.push({ prop: "order", owner: parent, want, got: g });
  }
  return out;
}

function contentContains(root, node) {
  for (const t of root.querySelectorAll("template"))
    if (t.content.contains(node) || contentContains(t.content, node))
      return true;
  return false;
}

/** Ignored regions keep their live content; remote-wins regions end as the
 * remote has them. Both compare the full multiset of the region roots within
 * the selected merge scope, the element scope root included, so multiplicity
 * and the removal of the selector itself are caught. The ignored set is the
 * pre-merge membership, so a removed ignored node cannot drop out of the
 * expectation; the pure shape's frozen captured roots are the live scope. */
function regions(c, obs) {
  const out = [];
  const { p } = obs.raw;
  const { R, G } = ownerSnapshot(c, obs);
  const markupIn = (side, sel) =>
    allElements(side.scope)
      .filter((el) => el.matches(sel))
      .map((el) => el.outerHTML);
  if (c.options.ignore) {
    const sel = c.options.ignore;
    const want = [];
    for (const [el, rec] of p.preMerge)
      if (rec.selectors.has(sel) && p.scopeBefore.has(el)) want.push(rec.html);
    const got = markupIn(G, sel);
    if (JSON.stringify([...want].sort()) !== JSON.stringify([...got].sort()))
      out.push({ prop: "ignored-changed", want, got });
  }
  if (c.options.remoteWins) {
    const want = markupIn(R, c.options.remoteWins);
    const got = markupIn(G, c.options.remoteWins);
    if (JSON.stringify(want) !== JSON.stringify(got))
      out.push({ prop: "remote-wins-differs", want, got });
  }
  return out;
}

function intent(c, obs) {
  if (c.expect?.html === undefined) return [];
  const got = obs.raw.liveRoot.body
    ? obs.raw.liveRoot.body.innerHTML
    : obs.html;
  return got === c.expect.html
    ? []
    : [{ prop: "intent", want: c.expect.html, got }];
}

/** Facts about a case's inputs, computed, never taken from the case. */
export function facts(c) {
  const p = prepare(c);
  const ser = (d) => d.documentElement.outerHTML;
  const selectedRoot = (d) =>
    c.shape === "element"
      ? (d.body && d.body.firstElementChild) || null
      : d.documentElement;
  const sidOn = c.identity === "plain" || c.identity === "clay";
  const fingerprint = (d, sids) => {
    const root = selectedRoot(d);
    if (!root) return "";
    const ids = sidOn ? allElements(root).map((el) => sids.get(el) || "") : [];
    return root.outerHTML + "\u0000" + ids.join(",");
  };
  const dupSids = (m) => {
    const seen = new Set(),
      dup = new Set();
    for (const id of m.values()) (seen.has(id) ? dup : seen).add(id);
    return [...dup];
  };
  const livePropertiesDiffer = allElements(p.cap.documentElement).some((el) => {
    const frozen = p.preMerge.get(p.capToLive.get(el));
    return (
      frozen &&
      [...frozen.props].some(([name, value]) => !Object.is(el[name], value))
    );
  });
  return {
    remoteChanged:
      fingerprint(p.base, p.sidB) !== fingerprint(p.remote, p.sidR),
    localChanged: fingerprint(p.base, p.sidB) !== fingerprint(p.cap, p.sidCap),
    liveDiffers:
      p.liveBefore !== "<!DOCTYPE html>" + ser(p.cap) || livePropertiesDiffer,
    idsDiffer:
      JSON.stringify([...p.sidB.values()]) !==
      JSON.stringify([...p.sidR.values()]),
    dupSids: {
      base: dupSids(p.sidB),
      local: dupSids(p.sidCap),
      remote: dupSids(p.sidR),
    },
  };
}

const REQUIRES = new Set([
  "remoteChanged",
  "localChanged",
  "liveDiffers",
  "idsDiffer",
  "fastTaken",
]);

const isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/** Malformed input fields that would otherwise throw inside an engine. */
function malformed(c) {
  if (c.requires !== undefined) {
    if (!Array.isArray(c.requires))
      return "requires must be an array of requirement names";
    for (const req of c.requires)
      if (typeof req !== "string") return "requires must be an array of names";
  }
  if (c.options !== undefined && !isObject(c.options))
    return "options must be an object";
  if (c.options?.hooks != null && !isObject(c.options.hooks))
    return "options.hooks must be an object";
  if (c.live !== undefined && c.live !== null && !isObject(c.live))
    return "live must be an object";
  if (c.expect !== undefined && c.expect !== null && !isObject(c.expect))
    return "expect must be an object";
  return null;
}

/** Why a case cannot count as evidence, or null. */
export function invalid(c, f) {
  const bad = malformed(c);
  if (bad) return bad;
  if (c.shape === "pure" && c.options.hooks)
    for (const k of ["vetoAdd", "vetoRemove", "vetoMorph", "vetoAttr"])
      if (c.options.hooks[k]) return `pure merge ignores hooks.${k}`;
  if (!f) f = facts(c);
  if (!f.remoteChanged && !f.localChanged && !f.liveDiffers)
    return "nothing to merge: base, local and remote are equal";
  if (c.shape === "clean" && f.localChanged)
    return "clean shape with a local that differs from base";
  if (c.shape === "dirty" && !f.localChanged)
    return "dirty shape with no local change (use clean)";
  if (c.identity === "clay" || c.identity === "plain") {
    const d = Object.entries(f.dupSids).filter(([, v]) => v.length);
    if (d.length && !c.meta?.dupSidsIntended)
      return `duplicate sid on ${d.map(([k, v]) => k + ":" + v).join(",")}`;
  }
  for (const req of c.requires || []) {
    if (!REQUIRES.has(req)) return `unknown requires ${req}`;
    if (req !== "fastTaken" && f[req] !== true)
      return `requires ${req}, which the inputs do not create`;
  }
  if (c.shape === "element")
    for (const k of ["base", "local", "remote"])
      if (parse(c[k]).body.children.length !== 1)
        return `element shape morphs one element; ${k} has ${parse(c[k]).body.children.length} body elements`;
  return null;
}

/** Every violation of one engine on one case, with the observation. */
export async function judge(E, raw, { parity = true } = {}) {
  const c = normalize(raw);
  let obs;
  try {
    obs = await runCase(E, c);
  } catch (e) {
    return {
      violations: [
        {
          prop: "crash",
          error: String((e && e.stack) || e)
            .split("\n")
            .slice(0, 3)
            .join(" | "),
        },
      ],
      ambiguous: [],
      obs: null,
    };
  }
  const p = obs.raw.p;
  const inputsNow = {
    base: serialize(p.base),
    cap: serialize(p.cap),
    remote: serialize(p.remote),
  };
  const mutated = Object.keys(p.inputsBefore).filter(
    (k) => p.inputsBefore[k] !== inputsNow[k],
  );
  // Scoped conservation replaced the legacy word-count and placement checks:
  // ownerCheck reports every content change it can prove, scoped to the owner
  // that owns it. `destination` below keeps its legacy identity-lost check
  // (the new owner element-presence check subsumes the rest).
  const owners = ownerChecks(c, obs);
  const v = [
    ...(mutated.length ? [{ prop: "input-mutated", fields: mutated }] : []),
    ...owners.violations,
    ...destination(c, obs),
    ...order(c, obs),
    ...regions(c, obs),
    ...intent(c, obs),
  ];
  const h = c.options.hooks || {};
  const muting = h.vetoAdd || h.vetoRemove || h.vetoMorph || h.vetoAttr;
  if (
    c.shape === "clean" &&
    !c.live &&
    !muting &&
    !c.options.ignore &&
    !c.options.remoteWins
  ) {
    const want = "<!DOCTYPE html>" + obs.raw.p.remote.documentElement.outerHTML;
    if (obs.html !== want) v.push({ prop: "clean-not-remote" });
  }
  const fast = { attempted: 0, taken: 0 };
  if (
    parity &&
    (c.shape === "clean" || c.shape === "dirty") &&
    supportsFastPath(E)
  ) {
    let full, quick;
    try {
      full = await runCase(E, c, { fastPath: false });
      quick = await runCase(E, c, { fastPath: true });
    } catch (e) {
      v.push({ prop: "crash", error: String(e).slice(0, 200), fastPath: true });
    }
    if (full && quick) {
      fast.attempted = quick.fast?.attempted || 0;
      fast.taken = quick.fast?.taken || 0;
      fast.fallback = quick.fast?.fallback || null;
      const d = differingFields(full, quick);
      if (d.length) v.push({ prop: "fast-full", fields: d });
    }
  }
  if (c.requires?.includes("fastTaken") && !fast.taken)
    v.push({
      prop: "vacuous",
      why: "fastTaken required, fast path not taken",
      fallback: fast.fallback,
    });
  return { violations: v, ambiguous: owners.ambiguous, obs, fast };
}

const fastSupport = new WeakMap();
function supportsFastPath(E) {
  if (fastSupport.has(E)) return fastSupport.get(E);
  let ok = true;
  try {
    E.merge3(parse("<p>a</p>"), parse("<p>a</p>"), parse("<p>a</p>"), {
      fastPath: true,
    });
  } catch {
    ok = false;
  }
  fastSupport.set(E, ok);
  return ok;
}

const canonical = (x) => {
  if (x === undefined) return "undefined";
  if (x === null) return "null";
  if (typeof x === "number" && Object.is(x, -0)) return "-0";
  if (typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  const keys = Object.keys(x).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") +
    "}"
  );
};

const witnessesOf = (violations) => violations.map(canonical).sort();

/** The fix-class signature: the loop groups every case with the same
 * violated properties, shape and identity mode into one fix. */
export const signatureOf = (c, violations) => {
  const n = normalize(c);
  const props = [...new Set(violations.map((v) => v.prop))].sort().join("+");
  return `${props}|${n.shape}|${n.identity}${n.options.ignore || n.options.remoteWins ? "|regions" : ""}${n.live ? "|live" : ""}`;
};

/**
 * The oracle's verdict on a candidate: `invalid` (the inputs do not create
 * what they claim), `counterexample` (a proved violation), `reference` (the
 * frozen reference engine does the same thing and nothing is lost: an old
 * resolution, not a new bug), `undecidable` (nothing proved, but the right
 * answer is ambiguous and no `expect.html` settles it), or `passes`.
 * An exact `expect.html` settles every ambiguity visible in the HTML, which
 * includes where words went, but not which live node survived.
 */
const UNCLEARED_KINDS = new Set([
  "duplicate",
  "existence",
  "veto",
  "veto-scope",
  "veto-children",
]);
const clearedByExpect = (a) =>
  (a.scope === "body" || a.scope === "element") &&
  (!UNCLEARED_KINDS.has(a.kind) ||
    (a.kind === "existence" && a.reason === "unsettled-collision"));

/** Violations that are never a resolution, even when the reference shares
 * them: lost or duplicated content and identity, crashes, a broken contract. */
const HARD = new Set([
  "loss",
  "duplication",
  "crash",
  "fast-full",
  "clean-not-remote",
  "intent",
  "identity-lost",
  "identity-duplicated",
  "identity-relabelled",
  "input-mutated",
  "anonymous-structure",
]);

export async function verdict(cur, ref, raw) {
  let c;
  let why;
  try {
    c = normalize(raw);
    why = invalid(c);
  } catch (e) {
    return { status: "invalid", reason: "inputs do not parse: " + e.message };
  }
  if (why) return { status: "invalid", reason: why };
  const now = await judge(cur, raw);
  const ambiguous = now.ambiguous || [];
  if (!now.violations.length) {
    if (c.expect?.html === undefined) {
      if (ambiguous.length)
        return { status: "undecidable", ambiguous, fast: now.fast };
      return { status: "passes", fast: now.fast };
    }
    if (ambiguous.some((a) => !clearedByExpect(a)))
      return { status: "undecidable", ambiguous, fast: now.fast };
    return { status: "passes", fast: now.fast };
  }
  if (
    now.violations.some(
      (v) => v.prop === "crash" && /unknown option/.test(v.error || ""),
    )
  )
    return {
      status: "invalid",
      reason: "an option the engine rejects by design",
      violations: now.violations,
    };
  const props = new Set(now.violations.map((v) => v.prop));
  if (props.has("vacuous") && props.size === 1)
    return { status: "invalid", reason: "vacuous", violations: now.violations };
  const was = ref ? await judge(ref, raw, { parity: false }) : null;
  const same =
    was && was.obs && now.obs && differingFields(was.obs, now.obs).length === 0;
  const refWitnesses = new Set(witnessesOf(was?.violations || []));
  const fresh = now.violations.filter((v) => !refWitnesses.has(canonical(v)));
  const status =
    was && (same || !fresh.length) && ![...props].some((p) => HARD.has(p))
      ? "reference"
      : "counterexample";
  return {
    status,
    signature: signatureOf(raw, now.violations),
    violations: now.violations,
    ambiguous,
    beyondReference: fresh,
    reference: was ? { violations: was.violations, same } : null,
    fast: now.fast,
  };
}
