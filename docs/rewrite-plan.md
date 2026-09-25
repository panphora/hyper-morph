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
3. Text merges at word granularity, with formatting merged per character, inside the core.

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

| Check                                                              | Result                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Full suite (Chromium, Playwright 1.56.1)                           | 606 pass, 4 fail, 15 skipped, 97.6% coverage                         |
| `morph(document, "<!DOCTYPE html>...")`                            | throws `HierarchyRequestError: Only one doctype on document allowed` |
| `morph(doc.documentElement, "<!DOCTYPE html>...")`                 | same throw                                                           |
| Attached element as new content with a nested `no-save` descendant | throws `TypeError: newContent.contains is not a function`            |
| `innerHTML` morph of one `documentElement` into another            | produces `<html><html>...</html></html>`                             |
| 3000-element page, one text edit                                   | 758 ms; upstream Idiomorph 277 ms on the same input                  |

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

| Baseline                        | Owner                | Domain                                     | Advances when                                                                                                     |
| ------------------------------- | -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `lastHtml` + `_lastIdentityMap` | `sync/live-sync.js`  | snapshot domain (what peers see)           | own relay POST succeeds; a peer frame applies (set to the raw frame, never the merged result); a clean disk apply |
| `lastSavedContents`             | `core/save.js`       | autosave-comparison domain                 | a save lands; a verified-clean sync apply                                                                         |
| `lastSavedDirty`                | `core/save.js`       | dirty domain (keeps `no-trigger-autosave`) | same as above                                                                                                     |
| source-map model                | `core/source-map.js` | the file's own bytes                       | boot fetch; accepted save; re-pair on `clay:sync-applied`                                                         |

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

| Domain     | What is stripped                                                                                                                                               | Used for                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| snapshot   | `no-snapshot` only                                                                                                                                             | live-sync wire (`serializeForSync` also drops tab-local root attrs) |
| save       | plus `no-save`, transforms, `freeze` restore                                                                                                                   | the file                                                            |
| comparison | `no-save`, `freeze`, `no-trigger-autosave`, `no-dirty`, `no-watch`; `onbeforesave` and every document transform run (inert forms, root library attrs stripped) | "should this autosave"                                              |
| dirty      | like comparison but keeps `no-trigger-autosave`                                                                                                                | "would the person lose work", and today's disk-lane merge base      |

Both save baselines are therefore inert-form, transform-run strings, while
the live DOM and the snapshot clone are activated. That mismatch is why the
disk lane in Part 5.1 needs a save-domain baseline of its own.

The region vocabulary is in `lib/region-policy.js` (`clay="no-save freeze"`
tokens plus legacy bare attributes). hyper-morph's `SYNC_IGNORE_SELECTOR`
is a hand-maintained copy of part of this list.

## 2.3 Identity without ids: the synthetic identity map

`live-sync.js` keeps `liveWeakMap: Element -> "<clientId>:<n>"`. Ids are
minted lazily at snapshot time and never written to the DOM or the file.
On every relay, `_buildIdentityMap` walks the snapshot clone and emits
`{ "0.1.3": "abc:17", ... }` keyed by dot-path over element children. The
frame as received carries `{ html, identityMap, sender, seq, etag, by }`
(`seq` and `by` are added by the server; the POST body's snapshot key is
`snapshot` on the spec wire and `html` on the legacy one).

The receiver walks the parsed frame by the same paths to build
`parsedWeakMap`, passes `key = el => liveWeakMap.get(el) || parsedWeakMap.get(el) || data-id || id`
to the morph, and in `afterNodeMorphed` copies the incoming id onto the
live element it morphed into. `_fillInIdsAfterMorph` covers elements the
morph inserted by cloning. So after one round trip, the same logical element
carries the same id in every tab, and identity survives moves and content
edits. This is what makes "no ids in the user's DOM" workable, and the
rewrite builds on it rather than on content scoring.

Fragilities to carry into the design:

- Path keys are computed on the sender's clone alone, resolving each element
  through provenance, so a handler-added sibling costs only its own id. On
  the receiver, `_fillInIdsAfterMorph` walks live and parsed in lockstep and
  aborts a subtree on child-count mismatch; its doc comment describing the
  sender as lockstep is stale.
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
   events, plus a probe of `[persist]` controls; cleared on save, at boot
   settle, and by `protectPeerDoc` when its diff finds nothing):
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
  `morph(el, built, { morphStyle: 'innerHTML', ignoreActiveValue: r, restoreFocus: true, formStateSync: 'property', policy: 'raw' })`
  with `r` defaulting to true. It builds new content in memory with
  property assignment, so property mode stays. `policy: 'raw'` maps to the
  default `ignore`, `ignoreActiveValue` to `protectFocusedValue`.
- `plugins/wire.js` waits on `clay:sync-applied` with `source: 'disk'` to
  learn that an agent's write landed, so that event's detail shape is a
  contract.
- `sync/section-notice.js` compares a region's `outerHTML` across
  `clay:sync-applied` to say "Ana changed this section". It has no access
  to what the merge actually changed and infers it.
- `plugins/source.js` re-pairs live nodes to file byte ranges on
  `clay:sync-applied` because "a morph replaces live nodes", and re-models
  from `detail.html` on a disk frame. Its `pair()` is a whole-tree
  alignment keyed by live node; there is no incremental mode, so it keeps
  the full re-pair.
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

|           | Result                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| plain     | `<p>The quick brown fox jumps over the sleepy dog.</p>` (local edit lost)      |
| splice    | held on BODY; nothing applied, remote edit never lands while local stays dirty |
| prototype | `<p>Note: The quick brown fox jumps over the sleepy dog.</p>`                  |

