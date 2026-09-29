import { parse, doc } from "../node/lib/dom.js";
import { BLOCK_TAGS, MARK_TAGS } from "../../src/inline-merge.js";
import {
  orderedSpan,
  projectSpan,
  staticSpan,
} from "../../src/recovery-dom.js";

// The observer the differential harness compares two engines by: the merged
// bytes, where every pre-merge live node went, which identities were adopted,
// and the merge's report. Kept out of the test file so what it must see
// (template content, new parents, identity recipients) can be tested directly.

export const contentOf = (n) =>
  n.nodeType === 1 && n.tagName === "TEMPLATE" && n.content ? n.content : null;

/** Visit a tree, entering template content; `owners` maps each content
 * fragment to its template. */
function walk(root, visit, owners) {
  const go = (n) => {
    visit(n);
    const content = contentOf(n);
    if (content) {
      owners.set(content, n);
      go(content);
    }
    for (let c = n.firstChild; c; c = c.nextSibling) go(c);
  };
  go(root);
}

const parentIn = (n, owners) =>
  n.nodeType === 11 ? owners.get(n) || null : n.parentNode;

const indexIn = (n, owners) =>
  n.nodeType === 11
    ? "content"
    : Array.prototype.indexOf.call(n.parentNode.childNodes, n);

/** A node's position in the final tree, as child indexes from the root. */
function address(root, n, owners) {
  const path = [];
  for (let x = n; x && x !== root; x = parentIn(x, owners))
    path.push(indexIn(x, owners));
  return "@" + path.reverse().join("/");
}

export function labelTree(root) {
  const ids = new WeakMap();
  const nodes = [];
  walk(
    root,
    (n) => {
      ids.set(n, nodes.length);
      nodes.push(n);
    },
    new WeakMap(),
  );
  return { root, ids, nodes };
}

/** After the merge: which nodes are reachable, and the template owners. */
export function finalTree(root) {
  const seen = new Set();
  const owners = new WeakMap();
  walk(root, (n) => seen.add(n), owners);
  return { root, seen, owners };
}

export const nameOf = (label, final, n) => {
  const id = label.ids.get(n);
  if (id !== undefined) return id;
  return final.seen.has(n) ? address(final.root, n, final.owners) : "detached";
};

/** Where every pre-merge live node went: detached from the final tree, or,
 * connected, the name of its parent there and its index in it. */
export function destinations(label, final) {
  return label.nodes.map((n, i) => {
    if (!final.seen.has(n)) return [i, 0];
    if (n === label.root) return [i, 1];
    const parent = parentIn(n, final.owners);
    return [i, 1, nameOf(label, final, parent), indexIn(n, final.owners)];
  });
}

export const identityList = (identities, label, final) =>
  identities
    .map(([el, id]) => JSON.stringify([nameOf(label, final, el), id]))
    .sort();

export const nodeList = (nodes, label, final) =>
  nodes.map((n) => JSON.stringify(nameOf(label, final, n))).sort();

/** The capture's nodes, paired with the live nodes they became. */
export function lockstepMap(a, b) {
  const m = new WeakMap();
  const go = (x, y) => {
    m.set(x, y);
    const cx = contentOf(x),
      cy = contentOf(y);
    if (cx && cy) go(cx, cy);
    for (
      let p = x.firstChild, q = y.firstChild;
      p && q;
      p = p.nextSibling, q = q.nextSibling
    )
      go(p, q);
  };
  go(a, b);
  return m;
}

/** A legacy conflict record as the diff compares it: kind, detail, the
 * scalar values, `range`, and the `node`/`el` pointers by name. */
const scalar = (v) =>
  v === undefined || v === null || typeof v === "string"
    ? v === undefined
      ? null
      : v
    : v.nodeType
      ? "node"
      : "unit";
const pointer = (n, label, final) =>
  n === undefined || n === null ? null : nameOf(label, final, n);
export const conflictList = (conflicts, label, final) =>
  conflicts.map((c) => ({
    kind: c.kind,
    detail: c.detail === undefined ? null : c.detail,
    name: c.name === undefined ? null : c.name,
    base: scalar(c.base),
    local: scalar(c.local),
    remote: scalar(c.remote),
    resolved: scalar(c.resolved),
    range: c.range === undefined ? null : c.range,
    node: pointer(c.node, label, final),
    el: pointer(c.el, label, final),
  }));

