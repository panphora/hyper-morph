# HyperMorph: review, system map, and rewrite plan

Date: 2026-09-25. Reviewed at hyper-morph v0.5.4 (commit 574c32c) and
clayjs v1.4.0 (commit dc18771). HyperclayJS is deprecated and was not used as
a reference.

Decisions taken with the maintainer before this revision:

1. Merging local unsaved work with incoming documents is the library's job,
   not an add-on. The "protected splice" is folded into the core rather than
   moved out.
2. The library must work on ordinary HTML with no ids the author has to add,
   and must never write identity into the user's DOM or file.
3. Text merges at character granularity, inside the core.

This document has five parts:

- Part 1: what is wrong with the current library (measured).
- Part 2: how ClayJS uses it and where the "mirror" lives (system map).
- Part 3: real-world scenarios, with the current library's measured result
  and the prototype three-way merge's result on the same inputs.
- Part 4: the new architecture and per-module specification.
- Part 5: ClayJS integration, test plan, delivery phases.

The scenario runner and the prototype are in `docs/evidence/` and run with:

```
npx web-test-runner --playwright --browsers chromium --files docs/evidence/scenarios-current-library.js
npx web-test-runner --playwright --browsers chromium --files docs/evidence/three-way-merge-prototype.js
```

---

# Part 1: Review of the current library

## Verdict

The library is a two-way morph (Idiomorph plus content scoring) with a
three-way JSON merge for script tags and a separate "diff local against
base, splice into remote, then morph" pipeline bolted on. That shape cannot
express the product's actual operation, which is a three-way merge of base,
local, and remote. Part 3 shows the consequence: in every scenario where two
people touch a page at once and the elements have no ids, the current
pipeline either discards one person's work or applies nothing at all.

## Measured defects

| Check | Result |
|---|---|
| Full suite (Chromium, Playwright 1.56.1) | 606 pass, 4 fail, 15 skipped, 97.6% coverage |
| `morph(document, "<!DOCTYPE html>...")` | throws `HierarchyRequestError: Only one doctype on document allowed` |
| `morph(doc.documentElement, "<!DOCTYPE html>...")` | same throw |
| Attached element as new content with a nested `no-save` descendant | throws `TypeError: newContent.contains is not a function` |
| `innerHTML` morph of one `documentElement` into another | produces `<html><html>...</html></html>` |
| 3000-element page, one text edit | 758 ms; upstream Idiomorph 277 ms on the same input |

- **Doctype crash.** Inherited from Idiomorph. ClayJS avoids it only because
  it morphs `documentElement` against a parsed `documentElement`, never a
  `Document` against a string. The head tests pass because their fixtures
  omit the doctype.
- **`.contains` crash (0.5.4).** `src/hyper-morph.js:1854` calls a method the
  `SlicedParentNode` duck type does not have. ClayJS passes an attached
  `documentElement` so it takes exactly this path; the crash needs an
  ignored region with a child on the incoming side.
- **Four focus tests fail on current Chromium** under `restoreFocus: false`
  in `test/restore-focus.js`. There is no CI. `npm run perf` points at a
  missing directory.
- **Quadratic matcher.** 742 of the 758 ms are in `computeMatches`.
  `computePath` walks previous siblings for every ancestor of every element
  (`src/hyper-morph-matcher.js:217`), and every lookup re-filters the whole
  signature bucket with `getAttribute` (`src/hyper-morph-matcher.js:713`).
  Disabling both drops the run to 188 ms. ClayJS relays a frame per 150 ms
  of typing, so on a large page a receiving tab spends most of its time in
  this function.
- **Global `document` and `window`** for active element, script creation,
  head fragment creation, and URL resolution.
- **Head merge** removes and re-appends a changed `<title>` instead of
  updating it, and does not keep incoming order.

## Structural problems

Five identity systems are reconciled after the fact (Idiomorph id sets,
content scoring, slot candidates, the `key` callback, merge-tag pairing).
The `key` block at `src/hyper-morph.js:1881` and the merge-pairing block at
`src/hyper-morph.js:1945` are near duplicates. Because matching is decided
lazily during the walk, the pantry, staged-node recovery,
`removeNodesBetween`, `moveBeforeById`, ancestor id-map cleanup, and the
cycle guard all exist to patch over decisions made too early.

Input normalization has five paths (`string`, detached node, attached node,
array, `Document`) and the `SlicedParentNode` duck type is only partly
honored. The three crashes above all come from that.

`findChangedRoots` and `spliceProtected` (about 600 lines) solve the merge
problem by promotion: a dirty element without a key promotes to its nearest
keyed ancestor, and on an id-free page that is `<body>`, which is a
structural root the splice refuses to replace. That is why the "hold"
outcome dominates Part 3.

---

# Part 2: System map: how ClayJS uses this library

This is the part a rewrite has to fit. Everything here was read from the
ClayJS source at v1.4.0.

## 2.1 There is no mirror tree. There are baseline strings.

ClayJS never keeps a shadow DOM tree in sync with the page. It keeps
serialized strings and re-parses them when needed:

