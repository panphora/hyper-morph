/**
 * hyper-morph — three-way merge of HTML documents applied to a live DOM.
 *
 *   mergeDocument({ live, base, remote, ... })  three-way merge into `live`
 *   morphDocument(live, remote, options)         two-way (base = local)
 *   morphElement(oldEl, newContent, options)    two- or three-way on one element
 *   merge3(base, local, remote, options)         the pure merge, no DOM mutation
 *
 * All DOM mutation happens synchronously inside the call; the returned
 * Promise resolves once inserted stylesheets and external scripts have
 * loaded (or errored).
 */

import { toDocument, createParseCache, syncDoctype } from "./parse.js";
import { makeIgnore } from "./ignore.js";
import { emptyStats } from "./stats.js";
import { importMap, tieredIdentity, defaultIdentity } from "./identity.js";
import { merge3 as mergeCore } from "./merge.js";
import { apply } from "./apply.js";
import { resolveLive, remapLive } from "./recovery.js";
import {
  collectBodyScriptSignatures,
  executeNewScripts,
  makeInertScript,
  isHtmlScript,
} from "./scripts.js";

export { merge3Text, diff } from "./text-merge.js";
export { createIdentityStore, importMap, tieredIdentity } from "./identity.js";
export { mergeJson, mergeScriptText } from "./hyper-morph-json-merge.js";
export {
  parseJsonRelaxed,
  parseRulesRelaxed,
} from "./hyper-morph-json-parse.js";
export { createParseCache } from "./parse.js";
export { findChangedRoots, spliceProtected } from "./legacy-splice.js";
export { morph } from "./compat.js";
import { morph } from "./compat.js";

const KNOWN = new Set([
  "live",
  "base",
  "remote",
  "local",
  "identity",
  "ignore",
  "remoteWins",
  "ignoreAttribute",
  "conflicts",
  "protectFocusedValue",
  "restoreFocus",
  "head",
  "scripts",
  "formState",
  "children",
  "hooks",
  "beforeApply",
]);
const noop = () => {};

function normalize(o, roots = []) {
  if (!o || typeof o !== "object")
    throw new TypeError("options object required");
  for (const k of Object.keys(o))
    if (!KNOWN.has(k)) throw new TypeError(`unknown option "${k}"`);
  const hooks = Object.assign(
    {
      beforeNodeAdded: noop,
      afterNodeAdded: noop,
      beforeNodeRemoved: noop,
      afterNodeRemoved: noop,
      beforeNodeMorphed: noop,
      afterNodeMorphed: noop,
      beforeAttributeUpdated: noop,
    },
    o.hooks || {},
  );
  const conflicts = o.conflicts || "remote";
  if (!["remote", "local", "both"].includes(conflicts))
    throw new TypeError(`conflicts must be remote, local or both`);
  const formState = o.formState || "attribute";
  if (!["attribute", "property"].includes(formState))
    throw new TypeError(`formState must be attribute or property`);
  const protect = o.protectFocusedValue;
  if (
    protect !== undefined &&
    typeof protect !== "boolean" &&
    protect !== "subtree"
  )
    throw new TypeError(`protectFocusedValue must be a boolean or "subtree"`);
  return {
    ignored: makeIgnore(o.ignore, roots),
    remoteWins: makeIgnore(o.remoteWins, roots),
    ignoreAttribute:
      typeof o.ignoreAttribute === "function" ? o.ignoreAttribute : () => false,
    conflicts,
    protectFocusedValue: protect === undefined ? true : protect,
    restoreFocus: o.restoreFocus !== false,
    head: Object.assign(
      { awaitLoads: false, preserve: () => false },
      o.head || {},
    ),
    scripts: Object.assign(
      { execute: true, merge: true, mergeTags: [] },
      o.scripts || {},
    ),
    formState,
    hooks,
    children: !!o.children,
    beforeApply: typeof o.beforeApply === "function" ? o.beforeApply : null,
  };
}

