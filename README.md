# HyperMorph

Three-way merge of HTML documents, applied to a live DOM.

HyperMorph does one job: given the document a page started from (**base**),
what this tab has now (**local**), and what arrived from a peer or from disk
(**remote**), it produces the merged document and updates the live DOM to
match it, keeping every live node that has a counterpart. Text merges at the
character level, elements keep their identity without ids, and every
decision it made is reported back.

It exists so HTML files can save themselves and be edited by several people
at once. It is the merge engine behind [ClayJS](https://github.com/panphora/clayjs).

## Installation

```bash
npm install hyper-morph
```

```javascript
import { mergeDocument, morphDocument, morphElement } from "hyper-morph";
```

A minified IIFE build is in `dist/hyper-morph.min.js` and exposes
`window.HyperMorph`.

## Three calls

```javascript
// Three-way: base is the last document both sides agreed on.
const report = await mergeDocument({
  live: document,
  base: lastSyncedHtml,
  remote: incomingHtml,
});

// Two-way: no base; the live DOM is treated as the base, so the remote
// document lands as-is except where the live DOM has protected state.
await morphDocument(document, incomingHtml);

// One element, or its children only.
await morphElement(el, "<div>…</div>");
await morphElement(el, "<li>a</li><li>b</li>", { children: true });
```

All three mutate the DOM synchronously and return a Promise that resolves
once inserted stylesheets and external scripts have loaded, with a
[report](#the-report) of what happened. Unknown options throw before any
mutation.

## What a merge does

1. **Parse.** Strings become documents. A doctype in the remote document is
   copied to the live one.
2. **Align.** Base is aligned with local and with remote, independently.
   Elements pair by identity (`data-id`, then `id`, or your own function),
   then by structure: identical subtrees pair in lockstep, then unique
   signatures, then signature plus similar text, then position. Unpaired
   elements on both sides are checked for moves across parents, and what
   is left pairs slot for slot when every unpaired element under a parent
   sits at the same index with the same tag on both sides. Nothing pairs
   on tag and class alone.
3. **Merge.** Every base node is emitted with whatever each side changed:
   attributes per name (class as a token set, style as a declaration map),
   text as a character-level three-way merge, children ordered by the side
   that reordered them, insertions anchored to the sibling they followed.
   An edit or move on one side beats a delete on the other.
4. **Apply.** The live DOM is walked against the merged tree. Live nodes are
   moved with `moveBefore` (state, focus and iframes survive), attributes and
   text are updated in place, and only nodes with no live twin are created.
   Focus and the caret are restored, mapped through the text merge.
5. **Scripts.** Scripts that are new to the page run once, after apply.

## Options

```javascript
await mergeDocument({
  live: document, // the Document to update
  base: html, // string | Document | null (null = two-way)
  remote: html, // string | Document

  // The local side. Defaults to the live DOM. ClayJS passes a snapshot
  // clone plus a function mapping clone nodes to live nodes.
  local: { root: cloneRoot, toLive: (n) => liveFor(n) },

  // Identity per side: a function, or a path-keyed id map to import after
  // parsing. Default: data-id, then id.
  identity: { base: idOf, local: idOf, remote: { map, then: idOf } },

  // Never touched, never imported, never indexed. Ancestor-aware.
  ignore: (el) => el.hasAttribute("editor-ui"),

  // Local edits inside these regions do not count; remote lands unchanged.
  remoteWins: (el) => el.hasAttribute("no-dirty"),

  // Attributes left out of the merge and of every report.
  ignoreAttribute: (el, name) => name === "savestatus",

  conflicts: "remote", // "remote" | "local" | "both" (text only)
  protectFocusedValue: true, // keep the focused input's value
  formState: "attribute", // or "property" for script-built content
  head: {
    awaitLoads: false, // resolve after inserted stylesheets load
    preserve: (el) => false, // a live head child this approves is never removed
  },
  scripts: {
    execute: true, // run scripts new to the page after apply
    merge: true, // three-way merge of <script type=application/json merge=…>
    mergeTags: [], // extra recognizers for mergeable script tags
  },
  hooks: {
    beforeNodeAdded: (n) => {},
    afterNodeAdded: (n) => {},
    beforeNodeRemoved: (n) => {},
    afterNodeRemoved: (n) => {},
    beforeNodeMorphed: (live, merged) => {},
    afterNodeMorphed: (live, merged) => {},
    beforeAttributeUpdated: (name, el, kind) => {},
  },
  beforeApply: (mergedDoc) => {}, // inspect or serialize before apply
});
```

Return `false` from a `before*` hook to veto that action. Note that
`beforeNodeMorphed` and `afterNodeMorphed` disable the unchanged-subtree fast
path, since the hook contract fires per matched node.

`morphDocument(live, remote, options)` and `morphElement(el, content,
options)` take the same options minus `live`, `base` and `remote`.
`morphElement` also takes `children: true` to merge the element's children
only, and `base` (string or element) for a three-way merge of one element.

## The report

```ts
type MergeReport = {
  applied: Applied[]; // what apply did to the live DOM
  decisions: Decision[]; // every merge decision that differs from base
  conflicts: Conflict[]; // both sides changed the same thing
  localDiverged: boolean; // merged output differs from remote: relay or save it
  identities: Array<[Element, string]>; // live elements paired with an identified remote element
  moved: Element[]; // live elements that changed parent
  replaced: Element[]; // nodes recreated because nothing live matched them
};
```

`applied` answers "what changed in this DOM" and matches what a
MutationObserver would see. `decisions` answers "what did the merge decide",
including local-only decisions that were already in the DOM. A consumer that
mints its own element identities overwrites its record with each entry of
`identities`, which is how ids converge across tabs after one round trip.

Conflicts carry the base, local, remote and resolved values for text and
attributes, and a `detail` for structure: `both-reordered`, `both-moved`,
`edit-beats-delete`, `move-beats-delete`, `insert-collision`.

## Text merging

Text nodes merge at the character level with a Myers diff against base on
each side. Disjoint edits both apply; overlapping edits resolve by the
`conflicts` policy and are reported. The focused element's caret is mapped
through the merge, so typing while a remote edit lands in the same paragraph
keeps the cursor where it was.

```javascript
import { merge3Text } from "hyper-morph";
merge3Text("the lazy dog", "Note: the lazy dog", "the sleepy dog").text;
// "Note: the sleepy dog"
```

Elements whose text is code rather than prose (`script`, `style`,
`textarea`, `template`, `iframe`, media) never pair by text and merge as a
whole value.

## Identity without ids

Nothing in your markup needs an id. Alignment pairs by content, and it
refuses to pair elements on tag and class alone: two `<li>`s pair only when
their text is similar, their subtrees are identical, or they sit at the same
index with nothing else to disambiguate. If you do have identities (an `id`,
a `data-id`, or a synthetic map from a collaboration layer), they win.

## Other exports

```javascript
import {
  merge3, // the pure merge: (base, local, remote, options) => merged document + provenance
  merge3Text,
  diff, // character diff
  createIdentityStore,
  importMap,
  tieredIdentity, // synthetic identity helpers
  mergeJson,
  mergeScriptText, // three-way JSON merge for data script tags
  parseJsonRelaxed,
  parseRulesRelaxed,
  createParseCache, // one-deep per-lane parse cache
  findChangedRoots,
  spliceProtected, // protected string splice (also at hyper-morph/splice)
} from "hyper-morph";
```

## Development

```bash
npm test            # Node (jsdom) unit tests + Chromium behavioral suite
npm run test:node
npm run test:chrome
npm run perf        # CPU profile of a 3000-element page, clean and dirty tab
npm run build       # dist/hyper-morph.min.js
```

## Documentation

- [docs/api.md](docs/api.md): the contract. Every option, every report
  field, the merge and apply rules, errors, and the performance budget.
- [types/index.d.ts](types/index.d.ts): type declarations, shipped with
  the package.
- [docs/rewrite-plan.md](docs/rewrite-plan.md): the design record. The
  review of 0.5.x, how ClayJS uses the library, the ten scenarios the
  merge was built against, the specification, the ClayJS integration
  plan, and where the implementation refined the spec.
- [test/README.md](test/README.md): the test suites, the compat shim the
  inherited suites run through, and the perf harness.
- [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT-0. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
