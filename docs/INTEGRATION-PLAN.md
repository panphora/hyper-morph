# Idiomorph + hyper-match Integration Plan

## Goal
Use hyper-match as primary matching strategy, fall back to Idiomorph's ID-based matching.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MORPH FLOW                                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. PRE-COMPUTE PHASE                                         │
│     ├─ Create ID maps (existing)                              │
│     └─ Compute hyper-matches (NEW)                            │
│                                                               │
│  2. MORPHING PHASE                                            │
│     For each new child:                                       │
│     ├─ Check hyper-match (NEW - primary)                      │
│     ├─ Check ID set match (existing - fallback)               │
│     ├─ Check soft match (existing - last resort)              │
│     └─ Create new if no match                                 │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Changes Required

### 1. Copy hyper-match into idiomorph-new
- Copy `hyper-match/index.js` → `idiomorph-new/src/hyper-match.js`
- Modify exports for inline use

### 2. Modify `createMorphContext` (line ~995)
```javascript
// After createIdMaps
const hyperMatcher = createMatcher();
const hyperMatches = hyperMatcher.computeMatches(oldNode, newContent);
// Add to context
ctx.hyperMatches = hyperMatches;
ctx.hyperMatcher = hyperMatcher;
```

### 3. Modify `findBestMatch` (line ~395)
```javascript
function findBestMatch(ctx, node, startPoint, endPoint) {
  // NEW: Check hyper-match first
  const hyperMatch = ctx.hyperMatches.get(node);

  let softMatch = null;
  let cursor = startPoint;

  while (cursor && cursor != endPoint) {
    // NEW: If this is the hyper-match result, return immediately
    if (cursor === hyperMatch) {
      return cursor;
    }

    // Existing ID set + soft match logic...
    if (isSoftMatch(cursor, node)) {
      if (isIdSetMatch(ctx, cursor, node)) {
        return cursor;
      }
      // ... soft match fallback logic
    }
    cursor = cursor.nextSibling;
  }

  return softMatch || null;
}
```

### 4. Modify `morphChildren` (line ~270)
Handle hyper-matched elements outside the current range:

```javascript
// After findBestMatch fails and persistentIds check fails:
if (newChild instanceof Element) {
  const hyperMatch = ctx.hyperMatches.get(newChild);
  if (hyperMatch) {
    // Move from elsewhere (future or pantry)
    moveBefore(oldParent, hyperMatch, insertionPoint);
    morphNode(hyperMatch, newChild, ctx);
    insertionPoint = hyperMatch.nextSibling;
    continue;
  }
}
// Then create new...
```

### 5. Modify `removeNode` (line ~508)
Save hyper-matched elements to pantry instead of removing:

```javascript
function removeNode(ctx, node) {
  // Existing: save if in idMap
  if (ctx.idMap.has(node)) {
    moveBefore(ctx.pantry, node, null);
  }
  // NEW: also save if hyper-matched to a future new element
  else if (isHyperMatchedToFuture(ctx, node)) {
    moveBefore(ctx.pantry, node, null);
  }
  else {
    // Actually remove
    if (ctx.callbacks.beforeNodeRemoved(node) === false) return;
    node.parentNode?.removeChild(node);
    ctx.callbacks.afterNodeRemoved(node);
  }
}
```

## Testing Strategy

1. Run existing tests - all should pass
2. The 5 currently skipped tests should now pass:
   - reordering anonymous siblings
   - prepending a new softmatchable node onto the beginning
   - inserting a new softmatchable node into the middle
   - removing a softmatchable node from the front
   - removing a softmatchable node from the middle

## Rollout

1. Implement changes incrementally
2. Run tests after each change
3. Add new tests for hyper-match specific scenarios
