# HyperMorph API reference

This is the normative description of the public surface of `hyper-morph`
1.x. Where this document and the code disagree, the code is a bug. Where
this document and `docs/rewrite-plan.md` disagree, this document wins: the
plan is the design record, this is the contract.

Type declarations for everything here are in `types/index.d.ts`.

- [Entry points](#entry-points)
- [Options](#options)
- [The report](#the-report)
- [Merge semantics](#merge-semantics)
- [Apply semantics](#apply-semantics)
- [Scripts](#scripts)
- [Head](#head)
- [Focus and caret](#focus-and-caret)
- [Identity helpers](#identity-helpers)
- [Text merge](#text-merge)
- [JSON merge](#json-merge)
- [Parse cache](#parse-cache)
- [Legacy splice](#legacy-splice)
- [Errors](#errors)
- [Performance contract](#performance-contract)

## Entry points

All four are named exports of the package root. A default export carries the
same four for `import HyperMorph from "hyper-morph"`.

### `mergeDocument(options): Promise<MergeReport>`

Three-way merge of whole documents into `options.live`. Mutates the live
document synchronously. The Promise resolves once every stylesheet and
external script the merge inserted has loaded or errored; with
`head.awaitLoads` off (the default) it resolves on the next microtask.

`options.live` must be a `Document`, otherwise `TypeError`.

### `morphDocument(live, remote, options?): Promise<MergeReport>`

`mergeDocument({ ...options, live, base: null, remote })`. Two-way: the live
DOM is the base, so the remote document lands as-is except where the live
DOM has protected state (focused value, ignored regions, preserved head
children).

### `morphElement(oldEl, content, options?): Promise<MergeReport>`

Merge one element. `oldEl` must be an `Element`, otherwise `TypeError`.

`content` may be a string, an `Element`, a `Document`, a `DocumentFragment`,
a `NodeList` or array of nodes, or `null`.

- Without `children`: the first element of `content` becomes the new version
  of `oldEl`. If there is none, `oldEl` is removed (subject to
  `beforeNodeRemoved`) and the report lists it under `replaced`. If its tag
  differs from `oldEl`'s, the children are merged into `oldEl` first so
  their live nodes survive, then moved into a fresh element of the new tag
  which replaces `oldEl`; the report lists the fresh element under
  `replaced`.
- With `children: true`: the children of `oldEl` are merged against the
  content. An `Element` given as content is treated as one new child, not
  as the container.

Element inputs are used directly, never cloned, so properties a caller set
on a built node (`input.value`, `option.selected`) are visible to
`formState: "property"`. A connected element is copied so the page it lives
in is untouched.

`options.base` (string or element, same shapes as `content`) makes the
merge three-way for that element. It must describe the same element: for
a whole-element morph its first element must have `oldEl`'s tag (a base of
another tag is ignored when the incoming tag also differs, and unsupported
otherwise); for a children morph it holds the children `oldEl` started
with.

### `merge3(base, local, remote, options?): MergeResult`

The pure merge. Takes documents or element roots, never touches them, and
returns a fresh document plus provenance. `base` may be `null`, which
makes `local` the base. Takes every option in the table below except
`live`, `base`, `remote`, `local`, `hooks` (only `beforeNodeMorphed` and
`afterNodeMorphed` matter, and only to disable the unchanged fast path) and
`beforeApply`. `children: true` merges only the roots' children and leaves
the root attributes alone.

```ts
type MergeResult = {
  doc: Document; // the merged document
  root: Element; // merged counterpart of the base root
  provenance: WeakMap<Node, Provenance>;
  textMappers: WeakMap<Text, (localOffset: number) => number>;
  decisions: Decision[]; // with merged-tree nodes, not live nodes
  conflicts: Conflict[];
  localDiverged: boolean;
  mergedScripts: Set<Element>; // output scripts produced by a JSON merge
  remoteIdOf: (el: Element) => string | null;
  customIdentity: boolean; // remote identity is not the default
};
type Provenance = {
  base: Node | Run | null;
  local: Node | Node[] | null; // text runs list their local nodes
  remote: Node | Node[] | null;
  unchanged?: true; // subtree identical on every side; output has no children
};
```

## Options

Unknown keys throw `TypeError` before any DOM mutation. `options` must be
an object.

| Option                | Type                                                                       | Default                | Applies to                                       |
| --------------------- | -------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| `live`                | `Document`                                                                 | required               | `mergeDocument`                                  |
| `base`                | `string \| Document \| null`                                               | required               | `mergeDocument`; `morphElement` (also `Element`) |
| `remote`              | `string \| Document`                                                       | required               | `mergeDocument`                                  |
| `local`               | `{ root: Element; toLive: (n: Node) => Node \| null }`                     | live DOM               | `mergeDocument`                                  |
| `identity`            | `{ base?, local?, remote?: IdentitySpec }`                                 | `data-id`, then `id`   | all                                              |
| `ignore`              | `(el: Element) => boolean`                                                 | `() => false`          | all                                              |
| `remoteWins`          | `(el: Element) => boolean`                                                 | `() => false`          | all                                              |
| `ignoreAttribute`     | `(el: Element, name: string) => boolean`                                   | `() => false`          | all                                              |
| `conflicts`           | `"remote" \| "local" \| "both"`                                            | `"remote"`             | all                                              |
| `protectFocusedValue` | `boolean`                                                                  | `true`                 | applying calls                                   |
| `formState`           | `"attribute" \| "property"`                                                | `"attribute"`          | applying calls                                   |
| `head`                | `{ awaitLoads?: boolean; preserve?: (el: Element) => boolean }`            | `false`, `() => false` | applying calls                                   |
| `scripts`             | `{ execute?: boolean; merge?: boolean; mergeTags?: MergeTagRecognizer[] }` | `true`, `true`, `[]`   | all (`execute` applying only)                    |
| `children`            | `boolean`                                                                  | `false`                | `morphElement`, `merge3`                         |
| `hooks`               | see below                                                                  | no-ops                 | applying calls                                   |
| `beforeApply`         | `(mergedDoc: Document) => void`                                            | none                   | applying calls                                   |

### `base`

The document both sides started from. A string is parsed as a full document
(a fragment string becomes body content). `null`, `undefined` or `""` means
no base: the merge is two-way, with local as the base. When `base` is the
same object as `local`, the merge is two-way as well.

### `remote`

The incoming document. A string is parsed once per distinct string per
lane (see [Parse cache](#parse-cache)). A `Document` is used as given and
must not be the live document.

### `local`

The local side, when it is not the live DOM. ClayJS passes the snapshot
clone it captured plus `toLive`, the provenance function that maps clone
nodes to the live nodes they were cloned from. `toLive` may return `null`
for nodes a snapshot hook added; such merged nodes have no live twin and
are inserted as clones. A returned node that is no longer connected under
the live root is treated as absent.

Typing that landed after the snapshot was taken is preserved: when a text
run's first live node differs from its snapshot text, the run is re-merged
with the snapshot text as base, the live text as local and the merged text
as remote.

### `identity`

Per side, an `IdentitySpec`:

```ts
type IdOf = (el: Element) => string | null | undefined;
type IdentitySpec =
  | IdOf
  | { map: Record<string, string>; first?: IdOf; then?: IdOf };
```

A function returns the element's identity or nothing. A map object is a
path-keyed id map (`"" ` for the root, `"0.2.1"` for root → child 0 →
child 2 → child 1, counting element children only) applied after the side
is parsed; `then` (default: the default identity) answers for elements the
map does not name. `first`, when given, is asked before the map, so an
identity the page authored (a `data-id`) can outrank a synthetic one the map
assigns.

The default identity is `data-id`, then `id`. Identities are used only when
they are unique on their side: an id on two elements of one side identifies
nothing and is dropped from that side's index. Identity pairs require equal
tag names. Identity never pairs into or out of ignored subtrees.

Two identities are always in effect regardless of this option:

- head children identify by their [head signature](#head);
- JSON scripts a recognizer claims identify by `"merge:" + recognizer index + ":" + identity`.

### `ignore`

A region the merge leaves alone on every side: never touched in the live
DOM, never read from the remote, never indexed for identity. The predicate
is called at most once per element per call and is ancestor-aware: a
descendant of an ignored element is ignored. The walk stops at the merge
root, so a marker above the root does not exempt the root itself. Ignored
live elements are never moved; the cursor skips over them so insertions
land around them.

### `remoteWins`

Inside these regions local edits do not count: the local side is read as
base, so the remote version lands unchanged and no local decision is
recorded for it. Ancestor-aware like `ignore`. The unchanged fast path is
off inside such regions.

### `ignoreAttribute`

Attributes the merge does not compare, does not write, and does not report.
The predicate is called with the element of whichever side is being read
and the attribute name. Class and style are whole attributes for this
purpose.

### `conflicts`

Resolution when both sides changed the same thing.

- Text (word hunks that overlap, or a text insertion touching the other side's edit): `"remote"` keeps the remote hunk,
  `"local"` the local one, `"both"` concatenates local then remote.
- Attributes: `"remote"` or `"local"`; `"both"` behaves as `"remote"`. For
  `class` the conflict is per token and for `style` per declaration, so
  two sides changing different tokens or declarations never conflict.
- Structure: policy does not apply; the rules in
  [Merge semantics](#merge-semantics) decide and a conflict is recorded.

Every conflict is recorded in `report.conflicts` whatever the policy. With
`"local"` or `"both"`, a recorded conflict also sets `localDiverged`.

### `protectFocusedValue`

When true, the focused `<input>` keeps its live `value` (property and
attribute) and the focused `<textarea>` keeps both its text and its value,
whatever the merge decided. `checked`, `selected` and `disabled` are not
protected. A protected value is not reported as a conflict unless the
merged value differs from the live value.

### `formState`

How `value`, `checked`, `selected`, `disabled` and `indeterminate` are
synced.

- `"attribute"` (default, for parsed content): the merged attribute is the
  source of truth. `value` attribute present → attribute and property are
  set to it; absent → attribute removed and property cleared. Booleans:
  attribute presence sets both attribute and property. `indeterminate` is
  never touched. Exception: when the remote node was built in memory and
  its `value` property differs from its `value` attribute, the property
  is honored (a script-set value on a node that also carries the
  attribute).
- `"property"` (for script-built content): properties are copied from the
  original remote node, attributes are not written. `value`, `checked`,
  `selected`, `disabled`, `indeterminate`; a textarea's child text is left
  alone and its `value` property is set.

Checkbox and radio `value` is data, not form state: it merges as an
ordinary attribute in either mode.

### `head`

- `awaitLoads`: when true the returned Promise waits for every inserted
  stylesheet `<link>` in the head to load or error.
- `preserve(el)`: a live head child for which this returns `true` is never
  removed by the merge. It is still updated in place when the remote
  carries an element with the same head signature.

### `scripts`

- `execute`: run scripts new to the page after apply (see
  [Scripts](#scripts)). Off means inserted scripts never run.
- `merge`: three-way merge of JSON data scripts. Off means such scripts
  merge as whole values like any other script.
- `mergeTags`: extra recognizers, tried after the built-in one
  (`merge="<name>"` on a JSON script):

```ts
type MergeTagRecognizer = {
  match: (el: Element) => boolean; // does this recognizer claim the script
  identity: (el: Element) => string | null | undefined; // its merge identity
  parse?: (text: string) => any; // dialect; default parseJsonRelaxed; must throw on invalid input
};
```

A recognized script must have a JSON media type (`application/json` or
`*+json`) and no `src`; otherwise it is not merged and a warning is logged
once per merge.

### `children`

`morphElement` and `merge3`: merge the children of the root only; the
root's own attributes and identity are left alone.

### `hooks`

```ts
type Hooks = {
  beforeNodeAdded?: (node: Node) => boolean | void;
  afterNodeAdded?: (node: Node) => void;
  beforeNodeRemoved?: (node: Node) => boolean | void;
  afterNodeRemoved?: (node: Node) => void;
  beforeNodeMorphed?: (live: Node, merged: Node) => boolean | void;
  afterNodeMorphed?: (live: Node, merged: Node) => void;
  beforeAttributeUpdated?: (
    name: string,
    el: Element,
    kind: "update" | "remove",
  ) => boolean | void;
};
```

Returning `false` from a `before*` hook vetoes that action: the node is not
added, not removed, not updated (children included), or the attribute is
left as it is. `beforeAttributeUpdated` also gates form-state writes
(`value`, `checked`, `selected`, `disabled`, and a textarea's value) with
the attribute name.

`beforeNodeMorphed` and `afterNodeMorphed` fire once per live node that has
a merged counterpart, including nodes whose subtree did not change. Setting
either disables the unchanged-subtree fast path, so a merge with these hooks
visits every node. The other hooks do not affect the fast path.

Hooks see settled state: leftovers with no twin elsewhere are removed as
their parent is applied, and nodes another parent will claim are moved
before the final removal pass.

### `beforeApply`

Called with the merged document after the merge and before any live
mutation. Use it to serialize the merged result or to run activation code
over it. The document is discarded after apply; its nodes are never
inserted into the live DOM (live nodes are updated in place, and nodes
without a twin are inserted as clones).

## The report

```ts
type MergeReport = {
  applied: Applied[];
  decisions: Decision[];
  conflicts: Conflict[];
  localDiverged: boolean;
  identities: Array<[Element, string]>;
  moved: Element[];
  replaced: Element[];
};
```

### `applied`

Every mutation apply made to the live DOM, in the order it was made. It is
what a `MutationObserver` on the live root would record, expressed as
intent.

```ts
type Applied =
  | { kind: "text"; node: Text | Element; before: string; after: string } // Element for script text and textarea text
  | {
      kind: "attr";
      el: Element;
      name: string;
      before: string | null;
      after: string | null;
    }
  | { kind: "insert"; node: Node; parent: Node }
  | { kind: "remove"; node: Node; parent: Node | null }
  | { kind: "move"; el: Element; from: Node; to: Node };
```

Vetoed actions are not listed. Property-only writes (`formState:
"property"`, `indeterminate`, the `value` property when the attribute was
already right) are not listed.

### `decisions`

Every merge decision that differs from base, with the side that caused it.

```ts
type Side = "local" | "remote" | "both";
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
```

`node`/`el` is the live node when the decision has a live counterpart, else
`null`. `applied` is true when a live counterpart exists. A local-only
decision was already in the live DOM, so it appears here and not in
`applied`. `remove` carries the base element that was removed.

### `conflicts`

```ts
type Conflict =
  | {
      kind: "text";
      node: Text | Element | null;
      base: string;
      local: string;
      remote: string;
      resolved: string;
      range?: [number, number]; // inline content: the resolved region in the segment's merged text
    }
  | {
      kind: "attr";
      el: Element | null;
      name: string;
      base: string | null;
      local: string | null;
      remote: string | null;
      resolved: string | null;
    }
  | {
      kind: "structure";
      el: Element | null;
      detail: StructureDetail;
      base?: Element;
    };
type StructureDetail =
  | "both-reordered" // both sides reordered the same children; the order side won
  | "both-moved" // both sides moved the element to different parents; the order side's destination won
  | "edit-beats-delete" // one side deleted, the other edited; the edit survived
  | "move-beats-delete" // one side deleted, the other moved; the move survived
  | "insert-collision"; // both sides inserted different text at the same anchor; local first
```

For `class` an attribute conflict reports the whole attribute values with
the merged token set as `resolved`; likewise `style` with declarations.

A text conflict inside a block's inline content (see [Text](#text)) carries
the live block element as `node`, the three versions of the region as HTML
(formatting elements and `<br>` included), and `range`: the start and end
offsets of the resolved region in the segment's merged text, where a `<br>`,
`<wbr>` or `<img>` counts as one character. A conflict in a text run merged
whole (a code-like element, a comment) has no `range`, and its `node` is the
live text node or `null`.

### `localDiverged`

True when the merged document differs from the remote document outside
ignored regions and ignored attributes: any decision on an element or
attribute with `source` `local` or `both`, any recorded conflict under
`conflicts: "local"` or `"both"`, or a block whose merged inline content
(text, formatting and atoms) is not what remote holds. The merged state
then exists only in this DOM and must be relayed or saved to reach anyone
else. False for a clean tab, whatever the remote changed, and false for a
local edit that remote already carries.

### `identities`

Every live element paired with a remote element that carried an identity
under `identity.remote`, whether it was updated in place, moved, or
inserted, as `[liveElement, remoteId]`. Elements in unchanged subtrees are
included when `identity.remote` is not the default. The consumer overwrites
its own record with the remote id, which is how synthetic ids converge
across tabs after one round trip.

### `moved`

Live elements whose parent changed during apply. Reorders within one parent
are not moves.

### `replaced`

Nodes the merge created because nothing live matched them: inserted clones,
plus the fresh element of a tag change in `morphElement`.

## Merge semantics

The merge is defined on three parsed trees. It aligns base with local and
base with remote independently, then emits every base node with what each
side did to it. Two-way mode is the same algorithm with local as base, so
"local" below reads as "unchanged" there.

### Alignment

Per side, in order; a node pairs at most once.

1. **Identity.** Equal usable identities with equal tag, anywhere in the
   tree. Includes head signatures and merge-tag identities.
2. **Structure**, top-down from the root and from every identity pair.
   Under `<html>`, `<head>` pairs with `<head>` and `<body>` with `<body>`
   whatever their content. Per parent, over its alignment units (elements,
   and adjacent text nodes coalesced into one run):
   1. same index and equal subtree (`isEqualNode`);
   2. the only unpaired element of a tag on both sides at the same index;
   3. identical subtree hash, unique on both sides;
   4. equal signature (tag, class set, key attributes) and equal text hint
      (first 64 collapsed characters), unique on both sides;
   5. equal signature and similar text (overlap coefficient of word tokens
      at or above 0.5), nearest index first;
   6. same position, when the elements have similar text or both have an
      empty hint.
      Text runs pair by the element that precedes them.
3. **Moves.** Elements still unpaired on both sides pair across parents by
   identical hash, else by equal signature and similar text, under a
   budget of 2000 similarity evaluations per side.

Code-like elements (`script`, `style`, `textarea`, `template`, `iframe`,
`object`, `canvas`, `video`, `audio`, `svg`) never pair by text: identity,
identical hash, or position only.

No element pair is ever made on tag and class alone. Two `<li class="row">`
with different text and nothing else to go on are a delete and an insert.

### Elements

An element paired on both sides is emitted once, with:

- **attributes** merged per name. A name changed on one side takes that
  side; changed on both to the same value is not a conflict; changed on
  both to different values resolves by policy and is reported. `class` is
  a token set: each token added or removed by a side is applied, and a
  token both sides touched differently conflicts. `style` is a declaration
  map merged per property the same way. Removal on one side beats an
  unchanged other side; removal on one side and a change on the other
  conflicts.
- **children** merged as below.

An element present in base and one side only is a deletion by the other
side. A deletion loses to an edit or a move: if the surviving side changed
anything inside the element, or moved it, the element survives with the
edit and an `edit-beats-delete` or `move-beats-delete` conflict is
recorded. Otherwise it is removed.

An element present on one side only is an insertion. It is emitted with
its subtree, anchored after the nearest preceding sibling that produced
output on that side, or at the front of the parent. Descendants of an
insertion that pair with base nodes (a new wrapper around existing
content) are emitted through the merge, not copied.

An insertion made on both sides under the same identity, or the same
content at the same anchor, is an echo: it is emitted once with local's
version and provenance covering both sides.

### Children and order

The **order side** decides sibling order: remote, unless only local
reordered the children, in which case local. Both sides reordering the same
children records `both-reordered`.

Moves across parents: an element moved by one side goes to that side's
destination. Moved by both sides to different parents goes to the order
side's destination with `both-moved`. Mutual moves (A into B's place and B
into A's) are detected as a cycle and emitted once. A base child that the
other side moved out is not re-emitted at its base position.

### Text

Inside a block, the text nodes, the formatting elements (`a`, `b`, `i`,
`em`, `strong`, `span`, `code`, `mark` and the other phrasing tags) and
every other non-block element (`<br>`, `<img>`, `<button>`, `<input>`, a
custom element) between two block-level children form one inline segment.
A segment merges as one character sequence: a non-formatting element is
one character (an atom), a formatting element is a range over the
sequence, and the output is rebuilt from the merged sequence, so a `<b>`
remote wrapped around a word local was typing in lands around the merged
word. An ignored element inside a segment keeps its offset in the text and
is never touched. Segments pair across sides through the nearest preceding
paired unit, so a block deleted, inserted or edited before a segment does
not break the pairing.

Text merges at word granularity: a word-level Myers diff of each side
against base, hunks applied where they do not overlap. Two edits to the
same word, or an insertion touching the other side's edit, conflict and
resolve by policy; two replacements that only touch both land; identical
edits land once; two insertions at the same point both land, local first.
Formatting merges per character as a set, with the rule class tokens use,
and never conflicts with formatting. A text edit strictly inside a range
the other side formatted takes that formatting; one that crosses the
range's edge conflicts. Atoms pair by position, or by the alignment when a
side swapped or moved one; deleting or replacing an atom the other side
changed conflicts. A segment over 20,000 word tokens on any side merges by
line.

A text run outside a segment (its block had no inline content in base, or
a formatting element in it moved across blocks) merges with `merge3Text`
under the same word rules. A run with no base counterpart on both sides
(text both sides inserted at the same anchor) merges with an empty base,
lands local first and records `insert-collision`.

Whole-value merge (side that differs from base wins; both differing
resolves by policy and records a conflict) applies to executable script
text, `textarea` text, and comments. Every other text run, `<style>` text
included, merges by the word rules; code-like elements only refuse to
_pair_ by text.

### Special elements

- `<template>`: content is merged like children.
- JSON scripts a recognizer claims: text merged with `mergeScriptText`
  (see [JSON merge](#json-merge)); in two-way mode local keys survive.
- `<textarea>`, `<input>`, `<option>`: attributes merge normally; the
  apply step decides what the live control gets (see `formState`).

## Apply semantics

Apply walks the merged tree against the live tree, using provenance to find
each merged node's live twin. It never searches.

- **Element with a live twin**: moved before the cursor when it is not
  already there (`moveBefore` where the browser has it, so iframes, focus
  and animations survive; `insertBefore` otherwise), then attributes,
  form state, text and children are applied in place.
- **Text run with live twins**: the first live member is reused and its
  value set; the other members are leftovers.
- **No twin**: a deep clone is inserted before the cursor. Scripts inside
  are inert. Live twins found inside the merged subtree then replace their
  cloned stand-ins, so an element moved into a new wrapper keeps its node.
- **Leftovers**: live children nothing claimed are removed as their parent
  is applied, unless another parent will claim them (they are moved out
  when that parent is applied), they are ignored, or they are preserved
  head children.
- **Unchanged subtrees** (no `beforeNodeMorphed`/`afterNodeMorphed` hook,
  subtree identical on every side): left untouched, except that form
  control properties are still synced and identities still reported.

`morphElement` without `children` applies the root itself: attributes and
form state of `oldEl`, then its children.

## Scripts

Scripts the merge inserts are inert clones and do not run on insertion.
After apply, when `scripts.execute` is true, every non-ignored HTML script
under the root (head included) whose **signature** was not present before
the merge executes once, by replacement with a fresh element that has the
same attributes and text. The Promise waits for external scripts to load or
error. Merged JSON scripts never execute.

A signature is `"script|src|" + type + "|" + absolute URL without hash` or
`"script|inline|" + type + "|" + hash(text)`. A script whose text changed
therefore has a new signature and runs again; a script that merely moved
does not.

Scripts inside `ignore`d regions are neither collected nor executed.

## Head

Head children carry a natural identity used during alignment:

```
TITLE, BASE        -> the tag name
SCRIPT with src    -> "script|src|" + type + "|" + absolute URL without hash
SCRIPT inline      -> "script|inline|" + type + "|" + hash(text)
LINK with href     -> "link|" + rel + "|" + absolute URL without hash
META               -> "meta|" + first of charset/name/property/http-equiv/itemprop + "=" + its value
STYLE              -> "style|" + hash(text)
else               -> outerHTML
```

URLs resolve against the live document's `baseURI`; the query string is
kept. So a changed `<title>` is a text edit on the same element and a
changed stylesheet `href` is a removal plus an insertion. The head is
merged and applied like any other element; a doctype in the remote
document is copied to the live document when the live one has none or
differs, and never removed.

## Focus and caret

Before apply the active element, its selection (input/textarea) or range
(contenteditable), and its scroll offsets are captured. After apply:

- the element is refocused if it lost focus and is still connected;
- a caret in a text run is placed in the surviving member at the offset
  mapped through that run's `mapLocalOffset`, so remote edits earlier in
  the same text shift the caret rather than displace it;
- a caret in a block's inline content follows its characters: the merge
  records, per local text node, which of its offsets landed in which
  output text node, and the caret goes to the live node that now holds the
  text on either side of it, at the mapped offset. A word remote wrapped in
  a `<b>` keeps the caret inside the word, and typing that happened after
  the snapshot is re-merged into the re-wrapped node rather than lost; a
  caret in a word remote deleted lands where the word was;
- input/textarea selection is restored only when the browser lost it;
- scroll offsets are restored.

## Identity helpers

```ts
createIdentityStore(clientId: string): IdentityStore;
type IdentityStore = {
  idOf: (el: Element) => string | null; // the id this store holds for el
  ensure: (el: Element) => string; // idOf, minting "<clientId>:<n>" when absent
  adopt: (el: Element, id: string) => void; // overwrite el's id
  exportMap: (cloneRoot: Element, toLive: (n: Node) => Node | null) => Record<string, string>;
};
importMap(root: Element, map: Record<string, string> | null | undefined): WeakMap<Element, string>;
tieredIdentity(tiers: IdOf[]): IdOf; // first non-empty string wins
```

`exportMap` walks the clone's element children, minting ids for the live
twins `toLive` returns, and produces the path-keyed map the `identity.*.map`
option consumes. Paths count element children only, so both ends must walk
the same shape; a snapshot that added or removed elements must be exported
from the same clone that is sent.

## Text merge

```ts
merge3Text(base: string, local: string, remote: string, policy?: "remote" | "local" | "both"): {
  text: string;
  conflicts: Array<{ bs: number; be: number; local: string; remote: string; resolved: string }>; // base offsets
  mapLocalOffset: (localOffset: number) => number; // caret offset in local -> merged
  granularity: "word" | "line" | "whole";
};
diff(base: string, side: string, maxEdits?: number): Array<{ bs: number; be: number; text: string }>;
```

`diff` never splits a surrogate pair, and hunks always start and end on
word, whitespace or punctuation boundaries, so a retyped word is one hunk.
`mapLocalOffset` maps an offset inside a local hunk that lost a conflict to
just after the remote text that replaced it. The inline merge that
`mergeDocument` runs on a block's content uses the same diff and the same
hunk rules over the flattened sequence; it is not exported.

## JSON merge

```ts
mergeJson(base: any | undefined, local: any, remote: any, options?): any;
mergeScriptText(baseText: string | null | undefined, localText: string, remoteText: string, options?): { text: string; warnings: string[] };
parseJsonRelaxed(text: string): any; // JSON plus unquoted keys, single quotes, trailing commas, comments
parseRulesRelaxed(text: string): any; // the hypercms rules-tag dialect
```

Objects merge per key; different keys both survive; same-key conflicts
resolve remote-wins. Arrays merge by identity (a keyed field for object
elements, the value for primitives) and resolve remote-wins wholesale when
no identity is usable. `mergeScriptText` keeps whichever sides parse:
invalid local or remote text yields the remote text, an invalid or absent
base yields a two-way merge, and the output is serialized so that a receiver
converges byte-identically with a sender whenever the merge equals one side.

## Parse cache

```ts
createParseCache(ownerDoc: Document): (lane: string, input: string | Document) => Document;
```

One-deep per lane: the same string on the same lane returns the same
`Document` object until a different string arrives. `mergeDocument` keeps
one cache per process with lanes `"remote"` and `"base"`, so a live-sync
loop that reuses one base string across a burst of frames parses it once.
Because the returned document is shared, callers must not mutate it.

## Legacy splice

`findChangedRoots(localRoot, baseRoot, options)` and
`spliceProtected(targetDoc, entries, options)` are the 0.5.x protected
splice, exported unchanged at the package root and at
`hyper-morph/splice` until ClayJS moves to `mergeDocument`. Their contract
is documented in `src/legacy-splice.js`. They will be removed in 2.0.

## Errors

| Condition                                      | Error                                   |
| ---------------------------------------------- | --------------------------------------- |
| `options` not an object                        | `TypeError("options object required")`  |
| unknown option key                             | `TypeError('unknown option "x"')`       |
| `conflicts` not remote/local/both              | `TypeError`                             |
| `formState` not attribute/property             | `TypeError`                             |
| `mergeDocument` without a `Document` as `live` | `TypeError("live must be a Document")`  |
| `morphElement` without an `Element`            | `TypeError("oldEl must be an Element")` |
| `remote`/`base` neither string nor `Document`  | `TypeError` from the parser             |

All of these throw synchronously before any mutation. Hooks and predicates
that throw propagate; the DOM may then be partially applied.

## Performance contract

Measured in Chromium on a 3000-element page (`perf/page.html`), median of
ten after five warm-ups:

| Case                                       | Budget | Measured |
| ------------------------------------------ | ------ | -------- |
| clean tab, one remote edit                 | 40 ms  | ~10 ms   |
| dirty tab, one local edit, one remote edit | 60 ms  | ~12 ms   |

`test/merge-document.js` fails the clean case above 80 ms. The parse of the
remote string is included; the parse of the base string is cached.

Cost bounds: text merge, per text run or inline segment, falls back to
line granularity beyond 20,000 tokens or 4,000 edits; the cross-parent move pass is bounded at 2,000 similarity
evaluations per side; the ignore predicate runs at most once per element
per call. Setting `globalThis.__hyperMorphProfile = {}` before a call
accumulates per-phase timings (`meta`, `align`, `alignTotal`, `build`,
`apply`) into that object.

## Compatibility: `morph()`

Deprecated. `morph(oldNode, newContent, config)` keeps 0.5.x callers working and maps the old options onto the new API:

| 0.5.x option                           | 1.0 equivalent                                                              |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `policy: "sync" \| "history" \| "raw"` | `ignore` (the old sync and history ignore selectors; `raw` ignores nothing) |
| `callbacks`                            | `hooks`                                                                     |
| `ignoreActiveValue: true`              | `protectFocusedValue: true`                                                 |
| `formStateSync`                        | `formState`                                                                 |
| `scripts.handle`                       | `scripts.execute`                                                           |
| `scripts.merge`, `scripts.mergeTags`   | same names under `scripts`                                                  |
| `scripts.mergeBase`                    | `base`                                                                      |
| `head.block`                           | `head.awaitLoads`                                                           |
| `head.shouldPreserve`                  | `head.preserve`                                                             |
| `key`                                  | `identity` on all three sides                                               |
| `morphStyle: "innerHTML"`              | `children: true`                                                            |

A `Document` or `<html>` target goes through `mergeDocument`; any other element goes through `morphElement`. New code should call those directly.
