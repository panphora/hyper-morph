# HyperMorph review and rewrite plan

Date: 2026-09-24. Reviewed at v0.5.4 (commit 574c32c).

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

## Target design

### One input shape

Take a live `Document` or `documentElement` and an HTML string or parsed
`Document`. Always parse to a full document. Handle the doctype explicitly as a
first step. Delete `morphStyle`, `SlicedParentNode`, template wrapping, array
and collection inputs, and the regex-based full-document detection.

### Pair first, then reconcile

Compute one global pairing map before touching the DOM, with a single priority
order:

1. caller `key(el)`
2. `id`
3. content score, restricted to the same parent pair
4. position

Content-based cross-parent moves are what force the pantry and the cycle guard,
so allow cross-parent moves only for keyed elements. With the pairing known, the
reconcile loop is a plain keyed-children pass using `moveBefore` with
`insertBefore` fallback, and the pantry disappears entirely.

### Linear matcher

Compute child indices in one top-down pass and store them in metadata so paths
never walk siblings. Filter id-bearing elements once when building the index,
not per lookup. Keep the scoring model, which is sound. Drop the non-session
`findMatch`, `invalidate`, and `explain` from the core export.

### Head as its own small merge

Key head children by normalized signature, walk the incoming head in order, and
morph a same-key element in place instead of remove-and-append. Optionally await
stylesheet and script loads. Drop the `append`, `morph`, and `none` styles and
the `im-preserve` / `im-re-append` attributes in favor of two predicates.

### Scripts with one rule

Identity is normalized `src`, or type plus content hash. New executes once
after the morph; existing never re-executes. Keep insertion inert as today.
Always return a Promise so callers stop branching on the return type.

### Focus and form state from the right document

Read `ownerDocument.activeElement`, restore selection, and treat the focused
control's value as protected by default. Add contenteditable selection
preservation, which matters for an editor and is currently a skipped test.

### One `ignore(el)` predicate

Replaces `policy`, the three ignore functions, and the hard-coded selector
list. Hyperclay passes its own predicate built from `region-capabilities.js`.

### Move out of core

- `findChangedRoots` and `spliceProtected` become a `hyper-morph/splice`
  subpath or move to ClayJS.
- JSON script merge stays as an optional subpath the core calls through a
  `mergeScript` hook.
- Delete `content-dom.js`.
- Replace `propagate.js` with a normal npm dependency in the downstream repos.

### API sketch

```js
import { morphDocument } from 'hyper-morph';

await morphDocument(document, incomingHtml, {
  key: (el) => el.getAttribute('data-id') || el.id || null,
  ignore: (el) => el.hasAttribute('morph-ignore'),
  hooks: {
    beforeNodeAdded, beforeNodeRemoved, beforeNodeMorphed, beforeAttributeUpdated,
  },
  head: { awaitLoads: false, preserve: (el) => false },
  scripts: { execute: true, merge: null },
});
```

## Size budget

| Module | Lines |
|---|---|
| parse and reconcile | ~700 |
| matcher | ~250 |
| head | ~120 |
| scripts | ~120 |
| focus and form state | ~120 |
| total | ~1,300 (today: ~4,900) |

## Migration

1. Triage the four failing focus tests so the rewrite has a green baseline.
2. Add doctype-bearing fixtures to every whole-document test so the primary
   path is covered.
3. Port the behavioral contract: `core`, `ops`, `fidelity`, `restore-focus`,
   `head`, `scripts-handle`, `hyper-match`, `comparison`.
4. Move `sync-ignore`, `protected-splice`, `json-merge`, `json-parse`, and
   `scripts-merge` tests alongside the code they cover as it leaves core.
5. Add a CI workflow running `npm run test:ci`, and either restore `perf/` or
   remove the script.
6. Cut the downstream repos over to the npm package and delete the vendored
   copies.