/** Whether a record's `node`/`el` is the node its recovery names: the
 * subject's live node (or, for a run, that node's parent), or on the pure
 * route the subject's first merged path. E4b fills these where they were
 * null, and the harness lets such a fill stand in for the reference's value
 * only when this says it is right. */
const explained = (c, final, pure) => {
  const r = c.recovery;
  if (!r) return { node: false, el: false };
  const ok = (n, allowParent) => {
    if (!n) return false;
    if (pure) {
      const at = address(final.root, n, final.owners);
      return r.subject.merged.some(
        (p) =>
          at === "@" + p.join("/") ||
          (allowParent && at === "@" + p.slice(0, -1).join("/")),
      );
    }
    return (
      r.subject.live.includes(n) ||
      (allowParent &&
        r.subject.live.some((x) => parentIn(x, final.owners) === n))
    );
  };
  return {
    node:
      c.kind === "text" &&
      (r.subject.nodeType === 8 ||
        c.node?.parentElement?.tagName === "SCRIPT" ||
        c.node?.tagName === "SCRIPT") &&
      ok(c.node, false),
    el: c.kind === "structure" && ok(c.el, r.subject.nodeType !== 1),
  };
};
export const pointerList = (conflicts, final, pure) =>
  conflicts.map((c) => explained(c, final, pure));

export const decisionList = (decisions, label, final) =>
  decisions.map((d) => ({
    kind: d.kind,
    source: d.source === undefined ? null : d.source,
    applied: d.applied === undefined ? null : d.applied,
    node: pointer(d.node, label, final),
    el: pointer(d.el, label, final),
  }));

const pathList = (paths) => paths.map((p) => p.join("/"));

const refProjection = (r, name) =>
  r === null
    ? null
    : {
        key: r.key,
        nodeType: r.nodeType,
        base: pathList(r.base),
        local: pathList(r.local),
        remote: pathList(r.remote),
        merged: pathList(r.merged),
        live: r.live.map(name),
      };

const pointProjection = (p) =>
  p === null ? null : [p.path.join("/"), p.offset];

const sideProjection = (s) =>
  s === null
    ? null
    : {
        text: s.text,
        start: s.start,
        end: s.end,
        fragment: s.fragment,
        span: [pointProjection(s.span.start), pointProjection(s.span.end)],
        scope: [pointProjection(s.scope.start), pointProjection(s.scope.end)],
      };

const liveSpanProjection = (s, name) =>
  s === null
    ? null
    : [
        name(s.startContainer),
        s.startOffset,
        name(s.endContainer),
        s.endOffset,
      ];

const placementProjection = (p, name) =>
  p === null
    ? null
    : {
        parent: refProjection(p.parent, name),
        before: p.before.map((r) => refProjection(r, name)),
        after: p.after.map((r) => refProjection(r, name)),
      };

/** Every conflict's recovery as JSON-comparable data, live nodes by name;
 * `shared` is the index of the first conflict holding the same object. */
export const recoveryList = (conflicts, label, final) => {
  const name = (n) => nameOf(label, final, n);
  return conflicts.map((c) => {
    const r = c.recovery;
    if (!r) return null;
    const s = r.structure;
    return {
      version: r.version,
      key: r.key,
      localLost: r.localLost,
      applied: r.applied,
      unavailable: r.unavailable,
      shared: conflicts.findIndex((o) => o.recovery === r),
      subject: refProjection(r.subject, name),
      text: r.text
        ? {
            encoding: r.text.encoding,
            base: sideProjection(r.text.base),
            local: sideProjection(r.text.local),
            remote: sideProjection(r.text.remote),
            merged: sideProjection(r.text.merged),
            liveSpan: liveSpanProjection(r.text.liveSpan, name),
            liveScope: liveSpanProjection(r.text.liveScope, name),
          }
        : null,
      attribute: r.attribute || null,
      structure: s
        ? {
            localAction: s.localAction,
            remoteAction: s.remoteAction,
            fragmentKind: s.fragmentKind,
            localFragment: s.localFragment,
            localPlacement: placementProjection(s.localPlacement, name),
            remotePlacement: placementProjection(s.remotePlacement, name),
            mergedPlacement: placementProjection(s.mergedPlacement, name),
            localOrder:
              s.localOrder && s.localOrder.map((x) => refProjection(x, name)),
            mergedOrder:
              s.mergedOrder && s.mergedOrder.map((x) => refProjection(x, name)),
          }
        : null,
    };
  });
};

