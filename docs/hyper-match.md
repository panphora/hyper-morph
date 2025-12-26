# HyperMatch Algorithm

Intelligent DOM element matching for morphing. Finds corresponding elements between two DOM trees without requiring explicit IDs or keys.

## The Problem

When morphing DOM trees, we must decide which old elements correspond to which new elements. Without explicit IDs, positional matching fails on reorders and prepends:

```html
<!-- Old -->
<ul>
  <li>Apple</li>   <!-- position 0 -->
  <li>Banana</li>  <!-- position 1 -->
</ul>

<!-- New (prepended) -->
<ul>
  <li>NEW</li>     <!-- matches old position 0 → wrong! -->
  <li>Apple</li>   <!-- matches old position 1 → wrong! -->
  <li>Banana</li>  <!-- no match → recreated -->
</ul>
```

Result: "Apple" becomes "NEW", focus is lost, animations break, component state resets.

## The Solution

Each element gets a content-based **signature** and a structural **path**. Matches are scored and only accepted if confidence is high.

```
┌─────────────────────────────────────────────────────────────────┐
│                         HOW IT WORKS                             │
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
│                    │conf=130  │                                  │
│                    └────┬─────┘                                  │
│                         │                                        │
│                         ▼                                        │
│                 confidence ≥ 101?                                │
│                    YES → MATCH                                   │
│                    NO  → RECREATE                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Scoring Model

| Factor | Score | Description |
|--------|-------|-------------|
| Signature match | +100 | Same tag + classes + key attributes |
| Path segment | +10 each | Matching ancestors (up to 4) |
| Text match | +20 | Leaf node text content matches |
| Text mismatch | -25 | Text content differs (or one has text, other doesn't) |
| Unique candidate | +50 | Only one element with this signature (only if text matches) |
| Position drift | -1 each | Index difference in document order (max -20) |

**Threshold:** Accept if confidence ≥ 101. This ensures signature alone isn't sufficient — at least one additional signal (path, text, or uniqueness) is required.

## How Signatures Work

Signature = hash of:
- Tag name (`DIV`, `LI`, etc.)
- Sorted classes (`card item` → `card item`)
- Key attributes (`href`, `src`, `name`, `type`, `role`)

```javascript
// These elements have the same signature:
<div class="card featured">...</div>
<div class="featured card">...</div>  // class order doesn't matter

// These have different signatures:
<div class="card">...</div>
<div class="card new">...</div>       // different classes
```

## How Paths Work

Path = structural address from element to nearest landmark.

```html
<main id="content">           <!-- landmark: #content -->
  <section>                   <!-- SECTION:1 -->
    <div class="card">        <!-- DIV:1 -->
      <h2>Title</h2>          <!-- path: #content/SECTION:1/DIV:1/H2:1 -->
    </div>
  </section>
</main>
```

Landmarks anchor paths and make them stable across reorders. Recognized landmarks:
- Elements with `id` attributes
- Elements with `role` attributes
- Semantic elements: `HEADER`, `NAV`, `MAIN`, `ASIDE`, `FOOTER`, `SECTION`, `ARTICLE`

## Greedy Sorted Assignment

When multiple elements could match, HyperMatch uses greedy sorted assignment:

1. Compute scores for all valid candidate pairs
2. Sort by score descending
3. Assign matches greedily (first-come, first-served)
4. Each old element can only match one new element

This ensures high-confidence matches are made first, preventing lower-confidence matches from "stealing" elements.

## Safety Features

### Elements with IDs are excluded

Elements with `id` attributes are excluded from HyperMatch. They're deferred to Idiomorph's ID-based matching, which has proper duplicate ID safety checks.

### Text mismatch penalty

When one element has text content and the other doesn't (or they have different text), a penalty is applied. This prevents matching:
- `<div>Alert</div>` to `<div></div>`
- `<li>Apple</li>` to `<li>Banana</li>`

### Unique candidate bonus only when text matches

The +50 bonus for having only one candidate is only applied when text content actually matches (or both are empty). This prevents false matches when there's only one candidate but the content is different.

## Configuration

```javascript
const HYPER_CONFIG = {
  // What makes elements "the same"
  includeClasses: true,
  includeAttributes: ['href', 'src', 'name', 'type', 'role', 'aria-label', 'alt', 'title'],
  excludeAttributePrefixes: ['data-morph-', 'data-hyper-', 'data-im-'],
  textHintLength: 64,

  // Structural matching
  maxPathDepth: 4,
  landmarks: ['HEADER', 'NAV', 'MAIN', 'ASIDE', 'FOOTER', 'SECTION', 'ARTICLE'],

  // Scoring weights
  weights: {
    signature: 100,
    pathSegment: 10,
    textMatch: 20,
    textMismatch: 25,
    uniqueCandidate: 50,
    positionPenalty: 1,
  },

  // Threshold
  minConfidence: 101,
};
```

## Performance

- **Signature computation**: O(1) per element, cached
- **Index building**: O(n) where n = elements in old tree
- **Match finding**: O(k) where k = candidates with same signature (usually small)
- **Full matching**: O(n log n) for greedy sorted assignment

For large trees (1000+ elements), the overhead is typically <10ms.

## Limitations

HyperMatch works best when:
- Elements have distinguishing features (classes, attributes, text)
- Structure is relatively stable (landmarks don't move)
- Lists have unique-ish content

It struggles when:
- All list items are identical (`<li></li>` with no content)
- Elements have no classes or meaningful attributes
- The entire DOM structure changes

In these cases, add explicit `id` attributes for reliable matching.
