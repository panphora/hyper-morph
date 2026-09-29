# Tests

Two suites, one shim, one perf harness.

## Node suite: `npm run test:node`

`test/node/*.test.js`, run with `node --test` under jsdom. These test the
pure modules without a browser and are the fastest place to pin a merge
rule.

| File                                 | Covers                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text-merge.test.js`                 | `diff`, `merge3Text`, caret mapping (T-T1 to T-T8)                                                                                                                 |
| `parse-ignore-identity.test.js`      | `toDocument`, doctype sync, parse cache, `makeIgnore`, identity store and index (T-P1 to T-P5, T-I1, T-A2)                                                         |
| `align.test.js`                      | the aligner's passes and its refusals (T-A1 to T-A10)                                                                                                              |
| `merge.test.js`                      | `merge3` on the scenarios S1 to S10 and the rules T-M1 to T-M16                                                                                                    |
| `hash-verify.test.js`                | the hash is never proof of equality: the aligner and `merge.js` sites and `equalUnits` (I1-A to I1-N, I2-T1 to T6)                                                 |
| `split-text-fuzz.test.js`            | split live text keeps its live nodes and caret (two lanes, fuzz seeds 1 to 300, id mode 1)                                                                         |
| `fixtures/structure-fuzz-mode2.json` | the mode 2 golden (`structure-fuzz-mode2.test.js`): sha1 of the merged body and the conflict signature per seed, seeds 1 to 300, rewritten with `UPDATE_GOLDENS=1` |

Helpers in `test/node/lib/`: `dom.js` (one jsdom window, `parse`, `doc`)
and `merge.js` (`mergeBodies(base, local, remote, opts)` returning the
merged body HTML and the raw result).

Test ids (`S3`, `T-M11`) refer to the scenarios in `docs/rewrite-plan.md`
Part 3 and the test plan in section 5.2. Keep them in test names so the
plan stays greppable.

## Differential harness: `npm run test:diff`

`test/fuzz/differential.test.js` runs a frozen reference engine and the
current tree on the same inputs and compares every observable field, so an
engine milestone can list what each change did: the merged bytes, where every
live node of the pre-merge page ended up, the identities adopted, the
conflicts, the decisions, `localDiverged`, and the moved and replaced nodes
(named, not counted). It covers id modes 0 to 6, seeds 1 to 1000, in four
shapes (pure merge, a dirty live page, a clean capture merged through `toLive`,
and a children-only `morphElement`), then hand-written fixtures, template
content included. The observer it compares through is `test/lib/differential-observe.js`.

It runs only when `HM_REFERENCE_ENTRY` is set to the absolute path of a frozen
engine's `src/index.js`; with that unset it reports one skipped test, and a
path that does not exist fails the test. `HM_REFERENCE_REV` names the
reference revision (for example `dea289b`) and is required with the entry: it
is the key the accepted differences live under in
`test/fuzz/differential-accepted.json`. A difference not in that file, or one
whose differing fields or whose two engines' values in them (a digest) do not
match its entry, fails the test, and the test prints the unaccepted differences
so a person can classify them. An accepted entry no difference matches any more
fails too, so a difference that stops occurring is reported. A new reference
revision starts a new file; nothing carries over.

```
HM_REFERENCE_ENTRY=/private/tmp/hm-reference-m2/src/index.js \
HM_REFERENCE_REV=dea289b npm run test:diff
```

## Browser suite: `npm run test:chrome`

`test/*.js`, run by web-test-runner in headless Chromium with mocha and
chai. `test/merge-document.js` tests the public API directly: whole
documents, three-way merges with a snapshot and provenance, the report,
caret mapping, `head.preserve`, and the perf budget.

The other files are the behavioral suites inherited from the Idiomorph
lineage (form state, focus, head, hooks, scripts, sync-ignore, htmx
integration, and the HyperMatch pairing cases). They still call
`Idiomorph.morph(old, content, config)`. `test/lib/compat.js`, loaded by
`web-test-runner.config.mjs`, maps that surface onto the new API:

| Old config                     | New option                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| `morphStyle: "innerHTML"`      | `children: true`                                                       |
| `callbacks`                    | `hooks`                                                                |
| `ignoreActiveValue`            | `protectFocusedValue` (default false in the shim, true in the library) |
| `formStateSync`                | `formState`                                                            |
| `scripts.handle`               | `scripts.execute`                                                      |
| `scripts.merge`, `mergeTags`   | same                                                                   |
| `scripts.mergeBase`            | `base` (wrapped in the old element's tag when needed)                  |
| `head.block`, `shouldPreserve` | `head.awaitLoads`, `head.preserve`                                     |
| `policy: "sync" \| "history"`  | `ignore` over the Hyperclay marker sets                                |
| `policy: "raw"`                | no `ignore`                                                            |
| `key`                          | `identity` on every side                                               |

The shim exists so the behavioral suites keep running; new tests should
call the new API directly.

`test/hyper-match.js` and `test/hyper-match-edge-cases.js` keep their
names from the old matcher; what they now pin is the aligner's pairing
behavior through the public API.

Other scripts: `test:firefox`, `test:webkit`, `test:all` run the browser
suite in the other engines; `test:debug` opens a browser for manual runs;
`test:coverage` enforces the coverage floor in `test/lib/ensure-full-coverage.js`;
`test:ci` is what the workflow runs: format check, Node, Chromium with
`it.only` forbidden.

## Perf: `npm run perf`

`perf/page.html` builds a 3000-element page and exposes `window.bench.clean()`
(one remote edit into a clean tab) and `window.bench.dirty()` (one local
edit plus one remote edit, three-way). `perf/profile.mjs [clean|dirty]`
serves the repo, runs five warm-ups, samples ten runs under the CDP CPU
profiler and prints the median plus the functions with the most self time.
The library's own phase timers report into `globalThis.__hyperMorphProfile`
when that object exists.

## Evidence: `docs/evidence/`

`scenarios-current-library.js` ran the Part 3 scenarios against the 0.5.x
library and `three-way-merge-prototype.js` against the prototype that
preceded `src/merge.js`. They are records, not tests. The prototype file is
self-contained and runs on any commit; the 0.5.x file needs the old core,
so check out commit `d0b3fad` first. Either runs with
`npx web-test-runner --playwright --browsers chromium --files docs/evidence/<file>`.