| Baseline | Owner | Domain | Advances when |
|---|---|---|---|
| `lastHtml` + `_lastIdentityMap` | `sync/live-sync.js` | snapshot domain (what peers see) | own relay POST succeeds; a peer frame applies (set to the raw frame, never the merged result); a clean disk apply |
| `lastSavedContents` | `core/save.js` | autosave-comparison domain | a save lands; a verified-clean sync apply |
| `lastSavedDirty` | `core/save.js` | dirty domain (keeps `no-trigger-autosave`) | same as above |
| source-map model | `core/source-map.js` | the file's own bytes | boot fetch; accepted save; re-pair on `clay:sync-applied` |

Parsing is memoized one-deep per lane (`splice-merge.js` `makeParseCache`)
because a typing burst reuses the same base string across frames.

The "mirror that gets patched as changes are made" is therefore the pair
(`lastHtml`, `_lastIdentityMap`) for the peer lane and `lastSavedDirty` for
the disk lane. The live DOM is the local side. Nothing is diffed
incrementally; every frame that arrives while the page might be dirty
re-captures the whole page and diffs it against the parsed baseline.

## 2.2 Serialization domains

`core/snapshot.js` produces several serializations of one clone. The clone
is made by `createContentView` (`lib/content-dom.js`) with capability
`snapshot`, which strips `no-snapshot` regions and records a provenance
WeakMap from every clone node to its live node (`originalSnapshotNode`).
Then, in order: snapshot hooks (form values written into attributes),
authored URL restore, `onbeforesnapshot` handlers, extension-noise strip.

| Domain | What is stripped | Used for |
|---|---|---|
| snapshot | `no-snapshot` only | live-sync wire (`serializeForSync` also drops tab-local root attrs) |
| save | plus `no-save`, transforms, `freeze` restore | the file |
| comparison | plus `no-trigger-autosave`, `no-dirty`, `no-watch` | "should this autosave" |
| dirty | like comparison but keeps `no-trigger-autosave` | "would the person lose work", and the disk-lane merge base |

The region vocabulary is in `lib/region-policy.js` (`clay="no-save freeze"`
tokens plus legacy bare attributes). hyper-morph's `SYNC_IGNORE_SELECTOR`
is a hand-maintained copy of part of this list.

## 2.3 Identity without ids: the synthetic identity map

`live-sync.js` keeps `liveWeakMap: Element -> "<clientId>:<n>"`. Ids are
minted lazily at snapshot time and never written to the DOM or the file.
On every relay, `_buildIdentityMap` walks the snapshot clone and emits
`{ "0.1.3": "abc:17", ... }` keyed by dot-path over element children. The
frame carries `{ html, identityMap, sender, seq, etag, by }`.

The receiver walks the parsed frame by the same paths to build
`parsedWeakMap`, passes `key = el => liveWeakMap.get(el) || parsedWeakMap.get(el) || data-id || id`
to the morph, and in `afterNodeMorphed` copies the incoming id onto the
live element it morphed into. `_fillInIdsAfterMorph` covers elements the
morph inserted by cloning. So after one round trip, the same logical element
carries the same id in every tab, and identity survives moves and content
edits. This is what makes "no ids in the user's DOM" workable, and the
rewrite builds on it rather than on content scoring.

Fragilities to carry into the design:

- Path keys break under any divergence between the sender's clone and the
  receiver's parse (an `onbeforesnapshot` handler that adds a sibling). Both
  walkers abort a subtree on child-count mismatch.
- Elements inside `<template>` and text nodes have no identity.
- Duplicate ids can arise when a subtree is cloned in the page (a
  drag-duplicate); both sides then fall back to content matching.

## 2.4 The send side

`core/autosave.js`: mutations in the autosave domain (`Mutation.onAnyChange`
with `require: 'autosave'`, 1.5 s debounce, 10 s max wait) call
`savePageThrottled` (1.2 s throttle). `savePage` runs
`captureForSaveAndComparison`, which dispatches `clay:snapshot-ready` with
the clone before stripping. `live-sync.js` listens, serializes for sync,
builds the identity map, and POSTs after a 150 ms debounce, single-flight
with a one-deep queue. `lastHtml` advances only if no frame applied while the
POST was in flight (`_applyGen`).

Saves carry `If-Match` when the host supports conditional saves
(`core/etag.js`); a 412 puts the tab in a conflict hold that suspends
autosave until a save lands or the user chooses to overwrite.

## 2.5 The receive side (peer lane)

`_doApplyUpdate` under `Mutation.pause()` and `pauseGate()`:

1. Parse the frame; build `parsedWeakMap` from `identityMap`.
2. If `pageMaybeDirty()` (a counter fed by dirty-domain mutations and input
   events, cleared on save, plus a probe of `[persist]` controls):
   `protectPeerDoc` captures a snapshot clone, parses `lastHtml`, fills ids
   on both, runs `findChangedRoots(localClone, baseDoc)`, and
   `spliceProtected(newDoc, entries)`. If the splice reports `ok: false`,
   the frame is **held**: nothing morphs, `lastHtml` does not move, the etag
   is refused, a 3 s retry re-queues the same frame, and
   `clay:sync-held` fires.
3. `HyperMorph.morph(document.documentElement, newDoc.documentElement, { morphStyle: 'outerHTML', ignoreActiveValue: true, head: { style: 'merge' }, scripts: { handle: true, matchMode: 'smart', mergeBase: lastHtml, mergeTags }, key, callbacks: { afterNodeMorphed, beforeAttributeUpdated } })`.
4. Restore scroll; fill ids; `lastHtml = raw frame`; record the etag; if
   nothing was protected and the page is clean, advance both save
   baselines; dispatch `clay:sync-applied`.