### S1b: two people edit the same word

Base `the lazy dog`, local `the LAZY dog`, remote `the sleepy dog`.

|           | Result                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| prototype | `the sleepy dog`, reported as a text conflict (remote wins the overlapping hunk; the report lets the UI offer "keep mine") |

### S2: local reorders a keyless list while remote edits one item

|           | Result                                                                     |
| --------- | -------------------------------------------------------------------------- |
| plain     | remote order wins, local reorder silently reverted, then saved as reverted |
| splice    | held on BODY                                                               |
| prototype | `Cherries, Apples, Bananas (organic)` (both survive)                       |

### S3: local drags a card to another column; remote edits its title

The card contains a `<video>`.

|           | Result                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| plain     | card recreated (video node lost, playback reset), move reverted                                                                                   |
| splice    | held on BODY                                                                                                                                      |
| prototype | card in the new column with the new title; the merge output records that the card corresponds to the local card, so apply moves the existing node |

### S4: both users append to the same list

|           | Result                                 |
| --------- | -------------------------------------- |
| plain     | local "Dates" deleted                  |
| splice    | held on BODY                           |
| prototype | `Apples, Bananas, Dates, Elderberries` |

### S5: attribute edits on different elements

Local sets `style` on `<h1>`; remote adds a class on the `<section>`.

|           | Result                                                         |
| --------- | -------------------------------------------------------------- |
| plain     | local `style` lost                                             |
| splice    | held on BODY (a keyless attribute edit promotes to the parent) |
| prototype | both attributes present                                        |

### S6: different attributes on the same element

|           | Result                              |
| --------- | ----------------------------------- |
| plain     | local `class` lost                  |
| splice    | held on BODY                        |
| prototype | `<div class="box open" data-x="2">` |

### S7: remote deletes the paragraph local is editing, and adds another

|           | Result                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| plain     | local edit destroyed with the paragraph                                                 |
| splice    | held on BODY                                                                            |
| prototype | `One, "Two, edited locally", Three, Four` (edits beat deletes; the new paragraph lands) |

S7 also produced the one bug in the prototype, which the specification now
carries as a rule: pairing two elements by tag and class alone, without a
text similarity check, let base "Two" align with remote "Four" and the
character merge produced "Fo, edited locallyur". Content pairing without a
key requires similar text (Part 4.6).

### S8: typing in a contenteditable while a remote edit lands elsewhere

|            | Result                                                                                |
| ---------- | ------------------------------------------------------------------------------------- |
| plain      | local typing reverted to the frame's text; caret moved to offset 0                    |
| new design | text merged; caret mapped through the merge hunks to its logical position (Part 4.10) |

### S9: whole-document sync of a page with a doctype

|            | Result                               |
| ---------- | ------------------------------------ |
| plain      | throws                               |
| new design | doctype synced explicitly (Part 4.4) |

### S10: performance, 3000-element page, one edit

|                    | Result                                         |
| ------------------ | ---------------------------------------------- |
| current, clean tab | 758 ms                                         |
| current, dirty tab | 758 ms plus a full capture and diff, or a hold |
| target             | 40 ms merge plus apply, measured in CI         |

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

Revision 2. This part was reviewed by two independent reviewers (an
implementer reading for buildability, a ClayJS maintainer reading for
integration) and revised against their 42 findings. Where a rule exists
because of a finding, the finding is named in brackets so a later reader
knows why it is there.

## 4.1 One operation

```
mergeDocument({ live, base, remote, ... }) -> Promise<MergeReport>
```

reads three trees and mutates `live` so that it holds the three-way merge
of base, local (the current state of `live`), and remote.

- Two-way morph is `base = null`: local is treated as unchanged, so remote
  wins everywhere except ignored regions. The library never holds a frame;
  whether a caller with unsaved local edits and no base should apply a
  two-way morph is the caller's decision (ClayJS keeps its hold for that
  case, Part 5.1). An empty base string is treated as null [C9].
- `morphElement(oldEl, newEl, options)` is the two-way case on one element
  pair; `options.children: true` morphs children only (the innerHTML case
  hypercms uses) [I15].

The operation is a pure phase and an apply phase:

```
merge3(baseDoc, localDoc, remoteDoc, opts) -> MergeResult
apply(live, mergeResult, toLive, opts)     -> AppliedReport
```

`merge3` runs on parsed documents and never touches the live DOM.
`apply` never guesses: every merged node carries provenance naming the
local node(s) it came from, and `toLive` maps those to live nodes.

Merge and apply run synchronously in one task. Anything awaited
(stylesheet loads, external scripts) is awaited after the DOM mutation, so
keystrokes cannot land between the local snapshot and the apply [I11].

## 4.2 Module layout

```
src/
  index.js          mergeDocument, morphDocument, morphElement; option validation
  parse.js          toDocument, syncDoctype, per-lane parse cache
  ignore.js         cached ancestor-aware predicate wrapper
  identity.js       identity store, path-map export/import, tiered idOf, per-side index
  similarity.js     structural hash, text hint, token similarity
  align.js          align(base, side): pairing map plus moved/inserted/deleted sets
  text-merge.js     Myers diff, hunk coalescing, diff3, local-offset mapper
  merge.js          merge3: attributes, text runs, children, moves, provenance, decisions
  head-merge.js     head signatures and head-specific rules
  scripts.js        script signatures, inert clones, execute-once, JSON merge hook
  apply.js          provenance-driven apply, focus and caret, head two-phase, report
  json-merge.js     unchanged
  json-parse.js     unchanged
  legacy-splice.js  findChangedRoots and spliceProtected, kept until ClayJS cuts over
```

