# Contributing

Issues and pull requests are welcome.

## What this library is

One operation: a three-way merge of HTML documents applied to a live DOM.
The contract is `docs/api.md`; the design record, scenarios and ClayJS
integration notes are `docs/rewrite-plan.md`. A change that alters
behavior described in `docs/api.md` updates that document in the same pull
request, and adds a `CHANGELOG.md` entry.

## Layout

```
src/index.js          entry points, option validation, the report
src/parse.js          strings to documents, doctype sync, parse cache
src/ignore.js         ancestor-aware, memoized ignore predicate
src/identity.js       identity store, path maps, identity index
src/similarity.js     per-node hash / hint / signature, alignment units
src/align.js          base-to-side pairing (identity, structure, moves)
src/text-merge.js     Myers diff and character-level three-way text merge
src/merge.js          the merge: builds the output document with provenance
src/head-merge.js     head child signatures
src/scripts.js        script signatures, merge-tag recognizers, execute-once
src/apply.js          make the live tree match the merged tree
src/legacy-splice.js  0.5.x protected splice, kept until ClayJS moves off it
src/hyper-morph-json-*.js  JSON merge and the relaxed parsers
types/index.d.ts      type declarations
```

Every module opens with a header comment stating its job and the rules it
implements. Keep that current.

## Running things

```
npm install
npm test              # Node suite, then Chromium suite
npm run test:node     # fast, pure modules under jsdom
npm run test:chrome   # web-test-runner + Playwright Chromium
npm run test:ci       # what CI runs: format check + both suites
npm run perf          # CPU profile of the 3000-element page
npm run format        # prettier
npm run build         # dist/hyper-morph.min.js
```

`test/README.md` describes the suites, the compat shim the inherited suites
run through, and the perf harness. Playwright needs its Chromium once:
`npx playwright install --with-deps chromium`.

## Adding a merge rule

1. Write the scenario as a Node test in `test/node/merge.test.js` (or
   `align.test.js` if it is about pairing), named with the next `T-M` /
   `T-A` id, and add that id to the test plan in `docs/rewrite-plan.md` 5.2.
2. Implement it in `src/merge.js` or `src/align.js`. The merge never
   touches a live document; anything DOM-facing belongs in `src/apply.js`.
3. If the rule changes what callers see, update `docs/api.md`.
4. Run `npm run perf` before and after when the change touches alignment
   or the apply pre-pass; the budgets are in `docs/api.md`.

## Style

Prettier defaults, ES modules, no dependencies at runtime, no globals other
than `DOMParser` (used only when a document has no window). Pull requests
keep `npm run test:ci` green.

## License of contributions

This project is MIT-0. By submitting a contribution you agree it is licensed
under MIT-0, the same terms as the project, with no other conditions.