/**
 * The identity the page authored, from an IdentitySpec: the function itself,
 * or a map spec's `first`, else its `then`. Two elements whose authored
 * identities differ are different elements and never pair; a synthetic id
 * from a map never keeps a pair from forming, since the same element can
 * carry different synthetic ids in two tabs until they have met.
 */
function authoredOf(spec) {
  if (typeof spec === "function") return spec;
  if (spec && typeof spec === "object" && spec.map) {
    if (typeof spec.first === "function") return spec.first;
    if (typeof spec.then === "function") return spec.then;
  }
  return defaultIdentity;
}

/** Resolve an IdentitySpec against a parsed side root. */
function resolveIdentity(spec, root) {
  if (typeof spec === "function") return spec;
  if (spec && typeof spec === "object" && spec.map) {
    const imported = importMap(root, spec.map);
    const then = typeof spec.then === "function" ? spec.then : defaultIdentity;
    if (typeof spec.first === "function") {
      const first = spec.first;
      return (el) => first(el) || imported.get(el) || then(el);
    }
    return (el) => imported.get(el) || then(el);
  }
  return defaultIdentity;
}

/**
 * The pure merge on documents or element roots. See merge.js.
 */
export function merge3(base, local, remote, options = {}) {
  const rootOf = (x) => (x && x.nodeType === 9 ? x.documentElement : x);
  const lRoot = rootOf(local),
    rRoot = rootOf(remote),
    bRoot = rootOf(base) || lRoot;
  const clean = Object.assign({}, options);
  delete clean.live;
  delete clean.base;
  delete clean.remote;
  const o = normalize(clean, [bRoot, lRoot, rRoot].filter(Boolean));
  const id = options.identity || {};
  const stats = emptyStats();
  const result = mergeCore(bRoot, lRoot, rRoot, {
    identity: {
      base: resolveIdentity(id.base, bRoot),
      local: resolveIdentity(id.local, lRoot),
      remote: resolveIdentity(id.remote, rRoot),
    },
    authored: {
      base: authoredOf(id.base),
      local: authoredOf(id.local),
      remote: authoredOf(id.remote),
    },
    skipUnchanged:
      o.hooks.beforeNodeMorphed === noop && o.hooks.afterNodeMorphed === noop,
    ignored: o.ignored,
    remoteWins: o.remoteWins,
    ignoreAttribute: o.ignoreAttribute,
    conflicts: o.conflicts,
    mergeTags: o.scripts.merge === false ? null : o.scripts.mergeTags,
    baseURI:
      (lRoot.ownerDocument && lRoot.ownerDocument.baseURI) || "about:blank",
    localIsBase: !base || base === local,
    childrenOnly: o.children,
    stats,
  });
  delete result.recoveryLinks;
  return result;
}

/**
 * Run merge and apply synchronously on one root pair. Shared by the public
 * entry points.
 */