No module references the global `document` or `window` except the
DOMParser fallback in `parse.js`. An ESLint `no-restricted-globals` rule
enforces it.

## 4.3 Public API

```ts
type Side = "base" | "local" | "remote" | "both";
type IdOf = (el: Element) => string | null | undefined;
// A path-keyed id map is applied after the library parses the side [I14, C10].
type IdentitySpec = IdOf | { map: Record<string, string>; then?: IdOf };

type MergeOptions = {
  live: Document;
  base: string | Document | null;
  remote: string | Document;

  // The local side. When omitted the live DOM is used. ClayJS passes its
  // snapshot clone plus the provenance function that maps clone nodes to
  // live nodes. toLive may return null for nodes a snapshot hook added;
  // such nodes are skipped at apply, never inserted [I11].
  local?: { root: Element; toLive: (n: Node) => Node | null };

  identity?: {
    base?: IdentitySpec;
    local?: IdentitySpec;
    remote?: IdentitySpec;
  };
  // Default for every side: data-id, then id.

  // Never touched on the live side, never imported from the remote side,
  // never indexed for identity. Ancestor-aware. Default () => false [I9].
  ignore?: (el: Element) => boolean;

  // Regions whose local edits do not count: the local side is read as base
  // inside them, so the remote version lands unchanged. Ancestor-aware.
  // Default () => false. ClayJS maps `no-dirty` here [C7].
  remoteWins?: (el: Element) => boolean;

  // Attributes excluded from the merge on every side and from every report.
  // Default () => false. ClayJS maps its tab-local root attributes here [C5].
  ignoreAttribute?: (el: Element, name: string) => boolean;

  conflicts?: "remote" | "local" | "both"; // default "remote"; "both" is text only, attributes use "remote" [I17]
  protectFocusedValue?: boolean; // default true
  head?: { awaitLoads?: boolean; preserve?: (el: Element) => boolean }; // awaitLoads default false
  scripts?: { execute?: boolean; mergeTags?: MergeTagRecognizer[] }; // execute default true
  formState?: "attribute" | "property"; // default "attribute"
  children?: boolean; // morphElement only

  hooks?: {
    beforeNodeAdded?: (n: Node) => boolean | void;
    afterNodeAdded?: (n: Node) => void;
    beforeNodeRemoved?: (n: Node) => boolean | void;
    afterNodeRemoved?: (n: Node) => void;
    beforeNodeMorphed?: (oldN: Node, newN: Node) => boolean | void;
    afterNodeMorphed?: (oldN: Node, newN: Node) => void;
    beforeAttributeUpdated?: (
      name: string,
      el: Element,
      kind: "update" | "remove",
    ) => boolean | void;
  };
};

// Two separate lists, because they answer different questions [I3, C4].
type MergeReport = {
  // What apply did to the live DOM. Matches what a MutationObserver sees.
  applied: Applied[];
  // Every merge decision that differs from base, with the side that caused
  // it. A local-only decision is already in the live DOM, so it appears
  // here and not in `applied`.
  decisions: Decision[];
  conflicts: Conflict[];
  // True when the merged document differs from the remote document outside
  // ignored regions and ignored attributes: the merged state exists only in
  // this DOM and must be relayed or saved to reach anyone else [C4].
  localDiverged: boolean;
  // Every live element paired with a remote element that carried an id,
  // whether it was morphed, moved, or inserted. The consumer overwrites its
  // own record with the remote id, which is how ids converge across tabs
  // after one round trip [C1].
  identities: Array<[Element, string]>;
  moved: Element[]; // live elements that changed parent
  replaced: Element[]; // live elements removed and recreated (no local twin)
};

type Applied =
  | { kind: "text"; node: Text; before: string; after: string }
  | {
      kind: "attr";
      el: Element;
      name: string;
      before: string | null;
      after: string | null;
    }
  | { kind: "insert"; node: Node; parent: Element }
  | { kind: "remove"; node: Node; parent: Element }
  | { kind: "move"; el: Element; from: Element; to: Element };

type Decision =
  | { kind: "text"; node: Text | null; source: Side; applied: boolean }
  | {
      kind: "attr";
      el: Element | null;
      name: string;
      source: Side;
      applied: boolean;
    }
  | { kind: "insert"; el: Element | null; source: Side; applied: boolean }
  | { kind: "remove"; source: Side; applied: boolean; base: Element }
  | { kind: "move"; el: Element | null; source: Side; applied: boolean };
// `node`/`el` are live nodes when the decision has a live counterpart.

type Conflict =
  | {
      kind: "text";
      node: Text;
      base: string;
      local: string;
      remote: string;
      resolved: string;
    }
  | {
      kind: "attr";
      el: Element;
      name: string;
      base: string | null;
      local: string | null;
      remote: string | null;
      resolved: string | null;
    }
  | { kind: "structure"; el: Element | null; detail: StructureDetail };
type StructureDetail =
  | "both-reordered" // both sides reordered the same children; order side won
  | "both-moved" // both sides moved the element to different parents; order side's destination won
  | "edit-beats-delete" // one side deleted, the other edited; the edit survived
  | "move-beats-delete" // one side deleted, the other moved; the move survived
  | "insert-collision"; // both sides inserted different text at the same anchor

declare function mergeDocument(o: MergeOptions): Promise<MergeReport>;
declare function morphDocument(
  live: Document,
  remote: string | Document,
  o?: Omit<MergeOptions, "live" | "base" | "remote">,
): Promise<MergeReport>;
declare function morphElement(
  oldEl: Element,
  newEl: Element,
  o?: Omit<MergeOptions, "live" | "base" | "remote">,
): Promise<MergeReport>;
declare function merge3(
  base: Document,
  local: Document,
  remote: Document,
  o?: Partial<MergeOptions>,
): MergeResult;
```