const LIVE_ONLY = new Set([
  "live",
  "liveSpan",
  "liveScope",
  "applied",
  "unavailable",
]);

/** The recovery list without its live side: what every route must agree on. */
export const staticRecovery = (list) =>
  JSON.stringify(list, (k, v) => (LIVE_ONLY.has(k) ? undefined : v));

const LEGACY_KEYS = {
  text: ["kind", "node", "base", "local", "remote", "resolved"],
  attr: ["kind", "el", "name", "base", "local", "remote", "resolved"],
  structure: ["kind", "el", "detail"],
};
const INLINE_TEXT_KEYS = ["range", "bs", "be", "lss", "lse", "rss", "rse"];
const ACTIONS = new Set([
  "edited",
  "deleted",
  "moved",
  "inserted",
  "reordered",
  "kept",
]);
const sameSet = (a, b) =>
  a.length === b.length && a.every((x) => b.includes(x));
const isPath = (p) =>
  Array.isArray(p) &&
  p.every((x) => x === "content" || (Number.isInteger(x) && x >= 0));
const isPoint = (p) =>
  p && isPath(p.path) && Number.isInteger(p.offset) && p.offset >= 0;

const projectionOptions = (scope, text, encoding) => {
  const options = text.includes("\u001e") ? {} : { blocks: new Set() };
  if (projectSpan(scope, encoding, options) === text) return options;
  if (encoding !== "html" || !orderedSpan(scope) || !text.includes("\ufffc"))
    return null;
  const range = scope.startContainer.ownerDocument.createRange();
  range.setStart(scope.startContainer, scope.startOffset);
  range.setEnd(scope.endContainer, scope.endOffset);
  const root = range.commonAncestorContainer;
  const candidates = [],
    blocks = new Set();
  const walk = (n) => {
    if (
      n !== root &&
      n.nodeType === 1 &&
      BLOCK_TAGS.has(n.tagName) &&
      text.includes("\u001e")
    )
      blocks.add(n);
    if (
      n.nodeType === 1 &&
      range.intersectsNode(n) &&
      (MARK_TAGS.has(n.tagName) || blocks.has(n))
    )
      candidates.push(n);
    for (const child of n.childNodes) walk(child);
  };
  walk(root);
  const atoms = new Set();
  const search = (i) => {
    if (i === candidates.length) {
      const choice = { blocks, atoms };
      return projectSpan(scope, encoding, choice) === text
        ? { blocks: new Set(blocks), atoms: new Set(atoms) }
        : null;
    }
    const plain = search(i + 1);
    if (plain) return plain;
    const n = candidates[i],
      block = blocks.has(n);
    if (block) blocks.delete(n);
    atoms.add(n);
    const opaque = search(i + 1);
    atoms.delete(n);
    if (block) blocks.add(n);
    return opaque;
  };
  return search(0);
};

/**
 * Everything wrong with a report's recovery data, as strings: the contract's
 * shape and invariants, and that every live node it names is in the final
 * tree. `pure` is the merge3 route, where nothing is applied.
 */
