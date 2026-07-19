# HyperMorph

Content-based DOM morphing. An enhanced [Idiomorph](https://github.com/bigskysoftware/idiomorph) that preserves element identity without explicit IDs.

## The Problem

Positional matching fails on reorders and prepends:

```html
<!-- Before -->                    <!-- After -->
<ul>                               <ul>
  <li>Apple</li>   ← position 0      <li>NEW</li>     ← position 0
  <li>Banana</li>  ← position 1      <li>Apple</li>   ← position 1
</ul>                                <li>Banana</li>  ← position 2
                                   </ul>
```

Positional morph: "Apple" DOM node gets text changed to "NEW". Focus lost, animations break, state resets.

**HyperMorph**: Recognizes "Apple" moved to position 1, preserves the DOM node.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         MATCHING ALGORITHM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   OLD TREE                          NEW TREE                     │
│                                                                  │
│   ┌──────────┐                      ┌──────────┐                │
│   │ sig: a3f │◄──── SIGNATURE ─────►│ sig: a3f │                │
│   │ path: #m │      LOOKUP          │ path: #m │                │
│   └──────────┘                      └──────────┘                │
│        │                                  │                      │
│        └──────────► SCORE PAIR ◄──────────┘                      │
│                    ┌──────────┐                                  │
│                    │ sig=+100 │                                  │
│                    │path=+30  │                                  │
│                    │text=+20  │                                  │
│                    │conf=150  │                                  │
│                    └────┬─────┘                                  │
│                         │                                        │
│                         ▼                                        │
│                 confidence ≥ 101?                                │
│                    YES → MATCH (move DOM node)                   │
│                    NO  → RECREATE                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Signature** = hash of tag + classes + key attributes
**Path** = structural address relative to landmarks (IDs, roles, semantic tags)
**Threshold** = 101 (signature alone isn't enough; requires additional signal)

## Installation

```bash
npm install hyper-morph
```

## Usage

```javascript
import HyperMorph from 'hyper-morph';

// Basic morph
HyperMorph.morph(oldElement, newContent);

// With options
HyperMorph.morph(oldElement, newContent, {
  morphStyle: 'innerHTML',
  callbacks: {
    beforeNodeMorphed: (oldNode, newNode) => console.log('morphing', oldNode)
  }
});
```

---

## Configuration Reference

### Top-Level Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `morphStyle` | `'outerHTML' \| 'innerHTML'` | `'outerHTML'` | Replace element itself or just its children |
| `ignoreActive` | `boolean` | `false` | Skip morphing the focused element entirely |
| `ignoreActiveValue` | `boolean` | `false` | Preserve value of focused input/textarea |
| `restoreFocus` | `boolean` | `true` | Restore focus and selection after morph |

```javascript
HyperMorph.morph(el, html, {
  morphStyle: 'innerHTML',
  ignoreActive: false,
  ignoreActiveValue: true,
  restoreFocus: true
});
```

---

### Callbacks

Hook into the morph lifecycle. Return `false` from "before" callbacks to prevent the action.

| Callback | Signature | Description |
|----------|-----------|-------------|
| `beforeNodeAdded` | `(node) => boolean` | Before inserting new node. Return `false` to skip. |
| `afterNodeAdded` | `(node) => void` | After node inserted |
| `beforeNodeMorphed` | `(oldNode, newNode) => boolean` | Before morphing. Return `false` to skip. |
| `afterNodeMorphed` | `(oldNode, newNode) => void` | After node morphed |
| `beforeNodeRemoved` | `(node) => boolean` | Before removing. Return `false` to keep. |
| `afterNodeRemoved` | `(node) => void` | After node removed |
| `beforeAttributeUpdated` | `(attr, el, type) => boolean` | Before attribute change. `type` is `'update'` or `'remove'`. |

```javascript
HyperMorph.morph(el, html, {
  callbacks: {
    beforeNodeAdded: (node) => {
      if (node.classList?.contains('skip')) return false;
    },
    afterNodeMorphed: (oldNode, newNode) => {
      console.log('Morphed:', oldNode);
    },
    beforeAttributeUpdated: (attr, el, type) => {
      if (attr === 'data-persist') return false; // prevent update
    }
  }
});
```

---

### Head Configuration

Control how `<head>` elements are handled during full-document morphs.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `style` | `'merge' \| 'append' \| 'morph' \| 'none'` | `'merge'` | Merge strategy for head elements |
| `block` | `boolean` | `false` | Wait for new stylesheets/scripts to load before morphing body |
| `ignore` | `boolean` | `false` | Skip head morphing entirely |
| `shouldPreserve` | `(el) => boolean` | Check `im-preserve` | Keep element even if not in new content |
| `shouldReAppend` | `(el) => boolean` | Check `im-re-append` | Remove and re-add (re-executes scripts) |
| `shouldRemove` | `(el) => boolean` | `() => {}` | Return `false` to prevent removal |
| `afterHeadMorphed` | `(head, {added, kept, removed}) => void` | noop | Called after head processing |

**Head styles:**
- `'merge'` — Add new elements, remove old ones not in new content
- `'append'` — Only add new elements, never remove existing
- `'morph'` — Treat head like body (standard element morphing)
- `'none'` — Skip head entirely

```javascript
HyperMorph.morph(document, newHtml, {
  head: {
    style: 'merge',
    block: true, // wait for CSS to load
    shouldPreserve: (el) => el.id === 'critical-styles',
    afterHeadMorphed: (head, { added, kept, removed }) => {
      console.log(`Added ${added.length}, kept ${kept.length}, removed ${removed.length}`);
    }
  }
});
```

---

### Scripts Configuration

Control how `<script>` elements in body are handled. **Enabled by default**: new scripts execute exactly once after the morph settles, so synced components from another author stay functional. Insertion itself is inert — script execution happens in exactly one place, gated by this config.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `handle` | `boolean` | `true` | Execute new scripts exactly once. Set `false` to keep new scripts inert (markup preserved, never executed) |
| `matchMode` | `'outerHTML' \| 'smart'` | `'outerHTML'` | How scripts are matched: exact `outerHTML`, or normalized src URL / inline content hash |
| `merge` | `boolean` | `true` | Set `false` to disable script-tag JSON merging for this morph (deliberate rewinds/restores must overwrite, not merge) |
| `mergeBase` | `string \| Element \| Document \| null` | `null` | Last-synced HTML: the base version for three-way merging of mergeable script tags (see below) |
| `mergeTags` | `MergeTagRecognizer[]` | `[]` | Extra recognizers for mergeable JSON script tags, checked after the built-in `merge` attribute recognizer |
| `shouldPreserve` | `(el) => boolean` | Check `im-preserve` | Keep script even if not in new content |
| `shouldReAppend` | `(el) => boolean` | Check `im-re-append` | Force re-execution of existing script |
| `shouldRemove` | `(el) => boolean` | `() => {}` | Return `false` to prevent removal |
| `afterScriptsHandled` | `(container, {added, kept, removed}) => void` | noop | Called after script processing |

**Script behavior when `handle: true` (default):**
- **Same script exists** (matching signature) → Preserved, not re-executed
- **New script** → Executed exactly once, after the morph completes
- **External script** (`src`) → Waits for load (or error) before the returned promise resolves
- **Head scripts** → Handled by head merging, not this path
- **Sync-ignored regions** (`save-ignore` etc.) → Left alone entirely

```javascript
HyperMorph.morph(el, html, {
  scripts: {
    handle: true,
    shouldReAppend: (el) => el.dataset.reload === 'true',
    afterScriptsHandled: (container, { added }) => {
      console.log('Executed scripts:', added.length);
    }
  }
});
```

**Returns a Promise** when scripts need to load:
```javascript
await HyperMorph.morph(el, html, { scripts: { handle: true } });
```

---

### Mergeable Script Tags (three-way JSON merge)

A morph normally replaces a matched inline script's text wholesale: last write wins, and in `smart` matchMode a content-changed data script even reads as a brand-new script (element churn plus re-execution for executable types). For JSON state stored in script tags, opt into merging instead:

```html
<script type="application/json" merge="store">
  { "todos": [{ "id": "a1", "title": "Ship it", "done": false }], "theme": "dark" }
</script>
```

- `merge="<name>"` is both the opt-in and the identity: the same name pairs the tag across the base, current, and incoming HTML. Non-empty value required; duplicate names in one document disable merging for those tags (console warning, replace behavior).
- Only JSON script types merge (`application/json` or any `*+json`). A `merge` attribute on an executable type warns and is ignored: merging never interacts with script execution.
- Pass the last-synced HTML as `scripts.mergeBase` to get a true three-way merge: base→local and base→remote diffs both apply, deletions propagate, and genuine same-key conflicts resolve remote-wins. Without a base the merge degrades to two-way (local-only keys survive, deletions don't propagate).
- Arrays merge by identity, not position: object elements by an inferred key field (`id`, `_id`, `uuid`, `key`, `slug`, `code`, `name`, or name your own with `merge-key="taskId slug"` on the tag), primitive elements by value. Arrays without usable identity resolve remote-wins wholesale: a wrong match is worse than a predictable replacement.
- Tag bodies parse as relaxed JSON by default: strict JSON plus unquoted identifier keys, single-quoted strings, trailing commas, and comments. Values must still be JSON literals or quoted strings — barewords never coerce to strings, so typos and truncated streams fail parse instead of merging garbage.
- Malformed JSON degrades safely, keeping only valid JSON: invalid incoming keeps local, invalid local takes incoming, invalid base falls back to two-way. Each degraded case logs one console warning.
- Merged tags keep their element identity (no clone swap) and never re-execute. Ordering takes remote's sequence and anchors local-only insertions after their nearest surviving neighbor.
- `scripts.mergeTags` extends recognition to other tag families (custom attribute, custom identity, custom JSON dialect parser):

```javascript
HyperMorph.morph(document.documentElement, incomingHtml, {
  scripts: {
    mergeBase: lastSyncedHtml,
    mergeTags: [{
      match: (el) => el.hasAttribute('data-rules-name'),
      identity: (el) => 'rules:' + el.getAttribute('data-rules-name'),
      parse: HyperMorph.parseRulesRelaxed, // optional custom dialect, must throw on invalid input; default is relaxed JSON
    }],
  },
});
```

The merge engine is exported standalone as `HyperMorph.mergeJson(base, local, remote, options)` and `HyperMorph.mergeScriptText(baseText, localText, remoteText, options)` (also via `hyper-morph/json-merge`). The two parsers are exported too (also via `hyper-morph/json-parse`): `HyperMorph.parseJsonRelaxed` (the merge default described above) and `HyperMorph.parseRulesRelaxed` (the Hyperclay rules-tag dialect, where unquoted selector barewords like `#hero .quote` become strings — pass it as a recognizer's `parse`).

---

### HTML Attributes

Control element behavior via HTML attributes:

| Attribute | Effect |
|-----------|--------|
| `im-preserve="true"` | Keep element even if removed from new content |
| `im-re-append="true"` | Force re-insertion (re-executes scripts) |
| `merge="<name>"` | Three-way merge this JSON script tag's content instead of replacing it (see Mergeable Script Tags) |
| `merge-key="<field> …"` | Ordered identity-field candidates for keyed-array merging inside this tag's JSON |

```html
<!-- This script will re-execute on every morph -->
<script im-re-append="true">
  console.log('Re-executed!');
</script>

<!-- This stylesheet persists even if not in new HTML -->
<link rel="stylesheet" href="critical.css" im-preserve="true">
```

---

## Matching Priority

1. **ID match** — Elements with matching `id` in subtree (Idiomorph's original logic)
2. **HyperMorph** — Content-based matching for anonymous elements
3. **Soft match** — Same tag/nodeType as fallback

Elements with `id` attributes are excluded from HyperMorph and handled by ID-based logic.

---

## Scoring Model

| Factor | Score | Description |
|--------|-------|-------------|
| Signature match | +100 | Required. Same tag + classes + key attributes |
| Path segment | +10 each | Matching ancestors (max 4 segments) |
| Text match | +20 | Element's text content matches |
| Text mismatch | -25 | Text differs or one has text, other doesn't |
| Unique candidate | +50 | Only one element with this signature (when text matches) |
| Position drift | -1 per | Index difference between old and new position, capped at 19 so drift alone never vetoes a text-confirmed match |

**Acceptance threshold:** ≥ 101
Signature match alone (100) isn't sufficient. Requires at least one additional signal.

---

## Standalone Matcher

Use the matching algorithm independently:

```javascript
import { createMatcher } from 'hyper-morph/matcher';

const matcher = createMatcher();
const { computeMatches, findMatch, explain } = matcher.session();

// Find all matches between two trees
const matches = computeMatches(oldRoot, newRoot);
// Returns Map<newElement, oldElement>

// Find match for a single element
const match = findMatch(newElement, oldRoot);
if (match) {
  console.log(match.element);     // The matching old element
  console.log(match.confidence);  // Score (101+)
  console.log(match.breakdown);   // Scoring details
}

// Debug why elements do/don't match
const result = explain(newEl, oldEl);
console.log(result.matches);    // boolean
console.log(result.score);      // number
console.log(result.breakdown);  // { signature, path, text, ... }
```

### Matcher Configuration

```javascript
const matcher = createMatcher({
  includeClasses: true,
  includeAttributes: ['href', 'src', 'name', 'type', 'role', 'aria-label', 'alt', 'title'],
  excludeAttributePrefixes: ['data-morph-', 'data-hyper-', 'data-im-'],
  textHintLength: 64,
  excludeIds: true,
  maxPathDepth: 4,
  landmarks: ['HEADER', 'NAV', 'MAIN', 'ASIDE', 'FOOTER', 'SECTION', 'ARTICLE'],
  weights: {
    signature: 100,
    pathSegment: 10,
    textMatch: 20,
    textMismatch: 25,
    uniqueCandidate: 50,
    positionPenalty: 1,
    maxDriftPenalty: 19,
  },
  minConfidence: 101,
  maxScoredCandidates: 16,
});
```

---

## DOM APIs Used

- **`moveBefore`** — New DOM API (Chrome 131+, Firefox 133+) that moves elements without triggering lifecycle callbacks. Preserves iframe state, video playback, CSS animations.
- **`insertBefore`** — Fallback for browsers without `moveBefore`.

---

## Defaults

Access and modify global defaults:

```javascript
import HyperMorph from 'hyper-morph';

// Read defaults
console.log(HyperMorph.defaults);

// Modify globally
HyperMorph.defaults.morphStyle = 'innerHTML';
HyperMorph.defaults.restoreFocus = false;
```

---

## Development

```bash
npm install
npm test          # Run all tests
npm run dev       # Start demo server at localhost:5692
npm run test:all  # Run tests in all browsers
```

## License

0BSD (Zero-Clause BSD)