Rules: applying functions always return a Promise; unknown option keys
throw before any mutation; no global defaults object; a protected focused
value records a conflict only when the merged value differs from the live
value [I20].

## 4.4 Parse (`parse.js`)

Implemented. `toDocument(input, ownerDoc)` accepts a string or a Document
and throws otherwise. `createParseCache(ownerDoc)` is one-deep per lane.
`syncDoctype(live, remote)` inserts or replaces, never removes.

Document-level fast paths in `merge3` [I13]: when the base and local
serializations are byte-equal the local side is base (no L alignment); when
base and remote are byte-equal the result is local and only ignored-region
and identity bookkeeping runs.

## 4.5 Identity (`identity.js`)

Implemented. `createIdentityStore(clientId)` gives `idOf`, `ensure`,
`adopt` (which overwrites [C1]), and `exportMap(cloneRoot, toLive)`, a walk
of the clone alone that resolves each element through `toLive` and skips
nothing [C11]. `importMap(root, map)` applies a path map to a parsed tree.
`indexByIdentity(root, idOf, ignored)` builds the per-side index, dropping
ids that occur twice on a side and skipping ignored subtrees [I9].

`mergeDocument` resolves each side's `IdentitySpec` after parsing: a
function is used as is; `{ map, then }` becomes "the imported map id, else
`then(el)`, else data-id, else id". Text nodes and template contents have
no identity.

For `base = null`, local is base, `identity.base` is never called, and the
base-local alignment is the identity map of local onto itself [I19].

## 4.6 Alignment (`align.js`, `similarity.js`)

`align(baseRoot, sideRoot, { idOfBase, idOfSide, ignored })` returns
`{ map, moved, inserted, deleted }`, a one-to-one pairing of base nodes to
side nodes.

Precomputation (one bottom-up pass per tree, cached per node) [I13]:

- `hash`: structural hash of tag, sorted attributes (minus ignored
  attributes), and children's hashes; for text and comments, the value.
  Two nodes with equal hashes are identical subtrees.
- `hint`: the first 64 characters of the node's whitespace-collapsed text.
- `tokens`: the lowercased word tokens of `hint`.
- `index`: position among element siblings.

`similar(a, b)` [I7]: both token sets empty is similar; one empty is not;
otherwise the overlap coefficient (shared tokens over the smaller token set) is at least 0.5; Jaccard was tried and rejected a container that merely gained content. Never
used for the code-like elements listed below.

Pass 1, identity (global): pair equal usable ids with equal tag. A
cross-parent pair from this pass has its children aligned by pass 2 like
any other pair [I19].

Pass 2, structure (top-down over paired element pairs; `<template>` pairs
recurse into `.content` [I19]). Children lists exclude ignored elements on
both sides. Adjacent text nodes are coalesced into one run per side, and a
run pairs as one unit [I6, C15]. For the remaining children:

```
a. identical: nodes whose hash is unique on both sides pair; their subtrees
   are marked identical and never recursed into by align or merge
b. signature and hint both equal, unique on both sides
c. signature equal and similar(), nearest sibling index; candidates are the
   16 nearest by index within the signature bucket
d. positional: in order, same node type and tag, and similar() for elements;
   a text run pairs with the next unpaired text run
```

Pass 3, moves (global) [I12]: unpaired base elements and unpaired side
elements are bucketed by signature; within a bucket, pairs that are
`similar()` and unique pair and are recorded in `moved`; their subtrees go
through pass 2. The pass stops after 2,000 similarity evaluations; what is
left stays delete plus insert.

Rule from S7: no element pair is ever formed on tag and class alone.

Code-like elements (`script`, `style`, `textarea`, `template`, `iframe`,
`object`, `canvas`, `video`, `audio`, `svg`) skip rules b and c and the
move pass; they pair by identity, hash, or position.

## 4.7 Text merge (`text-merge.js`)

Implemented and tested. Text is tokenized into words, whitespace runs and
punctuation (`Intl.Segmenter`, so scripts without spaces still segment
into words; a regex fast path when the input is ASCII), and `diff` is
Myers over token keys, so a retyped word is one hunk and hunks start and
end on token boundaries. `merge3Text(base, local, remote, policy)` returns
`{ text, conflicts, mapLocalOffset, granularity }`.

Hunks that overlap conflict, as do a pure insertion touching the other
side's change; two replacements that only touch both land; identical hunks
on both sides land once; two pure insertions at the same point both land,
local first. A conflict resolves by policy over the union of the ranges.
`mapLocalOffset` maps a caret offset in the local text to the merged text
by first expressing it in base coordinates through the local hunks, then
walking the merged segments [I5]. A caret exactly at a segment start stays
before that segment, so a remote insertion at the caret lands after it.

Bounds: over 20,000 tokens or 4,000 edits, line granularity; beyond that,
whole-value with a conflict record.

## 4.8 Merge (`merge.js`)

`merge3` aligns base with local (`L`) and base with remote (`R`), then
builds a fresh output document. Every output node records provenance
`{ base, local, remote }`; for a text run each entry is an array of the
run's nodes on that side [I6]. A merge-wide `emitted` set records every
base node and every side node that has produced output, so nothing is
emitted twice [I2].

### Attributes

