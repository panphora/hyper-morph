# HyperMorph review and rewrite plan

Date: 2026-09-24. Reviewed at v0.5.4 (commit 574c32c).

This document has two parts. Part 1 is the review that motivates the rewrite.
Part 2 is the implementation specification: module layout, data structures,
algorithms, option semantics, edge cases, test plan, and delivery phases. Part 2
is written so that an engineer who has not read the current source can build
the new library from it.

---

# Part 1: Review

## Verdict

The library does not currently do its one job. Morphing a live document against
a real incoming page throws, the whole-document paths are the least tested paths
in the suite, and about 60 percent of the source is Hyperclay-specific machinery
bolted onto a vendored Idiomorph. A rewrite around a single "parse, pair,
reconcile" pipeline is justified, and it can be roughly a quarter of the current
size.

## Confirmed defects

Measured in Chromium (Playwright 1.56.1) with the existing suite plus a
throwaway test for the whole-document path.

| Check | Result |
|---|---|
| Full suite | 606 pass, 4 fail, 15 skipped, 97.6% coverage |
| `morph(document, "<!DOCTYPE html>...")` | throws `HierarchyRequestError: Only one doctype on document allowed` |
| `morph(doc.documentElement, "<!DOCTYPE html>...")` | same throw |
| Same call, incoming string without doctype | works |
| Attached element as new content with a nested `no-save` child | throws `TypeError: newContent.contains is not a function` |
| `innerHTML` morph of one `documentElement` into another | produces `<html><html>...</html></html>` |
| 3000-element page, one text edit | 758 ms, versus 277 ms for upstream Idiomorph on the same input |

### Doctype crash (primary path is broken)

Every real page starts with a doctype, so the "merge two full documents" path
fails for the primary input. The bug is inherited from upstream Idiomorph. The
head tests in `test/head.js` only pass because their fixtures omit the doctype.
The new document's `DocumentType` child reaches `createNode`
(`src/hyper-morph.js:991`) and is inserted next to the existing one.

### `.contains` crash (new in 0.5.4)

The scoping fix at `src/hyper-morph.js:1854` calls `newContent.contains`, but
when new content is an attached element it is wrapped in `SlicedParentNode`,
which has no such method. Any descendant of an ignored region on the incoming
side trips it.

### Nested `<html>` on innerHTML morph

Documented in `test/document-level.js:55` as a known bug and then worked around
in the test rather than fixed.

### Red baseline, no CI

Four focus tests fail on current Chromium: both "retains focus and selection
state when elements are moved" cases under the `restoreFocus: false` group in
`test/restore-focus.js`. There is no CI workflow to catch this. `npm run perf`
points at a `perf/` directory that does not exist.

### Quadratic matcher

The matcher accounts for 742 of the 758 ms on the 3000-element page. Two hot
spots, each about 270 ms:

- `computePath` recomputes nth-of-type for every ancestor of every element by
  walking previous siblings (`src/hyper-morph-matcher.js:217`).
- `computeMatches` re-filters the whole signature bucket with `getAttribute`
  for every new element (`src/hyper-morph-matcher.js:713`).

Disabling both drops the run to 188 ms.

### Global `document` and `window`

Used for the active element, executable script creation, head fragment
creation, and URL normalization. Morphing a parsed or iframe document reads the
wrong document's focus and creates scripts in the wrong realm.

### Head merge does not preserve order

A changed `<title>` is removed and re-appended at the end of the head, firing
remove and add hooks for what is really an update.

## Why a rewrite rather than fixes

The core has five overlapping identity systems reconciled after the fact:
Idiomorph's id sets, the content matcher, slot candidates, the `key` callback,
and merge-tag pairing. The `key` block (`src/hyper-morph.js:1881`) and the merge
block (`src/hyper-morph.js:1945`) are near-duplicate reciprocal-cleanup code.
Because matching is decided lazily during the walk, the pantry, staged-node
recovery, `removeNodesBetween`, `moveBeforeById`, ancestor id-map cleanup, and
the cycle guard all exist to patch over decisions made too early.

Input normalization is the other structural problem. A string, a detached node,
an attached node, an array, and a `Document` each take a different path through
`normalizeParent`, and `SlicedParentNode` is a duck type that most of the
codebase only partly honors. The three crashes above are all consequences.

The rest is scope creep for a general library. By line count in
`src/hyper-morph.js`: about 600 lines are `findChangedRoots` and
`spliceProtected`, about 200 are JSON script merging, and about 150 are the
sync-ignore policy layer with Hyperclay vocabulary (`clay~=`, `editor-ui`,
`freeze`, `snapshot-remove`) baked in. `src/lib/content-dom.js` is generated
from ClayJS and imported by nothing. `parseRulesRelaxed` is a Hyperclay dialect.
`scripts/propagate.js` writes builds into sibling repos. The package reads as
Hyperclay's vendored fork, and the README never states the one job.

---

# Part 2: Implementation specification

## 2.1 Scope statement

The library has one entry point:

```js
await morphDocument(target, incoming, options)
```

It mutates `target` (a live `Document`) so that its serialized form matches
`incoming` (an HTML string or a parsed `Document`), while:

1. keeping every DOM node that corresponds to a node in the incoming document
   (node identity is preserved so focus, selection, scroll, CSS transitions,
   iframe and video state survive),
2. never executing a script twice and executing each genuinely new script
   exactly once,
3. leaving caller-designated local-only regions untouched,
4. keeping the focused form control's value and caret.

Out of scope for the core: partial morphs of a fragment, innerHTML mode,
arrays of nodes, three-way JSON merging (optional subpath), protected splicing
(moves out), and Hyperclay attribute vocabulary (caller supplies a predicate).

## 2.2 Module layout