5. If sections were protected, `savePageThrottled()` runs a convergence save
   so the merged state reaches disk and peers.

`lastHtml` is deliberately the raw frame, not the merged result: a patched
baseline would make the next frame's diff read the protected section as
clean (`tests/unit/live-sync-peer-protect.test.js`).

## 2.6 The receive side (disk lane)

External changes (the file changed on disk, or a fetch of the served page)
go through `_doApplyExternal`: the same shape, but the base is
`lastSavedDirty`, the local capture is `captureForMerge()` (a compare clone
and a save clone from one snapshot, paired by a WeakMap), the incoming
document is edit-mode activated (`activateIncomingDoc`) so inert attribute
forms match the live ones, and a clean apply advances both save baselines
and rebuilds `lastHtml`.

## 2.7 Other consumers of the morph

- `hypercms.vendor.js` morphs its own panel with
  `{ morphStyle: 'innerHTML', formStateSync: 'property', policy: 'raw' }`.
  It builds new content in memory with property assignment, so it needs the
  property mode the earlier draft of this plan proposed to drop. It stays.
- `sync/section-notice.js` compares a region's `outerHTML` across
  `clay:sync-applied` to say "Ana changed this section". It has no access
  to what the merge actually changed and infers it.
- `plugins/source.js` re-pairs live nodes to file byte ranges on
  `clay:sync-applied` because "a morph replaces live nodes". With the new
  apply step, the set of replaced nodes is known and can be reported.
- `lib/mutation.js` bridges `Mutation.pause()` to `clay.undo.pause()`, so
  remote frames never enter the undo stack. The rewrite keeps applying
  under the caller's pause; it does not manage undo.

## 2.8 What this means for the rewrite

- The three inputs of a three-way merge already exist: base is a baseline
  string, local is the live DOM (via a snapshot clone with provenance),
  remote is the frame.
- Identity is available on all three sides: base ids come from
  `_lastIdentityMap` or from the live WeakMap, local ids from the live
  WeakMap through provenance, remote ids from the frame's map.
- The consumer needs the apply to be identity-preserving against the live
  DOM (caret, scroll, undo, source-map pairing, `no-snapshot` chrome) and
  needs a precise change report afterward.
- Holding a frame must become rare. Today a hold is the normal outcome on
  an id-free page.

---

# Part 3: Scenarios

Each scenario was run against the current library in two configurations:
"plain" is `morph(live, remote)`; "splice" is the ClayJS pipeline
`findChangedRoots` then `spliceProtected` then `morph`, which is what a
dirty tab does. "Prototype" is the three-way merge prototype in
`docs/evidence/three-way-merge-prototype.js` on the same base, local, and
remote. None of the elements below carry ids.

### S1: two people edit the same paragraph, different places

Base `<p>The quick brown fox jumps over the lazy dog.</p>`. Local prepends
"Note: ". Remote changes "lazy" to "sleepy".

| | Result |
|---|---|
| plain | `<p>The quick brown fox jumps over the sleepy dog.</p>` (local edit lost) |
| splice | held on BODY; nothing applied, remote edit never lands while local stays dirty |
| prototype | `<p>Note: The quick brown fox jumps over the sleepy dog.</p>` |

### S1b: two people edit the same word

Base `the lazy dog`, local `the LAZY dog`, remote `the sleepy dog`.

| | Result |
|---|---|
| prototype | `the sleepy dog`, reported as a text conflict (remote wins the overlapping hunk; the report lets the UI offer "keep mine") |

### S2: local reorders a keyless list while remote edits one item

| | Result |
|---|---|
| plain | remote order wins, local reorder silently reverted, then saved as reverted |
| splice | held on BODY |
| prototype | `Cherries, Apples, Bananas (organic)` (both survive) |

### S3: local drags a card to another column; remote edits its title

The card contains a `<video>`.

| | Result |
|---|---|
| plain | card recreated (video node lost, playback reset), move reverted |
| splice | held on BODY |
| prototype | card in the new column with the new title; the merge output records that the card corresponds to the local card, so apply moves the existing node |

### S4: both users append to the same list

| | Result |
|---|---|
| plain | local "Dates" deleted |
| splice | held on BODY |
| prototype | `Apples, Bananas, Dates, Elderberries` |

### S5: attribute edits on different elements

Local sets `style` on `<h1>`; remote adds a class on the `<section>`.

| | Result |
|---|---|
| plain | local `style` lost |
| splice | held on BODY (a keyless attribute edit promotes to the parent) |
| prototype | both attributes present |

### S6: different attributes on the same element

| | Result |
|---|---|
| plain | local `class` lost |
| splice | held on BODY |
| prototype | `<div class="box open" data-x="2">` |

### S7: remote deletes the paragraph local is editing, and adds another

| | Result |
|---|---|
| plain | local edit destroyed with the paragraph |
| splice | held on BODY |
| prototype | `One, "Two, edited locally", Three, Four` (edits beat deletes; the new paragraph lands) |

S7 also produced the one bug in the prototype, which the specification now
carries as a rule: pairing two elements by tag and class alone, without a
text similarity check, let base "Two" align with remote "Four" and the
character merge produced "Fo, edited locallyur". Content pairing without a
key requires similar text (Part 4.6).

### S8: typing in a contenteditable while a remote edit lands elsewhere