Names come from the union of the three sides minus `ignoreAttribute`
[C5]. For each name, with absent as null and a side lacking the element
inheriting base:

```
lv === rv -> lv ; lv === bv -> rv ; rv === bv -> lv ; else policy (remote for attributes), conflict recorded
```

`class` merges as a token set and `style` as a declaration map before the
string rule, with absent read as the empty set [I17]. `style` splits on
semicolons outside quotes and parentheses; a value that does not parse
falls back to the string rule.

### Text

Inside a block, the text nodes, formatting elements (`MARK_TAGS`: `a`,
`b`, `i`, `em`, `strong`, `span`, `code` and the other phrasing tags) and
atoms (`ATOM_TAGS`: `br`, `wbr`, `img`) between two block-level units form
an inline segment, and `mergeChildren` hands each base segment with its
side counterparts (found through the twin of the block unit that precedes
the segment) to `mergeInline` (`inline-merge.js`). A segment whose units
are identical on both sides, or whose formatting element pairs with a unit
outside the segment (a cross-block move), stays on the per-unit path.

`mergeInline` flattens each side to one character sequence: an atom is
U+FFFC, a formatting element is a mark over a range, and a mark's stack is
recorded per character. Text merges by the `text-merge.js` hunk rules over
the flattened strings; marks merge per character as sets with the rule
class tokens use, so formatting never conflicts with formatting, a text
edit strictly inside a range the other side formatted inherits the mark,
and one that crosses the range's edge conflicts. Atoms pair by position,
overridden by the alignment for a swap (an unequal twin at a kept position)
or a move (an inserted atom whose base place the side deleted); deleting or
replacing an atom the other side changed conflicts. The output nodes are
rebuilt from the merged sequence. Provenance claims each local text node
for the output node holding its first surviving character, and records per
local text node which offsets landed in which output node (`caret`), so
apply can follow a caret into a re-wrapped node. A text conflict here
carries the block as `node` and `range`, the resolved region in the merged
sequence. The segment's `localDiverged` is a comparison of the merged
sequence with remote's, so a local edit remote already carries does not
count.

A run outside a segment merges with `merge3Text` and the run's
`mapLocalOffset` is stored on the output node's provenance. A text run
with no base counterpart on both sides (both inserted text under the same
parent at the same anchor) merges with an empty base and records an
`insert-collision` conflict when both are non-empty [I18].

### Children

```
mergeChildren(bEl, lEl, rEl):
  bKids, lKids, rKids: element children minus ignored, with text runs coalesced;
                       inside a remoteWins region lKids := bKids [C7]
  O := remote if remote reordered its kept base children, else local if local did, else remote
       (both reordered -> "both-reordered" conflict) [I10]
  P := the other side

  step 1, insertion pairing [I4]: every lKid with no base twin is compared with
    every rKid with no base twin under this parent: equal usable identity, else
    equal hash. A pair is merged as mergeNode(base := the remote copy, local, remote),
    because a remote copy of a local insertion is an echo of what local sent
    earlier; local's later typing then reads as its edits. Text runs pair by
    anchor, as above.

  step 2, walk O's children in order:
    node with a base twin under bEl     -> emitBase(twin)
    node with a base twin elsewhere     -> a move in: emitMoved(twin) (rules below)
    node paired in step 1               -> emit the pair once
    node with no twin                   -> emit a clone (insertion)
    then flush P's pending insertions anchored on this node (rule below)

  step 3, base children not yet emitted:
    deleted by both                     -> gone
    deleted by one, unchanged on other  -> gone
    deleted by one, edited on other     -> emit after the nearest preceding base sibling with
                                           output here; "edit-beats-delete" conflict
    moved out by one, deleted by other  -> emitted at the mover's destination; "move-beats-delete"
    moved out by one, edited by other   -> emitted at the mover's destination with the edits merged
    moved out by both, different parents-> O's destination; "both-moved" conflict; the other
                                           side's edits merged in
```

Anchors are resolved at emit time [I1]: an insertion from side P is
pending on the nearest preceding node in P's own child list that produces
output under this parent (walking backwards past nodes that were deleted,
moved out, or ignored), or on "start" when none does. Pending insertions
are flushed right after their anchor's output, start-anchored ones before
anything else. When both sides have insertions at the same anchor, local's
come first [I21].

`emitMoved(twin)` checks the output path: if the twin's output would
contain the parent being built (the two sides moved elements into each
other), the move is downgraded to insert-at-destination plus
delete-at-origin for the side whose move is applied second, and a
"both-moved" conflict is recorded [I2].

"Edited" means the side's structural hash differs from base's.

### Special elements

- `<head>`: children keyed by head signature (4.9), then the rules above.
- `<script>` with a JSON type and a merge identity: `mergeScriptText`
  three-way. Any other `<script>`: whole-text three-way, never character
  merged.
- `<textarea>`: whole-value three-way on its text.
- `<template>`: children merge on `.content`.
- Form controls: `value`, `checked`, `selected` merge as attributes.
- Ignored elements: absent from every kid list, so never in the output;
  apply leaves the live ones where they are [I9].

### Decisions and `localDiverged`

Every attribute, text, insertion, removal, and move that differs from
base is recorded with its side. `localDiverged` is true when any decision
has source `local` or `both`, when a conflict resolved in local's favor,
or when a merged inline segment differs from remote's [C4].

## 4.9 Head (`head-merge.js`)

Head children get an identity of their own:

```
TITLE, BASE        -> the tag name
SCRIPT with src    -> "script|src|" + type + "|" + absolute URL without hash
SCRIPT inline      -> "script|inline|" + type + "|" + hash(text)
LINK with href     -> "link|" + rel + "|" + absolute URL without hash
META               -> "meta|" + first of charset/name/property/http-equiv/itemprop + its value
STYLE              -> "style|" + hash(text)
else               -> outerHTML
```