```
src/
  index.js        public API, option normalization, orchestration
  parse.js        toDocument(): string | Document -> Document; doctype sync
  ignore.js       makeIgnore(): cached "is this node inside an ignored region"
  identity.js     key index per side, duplicate detection
  matcher.js      content scoring for same-parent candidates
  pairing.js      computePairing(): global Map<newEl, oldEl> built top-down
  reconcile.js    applyPairing(): children, attributes, text, form state
  head.js         mergeHead(): ordered signature merge with in-place updates
  scripts.js      signature(), inert cloning, execute-once pass
  focus.js        captureFocus(), restoreFocus()
  json-merge.js   unchanged, exported at "hyper-morph/json-merge"
  json-parse.js   unchanged, exported at "hyper-morph/json-parse"
  splice.js       findChangedRoots + spliceProtected, moved verbatim,
                  exported at "hyper-morph/splice" (candidate to leave the repo)
```

Deleted: `hyper-morph-matcher.js` (replaced by `matcher.js`),
`lib/content-dom.js`, `lib/region-capabilities.js` (moves to the Hyperclay
adapter), `scripts/propagate.js`, `scripts/vendor-format.js`,
`packed-contract.json`.

Every module receives the owner document through arguments or the context
object. No module may reference the global `document` or `window`. Add an
ESLint rule (`no-restricted-globals: document, window`) for `src/`.

## 2.3 Public API

```ts
type Options = {
  // Identity. Return a string to pair elements across the two documents
  // regardless of position. null/undefined/"" means "no key".
  // Default: el => el.getAttribute("id")
  key?: (el: Element) => string | null | undefined;

  // Local-only regions. True means: this element and everything inside it
  // is never morphed, removed, moved, or used as a match, and its incoming
  // counterpart is never inserted. Default: () => false
  ignore?: (el: Element) => boolean;

  // Keep the focused input/textarea value and caret even if the incoming
  // document says otherwise. Default: true
  protectFocusedValue?: boolean;

  head?: {
    // Wait for newly inserted stylesheets and external scripts in <head>
    // to load (or error) before resolving. Default: false
    awaitLoads?: boolean;
    // Keep an old head element even if absent from the incoming head.
    // Default: () => false
    preserve?: (el: Element) => boolean;
  };

  scripts?: {
    // Execute scripts that are new to the body. Default: true
    execute?: boolean;
    // Optional in-place merge for a paired <script> whose type is JSON.
    // Return a string to replace the old element's text; return undefined
    // to fall through to plain text replacement. Default: undefined
    merge?: (oldEl: HTMLScriptElement, newEl: HTMLScriptElement) => string | undefined;
  };

  hooks?: {
    beforeNodeAdded?:      (node: Node) => boolean | void;   // false skips
    afterNodeAdded?:       (node: Node) => void;
    beforeNodeRemoved?:    (node: Node) => boolean | void;   // false keeps
    afterNodeRemoved?:     (node: Node) => void;
    beforeNodeMorphed?:    (oldNode: Node, newNode: Node) => boolean | void; // false skips subtree
    afterNodeMorphed?:     (oldNode: Node, newNode: Node) => void;
    beforeAttributeUpdated?: (name: string, el: Element, kind: "update" | "remove") => boolean | void;
  };
};

declare function morphDocument(
  target: Document | HTMLHtmlElement,
  incoming: string | Document,
  options?: Options
): Promise<void>;
```

Rules:

- `morphDocument` always returns a Promise, even when nothing is asynchronous.
- If `target` is an `<html>` element it must be `target.ownerDocument.documentElement`;
  otherwise throw `TypeError("target must be a Document or its documentElement")`.
- If `incoming` is a `Document` it is used as is and will be consumed (its
  nodes are cloned, never moved, so it remains intact, but the caller must not
  rely on that).
- Options are validated once. Unknown keys throw. This replaces the mutable
  `HyperMorph.defaults` object; there is no global state.

A secondary export `morphElement(oldEl, newEl, options)` runs pairing and
reconcile on one element pair with no head, doctype, or script execution
handling. It exists for tests and for callers who already have two elements.
It is not the primary path and gets no special input normalization.

## 2.4 Context object

Every internal function takes `ctx` as its first argument:

```ts
type Ctx = {
  doc: Document;                     // target document
  opts: NormalizedOptions;           // all options with defaults filled in
  ignored: (node: Node) => boolean;  // from ignore.js, cached, ancestor-aware
  pairing: Map<Element, Element>;    // newEl -> oldEl
  reverse: Map<Element, Element>;    // oldEl -> newEl
  oldScriptSigs: Set<string>;        // body script signatures before mutation
  mergedScripts: Set<Element>;       // scripts merged by opts.scripts.merge
  loads: Promise<void>[];            // things to await before resolving
};
```

## 2.5 Orchestration (`index.js`)

```
async function morphDocument(target, incoming, options):
  opts   = normalizeOptions(options)
  doc    = target.nodeType === 9 ? target : target.ownerDocument
  newDoc = toDocument(incoming, doc)                     // parse.js
  ctx    = makeCtx(doc, opts)
  syncDoctype(doc, newDoc)                               // parse.js
  ctx.oldScriptSigs = collectBodyScriptSignatures(ctx, doc.body)
  focus  = captureFocus(ctx)                             // focus.js
  syncAttributes(ctx, doc.documentElement, newDoc.documentElement)
  mergeHead(ctx, doc.head, newDoc.head)                  // head.js
  computePairing(ctx, doc.body, newDoc.body)             // pairing.js
  reconcileElement(ctx, doc.body, newDoc.body)           // reconcile.js
  executeNewScripts(ctx, doc.body)                       // scripts.js
  restoreFocus(ctx, focus)                               // focus.js
  await Promise.all(ctx.loads)
```

Order rationale: the head goes first so stylesheets start loading before body
mutation; scripts execute after the body is fully reconciled so they see the
final DOM; focus restores after scripts because a script may have moved focus
deliberately, and restore is a no-op when focus is still where it was.

If any step throws, the error propagates. There is no pantry to unwind because
nothing is ever parked outside the tree.

## 2.6 Parse (`parse.js`)

```
function toDocument(incoming, ownerDoc):
  if typeof incoming === "string":
    return new ownerDoc.defaultView.DOMParser().parseFromString(incoming, "text/html")
    // If defaultView is null (a parsed document with no window), fall back
    // to globalThis.DOMParser. This is the only permitted global use.
  if incoming.nodeType === 9: return incoming
  throw new TypeError("incoming must be an HTML string or a Document")
```