export function recoveryProblems(
  conflicts,
  final,
  pure,
  roots = {},
  requireApplied = false,
) {
  const out = [];
  const byKey = new Map();
  const bad = (i, what) => out.push(`conflict ${i}: ${what}`);
  const checkRef = (i, r, what) => {
    if (r === null) return;
    if (!r || typeof r.key !== "string") return bad(i, `${what}: no key`);
    if (![1, 3, 8].includes(r.nodeType))
      return bad(i, `${what}: nodeType ${r.nodeType}`);
    for (const side of ["base", "local", "remote", "merged"])
      if (!Array.isArray(r[side]) || !r[side].every(isPath))
        bad(i, `${what}: ${side} paths`);
    if (!Array.isArray(r.live)) return bad(i, `${what}: live is not an array`);
    if (pure && r.live.length) bad(i, `${what}: live nodes on the pure route`);
    for (const n of r.live)
      if (!final || !final.seen.has(n))
        bad(i, `${what}: live node not in the final tree`);
  };
  const checkPlacement = (i, p, what) => {
    if (p === null) return;
    checkRef(i, p.parent, `${what}.parent`);
    for (const list of ["before", "after"]) {
      if (!Array.isArray(p[list]))
        return bad(i, `${what}.${list} is not an array`);
      p[list].forEach((r, j) => checkRef(i, r, `${what}.${list}[${j}]`));
    }
  };
  const checkSide = (i, s, what, encoding, root) => {
    if (s === null) return;
    if (typeof s.text !== "string") return bad(i, `${what}.text`);
    if (
      !(
        Number.isInteger(s.start) &&
        Number.isInteger(s.end) &&
        0 <= s.start &&
        s.start <= s.end &&
        s.end <= s.text.length
      )
    )
      bad(i, `${what}: range ${s.start}..${s.end} in ${s.text.length}`);
    if (typeof s.fragment !== "string") bad(i, `${what}.fragment`);
    for (const k of ["span", "scope"])
      if (!s[k] || !isPoint(s[k].start) || !isPoint(s[k].end))
        bad(i, `${what}.${k}`);
    const collapsed = (s) =>
      s &&
      JSON.stringify(s.start.path) === JSON.stringify(s.end.path) &&
      s.start.offset === s.end.offset;
    if (s.start === s.end && !collapsed(s.span))
      bad(i, `${what}: empty span not collapsed`);
    if (!s.text.length && !collapsed(s.scope))
      bad(i, `${what}: empty scope not collapsed`);
    if (root) {
      const options = projectionOptions(
        staticSpan(root, s.scope),
        s.text,
        encoding,
      );
      for (const [part, want] of [
        ["span", s.text.slice(s.start, s.end)],
        ["scope", s.text],
      ]) {
        const span = staticSpan(root, s[part]);
        if (!orderedSpan(span)) bad(i, `${what}.${part}: unordered or invalid`);
        if (!options || projectSpan(span, encoding, options) !== want)
          bad(i, `${what}.${part}: projection differs`);
      }
    }
  };
  const checkLiveSpan = (i, s, what) => {
    if (s === null) return;
    for (const c of ["startContainer", "endContainer"])
      if (!final || !final.seen.has(s[c]))
        bad(i, `${what}.${c} not in the final tree`);
    for (const o of ["startOffset", "endOffset"])
      if (!Number.isInteger(s[o]) || s[o] < 0) bad(i, `${what}.${o}`);
    if (!orderedSpan(s)) bad(i, `${what}: unordered or invalid`);
  };
  conflicts.forEach((c, i) => {
    const r = c.recovery;
    const legacy = LEGACY_KEYS[c.kind];
    if (!legacy) return bad(i, `unknown kind ${c.kind}`);
    const allowed = [...legacy, "node", "el", "recovery"];
    if (c.kind === "text") allowed.push(...INLINE_TEXT_KEYS);
    if (c.kind === "structure")
      allowed.push("base", "local", "remote", "resolved");
    const keys = Object.keys(c);
    if (
      !legacy.every((k) => keys.includes(k)) ||
      !keys.every((k) => allowed.includes(k))
    )
      bad(i, `record keys ${Object.keys(c).join(",")}`);
    if (!r || typeof r !== "object") return bad(i, "no recovery");
    if (r.version !== 1) bad(i, `version ${r.version}`);
    if (typeof r.localLost !== "boolean") bad(i, "localLost");
    if (typeof r.applied !== "boolean") bad(i, "applied");
    if (requireApplied && !pure && !r.applied)
      bad(i, "ordinary merge has unavailable recovery");
    if (pure && r.applied) bad(i, "applied on the pure route");
    if (![null, "hook-veto", "missing-output"].includes(r.unavailable))
      bad(i, `unavailable ${r.unavailable}`);
    if (r.applied && r.unavailable !== null)
      bad(i, "applied with unavailable set");
    if (pure && r.unavailable !== null)
      bad(i, "unavailable set on the pure route");
    if (!pure && !r.applied && r.unavailable === null)
      bad(i, "not applied with no unavailable");
    checkRef(i, r.subject, "subject");
    const sharedComment =
      r.subject.nodeType === 8 &&
      r.text &&
      r.structure &&
      r.structure.fragmentKind === "comment" &&
      ["text", "structure"].includes(c.kind) &&
      conflicts.some(
        (other) =>
          other !== c &&
          other.recovery === r &&
          other.kind === (c.kind === "text" ? "structure" : "text"),
      );
    const prefix = `${
      sharedComment ? "structure" : c.kind === "attr" ? "attr" : c.kind
    }:${r.subject && r.subject.key}:`;
    if (typeof r.key !== "string" || !r.key.startsWith(prefix))
      bad(i, `key ${r.key} (expected ${prefix}...)`);
    if (byKey.has(r.key) && byKey.get(r.key) !== r)
      bad(i, `key ${r.key} on two recovery objects`);
    byKey.set(r.key, r);
    const parts = ["text", "attribute", "structure"].filter((k) => r[k]);
    const want = c.kind === "attr" ? "attribute" : c.kind;
    if (
      sharedComment
        ? !sameSet(parts, ["text", "structure"])
        : parts.length !== 1 || parts[0] !== want
    )
      bad(i, `parts ${parts.join(",")} for ${c.kind}`);
    if (r.text) {
      if (!["plain", "html"].includes(r.text.encoding))
        bad(i, `encoding ${r.text.encoding}`);
      for (const side of ["base", "local", "remote", "merged"])
        checkSide(
          i,
          r.text[side],
          `text.${side}`,
          r.text.encoding,
          roots[side],
        );
      if (r.text.merged === null) bad(i, "text.merged is null");
      checkLiveSpan(i, r.text.liveSpan, "text.liveSpan");
      checkLiveSpan(i, r.text.liveScope, "text.liveScope");
      if (r.applied && !r.text.liveSpan)
        bad(i, "applied text with no liveSpan");
      const M = r.text.merged;
      const options = projectionOptions(
        r.text.liveScope,
        M.text,
        r.text.encoding,
      );
      for (const [part, want] of [
        ["liveSpan", M.text.slice(M.start, M.end)],
        ["liveScope", M.text],
      ]) {
        const span = r.text[part];
        if (!span) continue;
        if (
          want === "" &&
          (span.startContainer !== span.endContainer ||
            span.startOffset !== span.endOffset)
        )
          bad(i, `${part}: empty span not collapsed`);
        if (!options || projectSpan(span, r.text.encoding, options) !== want)
          bad(i, `${part}: projection differs`);
      }
    }
    if (r.attribute) {
      const a = r.attribute;
      if (!(a.namespaceURI === null || typeof a.namespaceURI === "string"))
        bad(i, "attribute.namespaceURI");
      if (
        typeof a.localName !== "string" ||
        typeof a.qualifiedName !== "string"
      )
        bad(i, "attribute names");
      if (a.namespaceURI === null && a.qualifiedName !== c.name)
        bad(i, `attribute ${a.qualifiedName} is not ${c.name}`);
    }
    if (r.structure) {
      const s = r.structure;
      if (!ACTIONS.has(s.localAction) || !ACTIONS.has(s.remoteAction))
        bad(i, `actions ${s.localAction}/${s.remoteAction}`);
      if (!["element", "text", "comment"].includes(s.fragmentKind))
        bad(i, `fragmentKind ${s.fragmentKind}`);
      if (!(s.localFragment === null || typeof s.localFragment === "string"))
        bad(i, "localFragment");
      for (const k of ["localPlacement", "remotePlacement", "mergedPlacement"])
        checkPlacement(i, s[k], k);
      for (const k of ["localOrder", "mergedOrder"])
        if (s[k] !== null && s[k] !== undefined)
          s[k].forEach((x, j) => checkRef(i, x, `${k}[${j}]`));
      if ((s.localOrder === null) !== (s.mergedOrder === null))
        bad(i, "one order without the other");
    }
  });
  return out;
}

