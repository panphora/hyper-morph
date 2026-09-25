# Changelog

## [1.0.0] - 2026-09-25

A rewrite. The library now does one job: a three-way merge of HTML documents
(base, local, remote) applied to a live DOM. See `docs/rewrite-plan.md` for
the review, the scenarios, and the specification.

### Added

- `mergeDocument({ live, base, remote, local?, ... })`: three-way merge of
  whole documents. `morphDocument(live, remote)` is the two-way form;
  `morphElement(el, content, { children?, base? })` works on one element.
- Character-level text merging (`merge3Text`, `diff`) with caret mapping for
  the focused element.
- Alignment that pairs elements without ids: identical subtrees, unique
  signatures, signature plus similar text, position, then cross-parent
  moves. Never on tag and class alone.
- A report per call: `applied`, `decisions`, `conflicts`, `localDiverged`,
  `identities`, `moved`, `replaced`.
- Options `remoteWins`, `ignoreAttribute`, `conflicts`, `local` (snapshot
  root plus `toLive`), `identity` per side (function or path-keyed map),
  `beforeApply`.
- `createIdentityStore`, `importMap`, `tieredIdentity` for synthetic
  identities; `createParseCache`.
- `head.preserve(el)`: a live head child the predicate approves is never
  removed, only updated in place.
- Type declarations in `types/index.d.ts`, and a full contract in
  `docs/api.md`.
- Node test suite (jsdom) under `test/node`; `npm run perf` profiles a
  3000-element page in Chromium.

### Changed

- Entry point is `src/index.js`; exports are `.`, `./json-merge`,
  `./json-parse`, `./splice`, `./text-merge`.
- All entry points return a Promise; DOM work is still synchronous.
- Unknown options throw before any mutation.
- `formState: "attribute" | "property"` replaces `formStateSync`;
  `protectFocusedValue` (default on) replaces `ignoreActiveValue`; `hooks`
  replaces `callbacks`; `ignore` (a predicate) replaces the `policy` presets.
- Scripts new to the page run once after apply, head scripts included.
- Live nodes are never parked: what nothing claims is removed after every
  move has happened, and nodes are moved with `moveBefore` where available.
- Checkbox and radio `value` is data, not form state.

### Removed

- The vendored Idiomorph core, the content-scoring matcher (`./matcher`),
  the pantry, `morphStyle`, `ignoreActive`, `restoreFocus`, `policy`, the
  `head` merge styles, and `beforeNodePantried`. The `key` option is
  replaced by `identity`.
- `scripts/propagate.js`, `packed-contract.json`, and the `hyper` package
  field.

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