| | Result |
|---|---|
| plain | local typing reverted to the frame's text; caret moved to offset 0 |
| new design | text merged; caret mapped through the merge hunks to its logical position (Part 4.10) |

### S9: whole-document sync of a page with a doctype

| | Result |
|---|---|
| plain | throws |
| new design | doctype synced explicitly (Part 4.4) |

### S10: performance, 3000-element page, one edit

| | Result |
|---|---|
| current, clean tab | 758 ms |
| current, dirty tab | 758 ms plus a full capture and diff, or a hold |
| target | 40 ms merge plus apply, measured in CI |

### Why the current pipeline holds

`findChangedRoots` can only express a local change as "replace this
identified subtree". On a page without ids, nothing below `<body>` is
identified, every dirty root promotes to `<body>`, and `spliceProtected`
refuses to replace a structural root. So a dirty tab on an id-free page
never receives a peer's edit until it saves, and its own save then
overwrites the peer's edit. The three-way merge has no such promotion: it
merges at the node where the change happened.

---

# Part 4: Architecture and specification

## 4.1 One operation

```
mergeDocument({ live, base, remote, ... }) -> Promise<MergeReport>
```

reads three trees and mutates `live` so that it holds the three-way merge
of base, local (the current state of `live`), and remote. Everything else
in the library is a special case or a building block:

- Two-way morph is `base = null`: local is treated as unchanged, so remote
  wins everywhere except ignored regions.
- `morphElement(oldEl, newEl, options)` is the two-way case on one element
  pair, for consumers like hypercms.

The operation is split into a pure phase and an apply phase:

```
merge3(baseDoc, localDoc, remoteDoc, opts) -> { doc, provenance, changes, conflicts }
apply(live, mergedDoc, provenance, localToLive, opts) -> AppliedReport
```

`merge3` never touches the live DOM and runs on parsed documents, so it is
unit-testable in Node with jsdom and reusable server-side. `apply` never
guesses: every node in the merged tree carries provenance saying which
local node it came from, and the caller supplies `localToLive` (ClayJS's
`originalSnapshotNode`). The identity-preservation problem the current
library solves with pantries and scoring becomes a lookup.

## 4.2 Module layout

```
src/
  index.js          mergeDocument, morphDocument, morphElement; option validation
  parse.js          toDocument, syncDoctype, one-deep parse cache
  ignore.js         cached ancestor-aware ignore predicate
  identity.js       synthetic identity store, export/import of path maps, tiered idOf
  align.js          align(base, side): Map<baseNode, sideNode> + moved/inserted/deleted
  similarity.js     signatures, text hints, similarity test
  text-merge.js     character diff (Myers), diff3 with hunk policy, offset mapping
  merge.js          merge3: attributes, children, text, special elements; change report
  head-merge.js     head children identity and merge rules
  scripts.js        script signatures, JSON merge integration, inert clones, execute-once
  apply.js          apply merged tree to live DOM by provenance; focus and caret restore
  json-merge.js     unchanged
  json-parse.js     unchanged
```

Deleted: `hyper-morph.js`, `hyper-morph-matcher.js`, `lib/content-dom.js`,
`lib/region-capabilities.js`, `scripts/propagate.js`,
`scripts/vendor-format.js`, `packed-contract.json`. `findChangedRoots` and
`spliceProtected` are deleted once ClayJS is on `mergeDocument`; until then
they are kept as `src/legacy-splice.js` behind the old export names.

No module references the global `document` or `window`; an ESLint
`no-restricted-globals` rule enforces it in `src/`.

## 4.3 Public API

```ts
type Side = "base" | "local" | "remote";

type MergeOptions = {
  // The document to mutate.
  live: Document;

  // Last common state, as the caller serialized it. null means two-way.
  base: string | Document | null;

  // Incoming state.
  remote: string | Document;

  // Optional snapshot of the local side. When omitted, the live DOM is used
  // directly. ClayJS passes its snapshot clone here (form values already
  // written into attributes, no-snapshot regions stripped) with the
  // provenance function that maps clone nodes back to live nodes.
  local?: { root: Element; toLive: (node: Node) => Node | null };

  // Identity per side. Return a stable string or null. Called once per
  // element per side. Defaults to data-id then id on every side.
  identity?: { base?: IdOf; local?: IdOf; remote?: IdOf };

  // Regions the merge must not touch on the live side and must not import
  // from the remote side. Ancestor-aware. Default: () => false.
  ignore?: (el: Element) => boolean;

  // Conflict policy for overlapping edits to the same text or attribute.
  // "remote" (default), "local", or "both" (text only: keep both hunks in
  // base order, local first).
  conflicts?: "remote" | "local" | "both";

  // Keep the focused input/textarea value even if the merge says
  // otherwise. Default true.
  protectFocusedValue?: boolean;

  head?: { awaitLoads?: boolean; preserve?: (el: Element) => boolean };

  scripts?: {
    execute?: boolean;                 // default true
    mergeTags?: MergeTagRecognizer[];  // same shape as today
  };

  formState?: "attribute" | "property"; // default "attribute"

  hooks?: {
    beforeNodeAdded?: (n: Node) => boolean | void;
    afterNodeAdded?: (n: Node) => void;
    beforeNodeRemoved?: (n: Node) => boolean | void;
    afterNodeRemoved?: (n: Node) => void;
    beforeNodeMorphed?: (oldN: Node, newN: Node) => boolean | void;
    afterNodeMorphed?: (oldN: Node, newN: Node) => void;
    beforeAttributeUpdated?: (name: string, el: Element, kind: "update" | "remove") => boolean | void;
  };
};

type MergeReport = {
  changes: Change[];     // what the apply did to live nodes, by kind
  conflicts: Conflict[]; // overlapping edits and how each was resolved
  moved: Element[];      // live nodes moved to a new parent
  replaced: Element[];   // live nodes that were removed and recreated
  identities: Map<Element, string>; // ids for elements that gained one (see 4.5)
};

type Change =
  | { kind: "text"; node: Text; before: string; after: string; source: Side }
  | { kind: "attr"; el: Element; name: string; before: string | null; after: string | null; source: Side }
  | { kind: "insert"; el: Element; source: Side }
  | { kind: "remove"; el: Element; source: Side }
  | { kind: "move"; el: Element; from: Element; to: Element; source: Side };

type Conflict =
  | { kind: "text"; node: Text; base: string; local: string; remote: string; resolved: string }
  | { kind: "attr"; el: Element; name: string; base: string | null; local: string | null; remote: string | null; resolved: string | null }
  | { kind: "structure"; el: Element; detail: string };

declare function mergeDocument(o: MergeOptions): Promise<MergeReport>;
declare function morphDocument(live: Document, remote: string | Document, o?: Partial<MergeOptions>): Promise<MergeReport>;
declare function morphElement(oldEl: Element, newEl: Element, o?: Partial<MergeOptions>): Promise<MergeReport>;
declare function merge3(base: Document, local: Document, remote: Document, o?: Partial<MergeOptions>): MergeResult; // pure
```

