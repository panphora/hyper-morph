# Idiomorph + HyperMatch Integration

This repository contains an enhanced fork of [Idiomorph](https://github.com/bigskysoftware/idiomorph) with integrated content-based element matching via HyperMatch.

## Overview

Idiomorph is a DOM morphing library that intelligently updates the DOM by matching elements between old and new trees. The original algorithm relies primarily on:
- **ID-based matching** - Elements with matching IDs are paired
- **Soft matching** - Elements with the same tag/nodeType are paired positionally

This fork adds **HyperMatch** as a primary matching strategy for anonymous elements (elements without IDs), providing content-based matching that considers:
- Element signatures (tag + classes + key attributes)
- Structural paths relative to landmarks
- Text content similarity

## Structure

```
├── src/           # Idiomorph fork with HyperMatch integration
├── reference/     # Original Idiomorph (unmodified) for comparison
└── docs/          # Design documents and integration plans
```

## Key Changes

The HyperMatch integration modifies Idiomorph's matching priority:

1. **ID set match** (unchanged) - Elements with matching IDs in subtree
2. **HyperMatch** (new) - Content-based matching for anonymous elements
3. **Soft match** (unchanged) - Same tag/nodeType as fallback

### Safety Features

- Elements with `id` attributes are excluded from HyperMatch (deferred to Idiomorph's ID logic)
- Text content mismatches prevent matching (avoids wrong element reuse)
- Duplicate ID safety is preserved from original Idiomorph

## Usage

```bash
cd src
npm install
npm test
```

## Tests

All 169 original Idiomorph tests pass with the HyperMatch integration.

## Related

- [hyper-match](../hyper-match) - Standalone HyperMatch library
- [Idiomorph](https://github.com/bigskysoftware/idiomorph) - Original library