URLs resolve against the live document's `baseURI`; the query string is
kept. Duplicate signatures form a multiset.

## 4.10 Apply (`apply.js`)

Input: the live document, the merge result, `toLive`, options.

Pre-pass [I5, I8]: build `liveToMerged` by walking the merged tree and
resolving every provenance entry through `toLive`; a local node whose live
counterpart is null or no longer connected to `live` is treated as absent,
so its merged node is inserted as a clone [I11]. Capture focus: the active
element of `live`, its selection, and for a caret in a text node the run it
belongs to and the offset within the run (the sum of preceding run members'
lengths plus the offset in the node) [I6, C15]. Capture scroll offsets.

```
applyElement(liveEl, mergedEl):
  syncAttributes; syncFormState (attribute or property mode; property mode reads
    the original remote node from provenance, not the merged clone) [I15]
  textarea: value; script: text; template: content
  applyChildren(liveEl, mergedEl)

applyChildren(liveParent, mergedParent):
  cursor = first live child that is not ignored
  for mergedChild in mergedParent.childNodes:
    live = liveToMerged twin of mergedChild
    element with a live twin: if live !== cursor: moveBefore(liveParent, live, cursor); applyElement; claim
    text run with live twins: reuse the FIRST member; if its value differs from the run's
      local text (typing landed after the snapshot) re-merge with base := snapshot text,
      local := live text, remote := merged text [I11]; set nodeValue; claim the first
      member; the other members are leftovers
    no twin: insert an inert clone before cursor; claim
    cursor = next non-ignored live node after the claimed node
  leftovers of this parent are recorded, not removed

after the whole tree: remove every recorded leftover that is still unclaimed
  and not ignored [I8]
```

Ignored live elements are never moved; the cursor skips them so inserts
land around them.

Head [I16]: `applyHead` is two-phase: insert and update in incoming order,
awaiting loads if enabled, then remove leftovers, so a replaced stylesheet
is never absent. A head script whose signature was present before never
re-executes; a new head inline or `src` script is created fresh and runs on
insertion.

Focus and caret: after apply, if the caret's run still has a live node,
map the run-relative offset through the run's `mapLocalOffset` and place
the caret in the surviving member; if the element was recreated, refocus
by identity. The focused input or textarea keeps its live value when
`protectFocusedValue` is true.

Body scripts run after apply: a script whose signature was not present
before executes once by replacement; merged JSON scripts never execute.

`applied` is recorded as the mutations are made, and `decisions` get their
`applied` flag and live node references from the same pass.

## 4.11 Baselines

The library takes baselines as the caller holds them and never advances
them. Everything about holds, stamps, epochs, and convergence stays in the
caller; what the library adds is `localDiverged` and the two report lists
so the caller can decide with facts instead of inference.

---

# Part 5: Integration, tests, phases

## 5.1 ClayJS changes

The peer lane keeps its structure [C6]: the clean path is a two-way morph
with no capture, the dirty path is the three-way merge. The gate token is
taken before the capture and cleared when the merge reports no local
divergence, which is what `protectPeerDoc` did for the oracle.

```js
// _doApplyUpdate, replacing protectPeerDoc + morph
const hooks = {
  beforeAttributeUpdated: (name, el) =>
    isTabLocalRootAttr(name, el) ? false : undefined,
};
const common = {
  live: document,
  remote: html,
  identity: {
    remote: { map: identityMap },
    local: (el) => store.idOf(originalSnapshotNode(el) || el),
  },
  ignore: (el) =>
    el.matches(SYNC_IGNORE) || el.matches(EXTENSION_NODE_SELECTOR),
  remoteWins: (el) => el.matches(NO_DIRTY_SELECTOR),
  ignoreAttribute: (el, name) =>
    !el.parentElement && TAB_LOCAL_ROOT_ATTRS.has(name),
  scripts: { mergeTags: mergeTagRecognizers },
  hooks,
};
let report;
if (this.lane === "live" && pageMaybeDirty()) {
  if (!this.lastHtml) {
    /* hold exactly as today */ return;
  }
  const gateToken = gateCaptureToken();
  const clone = captureSnapshot({ flushUndo: false });
  report = await mergeDocument({
    ...common,
    base: this.lastHtml,
    identity: { ...common.identity, base: { map: this._lastIdentityMap } },
    local: { root: clone, toLive: originalSnapshotNode },
  });
  if (!report.localDiverged) {
    probeMarkClean();
    gateClearIfUnchanged(gateToken);
  }
} else {
  report = await mergeDocument({ ...common, base: null });
}
for (const [el, id] of report.identities) store.adopt(el, id); // overwrite, as afterNodeMorphed did
```

`SYNC_IGNORE` is the set the vendored morph ignores today (`no-snapshot`,
`no-save`, `freeze`, `editor-ui`, `save-ignore`), not `PEER_SKIP_SELECTOR`
[C7]. `lastHtml` stays the raw frame. The convergence save runs when
`report.localDiverged` is true [C4]; on a manual-save page it is replaced
by a relay of the merged snapshot without a save, which is a ClayJS policy
decision recorded here as an open item.

Disk lane [C2, C3]: all three sides are in the save domain. `save.js`
keeps a third baseline, `lastSavedSave`, the pre-renderer `forSave` bytes,
advanced wherever `lastSavedDirty` is. The local side is the save clone
from `captureForMerge` (it has provenance; the compare clone does not), the
remote is the disk document left inert, and `activateIncomingDoc` runs on
the merged output before apply, which the library exposes as a
`beforeApply(mergedDoc)` hook. `lastSavedSave` is initialised to null, and
`getLastSavedDirty() === ''` means no base [C9].

