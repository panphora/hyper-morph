# hyper-match

Intelligent DOM element matching for morphing. An enhanced [Idiomorph](https://github.com/bigskysoftware/idiomorph) with content-based matching.

## The Problem

When morphing DOM trees, we must decide which old elements correspond to which new elements. Without explicit IDs, positional matching fails:

```html
<!-- Old -->
<ul>
  <li>Apple</li>
  <li>Banana</li>
</ul>

<!-- New (prepended) -->
<ul>
  <li>NEW</li>     <!-- positional match → "Apple" becomes "NEW" ❌ -->
  <li>Apple</li>
  <li>Banana</li>
</ul>
```

Result: Focus lost, animations break, component state resets.

## The Solution

HyperMatch identifies elements by content-based **signatures** and structural **paths**:

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
│                    │text=+20  │                                  │
│                    │conf=150  │                                  │
│                    └────┬─────┘                                  │
│                         │                                        │
│                         ▼                                        │
│                 confidence ≥ 101?                                │
│                    YES → MATCH ✓                                 │
│                    NO  → RECREATE                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

```bash
cd src
npm install
npm test  # 169 tests passing
```

```javascript
import Idiomorph from './src/idiomorph.js';

// Just use Idiomorph normally - HyperMatch is integrated
Idiomorph.morph(oldElement, newElement);
```

## Scoring Model

| Factor | Score | Description |
|--------|-------|-------------|
| Signature match | +100 | Same tag + classes + key attributes |
| Path segment | +10 each | Matching ancestors (up to 4) |
| Text match | +20 | Leaf node text content matches |
| Text mismatch | -25 | Text differs or asymmetric |
| Unique candidate | +50 | Only one candidate (when text matches) |

**Threshold:** Confidence ≥ 101 required. Signature alone isn't enough.

## Matching Priority

1. **ID set match** — Elements with matching IDs in subtree (Idiomorph)
2. **HyperMatch** — Content-based matching for anonymous elements
3. **Soft match** — Same tag/nodeType as fallback (Idiomorph)

Elements with `id` attributes are excluded from HyperMatch and handled by Idiomorph's ID logic.

## Structure

```
├── src/           # Idiomorph + HyperMatch integration
├── reference/     # Original Idiomorph for comparison
└── docs/          # Detailed documentation
    ├── hyper-match.md           # Algorithm details
    ├── INTEGRATION-PLAN.md      # Integration design
    └── ...
```

## Documentation

- [HyperMatch Algorithm](./docs/hyper-match.md) — Detailed scoring, paths, signatures
- [Problem Analysis](./docs/problem-analysis.md) — Why DOM matching is hard
- [Integration Plan](./docs/INTEGRATION-PLAN.md) — How HyperMatch integrates with Idiomorph

## Related

- [Idiomorph](https://github.com/bigskysoftware/idiomorph) — Original library by Big Sky Software

## License

BSD 2-Clause (same as Idiomorph)