`DOMParser` always yields `<html><head></head><body></body></html>` even for a
fragment string, so `newDoc.head` and `newDoc.body` are never null.

```
function syncDoctype(doc, newDoc):
  old = doc.doctype, next = newDoc.doctype
  if next == null: return                      // never remove a doctype
  if old == null:
    doc.insertBefore(doc.implementation.createDocumentType(next.name, next.publicId, next.systemId), doc.documentElement)
  else if old.name !== next.name || old.publicId !== next.publicId || old.systemId !== next.systemId:
    doc.replaceChild(doc.implementation.createDocumentType(...), old)
```

Comments or processing instructions that sit outside `<html>` are ignored on
both sides. Document mode (quirks or standards) cannot change after parse;
the doctype is synced for serialization fidelity only.

## 2.7 Ignore (`ignore.js`)

```
function makeIgnore(pred):
  cache = new WeakMap()   // Element -> boolean
  return function ignored(node):
    if node.nodeType !== 1: return false
    if cache.has(node): return cache.get(node)
    result = pred(node) || (node.parentElement != null && ignored(node.parentElement))
    cache.set(node, result)
    return result
```

Ancestor walk stops at the document (parentElement of `<html>` is null). Both
documents share one cache; nodes are distinct objects so there is no
collision. `pred` is called at most once per element per morph.

Semantics applied everywhere:

- Old ignored element: not indexed for identity, not scored, never moved,
  never removed, never morphed, and the reconcile cursor skips over it.
- New ignored element: never inserted, never paired.
- Head: same rules, applied to head children.

## 2.8 Identity (`identity.js`)

```
function buildKeyIndex(ctx, root):
  map = new Map()      // key -> Element
  dups = new Set()
  for el of [root, ...root.querySelectorAll("*")]:
    if ctx.ignored(el): continue
    k = ctx.opts.key(el)
    if k == null || k === "": continue
    if map.has(k): dups.add(k) else map.set(k, el)
  for k of dups: map.delete(k)
  return map
```