Boot seeding [C8]: `snapshot.js` gains `captureBootBaseline()` returning
`{ forComparison, forDirty, forSave, forSync, identityMap }` from one
clone; `live-sync.start()` seeds `lastHtml` and `_lastIdentityMap` from it
and again at settle. Until it lands, the null-base hold above covers the
window.

Consumers: `clay:sync-applied` keeps its detail shape (`seq`, `source`,
`etag`, `by`, `html` on disk frames) for `plugins/wire.js` and
`plugins/source.js` [C12, C13], and gains `report`. `section-notice.js`
reads `report.applied` entries inside the region instead of comparing
`outerHTML` [C14]. `source.js` keeps its full re-pair. `splice-merge.js`
is deleted; `merge-tags.js` is unchanged. hypercms calls
`morphElement(panel, built, { children: true, formState: 'property', protectFocusedValue: r })`
[C19].

ClayJS tests that change [C17]: the peer-protect "unmergeable keyless
edit holds" case becomes "merges"; the disk-lane holds in
`live-sync-external.test.js` and `splice-merge-disk.test.js` likewise;
"a held frame never adopts a stamp" is re-pinned on the null-base hold.

## 5.2 Test plan

Pure modules run under Node with jsdom (`npm run test:node`); DOM behavior
runs in Chromium (`npm run test:chrome`). Every whole-document fixture
includes a doctype.

Status after implementation. Ids in **bold** are present as labeled tests
(grep the id under `test/`); the others are covered by the inherited
behavioral suites named in the right-hand column, which run through the
compat shim (`test/README.md`), or are listed as gaps.

Pure modules (Node): `text-merge` **T-T1** to **T-T6**, **T-T8**, mapper
cases (T-T7, the line-granularity fallback, is exercised by T-T8 but not
labeled); `parse` **T-P1** to **T-P5**; `ignore` **T-I1**; `identity`
(store, maps, index, **T-A2**).

Alignment (Node): **T-A1** identity across parents; **T-A3** identical
siblings keep order; **T-A4** retyped heading pairs; **T-A5** tag and class
alone never pair; **T-A6** move detection; **T-A8** split text runs pair
with one parsed node; **T-A9** code-like elements; **T-A10** identical
subtrees are skipped. Gap: T-A7 (the 2000-evaluation move bound) has no
test; the bound is asserted by reading `MOVE_BUDGET` in `align.js`.

Merge (Node): **S1**, **S1b**, **S2** to **S7**, **S10**; **T-M1** both
insert the same element (one copy); **T-M2** both reorder (remote,
conflict); **T-M3** class tokens; **T-M4** style declarations; **T-M5**
remote deletes a container local moved content into; **T-M6** ignored
regions; **T-M7** JSON and executable scripts; **T-M8** head; **T-M9**
provenance covers every node; **T-M10** `base = null` equals two-way;
**T-M11** insertion after a deleted anchor survives [I1]; **T-M12** mutual
moves terminate with a conflict [I2]; **T-M13** echoed insertion pairs by
identity and keeps later local typing [I4]; **T-M14** `remoteWins` region
takes remote; **T-M15** `ignoreAttribute` names never appear in decisions;
**T-M16** `localDiverged` false for a clean tab and true for each local
decision kind.