Rules: always a Promise from the applying functions; unknown option keys
throw before any mutation; no global defaults object.

## 4.4 Parse (`parse.js`)

```
toDocument(input, ownerDoc):
  string   -> DOMParser on ownerDoc.defaultView (globalThis fallback) -> Document
  Document -> as is
  else     -> TypeError
```

`parseCached(key)` keeps the last string and its parsed Document per lane
(the caller passes a lane name), because a burst reuses the base string.

```
syncDoctype(live, remote):
  if remote.doctype == null: return
  if live.doctype == null: insert createDocumentType(...) before documentElement
  else if name/publicId/systemId differ: replaceChild
```

Nodes outside `<html>` other than the doctype are ignored.

## 4.5 Identity (`identity.js`)

The library ships the synthetic identity scheme ClayJS implements today so
every consumer gets it and the walkers are maintained in one place:

```
createIdentityStore(clientId):
  idOf(liveEl)           -> existing id or null
  ensure(liveEl)         -> existing id or a freshly minted "<clientId>:<n>"
  exportMap(cloneRoot, toLive) -> { "0.1.3": id }  (dot-path over element children of the clone;
                                                   subtree skipped on child-count divergence)
  importMap(parsedRoot, map)   -> WeakMap<Element, id>
  adopt(liveEl, id)      -> record an id learned from a frame
```

`mergeDocument` takes `identity.{base,local,remote}` functions. The tiered
default, which ClayJS will pass explicitly, is:

```
tier 1: synthetic id (store / imported map)
tier 2: data-id
tier 3: id
```

A value is usable on a side only if unique on that side. A pair requires the
same `tagName`. After apply, `MergeReport.identities` lists live elements
that received an id from the remote side (the element was inserted from
remote, or morphed into an element whose remote counterpart carried an id
the live one lacked). ClayJS calls `store.adopt` for each, replacing
`afterNodeMorphed` and `_fillInIdsAfterMorph`.

Text nodes and template contents have no identity and align structurally.

## 4.6 Alignment (`align.js`, `similarity.js`)

`align(baseRoot, sideRoot, idOfBase, idOfSide, ignore)` returns

```
{ map: Map<baseNode, sideNode>, moved: Set<baseEl>, inserted: Set<sideNode>, deleted: Set<baseNode> }
```

Every base node maps to at most one side node and vice versa.

Pass 1, identity (global): index both roots by usable id; pair equal ids
with equal tag.

Pass 2, structure (top-down over paired element pairs, children only):

```
alignKids(bKids, sKids):
  a. exact: nodes whose serialization (outerHTML, or nodeValue for text and
     comments) is unique on both sides pair.
  b. signature + text hint, unique on both sides.
  c. signature + similar text, nearest sibling index. Signature is
     tag + sorted classes + href/src/name/type/role. Similar means the
     character edit distance between the two 64-char hints is at most the
     longer hint's length, or both hints are empty.
  d. positional: remaining nodes pair in order when node type and tag agree
     AND (for elements) similar text. A text node pairs with the next
     unpaired text node.
```

Pass 3, moves (global): every still-unpaired base element is compared with
every still-unpaired side element under the same parent-independent rules
b then c; a unique match is recorded in `moved` and its subtree is aligned
with pass 2. The pass is skipped when the product of the two unpaired
counts exceeds 250,000, and those elements stay delete-plus-insert.

Rule carried from S7: no element pair is ever formed on tag and class alone.
Similar text or a usable identity is required, or the elements are a delete
and an insert. Elements with empty text on both sides (icons, spacers,
inputs) satisfy "similar".