function run({
  liveRoot,
  baseRoot,
  localRoot,
  remoteRoot,
  toLive,
  options,
  identity,
  childrenOnly,
  isDocument,
}) {
  const o = normalize(
    options,
    [liveRoot, baseRoot, localRoot, remoteRoot].filter(Boolean),
  );
  if (o.ignored(liveRoot)) return { report: emptyReport(), loads: [] };
  const doc = liveRoot.ownerDocument;
  const before = o.scripts.execute
    ? collectBodyScriptSignatures(liveRoot, o.ignored, doc.baseURI)
    : null;

  const stats = emptyStats();
  const result = mergeCore(baseRoot || localRoot, localRoot, remoteRoot, {
    identity: {
      base: resolveIdentity(identity.base, baseRoot || localRoot),
      local: resolveIdentity(identity.local, localRoot),
      remote: resolveIdentity(identity.remote, remoteRoot),
    },
    authored: {
      base: authoredOf(identity.base),
      local: authoredOf(identity.local),
      remote: authoredOf(identity.remote),
    },
    ignored: o.ignored,
    remoteWins: o.remoteWins,
    ignoreAttribute: o.ignoreAttribute,
    conflicts: o.conflicts,
    mergeTags: o.scripts.merge === false ? null : o.scripts.mergeTags,
    baseURI: doc.baseURI,
    localIsBase: !baseRoot,
    childrenOnly,
    stats,
    // With no per-node morph hooks, subtrees identical on both sides need
    // neither output nor a visit; the hook contract fires per matched node.
    skipUnchanged:
      o.hooks.beforeNodeMorphed === noop && o.hooks.afterNodeMorphed === noop,
  });
  if (o.beforeApply) o.beforeApply(result.doc);
  const prof = globalThis.__hyperMorphProfile;
  const tA = prof ? performance.now() : 0;

  const ap = apply(liveRoot, result.root, result, {
    toLive,
    ignored: o.ignored,
    ignoreAttribute: o.ignoreAttribute,
    formState: o.formState,
    protectFocusedValue: o.protectFocusedValue,
    restoreFocus: o.restoreFocus,
    preserve: o.head.preserve,
    hooks: o.hooks,
    childrenOnly,
  });

  if (prof) prof.apply = (prof.apply || 0) + (performance.now() - tA);
  const loads = [];
  if (o.head.awaitLoads) {
    for (const a of ap.applied) {
      if (a.kind !== "insert" || a.node.nodeType !== 1) continue;
      const el = a.node;
      const waits =
        el.tagName === "LINK" &&
        /\bstylesheet\b/i.test(el.getAttribute("rel") || "") &&
        el.getAttribute("href");
      if (waits && el.closest("head"))
        loads.push(
          new Promise((r) => {
            el.addEventListener("load", () => r());
            el.addEventListener("error", () => r());
          }),
        );
    }
  }
  let swapped = null;
  if (before) {
    const ex = executeNewScripts(liveRoot, before, {
      ignored: o.ignored,
      skip: ap.mergedScriptsLive,
      baseURI: doc.baseURI,
      beforeNodeAdded: o.hooks.beforeNodeAdded,
      afterNodeAdded: o.hooks.afterNodeAdded,
    });
    loads.push(...ex.loads);
    swapped = ex.swapped;
  }

  // A merged node's live node: its twin, the text node holding its text
  // (all of them for a run apply left split), or the copy inserted for it; a
  // script apply activated is its fresh element. The report's `node` and
  // `el` keep their twin-first mapping and reach the copies where they used
  // to be null.
  const active = (n) => (swapped && swapped.get(n)) || n;
  const lookup = (m) => {
    if (ap.keptRuns.has(m)) return ap.runOf.get(m);
    const n = ap.liveOf.get(m) || ap.heldBy.get(m) || ap.insertedLive.get(m);
    return n ? active(n) : null;
  };
  const live = (n) => {
    if (!n) return null;
    const twin = ap.liveOf.get(n);
    if (twin) return active(twin);
    const v = lookup(n);
    return Array.isArray(v) ? v[0] : v;
  };
  if (result.recoveryLinks) {
    const liveAttr = (el, a, resolved) => {
      const v = a.namespaceURI
        ? el.getAttributeNS(a.namespaceURI, a.localName)
        : el.getAttribute(a.qualifiedName);
      return v === resolved;
    };
    resolveLive(result.conflicts, result.recoveryLinks, {
      lookup,
      vetoed: ap.vetoed,
      vetoedAttrs: ap.vetoedAttrs,
      liveAttr,
      ignored: o.ignored,
    });
  }
  const report = {
    applied: ap.applied,
    decisions: result.decisions.map((d) =>
      Object.assign({}, d, {
        node: d.node ? live(d.node) : null,
        el: d.el ? live(d.el) : null,
        applied: !!(d.node ? live(d.node) : d.el ? live(d.el) : false),
      }),
    ),
    conflicts: result.conflicts.map((c) =>
      Object.assign({}, c, {
        node: c.node ? live(c.node) : c.node,
        el: c.el ? live(c.el) : c.el,
      }),
    ),
    localDiverged: result.localDiverged,
    identities: ap.identities,
    moved: ap.moved,
    replaced: ap.replaced,
    stats,
  };
  return { report, loads };
}