Called once per side on the body subtree. Duplicate keys on a side disable
that key on that side (same rule as today's `createPersistentIds`). A key pair
is only used when both elements have the same `tagName`.

Note on `<template>`: `querySelectorAll` does not descend into
`template.content`. Elements inside templates are therefore keyless and are
reconciled positionally inside the template's content fragment. This matches
current behavior.

## 2.9 Matcher (`matcher.js`)

The matcher only scores candidates that share a parent pair. Because both
elements have the same ancestry by construction, the old "path" signal
collapses to a single sibling-index comparison, and no ancestor walks exist.

Per-element metadata, computed once and cached in a `WeakMap`:

```
meta = {
  sig:   hash(tagName + "|" + sortedClasses + "|" + sortedIncludedAttrs),
  index: number,      // position among element siblings, 0-based
  text:  first 64 chars of textContent with whitespace collapsed and trimmed,
}
```

`sortedIncludedAttrs` covers `href src name type role aria-label alt title`
and excludes `id` and `class`. `hash` is djb2 XOR as today, base 36.

Computing `index` must not walk siblings: `reconcile` and `pairing` iterate
children with a counter and pass the index into `getMeta`. `getMeta(el, index)`
stores it on first call.

```
function scoreCandidates(ctx, oldKids, newKids):
  // oldKids and newKids: arrays of unpaired, non-ignored element children
  // Returns array of {newEl, oldEl, score} with score >= 101
  buckets = Map<sig, Element[]>  over oldKids (document order preserved)
  byText  = Map<sig, Map<text, Element[]>>  built lazily per bucket
  out = []
  for newEl of newKids:
    m = meta(newEl)
    bucket = buckets.get(m.sig); if !bucket: continue
    candidates = bucket.length <= 16 ? bucket : subset(m, bucket, 16)
    for oldEl of candidates:
      o = meta(oldEl)
      s = 100
      if o.index === m.index: s += 10
      if m.text && o.text: s += (m.text === o.text) ? 20 : -25
      else if m.text !== o.text: s -= 25
      textOk = (m.text === o.text)
      if bucket.length === 1 && textOk: s += 50
      s -= min(abs(o.index - m.index), 19)
      if s >= 101: out.push({newEl, oldEl, score: s})
  return out
```

`subset(m, bucket, cap)`: all exact `text` matches from `byText` (up to cap)
plus a window of `cap` elements of the bucket centered on the position whose
`index` is closest to `m.index` (binary search on the bucket, which is in
index order). This is the current `selectCandidateSubset` without the
per-call `filter`.

Weights and threshold are constants in this module, not options. The old
`createMatcher(config)` surface is dropped; the tests in `test/hyper-match.js`
that tune weights must be rewritten to the fixed model or deleted.

## 2.10 Pairing (`pairing.js`)

Builds `ctx.pairing` and `ctx.reverse` for the body subtree before any
mutation. Runs top-down so a parent's pairing is known when its children are
paired.

```
function computePairing(ctx, oldBody, newBody):
  ctx.oldKeys = buildKeyIndex(ctx, oldBody)
  ctx.newKeys = buildKeyIndex(ctx, newBody)
  pair(ctx, newBody, oldBody)
  pairChildren(ctx, oldBody, newBody)

function pair(ctx, newEl, oldEl):
  ctx.pairing.set(newEl, oldEl); ctx.reverse.set(oldEl, newEl)

function pairChildren(ctx, oldParent, newParent):
  oldKids = elementChildren(oldParent).filter(e => !ctx.ignored(e) && !ctx.reverse.has(e))
  newKids = elementChildren(newParent).filter(e => !ctx.ignored(e))
  // (for <template>, use .content of each side)

  // Step 1: keyed, may reach anywhere in the old body
  for newEl of newKids:
    k = ctx.opts.key(newEl)
    if k == null || k === "" || ctx.newKeys.get(k) !== newEl: continue   // dup on new side
    oldEl = ctx.oldKeys.get(k)
    if !oldEl || ctx.reverse.has(oldEl) || oldEl.tagName !== newEl.tagName: continue
    if oldEl !== oldParent && oldEl.contains(oldParent): continue         // would create a cycle
    pair(ctx, newEl, oldEl)

  // Step 2: content, same parent only
  remainingNew = newKids.filter(e => !ctx.pairing.has(e))
  remainingOld = oldKids.filter(e => !ctx.reverse.has(e) && !hasKey(ctx, e))
  for {newEl, oldEl} of scoreCandidates(ctx, remainingOld, remainingNew) sorted by score desc, then document order:
    if ctx.pairing.has(newEl) || ctx.reverse.has(oldEl): continue
    pair(ctx, newEl, oldEl)

  // Step 3: positional, same parent, same tag, lockstep
  cursor = 0
  for newEl of newKids:
    if ctx.pairing.has(newEl): continue
    while cursor < oldKids.length:
      oldEl = oldKids[cursor]; cursor++
      if ctx.reverse.has(oldEl) || hasKey(ctx, oldEl): continue
      if oldEl.tagName === newEl.tagName: pair(ctx, newEl, oldEl); break

  // Recurse into every pair whose new side is a child of newParent
  for newEl of newKids:
    oldEl = ctx.pairing.get(newEl)
    if oldEl: pairChildren(ctx, oldEl, newEl)
```

`hasKey(ctx, el)` is true when `opts.key(el)` is a non-empty string that is
unique on its side. A keyed old element is never consumed by content or
positional pairing (Idiomorph's "don't morph an id'd node into something
else" rule).

The cycle guard in step 1 prevents `moveBefore` from throwing
`HierarchyRequestError` when a keyed old element is an ancestor of the
destination parent. Such an element is left unpaired: its incoming counterpart
is inserted fresh and the old one is removed (with its subtree) during
reconcile. This is rare (a keyed element moved into its own descendant) and
documented as a limitation.

Special element rule: `<script>`, `<style>`, `<textarea>`, `<template>`,
`<iframe>`, `<object>`, `<embed>`, `<canvas>`, `<video>`, `<audio>` are paired
by steps 1 and 3 only (no content scoring). Their text hint would be code or
empty and scoring adds nothing.

Complexity: O(N) metadata, O(sum over parents of newKids × min(bucket, 16))
scoring, O(N) recursion. No sibling walks.

## 2.11 Reconcile (`reconcile.js`)

Mutates the old tree to match the new tree using the pairing. Never touches
nodes outside the current parent except to move a paired old element in.

```
function reconcileElement(ctx, oldEl, newEl):
  if ctx.opts.hooks.beforeNodeMorphed(oldEl, newEl) === false: return
  syncAttributes(ctx, oldEl, newEl)
  switch specialKind(oldEl):
    case "textarea": syncTextarea(ctx, oldEl, newEl); break
    case "script":   reconcileScript(ctx, oldEl, newEl); break
    case "template": reconcileChildren(ctx, oldEl.content, newEl.content); break
    default:
      syncFormState(ctx, oldEl, newEl)
      reconcileChildren(ctx, oldEl, newEl)
  ctx.opts.hooks.afterNodeMorphed(oldEl, newEl)
```

```
function reconcileChildren(ctx, oldParent, newParent):
  touched = new Set()
  cursor = firstUsable(oldParent.firstChild)     // skips ignored elements

  for newChild of Array.from(newParent.childNodes):
    if newChild.nodeType === 1:
      if ctx.ignored(newChild): continue
      oldChild = ctx.pairing.get(newChild)
      if oldChild:
        if oldChild !== cursor: moveBefore(oldParent, oldChild, cursor)
        reconcileElement(ctx, oldChild, newChild)
        touched.add(oldChild)
        cursor = firstUsable(oldChild.nextSibling)
      else:
        inserted = insertClone(ctx, oldParent, newChild, cursor)
        if inserted: touched.add(inserted)
    else if newChild.nodeType === 3 || newChild.nodeType === 8:
      if cursor && cursor.nodeType === newChild.nodeType && !touched.has(cursor) && !ctx.reverse.has(cursor):
        if cursor.nodeValue !== newChild.nodeValue: cursor.nodeValue = newChild.nodeValue
        touched.add(cursor)
        cursor = firstUsable(cursor.nextSibling)
      else:
        clone = ctx.doc.importNode(newChild, false)
        if ctx.opts.hooks.beforeNodeAdded(clone) !== false:
          oldParent.insertBefore(clone, cursor)
          ctx.opts.hooks.afterNodeAdded(clone)
          touched.add(clone)
    // other node types (doctype, PI, CDATA) are ignored

  // Remove leftovers: anything not touched, not ignored, and not paired
  // to a new element elsewhere (those are moved out when their new parent
  // is reconciled, which may happen later in the traversal).
  for child of Array.from(oldParent.childNodes):
    if touched.has(child): continue
    if child.nodeType === 1 && (ctx.ignored(child) || ctx.reverse.has(child)): continue
    removeNode(ctx, child)

function firstUsable(node):
  while node && node.nodeType === 1 && ctx.ignored(node): node = node.nextSibling
  return node

function moveBefore(parent, node, before):
  if typeof parent.moveBefore === "function":
    try { parent.moveBefore(node, before); return } catch {}
  parent.insertBefore(node, before)

function removeNode(ctx, node):
  if ctx.opts.hooks.beforeNodeRemoved(node) === false: return
  node.parentNode.removeChild(node)
  ctx.opts.hooks.afterNodeRemoved(node)
```

Why there is no pantry: an old element paired to a new element in a different
parent stays where it is until the destination parent is reconciled, at which
point `moveBefore` pulls it in from anywhere in the document. Leftover removal
skips it because `ctx.reverse.has(child)` is true. The only ordering
requirement is that leftover removal must not remove such nodes, which the
check guarantees. `moveBefore` preserves iframe, video, and focus state where
the browser supports it; `insertBefore` is the fallback.

Idiomorph's "block soft match when two future siblings would soft match"
heuristic is dropped. The prepend and insert-in-middle cases it existed for are
handled by content pairing (step 2), and the positional fallback is plain
lockstep.

```
function insertClone(ctx, parent, newEl, before):
  clone = cloneWithoutIgnored(ctx, newEl)      // deep importNode, skipping ignored descendants
  if ctx.opts.hooks.beforeNodeAdded(clone) === false: return null
  parent.insertBefore(clone, before)
  ctx.opts.hooks.afterNodeAdded(clone)
  return clone

function cloneWithoutIgnored(ctx, node):
  copy = ctx.doc.importNode(node, false)
  src = node.tagName === "TEMPLATE" ? node.content : node
  dst = copy.tagName === "TEMPLATE" ? copy.content : copy
  for child of src.childNodes:
    if child.nodeType === 1 && ctx.ignored(child): continue
    dst.appendChild(cloneWithoutIgnored(ctx, child))
  return copy
```

Inserted scripts are inert by construction. `importNode` of a `<script>` from
a `DOMParser` document copies the "already started" flag, so the copy never
executes on insertion (HTML spec, cloning steps for script elements). When
`incoming` is a caller-built `Document` this is not guaranteed; `parse.js`
must run `neutralizeScripts(newDoc.body)` (the current `makeInertScript`
approach using innerHTML) in that case only. Test 2.16 T-S1 pins this.

### Attributes

```
function syncAttributes(ctx, oldEl, newEl):
  for attr of Array.from(newEl.attributes):
    if isFormStateAttr(oldEl, attr.name): continue           // value, checked, selected handled below
    if oldEl.getAttributeNS(attr.namespaceURI, attr.localName) === attr.value: continue
    if ctx.opts.hooks.beforeAttributeUpdated(attr.name, oldEl, "update") === false: continue
    oldEl.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
  for attr of Array.from(oldEl.attributes):                   // snapshot: NamedNodeMap is live
    if isFormStateAttr(oldEl, attr.name): continue
    if newEl.hasAttributeNS(attr.namespaceURI, attr.localName): continue
    if ctx.opts.hooks.beforeAttributeUpdated(attr.name, oldEl, "remove") === false: continue
    oldEl.removeAttributeNS(attr.namespaceURI, attr.localName)
```

Namespaced form (`setAttributeNS` with `attr.namespaceURI`) is required so
`xlink:href` on inline SVG round-trips. For HTML attributes `namespaceURI` is
null and the NS methods behave like the plain ones.

`isFormStateAttr` is true for `value` on `input`, `checked` on `input`,
`selected` on `option`. Those are owned by `syncFormState` so the attribute
and the property are set together and the focus protection can apply.

### Form state

The incoming document is parsed HTML, so its attributes are the only source of
truth. The old document is live, so both attribute and property are written.

```
function syncFormState(ctx, oldEl, newEl):
  protect = ctx.opts.protectFocusedValue && oldEl === ctx.doc.activeElement
  if oldEl is INPUT:
    if type !== "file" && !protect:
      if newEl.hasAttribute("value"):
        v = newEl.getAttribute("value")
        if oldEl.getAttribute("value") !== v: oldEl.setAttribute("value", v)
        if oldEl.value !== v: oldEl.value = v
      else:
        oldEl.removeAttribute("value"); if oldEl.value !== "": oldEl.value = ""
    syncBoolean(ctx, oldEl, newEl, "checked")
    syncBoolean(ctx, oldEl, newEl, "disabled")
  if oldEl is OPTION: syncBoolean(ctx, oldEl, newEl, "selected")

function syncBoolean(ctx, oldEl, newEl, name):
  want = newEl.hasAttribute(name)
  if want: oldEl.setAttribute(name, "") else oldEl.removeAttribute(name)
  if oldEl[name] !== want: oldEl[name] = want

function syncTextarea(ctx, oldEl, newEl):
  protect = ctx.opts.protectFocusedValue && oldEl === ctx.doc.activeElement
  v = newEl.textContent
  if oldEl.textContent !== v: oldEl.textContent = v      // default value
  if !protect && oldEl.value !== v: oldEl.value = v      // live value
```

`hooks.beforeAttributeUpdated` is consulted for `value`, `checked`,
`selected`, and `disabled` with kind `"update"` or `"remove"` exactly as for
other attributes, so a caller can still veto them.

The current `formStateSync: "property"` mode is dropped. Callers who build
incoming content in memory must set attributes; serializing to a string and
back is the supported path.

`indeterminate` is never touched (it has no attribute form).

### Scripts inside reconcile

```
function reconcileScript(ctx, oldEl, newEl):
  if ctx.opts.scripts.merge && isJsonType(oldEl) && isJsonType(newEl):
    merged = ctx.opts.scripts.merge(oldEl, newEl)
    if typeof merged === "string":
      if oldEl.textContent !== merged: oldEl.textContent = merged
      ctx.mergedScripts.add(oldEl)
      return
  if oldEl.textContent !== newEl.textContent: oldEl.textContent = newEl.textContent
```

Setting `textContent` on an already-started script does not execute it. The
execute pass decides later, by signature, whether it runs.

## 2.12 Head (`head.js`)

Head children are matched by signature, walked in incoming order, and updated
in place when matched. A `<title>` text change is a text update, not a
remove-and-append.

```
function headSignature(ctx, el):
  tag = el.tagName
  if tag === "TITLE" || tag === "BASE": return tag
  if tag === "SCRIPT": return scriptSignature(ctx, el)          // see 2.13
  if tag === "LINK":
    href = el.getAttribute("href")
    return href ? "LINK|" + (el.getAttribute("rel") || "") + "|" + absoluteWithoutHash(ctx, href) : el.outerHTML
  if tag === "META":
    for name of ["charset", "name", "property", "http-equiv", "itemprop"]:
      if el.hasAttribute(name): return "META|" + name + "=" + el.getAttribute(name)
    return el.outerHTML
  if tag === "STYLE": return "STYLE|" + hash(el.textContent)
  return el.outerHTML
```

`absoluteWithoutHash(ctx, url)` resolves against `ctx.doc.baseURI` and drops
the fragment; the query string is kept (cache busters are significant).

```
function mergeHead(ctx, oldHead, newHead):
  buckets = Map<sig, Element[]>  over oldHead.children that are not ignored, in order
  cursor = firstUsable(oldHead.firstChild)
  kept = new Set()

  for newEl of Array.from(newHead.children):
    if ctx.ignored(newEl): continue
    sig = headSignature(ctx, newEl)
    bucket = buckets.get(sig)
    oldEl = bucket && bucket.shift()
    if oldEl:
      if oldEl !== cursor: moveBefore(oldHead, oldEl, cursor)
      if ctx.opts.hooks.beforeNodeMorphed(oldEl, newEl) !== false:
        syncAttributes(ctx, oldEl, newEl)
        if oldEl.tagName === "SCRIPT": reconcileScript(ctx, oldEl, newEl)
        else if oldEl.tagName !== "LINK": reconcileChildren(ctx, oldEl, newEl)   // title, style, meta (no children), noscript
        ctx.opts.hooks.afterNodeMorphed(oldEl, newEl)
      kept.add(oldEl)
      cursor = firstUsable(oldEl.nextSibling)
    else:
      fresh = createHeadElement(ctx, newEl)
      if ctx.opts.hooks.beforeNodeAdded(fresh) === false: continue
      if ctx.opts.head.awaitLoads && waitsForLoad(fresh): ctx.loads.push(loadPromise(fresh))
      oldHead.insertBefore(fresh, cursor)
      ctx.opts.hooks.afterNodeAdded(fresh)
      kept.add(fresh)

  // Text and comment nodes in <head> are whitespace; leave them alone.
  for child of Array.from(oldHead.children):
    if kept.has(child) || ctx.ignored(child) || ctx.opts.head.preserve(child): continue
    removeNode(ctx, child)
```

`createHeadElement` uses `ctx.doc.createElement(tagName)` and copies
attributes and text, so an inserted `<script>` in the head executes on
insertion (a fresh element has no "already started" flag). Old head scripts
that match by signature are never re-run. `waitsForLoad` is true for a script
with `src` and a `link` whose `rel` list contains `stylesheet` and has `href`;
`loadPromise` resolves on either `load` or `error`.

Scripts in the head are excluded from the body execute pass (2.13) because the
head handled them.

Dropped: head styles `append`, `morph`, `none`; the `im-preserve` and
`im-re-append` attributes; `head.block` (replaced by `awaitLoads`);
`afterHeadMorphed` (use the generic hooks).

## 2.13 Body scripts (`scripts.js`)

```
function scriptSignature(ctx, el):
  src = el.getAttribute("src")
  type = (el.getAttribute("type") || "text/javascript").split(";")[0].trim().toLowerCase()
  if src: return "SCRIPT|src|" + type + "|" + absoluteWithoutHash(ctx, src)
  return "SCRIPT|inline|" + type + "|" + hash(el.textContent.trim())

function collectBodyScriptSignatures(ctx, body):
  out = new Set()
  for el of body.querySelectorAll("script"):
    if el.namespaceURI !== HTML_NS || ctx.ignored(el): continue
    out.add(scriptSignature(ctx, el))
  return out

function executeNewScripts(ctx, body):
  if !ctx.opts.scripts.execute: return
  for el of Array.from(body.querySelectorAll("script")):
    if el.namespaceURI !== HTML_NS || ctx.ignored(el) || ctx.mergedScripts.has(el): continue
    if ctx.oldScriptSigs.has(scriptSignature(ctx, el)): continue
    fresh = ctx.doc.createElement("script")
    for attr of el.attributes: fresh.setAttribute(attr.name, attr.value)
    fresh.textContent = el.textContent
    if ctx.opts.hooks.beforeNodeAdded(fresh) === false: continue
    if fresh.hasAttribute("src"): ctx.loads.push(loadPromise(fresh))
    el.replaceWith(fresh)
    ctx.opts.hooks.afterNodeAdded(fresh)
```

Consequences, which the tests must pin:

- A script whose text or `src` did not change never re-executes, even if it
  moved.
- A script whose inline text changed executes once with the new text.
- A script that was merged via `scripts.merge` never executes.
- Execution happens after the whole body is reconciled, in document order.
- A script that appears twice with identical text in the incoming document
  and once in the old document: the second copy has a signature that was
  present before, so it does not execute. This is the current behavior and is
  documented as a limitation.

The `matchMode: "outerHTML" | "smart"` option is dropped; the signature above
is the single "smart" definition. `shouldPreserve`, `shouldReAppend`,
`shouldRemove`, and `afterScriptsHandled` are dropped; vetoes go through
`hooks.beforeNodeAdded` and `hooks.beforeNodeRemoved`.

## 2.14 Focus (`focus.js`)

```
function captureFocus(ctx):
  el = ctx.doc.activeElement
  if !el || el === ctx.doc.body: return null
  state = { el, id: el.getAttribute("id"), scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }
  if el is HTMLInputElement or HTMLTextAreaElement:
    try { state.selection = [el.selectionStart, el.selectionEnd, el.selectionDirection] } catch {}
  else if el.isContentEditable:
    sel = ctx.doc.getSelection()
    if sel && sel.rangeCount: 
      r = sel.getRangeAt(0)
      state.range = { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset }
  return state

function restoreFocus(ctx, state):
  if !state: return
  el = state.el
  if !el.isConnected && state.id: el = ctx.doc.getElementById(state.id)
  if !el || !el.isConnected: return
  if ctx.doc.activeElement !== el: el.focus({ preventScroll: true })
  el.scrollTop = state.scrollTop; el.scrollLeft = state.scrollLeft
  if state.selection: try { el.setSelectionRange(...state.selection) } catch {}
  if state.range && state.range.sc.isConnected && state.range.ec.isConnected:
    r = ctx.doc.createRange(); r.setStart(sc, min(so, lengthOf(sc))); r.setEnd(ec, min(eo, lengthOf(ec)))
    sel = ctx.doc.getSelection(); sel.removeAllRanges(); sel.addRange(r)
```

`lengthOf(node)` is `node.length` for text nodes and `childNodes.length`
otherwise; offsets are clamped because text may have shortened.

Because node identity is preserved whenever pairing succeeds, and `moveBefore`
keeps focus on supported browsers, `restoreFocus` is usually a no-op. It is
the safety net for `insertBefore` fallbacks and for the focused element
having been recreated.

The old `ignoreActive`, `ignoreActiveValue`, and `restoreFocus` options are
replaced by `protectFocusedValue` (default true) plus always-on restore.

## 2.15 Hyperclay adapter (lives in the Hyperclay repos, shown for completeness)

```js
import { morphDocument } from "hyper-morph";
import { mergeScriptText } from "hyper-morph/json-merge";

const SYNC_IGNORE = '[editor-ui],[clay~="editor-ui"],[save-ignore],[snapshot-remove],[no-snapshot],[no-save],[save-remove],[freeze],[save-freeze],[clay~="no-save"],[clay~="no-snapshot"],[clay~="freeze"]';
const isExtension = (el) => /^(chrome|moz|safari-web)-extension:/.test(el.getAttribute("src") || el.getAttribute("href") || "");

export function syncMorph(doc, html, { baseHtml }) {
  const baseTexts = collectMergeTexts(baseHtml);   // Map<merge name, text>
  return morphDocument(doc, html, {
    key: (el) => el.getAttribute("data-id") || el.getAttribute("id"),
    ignore: (el) => el.matches(SYNC_IGNORE) || ((el.tagName === "LINK" || el.tagName === "SCRIPT") && isExtension(el)),
    scripts: {
      merge: (oldEl, newEl) => {
        const name = newEl.getAttribute("merge");
        if (!name) return undefined;
        return mergeScriptText(baseTexts.get(name), oldEl.textContent, newEl.textContent).text;
      },
    },
  });
}
```

The `policy: "history"` and `"raw"` modes become different `ignore`
predicates supplied by the adapter. `findChangedRoots` and `spliceProtected`
are imported from `hyper-morph/splice` by the adapter until they move.

## 2.16 Test plan

Test runner stays `@web/test-runner` with Playwright. Every whole-document
test fixture must include `<!DOCTYPE html>`. Tests are organized per module;
the existing files are the source of cases to port. Each test below is a
required acceptance case, not a suggestion.

### parse.js

- T-P1: string without doctype, target with doctype: target doctype kept.
- T-P2: string with doctype, target without: doctype inserted before `<html>`.
- T-P3: differing doctypes: replaced, no throw.
- T-P4: fragment string (`<p>x</p>`): becomes body content, head empty.
- T-P5: non-string non-Document incoming throws `TypeError`.

### ignore.js

- T-I1: predicate called at most once per element per morph (count calls).
- T-I2: descendant of an ignored old element is not removed even if absent
  from incoming.
- T-I3: ignored new element and its descendants are not inserted.
- T-I4: ignored old element keeps its position relative to the preceding
  kept sibling after inserts and removes around it.
- T-I5: an ignored element is never a pairing target: incoming element with
  the same key as an ignored old element is inserted fresh.

### identity.js and pairing.js

- T-K1: keyed element moved to a different parent is moved, not recreated
  (same node object).
- T-K2: duplicate key on the old side disables that key; elements pair by
  content or position instead.
- T-K3: duplicate key on the new side likewise.
- T-K4: key with different tagName is not paired.
- T-K5: keyed old element that is an ancestor of the destination is not
  paired (cycle guard); no exception; incoming inserted fresh.
- T-K6: keyed old element is never consumed positionally by an unkeyed new
  element.
- T-C1 to T-C30: port `test/comparison.js` scenarios (prepend, remove from
  front and middle, reorder, swap) asserting node identity preserved.
  Scenarios that relied on content-based moves across parents are rewritten
  to use keys, and listed in the commit message.
- T-C31: two same-signature siblings with different text, swapped: both
  nodes preserved and reordered.
- T-C32: 1000 identical `<li class="row">` with unique text, one edited:
  every node preserved, one text node updated.
- T-C33: element with changed class but same position and tag: paired
  positionally (replaces the old slot-match candidate).

### reconcile.js

- T-R1 to T-R11: port `test/ops.js` with the expected operation lists
  regenerated and reviewed by hand; each list must be explainable by the
  three-step pairing.
- T-R12: text node update in place (same node object).
- T-R13: comment node update in place.
- T-R14: `xlink:href` on inline SVG updates and removes correctly.
- T-R15: `<template>` content reconciled, script inside template never runs.
- T-R16: `hooks.beforeNodeAdded` returning false skips insert and the
  cursor still advances correctly (subsequent siblings land in order).
- T-R17: `hooks.beforeNodeRemoved` returning false keeps the node and it is
  not double-visited.
- T-R18: `hooks.beforeNodeMorphed` returning false leaves the subtree and
  attributes untouched.
- T-R19: custom element whose `attributeChangedCallback` removes another
  attribute does not break attribute iteration.
- T-F1 to T-F9: port `test/form-state-sync.js` for the attribute mode only.
- T-F10: focused `<input>` keeps its value and caret when the incoming value
  attribute differs and `protectFocusedValue` is true; is overwritten when
  false.
- T-F11: `<select>` option `selected` synced from attributes.
- T-F12: `<textarea>` default value and live value both synced when not
  focused.
- T-F13: file input value never touched.

### head.js

- T-H1 to T-H18: port `test/head.js` with doctypes added.
- T-H19: `<title>` text change updates the same `<title>` node; no
  add/remove hook fired.
- T-H20: incoming head order is applied to existing elements (moved, not
  recreated).
- T-H21: new stylesheet inserted before the old one is removed.
- T-H22: `awaitLoads: true` resolves after a stylesheet `load` and after a
  404 `error`.
- T-H23: `head.preserve` keeps an element absent from incoming.
- T-H24: a head `<script>` with unchanged text is not re-executed; with
  changed text it executes once (fixture counter).
- T-H25: two identical `<link rel="preload">` elements are both kept
  (multiset bucket).

### scripts.js

- T-S1: inline body script from a string is not executed on insertion, then
  executed exactly once by the execute pass (counter reads 1 after morph, not
  2).
- T-S2: same script text moved to a new position: not re-executed.
- T-S3: changed inline text: executed once with the new text.
- T-S4: `scripts.execute: false`: never executes, markup present.
- T-S5: external script with `src`: promise resolves after `load`, and after
  `error` for a 404.
- T-S6: script merged via `scripts.merge` keeps identity and does not
  execute.
- T-S7: `scripts.merge` on a non-JSON type is not called.
- T-S8: script inside an ignored region is neither executed nor touched.

### focus.js

- Port `test/restore-focus.js` and `test/preserve-focus.js`. The four cases
  failing today must pass; if `moveBefore` loses focus when moving between
  containers in a given browser, the restore path must recover it, so the
  assertion is unconditional.
- T-X1: contenteditable selection restored after a text edit elsewhere in
  the document.
- T-X2: focused element recreated (unpaired) is refocused by id and caret
  restored.
- T-X3: focus in an iframe document: `morphDocument(iframe.contentDocument,
  ...)` reads that document's active element, not the top document's.

### Whole document (index.js)

- T-D1: `morphDocument(document, fullPageStringWithDoctype)` on the test
  page: no throw, `document.body` identity preserved, `document.head`
  identity preserved.
- T-D2: `<html>` attributes synced.
- T-D3: same call on a `DOMParser` document with no window: works.
- T-D4: `morphDocument(html.documentElement, ...)` works; a detached `<html>`
  throws `TypeError`.
- T-D5: return value is a Promise even with no scripts or stylesheets.
- T-D6: unknown option key throws before any mutation.

### Performance

Restore `perf/` with one benchmark script runnable in Chromium via the test
runner: the 3000-element page with one text edit, median of five runs after
three warm-ups. Acceptance: at or under 40 ms on the CI Chromium. Print the
number; fail the test above 80 ms so regressions are caught without flaking.

### Coverage

Keep `coverageConfig.include: ["src/**/*"]` and the `ensure-full-coverage`
check. Target 95 percent lines on `src/` excluding `splice.js`.

## 2.17 Delivery phases

Each phase ends with a green `npm run test:ci` and a commit. Do not start the
next phase on a red suite.

### Phase 0: baseline (no new code)

1. Add `.github/workflows/test.yml` running `npm ci` and `npm run test:ci`
   on push and pull request, Chromium only.
2. Fix or quarantine-with-issue the four failing focus tests so main is
   green. Prefer fixing: the likely cause is the pantry being `hidden`, which
   blurs a moved focused input; moving directly with `moveBefore` avoids it.
3. Remove the dangling `perf` script or restore `perf/runner.js`.

### Phase 1: skeleton and parse

Create `src/index.js`, `src/parse.js`, `src/ignore.js` with T-P and T-I tests.
`morphDocument` at this point delegates the body to the old
`HyperMorph.morph` so the whole-document tests T-D1 to T-D6 can pass early
and the doctype crash is fixed for users on the next release.

### Phase 2: identity, matcher, pairing

`src/identity.js`, `src/matcher.js`, `src/pairing.js`. Unit-test pairing by
asserting the returned `Map` directly (no DOM mutation yet). T-K, T-C.
Benchmark `computePairing` alone on the 3000-element page: target under 15 ms.

### Phase 3: reconcile

`src/reconcile.js`. Switch `morphDocument` to the new body path. T-R, T-F.
Port `test/core.js` and `test/fidelity.js`; every case must pass or be
consciously rewritten with the reason in the test description.

### Phase 4: head and scripts

`src/head.js`, `src/scripts.js`. T-H, T-S.

### Phase 5: focus

`src/focus.js`. T-X plus the ported focus suites.

### Phase 6: cut over and remove

1. Delete `src/hyper-morph.js`, `src/hyper-morph-matcher.js`,
   `src/lib/`, `scripts/propagate.js`, `scripts/vendor-format.js`,
   `packed-contract.json`, and the tests that only covered removed options
   (`sync-ignore.js`, `key-matching.js` where superseded, `hooks.js` cases
   for removed head/script hooks).
2. Move `findChangedRoots` and `spliceProtected` and `test/protected-splice.js`
   to `src/splice.js` and `test/splice.js` unchanged.
3. Update `package.json` `exports` to `.`, `./json-merge`, `./json-parse`,
   `./splice`. Bump to 1.0.0.
4. Rewrite `README.md` around the one-job statement and the option table in
   2.3.
5. Land the Hyperclay adapter (2.15) in the downstream repos and replace the
   vendored copies with the npm dependency.

### Size budget

| Module | Lines |
|---|---|
| index.js + parse.js + ignore.js | ~200 |
| identity.js + matcher.js + pairing.js | ~350 |
| reconcile.js | ~300 |
| head.js | ~130 |
| scripts.js | ~90 |
| focus.js | ~90 |
| total core | ~1,160 (today: ~4,900 including splice and json) |

## 2.18 Behavior changes to announce in the 1.0 changelog

- Content-based matching no longer moves elements between parents; use
  `key` for that.
- Head elements are updated in place and keep incoming order.
- `morph()` is replaced by `morphDocument()` and always returns a Promise.
- Removed options: `morphStyle`, `ignoreActive`, `ignoreActiveValue`,
  `restoreFocus`, `formStateSync`, `policy`, `head.style`, `head.block`,
  `head.ignore`, `head.shouldPreserve`, `head.shouldReAppend`,
  `head.shouldRemove`, `head.afterHeadMorphed`, `scripts.handle`,
  `scripts.matchMode`, `scripts.mergeBase`, `scripts.mergeTags`,
  `scripts.shouldPreserve`, `scripts.shouldReAppend`, `scripts.shouldRemove`,
  `scripts.afterScriptsHandled`, `HyperMorph.defaults`.
- Removed attributes: `im-preserve`, `im-re-append`, `merge`, `merge-key`
  (the last two move to the adapter's `scripts.merge` implementation).
- Removed exports: `createMatcher`, `findChangedRoots` and `spliceProtected`
  from the main entry (now `hyper-morph/splice`), `parseRulesRelaxed` (stays
  under `hyper-morph/json-parse` only).

## 2.19 Open questions for the maintainer

1. Should `splice.js` ship in this package at all, or move to ClayJS with
   its tests? The spec assumes it ships as a subpath for one release.
2. Is dropping content-based cross-parent moves acceptable for live sync?
   The current comparison suite should be checked for real cases that
   depend on it before Phase 2 begins.
3. Should `protectFocusedValue` also protect a focused `contenteditable`
   subtree from incoming text changes? The spec says no (selection is
   restored instead) because collaborative editing needs remote edits to
   land.