Elements whose text hint is code or data (`script`, `style`, `textarea`,
`template`, `iframe`, `object`, `canvas`, `video`, `audio`, `svg`) skip
rules b and c and pair by identity, exact equality, or position only.

Text hints are computed once per node in one top-down pass and cached in
a WeakMap along with the node's sibling index. No sibling walks.

Complexity: O(N) identity and hint passes; per parent O(k) with buckets and
a 16-candidate window for oversized buckets (the current
`selectCandidateSubset` without the per-call filter); pass 3 bounded as
above.

## 4.7 Text merge (`text-merge.js`)

```
diff(a, b) -> Hunk[]              Myers O(ND) on UTF-16 code units, hunks as {bs, be, text}
merge3Text(base, local, remote, policy) -> { text, conflicts: Hunk[], mapLocalOffset: (n) => n }
```

Fast paths: `local === remote` returns local; `local === base` returns
remote; `remote === base` returns local.

Otherwise both hunk lists are walked in base order. Two hunks overlap when
their base ranges intersect; two pure insertions at the same base offset do
not overlap and both apply, local first. Non-overlapping hunks apply from
both sides. Overlapping hunks resolve by policy:

- `remote`: remote's hunk applies over the union of the two ranges, local's
  hunk is dropped and reported.
- `local`: symmetric.
- `both`: both replacement texts are emitted, local first, over the union.

`mapLocalOffset` maps a caret offset in the local text to the merged text:
offsets before a remote hunk are unchanged, offsets inside a remote hunk
clamp to the hunk's end in the merged text, offsets after it shift by the
hunk's length delta. This is what keeps the caret in place in S8.

Cost bound: for two strings longer than 20,000 code units, or when the
Myers edit distance exceeds 4,000, fall back to line-granularity diff and
then to whole-value three-way (last writer wins with a conflict record).
Paragraph text is the normal case and is far below either limit.

## 4.8 Merge (`merge.js`)

`merge3(baseDoc, localDoc, remoteDoc, opts)` aligns base with local (`L`)
and base with remote (`R`), then builds a fresh output document. Every
output node records provenance `{ base, local, remote }` (any may be null).

### Attributes

```
for each name in union(base, local, remote):
  bv, lv, rv (null when absent; a side that lacks the element inherits bv)
  lv === rv -> lv ; lv === bv -> rv ; rv === bv -> lv ; else policy, record conflict
```

`class` and `style` merge token-wise and declaration-wise before falling
back to the string rule, so S6's "local added a class, remote changed a
data attribute" and "local added one class, remote added another" both
survive.

### Text and comment nodes

`merge3Text` on `nodeValue`. Adjacent text nodes on each side are coalesced
into one run before alignment (the live DOM splits text under typing; a
parsed document does not), and the merged run is emitted as one node.

### Children

```
mergeChildren(b, l, r):
  bKids = children of b (text runs coalesced)
  order side O: remote if remote reordered kept children, else local if local did, else remote
  for each node in O's children, in order:
    paired to a base child here      -> emit mergeNode(bk, L.get(bk), R.get(bk)) unless dropped
    paired to a base child elsewhere -> a move in: emit mergeNode(bk, ...) here, record move
    unpaired                          -> an insertion: emit a clone, record insert
    after each base child, emit the other side's insertions anchored after it
  base children not emitted (O deleted or moved them out):
    deleted by both                    -> gone
    deleted by one, untouched by other -> gone
    deleted by one, edited by other    -> emitted after its nearest surviving preceding base sibling (edits beat deletes)
    moved out by one side              -> emitted at that side's destination, with the other side's edits merged in
  both sides inserted a byte-identical node at the same anchor -> emitted once
```

"Edited" means the side's subtree serialization differs from base.

A side that moves an element into its own descendant is treated as an
insertion at the destination and a deletion at the origin (no cycle can be
created in the output because the output is built fresh).

### Special elements

- `<head>`: children keyed by head signature (4.9), then the same rules.
- `<script>` with a JSON type and a merge identity: `mergeScriptText`
  three-way. Any other `<script>`: whole-text three-way, never character
  merged (a half-merged program is worse than a lost edit).
- `<textarea>`: value attribute and text as one value, whole-value three-way.
- `<template>`: children merge on `.content`.
- Ignored regions: a local ignored element is copied from local verbatim
  with provenance, so apply keeps the live node untouched; a remote ignored
  element is dropped.
- Form controls: `value`, `checked`, `selected` merge as attributes (the
  snapshot clone carries live values as attributes). Apply protects the
  focused control (4.10).

### Change report

Every decision that differs from base on either side is recorded with the
side that caused it and the output node, so apply can translate it to live
nodes for `MergeReport.changes`.

## 4.9 Head (`head-merge.js`)

Head children get an identity of their own so they align without ids:

```
TITLE, BASE            -> the tag name (singletons)
SCRIPT with src        -> "script|src|" + type + "|" + absolute URL without hash
SCRIPT inline          -> "script|inline|" + type + "|" + hash(text)
LINK with href         -> "link|" + rel + "|" + absolute URL without hash
META                   -> "meta|" + first of charset/name/property/http-equiv/itemprop and its value
STYLE                  -> "style|" + hash(text)
else                   -> outerHTML
```

URLs resolve against the live document's `baseURI`; the query string is
kept. Duplicate signatures form a multiset. Apply keeps incoming order,
updates a matched element in place (a title change is a text change), and
inserts a new stylesheet before removing a replaced one. `awaitLoads`
awaits `load` or `error` on inserted stylesheets and external scripts.