const parseCaches = new WeakMap();

/** The report of a call that touched nothing: an ignored root. */
function emptyReport() {
  return {
    applied: [],
    decisions: [],
    conflicts: [],
    localDiverged: false,
    identities: [],
    moved: [],
    replaced: [],
    stats: emptyStats(),
  };
}

/**
 * @param {object} options - see docs/rewrite-plan.md 4.3
 * @returns {Promise<object>} MergeReport
 */
export function mergeDocument(options) {
  const o = options || {};
  const live = o.live;
  if (!live || live.nodeType !== 9)
    throw new TypeError("live must be a Document");
  // One parse cache per live document: a cache built for another document
  // would parse in that document's realm, which may be gone.
  let cache = parseCaches.get(live);
  if (!cache) {
    cache = createParseCache(live);
    parseCaches.set(live, cache);
  }
  const remoteDoc = cache("remote", o.remote);
  const baseInput = typeof o.base === "string" && o.base === "" ? null : o.base;
  const baseDoc = baseInput ? cache("base", baseInput) : null;
  const localRoot = o.local ? o.local.root : live.documentElement;
  const toLive = o.local ? o.local.toLive : (n) => n;
  syncDoctype(live, remoteDoc);
  const { report, loads } = run({
    liveRoot: live.documentElement,
    baseRoot: baseDoc ? baseDoc.documentElement : null,
    localRoot,
    remoteRoot: remoteDoc.documentElement,
    toLive,
    options: o,
    identity: o.identity || {},
    childrenOnly: false,
    isDocument: true,
  });
  return Promise.all(loads).then(() => report);
}

/**
 * Two-way: the live document becomes the remote document.
 */
export function morphDocument(live, remote, options = {}) {
  return mergeDocument(
    Object.assign({}, options, { live, base: null, remote }),
  );
}

/**
 * Normalize fragment content into { root, first }: `root` is a container
 * whose children are the content (for children-only morphs), `first` its
 * first element (for whole-element morphs). Element inputs are used as they
 * are, never cloned, so property-mode callers keep the properties they set.
 */
function contentOf(content, doc) {
  if (content == null) {
    const t = doc.createElement("template");
    return { root: t, first: null };
  }
  if (typeof content === "string") {
    // A string that is itself a body or html element keeps that element: a
    // template parse would drop the wrapper and hand back its first child.
    const m =
      /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>\s*)?<(html|body)[\s>]/i.exec(
        content,
      );
    if (m) {
      const parsed = toDocument(content, doc);
      const el =
        m[1].toLowerCase() === "html" ? parsed.documentElement : parsed.body;
      return { root: el, first: el };
    }
    const t = doc.createElement("template");
    t.innerHTML = content;
    return { root: t, first: t.content.firstElementChild };
  }
  if (content.nodeType === 9)
    return { root: content.documentElement, first: content.documentElement };
  if (content.nodeType === 1) {
    // A whole-element morph reads the element itself. A children morph
    // treats the element as the one new child: a detached node moves into a
    // template (keeping the properties a caller set on it), an attached one
    // is copied so the page it lives in is untouched.
    const t = doc.createElement("template");
    const inDoc = content.isConnected;
    t.content.appendChild(inDoc ? doc.importNode(content, true) : content);
    return { root: t, first: content };
  }
  if (content.nodeType === 11) {
    const t = doc.createElement("template");
    t.content.appendChild(content);
    return { root: t, first: t.content.firstElementChild };
  }
  const t = doc.createElement("template");
  for (const n of Array.from(content))
    t.content.appendChild(n.parentNode ? doc.importNode(n, true) : n);
  return { root: t, first: t.content.firstElementChild };
}

