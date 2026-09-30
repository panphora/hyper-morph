import { parse } from "../../node/lib/dom.js";
import { normalize, prepare, runCase, differingFields } from "./runner.js";

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

function nearest(el, idOf) {
  for (let x = el; x && x.nodeType === 1; x = x.parentNode) {
    const id = idOf(x);
    if (id) return id;
  }
  return null;
}

const parentId = (el, idOf) => nearest(el.parentNode, idOf) || "(root)";

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
  const { p, report } = obs.raw;
  const idB = idReader(c, p.sidB, p.base);
  const idCap = idReader(c, p.sidCap, p.cap);
  const idR = idReader(c, p.sidR, p.remote);
  const merged = new Map(p.sidL);
  const known = new Set([
    ...p.sidB.values(),
    ...p.sidCap.values(),
    ...p.sidR.values(),
  ]);
  if (c.identity === "clay" || c.identity === "plain")
    for (const [el, id] of report.identities || []) {
      if (known.has(id)) merged.set(el, id);
      else if (id === (el.getAttribute("data-id") || el.getAttribute("id")))
        continue;
      else if (merged.has(el)) merged.set(el, "~fresh:" + id);
    }
  const idG = idReader(c, merged, obs.raw.liveRoot);
  return { idB, idCap, idR, idG };
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
function destination(c, obs) {
  if (c.shape === "pure" || c.identity === "default") return [];
  const { p } = obs.raw;
  const { idB, idCap, idR, idG } = sides(c, obs);
  const B = index(p.base, idB),
    L = index(p.cap, idCap),
    R = index(p.remote, idR);
  const out = [];
  const liveOf = new Map();
  for (const [el, id] of p.sidL) liveOf.set("$" + id, el);
  for (const [id, capEl] of L) {
    if (id.startsWith("@")) {
      const liveEl = p.capToLive.get(capEl);
      if (liveEl) liveOf.set(id, liveEl);
    }
  }
  for (const [id, liveEl] of liveOf) {
    if (!L.has(id)) continue;
    const exists = three(B.has(id), true, R.has(id));
    if (exists !== true) continue;
    const r = R.get(id);
    if (r && r.tagName !== liveEl.tagName) continue;
    const pb = B.has(id) ? parentId(B.get(id), idB) : undefined;
    const pl = parentId(L.get(id), idCap);
    const pr = r ? parentId(r, idR) : undefined;
    const want = pb === undefined ? (pr ?? pl) : three(pb, pl, pr ?? pb);
    if (
      !obs.raw.liveRoot.contains(liveEl) &&
      !contentContains(obs.raw.liveRoot, liveEl)
    ) {
      out.push({ prop: "identity-lost", id, want });
      continue;
    }
    if (want === undefined) continue;
    const gotParent = parentId(liveEl, idG);
    if (gotParent !== want)
      out.push({ prop: "destination", id, want, got: gotParent });
  }
  return out;
}

/** Siblings keep the order the three-way answer gives each pair of them:
 * a reorder only one side made lands; one both made differently is a
 * reported conflict. */