## 4.10 Apply (`apply.js`)

Input: the live document, the merged document, provenance, `toLive`.

```
applyElement(liveEl, mergedEl):
  syncAttributes (namespaced; hooks consulted; form-state attrs via syncFormState)
  special: textarea, script (text only; execution decided later), template (content)
  applyChildren(liveEl, mergedEl)

applyChildren(liveParent, mergedParent):
  cursor = first live child that is not ignored
  for mergedChild in mergedParent.childNodes:
    liveChild = toLive(provenance(mergedChild).local)      // null when inserted from remote
    if liveChild:
      if liveChild !== cursor: moveBefore(liveParent, liveChild, cursor)   // from anywhere in the live tree
      applyNode(liveChild, mergedChild); cursor = next non-ignored after liveChild
    else if mergedChild is text and cursor is an unclaimed live text node:
      set nodeValue; claim; advance
    else:
      insert an inert clone before cursor (importNode from the merged doc; scripts made inert)
  remove every live child not claimed, not ignored, and not the local twin of a merged node elsewhere
```

There is no pantry: a live node whose merged counterpart sits under another
parent stays put until that parent is applied and then `moveBefore` pulls
it in. Leftover removal skips it because provenance names it.

`moveBefore` is used when present (Chrome 133+, Firefox 133+) so iframe,
video, and focus survive; `insertBefore` otherwise.

Focus and caret: before applying, capture `activeElement`, its selection
range, and scroll offsets, from `live`, not the global document. For a
contenteditable, keep a reference to the text node and offset. After
applying, if that text node still exists, map the offset through the
`mapLocalOffset` function the text merge returned for it; if it was
replaced, place the caret at the same offset in the merged node that took
its place; if the element was recreated, refocus by identity. The focused
input or textarea keeps its live value when `protectFocusedValue` is true;
the merged value is recorded as a conflict so the caller can decide.

Script execution runs after apply: a body script whose signature (4.9 rule)
was not present before apply executes once by replacement with a fresh
element; merged JSON scripts never execute.

## 4.11 Baselines and holds

The library takes baselines as the caller holds them. It does not own them.
What it guarantees:

- With a base, every frame merges. There is no structural hold; a
  structural impossibility (the two sides cannot both be honored, such as
  one side deleting a container the other side moved content into) is
  resolved by policy and reported as a `structure` conflict.
- With `base = null`, the merge is two-way and remote wins. ClayJS today
  holds a dirty tab's first frame because `lastHtml` is null until the
  first send. The recommended fix is in Part 5: seed `lastHtml` from the
  boot capture so `base` is never null after boot.

---

# Part 5: Integration, tests, phases

## 5.1 ClayJS changes

`sync/live-sync.js`, `_doApplyUpdate`:

```js
const clone = captureSnapshot({ flushUndo: false });
const report = await mergeDocument({
  live: document,
  base: this.lastHtml,                       // may be null before first send; see below
  remote: html,
  local: { root: clone, toLive: originalSnapshotNode },
  identity: {
    base:   (el) => baseIds.get(el)   || el.getAttribute('data-id') || el.getAttribute('id'),
    local:  (el) => store.idOf(originalSnapshotNode(el)) || el.getAttribute('data-id') || el.getAttribute('id'),
    remote: (el) => remoteIds.get(el) || el.getAttribute('data-id') || el.getAttribute('id'),
  },
  ignore: (el) => el.matches(PEER_SKIP_SELECTOR) || isExtensionNode(el),
  scripts: { mergeTags: mergeTagRecognizers },
  hooks: { beforeAttributeUpdated: (name, el) => isTabLocalRootAttr(name, el) ? false : undefined },
});
for (const [el, id] of report.identities) store.adopt(el, id);
```

`baseIds` is `importMap(baseDoc, this._lastIdentityMap)`; `remoteIds` is
`importMap(newDoc, identityMap)`. `protectPeerDoc`, `findChangedRoots`, and
`spliceProtected` are no longer called. The hold path remains only for
`base == null`. `lastHtml` stays the raw frame, and the convergence save
stays: it runs when `report.changes` contains any change with
`source: "local"` that the frame did not carry, which is exactly "the
merged state exists only here".

`_doApplyExternal`: the same call with `base: getLastSavedDirty()`, `local`
from `captureForMerge()`'s compare clone (its `pairMap` gives the save-domain
twin when a subtree must be imported), and `activateIncomingDoc` applied to
the parsed remote first.

`sync/section-notice.js` reads `report.changes` filtered to the region
instead of comparing `outerHTML` (it can then also say what changed).
`plugins/source.js` re-pairs only `report.replaced` and `report.moved`.
`sync/splice-merge.js` is deleted. `sync/merge-tags.js` is unchanged.

Seed `lastHtml` at boot from the settled baseline capture (the snapshot
domain serialization of the same clone `save.js` already takes), so a dirty
tab's first incoming frame has a base and never holds.

hypercms keeps calling `morphElement(panel, built, { formState: 'property' })`.

## 5.2 Test plan

Runner stays `@web/test-runner` for DOM tests; `merge3`, `align`, and
`text-merge` also run under Node with jsdom so the pure core is tested
without a browser. Every whole-document fixture includes a doctype.

Text merge (`text-merge`):