Apply (Chromium). The apply ids below share the `T-P` prefix with the
parse ids above; they are distinguished by the file they live in.
T-P1 node identity kept: `core.js`, `hyper-match.js`, `key-matching.js`;
T-P2 leftovers claimed elsewhere survive until moved [I8]:
`retain-hidden-state.js` (moves between containers and levels); T-P3 focus
and selection: `preserve-focus.js`, `restore-focus.js`, plus **S8** caret
mapping through a run in `merge-document.js`; T-P4 protected focused
value: `core.js` (ignoreActiveValue cases) and `merge-document.js`; T-P5
new inline script runs once: `scripts-handle.js` and `merge-document.js`;
T-P6 `insertBefore` fallback: `restore-focus.js` ("moveBefore disabled"
blocks); T-P7 namespaced attributes: `core.js` (svg cases); **T-P10**
typing between snapshot and apply survives [I11]; T-P11 head order:
`head.js`; T-P12 property mode reads the original node:
`form-state-sync.js`. Gaps: T-P8 (a merge whose live document is an
iframe's document) has no test, only iframes as elements that survive a
merge in `hyper-match.js`; T-P9 (`applied` equals the MutationObserver
record) has no test, `applied` is asserted per case instead.

Whole document (Chromium, `merge-document.js`): **T-D1**, **T-D1b**
doctype cases; **T-D3** unknown option throws; **T-D5** always a Promise;
`head.preserve`; `remoteWins`; `ignoreAttribute`; `identities`;
`protectFocusedValue`; **S1** and **S3** through the public API. Gap: T-D2
(the test page itself as a fixture) was not written; `document-level.js`
covers whole-document morphs of synthetic pages.

Performance: `merge-document.js` runs the clean-tab case (3000 elements,
one remote edit) on every Chromium run and fails above 80 ms; the target
of 40 ms is met at ~10 ms. The dirty-tab case (target 60 ms, measured
~12 ms) and the identical-documents alignment case are measured by
`npm run perf`, not gated in CI.

## 5.3 Delivery phases

Phase 0 (done): CI workflow, jsdom, `text-merge`, `parse`, `ignore`,
`identity`.

Phase 1 (done): `similarity`, `align`, `merge`, `head-merge` with the Node
suite. Exit: S1 to S10 pass through `merge3`.

Phase 2 (done): `scripts`, `apply`, `index`. The two-way suites run through
`test/lib/compat.js`, a shim that maps the old `Idiomorph.morph` surface to
the new API. Old core deleted, `legacy-splice.js` kept. Exit: `test:node`
(56) and `test:chrome` (587) green.

Phase 3 (done): `perf/` profiler and a perf gate in `test/merge-document.js`;
see 5.6 for the numbers.

Phase 4: ClayJS cut-over per 5.1 on a ClayJS branch; then delete
`legacy-splice.js`; release 1.0.

## 5.4 Size

Estimated before implementation, then measured after (formatted lines,
comments included).

| Module                         | Estimate | Actual                                           |
| ------------------------------ | -------- | ------------------------------------------------ |
| index, parse, ignore, identity | ~400     | 703                                              |
| similarity, align              | ~450     | 602                                              |
| text-merge                     | ~300     | 435                                              |
| merge, head-merge              | ~750     | 1,125                                            |
| scripts                        | ~120     | 172                                              |
| apply                          | ~500     | 704                                              |
| total                          | ~2,500   | 3,741 (old core plus splice and matcher: ~4,900) |

## 5.5 What was not verified

- The relay server (htmlclay) was not read; the wire shape was inferred
  from the ClayJS client as received (`snapshotKey` differs per wire
  profile on the POST) [C18].
- `hyper-undo` beyond the `Mutation.pause` bridge.
- The prototype in `docs/evidence/` evidences the merge rules for S1 to
  S7 only; it has one conflict policy, no offset mapper, no class token
  merge, and unbounded searches [I22].

## 5.6 Implementation notes: where the code deviates from 4.x

Everything in Part 4 was implemented. These are the places where the
implementation refined the spec, each forced by a test or a profile.

**Alignment (4.6).**

- A pass 0 runs before hashing: children at the same index whose subtrees
  are equal by the native `isEqualNode` pair in lockstep. On an ordinary
  edit this pairs nearly everything, so hashing only touches the remainder.
- Identical pairs are not descended eagerly. `pairIdenticalChildren(b)`
  pairs one level on demand when the merge needs to descend (hooks present,
  or a children-only morph). A merge that skips the subtree never pays.
- An unambiguous rule runs before the hash passes: a lone unpaired element
  of a tag on one side pairs with the lone unpaired element of that tag on
  the other side when both sit at the same index. This is the only place
  tag alone decides, and only because there is nothing to disambiguate.
- Text runs pair by the element that precedes them, not by content, so
  whitespace runs do not churn after a reorder.
- Similarity is an overlap coefficient (shared tokens over the smaller
  set), not Jaccard, so a container that gained content still pairs with
  its earlier self.
- The identity index uses a selector (`[id],[data-id],script,head>*`) when
  the default identity is in use, and reads template content explicitly,
  since `querySelectorAll` never enters it.
- Structural singletons: under `<html>`, `<head>` pairs with `<head>` and
  `<body>` with `<body>` whatever their content.

**Merge (4.8).**

- An `unchanged` flag: when no per-node morph hook is set and a base
  element's subtree is identical on both sides, the output carries the
  element alone, flagged, with no children. Apply leaves the live subtree
  untouched except for form-control properties and identities. With
  `beforeNodeMorphed` or `afterNodeMorphed` set the fast path is off, since
  the hook contract fires per matched node.
- Insertion clones merge their paired descendants (`cloneUnit`): a new
  wrapper around existing content, or a tag change, keeps the live nodes
  inside it.
- Mutual moves (A into B's place and B into A's) are detected as a cycle
  and emitted once, with a `both-moved` conflict when the sides disagree.
- Echoed insertions (both sides inserted the same thing) take the local
  version, with provenance covering both.
- Checkbox and radio `value` is data, merged as an attribute, not form
  state.

**Apply (4.10).**

- A pre-pass resolves every merged node's live twin once, so apply never
  searches. Text runs reuse the first live member of the run; when typing
  landed after the snapshot was taken, the run is re-merged against the
  current live text so the keystrokes survive (T-P10).
- Insertions are deep inert clones followed by `graft`: live twins found
  inside the merged subtree replace their cloned stand-ins once the copy is
  connected, so `moveBefore` keeps their state.
- Leftovers with no twin elsewhere are removed immediately; only nodes
  another parent will claim wait for the final pass. Hooks therefore see
  settled state.
- In `formState: "property"` mode a built remote node's property overrides
  the merged attribute only when the node also carries the attribute; an
  absent attribute still clears the value.
- Selection is restored only when the browser lost it (`moveBefore` keeps
  it in Chromium).
- Scripts execute once after apply, chosen by signature against the set
  collected before the merge; head scripts are included.

**Performance (S10).** A 3000-element page in Chromium, `perf/profile.mjs`,
median of five after warm-up:

| Case                              | Old library | Now     |
| --------------------------------- | ----------- | ------- |
| clean tab, one remote edit        | ~142 ms     | 11.1 ms |
| dirty tab, one local + one remote | n/a         | 13.0 ms |

`test/merge-document.js` gates the clean case at 80 ms. Timers are
compiled in but inert unless `globalThis.__hyperMorphProfile` is an object.

**Not done here.** Phase 4 (the ClayJS cut-over in 5.1) is ClayJS work on a
ClayJS branch; `legacy-splice.js` stays exported as `hyper-morph/splice`
until then.