/**
 * Morph one element. `options.children` morphs its children only. With
 * `options.base` (string or element) the merge is three-way.
 */
export function morphElement(oldEl, newContent, options = {}) {
  if (!oldEl || oldEl.nodeType !== 1)
    throw new TypeError("oldEl must be an Element");
  const doc = oldEl.ownerDocument;
  const { base, ...rest } = options;
  const childrenOnly = !!rest.children;
  // An ignored root is left alone whole, as its subtree would be below it.
  if (normalize(rest, [oldEl]).ignored(oldEl))
    return Promise.resolve(emptyReport());
  const remoteC = contentOf(newContent, doc);
  const baseC = base != null ? contentOf(base, doc) : null;
  let remoteRoot,
    baseRoot = null;
  if (childrenOnly) {
    // For a children morph of an element input, the input's own children are
    // the content; for string input, the template's content.
    remoteRoot = remoteC.root;
    baseRoot = baseC ? baseC.root : null;
  } else {
    remoteRoot = remoteC.first;
    baseRoot = baseC ? baseC.first : null;
    if (!remoteRoot) {
      // Nothing to morph into: the element goes away.
      const o = normalize(rest);
      if (o.hooks.beforeNodeRemoved(oldEl) !== false) {
        oldEl.remove();
        o.hooks.afterNodeRemoved(oldEl);
      }
      return Promise.resolve({
        applied: [{ kind: "remove", node: oldEl, parent: null }],
        decisions: [],
        conflicts: [],
        localDiverged: false,
        identities: [],
        moved: [],
        replaced: [oldEl],
        stats: emptyStats(),
      });
    }
    if (remoteRoot.tagName !== oldEl.tagName) {
      // A different element: merge the children into the old element first
      // so their live nodes survive, then move them into a fresh element of
      // the new tag and swap it in.
      const o = normalize(rest, [oldEl, remoteRoot]);
      if (o.hooks.beforeNodeMorphed(oldEl, remoteRoot) === false)
        return Promise.resolve(emptyReport());
      const inner = run({
        liveRoot: oldEl,
        baseRoot:
          baseRoot && baseRoot.tagName === oldEl.tagName ? baseRoot : null,
        localRoot: oldEl,
        remoteRoot,
        toLive: (n) => n,
        options: rest,
        identity: rest.identity || {},
        childrenOnly: true,
        isDocument: false,
      });
      const fresh = isHtmlScript(remoteRoot)
        ? makeInertScript(remoteRoot, doc)
        : doc.importNode(remoteRoot, false);
      if (!isHtmlScript(fresh))
        while (oldEl.firstChild) fresh.appendChild(oldEl.firstChild);
      if (o.hooks.beforeNodeAdded(fresh) === false)
        return Promise.resolve(inner.report);
      if (o.hooks.beforeNodeRemoved(oldEl) === false)
        return Promise.resolve(inner.report);
      oldEl.replaceWith(fresh);
      remapLive(inner.report.conflicts, oldEl, fresh);
      o.hooks.afterNodeRemoved(oldEl);
      o.hooks.afterNodeAdded(fresh);
      o.hooks.afterNodeMorphed(oldEl, remoteRoot);
      inner.report.replaced.push(fresh);
      inner.report.applied.push(
        { kind: "insert", node: fresh, parent: fresh.parentNode },
        { kind: "remove", node: oldEl, parent: fresh.parentNode },
      );
      return Promise.all(inner.loads).then(() => inner.report);
    }
  }
  const { report, loads } = run({
    liveRoot: oldEl,
    baseRoot,
    localRoot: oldEl,
    remoteRoot,
    toLive: (n) => n,
    options: rest,
    identity: rest.identity || {},
    childrenOnly,
    isDocument: false,
  });
  return Promise.all(loads).then(() => report);
}

export default { mergeDocument, morphDocument, morphElement, merge3, morph };