- T-T1 disjoint edits both apply (S1).
- T-T2 overlapping edits: remote policy, local policy, both policy; conflict reported.
- T-T3 two insertions at the same offset: local first, no conflict.
- T-T4 insertion adjacent to a deletion: both apply.
- T-T5 one side empties the string, other edits: policy applies, conflict reported.
- T-T6 `mapLocalOffset` before, inside, and after a remote hunk.
- T-T7 surrogate pairs are never split.
- T-T8 size fallback: 30,000-character strings merge at line granularity within 50 ms.

Alignment (`align`):

- T-A1 identity pairs across parents (S3 without content).
- T-A2 duplicate identity on one side disables that id on that side.
- T-A3 exact-equality pairing of repeated identical siblings keeps order.
- T-A4 signature plus similar text pairs a retyped heading.
- T-A5 tag-and-class alone never pairs dissimilar text (S7 rule).
- T-A6 move detection pairs an unpaired base element with an unpaired side element under another parent.
- T-A7 move detection is skipped above the size bound.
- T-A8 text runs split by typing align with a single parsed text node.
- T-A9 code-like elements never pair by text rules.

Merge (`merge3`), one test per scenario in Part 3 (S1 to S7, S10 structure)
plus:

- T-M1 both sides append the same element: one copy.
- T-M2 both sides reorder differently: remote order, structure conflict reported.
- T-M3 class token merge: local adds `a`, remote adds `b`, result has both.
- T-M4 style declaration merge.
- T-M5 remote deletes a container local moved content into: content survives at local's destination, conflict reported.
- T-M6 ignored region on local kept verbatim; on remote dropped.
- T-M7 JSON merge script three-way; executable script whole-value.
- T-M8 head: title change is a text change; stylesheet replaced in order; preload duplicates kept.
- T-M9 provenance covers every output node.
- T-M10 `base = null` equals a plain two-way morph on the whole existing `core`, `ops`, and `fidelity` suites (ported).

Apply (`apply`):

- T-P1 every live node with a local twin is the same object after apply (S2, S3 video node).
- T-P2 leftover removal never removes a node claimed elsewhere.
- T-P3 focus and selection preserved for input, textarea, contenteditable (ports of `restore-focus` and `preserve-focus`, plus S8 caret mapping).
- T-P4 focused input value protected and reported.
- T-P5 inert clones: a new inline script runs exactly once, after apply.
- T-P6 `moveBefore` fallback to `insertBefore` behaves identically for structure.
- T-P7 `xlink:href` and other namespaced attributes.
- T-P8 iframe document: active element read from the right document.
- T-P9 `MergeReport.changes` matches the DOM mutations observed by a MutationObserver.

Whole document:

- T-D1 doctype present, absent, changed.
- T-D2 `morphDocument(document, string)` on the test page: body and head identity kept.
- T-D3 unknown option throws before mutation.

Performance (`perf/`, run in CI):

- 3000-element page, clean tab, one remote text edit: merge plus apply at or under 40 ms, fail above 80 ms.
- Same page, dirty tab with one local edit elsewhere: at or under 60 ms.
- Alignment of two 3000-element documents with full synthetic identity: at or under 10 ms.

ClayJS (in the ClayJS repo, after 5.1):

- Port `live-sync-peer-protect.test.js` expectations; the "unmergeable keyless edit holds" test flips to "merges".
- Two-frame burst keeps the local edit with raw `lastHtml`.
- Convergence save fires only when the merge carried local-only changes.

## 5.3 Delivery phases

Each phase ends with a green suite and a commit.

Phase 0, baseline: CI workflow running `npm run test:ci` in Chromium; fix
the four focus tests; restore or remove `perf`.

Phase 1, pure core: `parse`, `identity`, `similarity`, `align`,
`text-merge`, `merge3` with the Node test suite. Deliverable: `merge3`
passes S1 to S7 and the merge tests above. No DOM mutation yet.

Phase 2, apply: `apply`, focus and caret, script execution, head.
`mergeDocument` and `morphDocument` wired. Port `core`, `ops`, `fidelity`,
`restore-focus`, `preserve-focus`, `head`, `scripts-handle` as the two-way
case. Delete the old core, keep `legacy-splice.js`.

Phase 3, performance: benchmark in CI; profile and fix until targets hold.

Phase 4, ClayJS cut-over: the changes in 5.1 on a ClayJS branch, tested
against its unit suite and a two-tab manual session; then delete
`legacy-splice.js` and release 1.0.

## 5.4 Size

| Module | Lines |
|---|---|
| index, parse, ignore, identity | ~350 |
| similarity, align | ~400 |
| text-merge | ~250 |
| merge, head-merge | ~600 |
| scripts | ~120 |
| apply | ~400 |
| total | ~2,100 (current core plus splice and matcher: ~4,900) |

The core grows relative to the earlier draft of this plan because the
merge is now the product. What is removed is duplication and guessing, not
capability.

## 5.5 What was not verified

- The relay server (htmlclay) was not read; the wire shape was inferred
  from the ClayJS client and its tests.
- `hyper-undo`'s interaction with applied frames was not read beyond the
  `Mutation.pause` bridge. Apply runs under the caller's pause exactly as
  the morph does today, so no change is expected.
- The prototype in `docs/evidence/` uses an O(n·m) diff and unbounded
  pairing searches. It is evidence for the merge rules, not a performance
  measurement.