function order(c, obs) {
  if (c.shape === "pure" || c.identity === "default") return [];
  if (
    (obs.raw.report.conflicts || []).some((x) => x.detail === "both-reordered")
  )
    return [];
  const { p } = obs.raw;
  const { idB, idCap, idR, idG } = sides(c, obs);
  const orderOf = (root, idOf) => {
    const pos = new Map();
    const all = [
      root.documentElement || root,
      ...(root.documentElement || root).querySelectorAll("*"),
    ];
    for (const el of all) {
      const pid = idOf(el) || (el.tagName === "BODY" ? "(body)" : null);
      if (!pid) continue;
      [...el.children]
        .map(idOf)
        .filter(Boolean)
        .forEach((id, i) => pos.set(id, [pid, i]));
    }
    return pos;
  };
  const B = orderOf(p.base, idB),
    L = orderOf(p.cap, idCap),
    R = orderOf(p.remote, idR),
    G = orderOf(obs.raw.liveRoot, idG);
  const out = [];
  const ids = [...G.keys()].filter((id) => B.has(id) && L.has(id) && R.has(id));
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = [ids[i], ids[j]];
      const same = [B, L, R, G].every((m) => m.get(x)[0] === m.get(y)[0]);
      if (!same) continue;
      const before = (m) => m.get(x)[1] < m.get(y)[1];
      const want = three(before(B), before(L), before(R));
      if (want !== undefined && want !== before(G))
        out.push({ prop: "order", pair: [x, y], want: want ? "x<y" : "y<x" });
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
 * remote has them. */
function regions(c, obs) {
  const out = [];
  const { p } = obs.raw;
  if (c.options.ignore) {
    const before = parse(p.liveBefore);
    const was = [...before.querySelectorAll(c.options.ignore)].map(
      (e) => e.outerHTML,
    );
    const now = [...obs.raw.liveRoot.querySelectorAll(c.options.ignore)].map(
      (e) => e.outerHTML,
    );
    for (const html of was)
      if (!now.includes(html)) out.push({ prop: "ignored-changed", html });
  }
  if (c.options.remoteWins) {
    const want = [...p.remote.querySelectorAll(c.options.remoteWins)].map(
      (e) => e.outerHTML,
    );
    const now = [
      ...obs.raw.liveRoot.querySelectorAll(c.options.remoteWins),
    ].map((e) => e.outerHTML);
    if (JSON.stringify(want) !== JSON.stringify(now))
      out.push({ prop: "remote-wins-differs", want, got: now });
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
  const dupSids = (m) => {
    const seen = new Set(),
      dup = new Set();
    for (const id of m.values()) (seen.has(id) ? dup : seen).add(id);
    return [...dup];
  };
  return {
    remoteChanged: ser(p.base) !== ser(p.remote),
    localChanged: ser(p.base) !== ser(p.cap),
    liveDiffers: p.liveBefore !== "<!DOCTYPE html>" + ser(p.cap),
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

/** Why a case cannot count as evidence, or null. */
export function invalid(c, f = facts(c)) {
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
  for (const req of c.requires || [])
    if (req in f && !f[req])
      return `requires ${req}, which the inputs do not create`;
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
      obs: null,
    };
  }
  const h = c.options.hooks || {};
  const vetoed = h.vetoAdd || h.vetoRemove || h.vetoMorph || h.vetoAttr;
  const v = [
    ...(vetoed
      ? []
      : [
          ...conservation(c, obs),
          ...placement(c, obs),
          ...destination(c, obs),
          ...order(c, obs),
        ]),
    ...regions(c, obs),
    ...intent(c, obs),
  ];
  if (
    c.shape === "clean" &&
    !c.live &&
    !vetoed &&
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
  return { violations: v, obs, fast };
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

export const signatureOf = (c, violations) => {
  const n = normalize(c);
  const props = [...new Set(violations.map((v) => v.prop))].sort().join("+");
  return `${props}|${n.shape}|${n.identity}${n.options.ignore || n.options.remoteWins ? "|regions" : ""}${n.live ? "|live" : ""}`;
};

/**
 * The oracle's verdict on a candidate: `invalid` (the inputs do not create
 * what they claim), `passes` (the current engine is right), `reference`
 * (wrong in a way the frozen reference produces byte for byte and node for
 * node, and no content is lost: a resolution, not a bug), or
 * `counterexample`.
 */
export async function verdict(cur, ref, raw) {
  const c = normalize(raw);
  let why;
  try {
    why = invalid(c);
  } catch (e) {
    return { status: "invalid", reason: "inputs do not parse: " + e.message };
  }
  if (why) return { status: "invalid", reason: why };
  const now = await judge(cur, raw);
  if (!now.violations.length) return { status: "passes", fast: now.fast };
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
    was &&
    was.obs &&
    now.obs &&
    was.obs.html === now.obs.html &&
    JSON.stringify(was.obs.destinations) ===
      JSON.stringify(now.obs.destinations);
  const key = (v) =>
    `${v.prop}:${v.id ?? v.word ?? v.pair ?? ""}:${v.want ?? ""}:${v.got ?? ""}`;
  const refKeys = new Set((was?.violations || []).map(key));
  const fresh = now.violations.filter((v) => !refKeys.has(key(v)));
  const hard = [
    "loss",
    "duplication",
    "crash",
    "fast-full",
    "clean-not-remote",
  ];
  const status =
    was && (same || !fresh.length) && ![...props].some((p) => hard.includes(p))
      ? "reference"
      : "counterexample";
  return {
    status,
    signature: signatureOf(raw, now.violations),
    violations: now.violations,
    beyondReference: fresh.map(key),
    reference: was ? { violations: was.violations, same } : null,
    fast: now.fast,
  };
}
