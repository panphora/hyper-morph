# Changelog

## [1.0.1] - 2026-09-27

### Changed
- Rebuilt dist to include the echo-gap fix
- Tests now fail when the behavior they name breaks, covering one-sided edits and images in the structure fuzz, text-node and provenance identity by reference, exact pins for weak checks, and remote-policy conflict resolution in the text fuzz

### Fixed
- An echoed phrase across a non-breaking space now lands once when each side also edited next to it



## [1.0.0] - 2026-09-25

A rewrite. The library now does one job: a three-way merge of HTML documents
(base, local, remote) applied to a live DOM. See `docs/rewrite-plan.md` for
the review, the scenarios, and the specification.

### Added

- `morph(oldNode, newContent, config)`: the 0.5.x surface as a deprecated
  compatibility export, mapped onto the new API (see `docs/api.md`). An
  `<html>` element handed as new content is the remote document; a keyed
  element never morphs into one with another key; in `formStateSync:
"property"` a control inserted from a built node keeps the properties set
  on it.

- `mergeDocument({ live, base, remote, local?, ... })`: three-way merge of
  whole documents. `morphDocument(live, remote)` is the two-way form;
  `morphElement(el, content, { children?, base? })` works on one element.
- Word-level text merging (`merge3Text`, `diff`) with caret mapping for
  the focused element.
- Inline merging inside a block: text, formatting elements and `<br>`,
  `<wbr>`, `<img>` merge as one sequence, so edits to different words land
  side by side, formatting one side applied survives the other side's
  typing, and a caret inside a re-wrapped word stays where it was. A
  conflict in that content reports the block as `node` and a `range` into
  its merged text.
- Alignment that pairs elements without ids: identical subtrees, unique
  signatures, signature plus similar text, position, cross-parent moves,
  then slots rewritten in place (unpaired elements between the same two
  paired neighbours, in equal number with the same tags on both sides).
  Never on tag and class alone, and never across two different authored
  identities.
- Paragraph splits and joins merge as edits: when one side splits a text
  block in two or joins two, and the other side edits the blocks involved,
  the blocks merge as one word sequence with a block break where each
  block ends, so every word lands once and live elements are reused. This
  holds in any script, for a split inside a word, around an inline
  `remoteWins` region, and for a join that fuses two words: an edit to
  either word still lands, and the caret keeps its character.
- A block both sides inserted (an echo) lands once even when one side then
  moved its neighbour or its container, when each side reads it as a
  rewrite of a different neighbour, and when one side also inserted a
  sibling beside it. Identical blocks two sides added under different
  parents stay two blocks unless something moved.
- A block moved to another container and edited there leaves its old slot
  to a block typed in it: both land, and the other side's edits reach the
  moved block.
- A report per call: `applied`, `decisions`, `conflicts`, `localDiverged`,
  `identities`, `moved`, `replaced`. `localDiverged` is true exactly when
  the merged document differs from the remote one, compared directly after
  the merge, ignored regions and ignored attributes aside.
- Options `remoteWins`, `ignoreAttribute`, `conflicts`, `local` (snapshot
  root plus `toLive`), `identity` per side (function or path-keyed map),
  `beforeApply`, `restoreFocus` (default on; `false` skips capturing and
  restoring focus, scroll and selection), `protectFocusedValue: "subtree"`
  (the focused element's children are left alone as well as its value).
- The `ignore` predicate is told when the element is a merge root; a call
  whose root is ignored touches nothing and returns an empty report.
- `createIdentityStore`, `importMap`, `tieredIdentity` for synthetic
  identities; `createParseCache`. An exported identity map carries the
  sender's element child counts under the reserved key `"~"` and their tag
  names under `"^"`. `importMap` imports nothing below an element whose
  child count differs, and gives an element whose tag differs no id.
- `head.preserve(el)`: a live head child the predicate approves is never
  removed, only updated in place.
- Type declarations in `types/index.d.ts` (and one file per subpath
  export), and a full contract in `docs/api.md`.
- Node test suite (jsdom) under `test/node`; `npm run perf` profiles a
  3000-element page in Chromium.

### Changed

- Entry point is `src/index.js`; exports are `.`, `./json-merge`,
  `./json-parse`, `./splice`, `./text-merge`.
- All entry points return a Promise; DOM work is still synchronous.
- Unknown options throw before any mutation.
- `formState: "attribute" | "property"` replaces `formStateSync`;
  `protectFocusedValue` (default on; `"subtree"` is what `ignoreActiveValue`
  meant) replaces `ignoreActiveValue`; `hooks` replaces `callbacks`;
  `ignore` (a predicate) replaces the `policy` presets.
- Scripts new to the page run once after apply, head scripts included.
- Live nodes are never parked: what nothing claims is removed after every
  move has happened, and nodes are moved with `moveBefore` where available.
- Checkbox and radio `value` is data, not form state.

### Removed

- The vendored Idiomorph core, the content-scoring matcher (`./matcher`),
  the pantry, `morphStyle`, `ignoreActive`, `policy`, the `head` merge
  styles, and `beforeNodePantried`. The `key` option is
  replaced by `identity`.
- `packed-contract.json`.
- The named exports `HyperMorph` and `defaults`, and the `./matcher`
  subpath. `src/hyper-morph.js` is no longer the entry file; import the
  package root. The default export is now `{ mergeDocument, morphDocument,
morphElement, merge3, morph }`.

### Compatibility notes for `morph()`

- It returns a Promise of a merge report; 0.5.4 returned the morphed nodes
  (`Node[]`) synchronously.
- A root the policy ignores is left alone under `morphStyle: "innerHTML"`
  too; 0.5.4 morphed its children. A form marked `no-save` or `editor-ui`
  must be morphed through an unmarked wrapper, or with `policy: "raw"`.
- An `outerHTML` morph whose content has several top-level nodes morphs the
  first element only; 0.5.4 also inserted the other nodes around it.
- With `restoreFocus: false`, a focused control moved to a different depth
  loses focus; 0.5.4 kept it.

### Known limitations

These shapes can still duplicate or lose text. Each needs several edits at
one point, or a move of blocks between containers combined with a split
or join; `docs/api.md`, "Known limitations", has an example of each.

- A word both sides typed, then a split right after it on one side plus
  more typing in the new block.
- An inline element moved from one block to another while the other side
  joins those blocks.
- A word both sides typed where the other side removed an inline element
  and replaced the word beside it.
- Blocks moved between containers on one side, with a split or join in the
  same stretch on the other, several at once.

## [0.5.4] - 2026-09-23

### Changed

- Sync-ignore markers now apply only within the morph root

## [0.5.3] - 2026-09-13

### Added

- Packed contract load manifest

### Changed

- Published package now includes the packed contract
- Updated hyper-morph

## [0.5.2] - 2026-09-11

### Changed

- Update hyper-morph

## [0.5.1] - 2026-08-21

### Changed

- Update hyper-morph

## [Unreleased]

### Changed

- License: relicensed to MIT-0 (MIT No Attribution). Same rights, attribution no longer required for our code; Idiomorph-derived portions are covered in the new THIRD-PARTY-NOTICES.md.

## [0.5.0] - 2026-08-16

### Added

- `findChangedRoots` and `spliceProtected` for scoped DOM sync
- Three-way JSON merge for mergeable script tags (0.4.0)
- `kind`, `status`, and `url` declared in the hyper key

### Changed

- `findChangedRoots` now promotes keyless dirty roots to the nearest keyed ancestor
- Pinned Playwright to 1.56.1

### Fixed

- Protected-splice blockers found in the final review