/** A report's fields as the diff compares them: node lists by name. */
const reported = (report, label, final, roots) => ({
  adoptedIdentities: identityList(report.identities || [], label, final),
  conflicts: conflictList(report.conflicts || [], label, final),
  pointers: pointerList(report.conflicts || [], final, false),
  decisions: decisionList(report.decisions || [], label, final),
  localDiverged: report.localDiverged,
  moved:
    report.moved === undefined ? null : nodeList(report.moved, label, final),
  replaced:
    report.replaced === undefined
      ? null
      : nodeList(report.replaced, label, final),
  recovery: recoveryList(report.conflicts || [], label, final),
  recoveryProblems: recoveryProblems(
    report.conflicts || [],
    final,
    false,
    roots,
    true,
  ),
  stats: report.stats,
});

/**
 * One engine's view of one input in one shape: the merged bytes and every
 * live-node, identity, conflict and decision field a merge can observe.
 */
export async function observe(engine, shape, inputs) {
  const { b, l, r } = inputs;
  const rootsFor = (merged) => {
    if (shape === "element") {
      const makeTemplate = (html) => {
        const t = merged.ownerDocument.createElement("template");
        t.innerHTML = html;
        return t;
      };
      return {
        base: makeTemplate(b),
        local: parse(doc(`<section>${l}</section>`)).body.firstElementChild,
        remote: makeTemplate(r),
        merged: makeTemplate(merged.innerHTML),
      };
    }
    return {
      base: parse(doc(b)).documentElement,
      local: parse(doc(shape === "clean" ? b : l)).documentElement,
      remote: parse(doc(r)).documentElement,
      merged,
    };
  };
  if (shape === "pure") {
    // The pure merge without hooks omits subtrees identical on both sides:
    // its output is an instruction for apply, not a document. The fuzz gate's
    // pure merge reads the whole output, so ask for a visit.
    const res = engine.merge3(parse(doc(b)), parse(doc(l)), parse(doc(r)), {
      hooks: { beforeNodeMorphed: () => {} },
    });
    const label = labelTree(res.doc.documentElement);
    const final = finalTree(res.doc.documentElement);
    return {
      html: res.doc.body.innerHTML,
      nodeDestinations: [],
      adoptedIdentities: [],
      conflicts: conflictList(res.conflicts, label, final),
      pointers: pointerList(res.conflicts, final, true),
      decisions: decisionList(res.decisions, label, final),
      localDiverged: res.localDiverged,
      moved: [],
      replaced: [],
      recovery: recoveryList(res.conflicts, label, final),
      recoveryProblems: recoveryProblems(
        res.conflicts,
        final,
        true,
        res.conflicts.length ? rootsFor(res.doc.documentElement) : {},
      ),
      stats: res.stats,
    };
  }
  if (shape === "element") {
    const live = parse(doc("<section>" + l + "</section>"));
    const label = labelTree(live.documentElement);
    const report = await engine.morphElement(live.body.firstElementChild, r, {
      base: b,
      children: true,
    });
    const final = finalTree(live.documentElement);
    return {
      html: live.body.innerHTML,
      nodeDestinations: destinations(label, final),
      ...reported(
        report,
        label,
        final,
        report.conflicts.length ? rootsFor(live.body.firstElementChild) : {},
      ),
    };
  }
  const live = parse(doc(shape === "clean" ? b : l));
  const label = labelTree(live.documentElement);
  let base, local;
  if (shape === "clean") {
    const cap = parse(doc(b));
    const toLive = lockstepMap(cap.documentElement, live.documentElement);
    base = cap;
    local = {
      root: cap.documentElement,
      toLive: (n) => toLive.get(n) || null,
    };
  } else {
    base = doc(b);
  }
  const report = await engine.mergeDocument({
    live,
    base,
    local,
    remote: doc(r),
  });
  const final = finalTree(live.documentElement);
  return {
    html: live.body.innerHTML,
    nodeDestinations: destinations(label, final),
    ...reported(
      report,
      label,
      final,
      report.conflicts.length ? rootsFor(live.documentElement) : {},
    ),
  };
}
