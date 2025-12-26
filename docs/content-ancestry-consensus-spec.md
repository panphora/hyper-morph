# Hyperclay Matching Spec: Content Signatures + Ancestry + Bidirectional Consensus

This document specifies a fully automatic matching layer for DOM morphing that
does not require developers to add keys or IDs. The approach combines:

- Content-addressable signatures
- Structural ancestry fingerprinting
- Bidirectional best-match consensus

It is designed to sit on top of Idiomorph and provide "good enough" stability
for reorders, prepends, and collaborative edits without adding visible DOM
attributes.

## Goals

- Match elements reliably without requiring keys or IDs.
- Preserve user state (focus, scroll, media) by avoiding wrong matches.
- Avoid adding persistent attributes to the live DOM.
- Keep complexity reasonable and predictable.

## Non-goals

- Prove a globally optimal edit script.
- Guarantee perfect matching in all cases.
- Preserve identity across reloads without any persisted data.

## Overview

Each element gets two hints:

- `sigPrimary`: a content-based signature (tag + stable attrs + small text hint).
- `path`: a short ancestry fingerprint (tag + nth-of-type segments, anchored).

Matching proceeds in two passes:

1. Forward pass: new -> old
2. Backward pass: old -> new

A match is accepted only if both passes agree (consensus). Any non-consensus
node is treated as new (recreated), which is safer than a wrong match.

## Terminology

- Old tree: the current live DOM.
- New tree: the incoming DOM to morph into.
- Signature: a short hash representing an element's identity by content.
- Path: a short, local structural address for disambiguation.
- Candidate: an old element that could match a new element.
- Consensus: both old -> new and new -> old pick the same pair.

## Data collected per element

For every element in both trees, collect:

- `sigPrimary`: content signature (includes text hint for leaf nodes).
- `sigSecondary`: content signature without text hint (more stable).
- `path`: ancestry fingerprint (short suffix of tag + nth-of-type segments).
- `domIndex`: document-order index for tie-breaking.

No attributes are written to the live DOM. All data is stored in memory maps.

## Signature specification

Signature inputs should be stable but discriminative. Defaults:

- Tag name.
- Class list (sorted).
- Selected attributes (allowlist).
- Text hint for leaf elements (trimmed, normalized, short).

Exclude attributes that are morph-specific or unstable.

### Default signature config

```
const DEFAULT_SIGNATURE_CONFIG = {
  textHintLimit: 64,
  includeTextForLeafOnly: true,
  includeInputValue: false,
  includeAttributes: [
    "name",
    "type",
    "role",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "href",
    "src",
    "alt",
    "title",
    "placeholder",
  ],
  includeDataAttributes: false,
  excludeAttributePrefixes: ["data-im-", "data-morph-", "data-hyper-"],
};
```

### Signature algorithm (spec)

1. Normalize tag name to upper-case.
2. Normalize classes: trim, split on whitespace, sort, join.
3. Collect allowed attributes:
   - Allowlist above.
   - Optionally allow `data-*` (off by default).
   - Exclude `id` and excluded prefixes.
4. If `includeTextForLeafOnly` is true and element has no element children:
   - Take normalized text content:
     - Collapse whitespace.
     - Trim.
     - Limit to `textHintLimit` characters.
5. Create a token string and hash it.

`sigPrimary` includes the text hint (if any).  
`sigSecondary` omits the text hint entirely.

## Ancestry fingerprint specification

The `path` is a short list of segments from the element up toward the root.
Each segment is:

```
TAG:nth-of-type(INDEX)
```

Where `INDEX` is 1-based (CSS semantics). The path is a suffix of length N
(defaults to 4). Optionally, stop when a semantic landmark is found.

### Landmark detection (optional)

Landmarks reduce path volatility. A landmark is any of:

- An element with an `id` (if present).
- A semantic tag: HEADER, NAV, MAIN, FOOTER, ASIDE, SECTION, ARTICLE.
- An explicit `role` attribute.

When a landmark is found, add its marker to the path and stop climbing.

## Matching and consensus

### Candidate selection

For each new element:

1. Find old candidates by `sigPrimary` match.
2. If none, fall back to `sigSecondary` match.
3. Score each candidate:
   - Exact signature match (primary or secondary).
   - Path similarity (matching suffix segments).
   - Document-order proximity (tie-breaker).
4. Choose the highest-scoring candidate above a threshold.

### Path similarity (spec)

Compare path segments from leaf upward. The score is the count of matching
segments. If both paths share the same landmark prefix, add a bonus.

### Bidirectional consensus

Compute:

- `newToOld`: best match for each new element.
- `oldToNew`: best match for each old element.

A pair `(old, new)` is accepted only if:

- `newToOld.get(new) === old` and
- `oldToNew.get(old) === new`

All non-consensus nodes are treated as unmatched.

## Integration with Idiomorph

This approach requires a prepass that computes consensus matches and exposes
them to the morph algorithm. There are two integration points:

1. Prepare matches before `morphChildren` runs.
2. In `findBestMatch`, if a new node has a precomputed match, return it.

If the precomputed match is outside the current scan range, move it into place
similar to how persistent IDs are moved today.

## Optional adaptive mode

The eager prepass is the most robust option, but it can be wasteful when most
nodes are already well matched by Idiomorph. An adaptive mode reduces upfront
work by only computing signatures when ambiguity is detected.

### Why fallback-only is not enough

Relying on signatures only when Idiomorph fails to find any match does not
address the main failure mode: false positives. Idiomorph usually finds a soft
match even when it is the wrong element. Adaptive mode must trigger on
ambiguous matches, not just misses.

### Ambiguity triggers

Trigger the local matcher when any of these are true:

- Multiple soft matches exist in the current scan window.
- The prepend guard activates (future soft matches >= 2).
- Sibling list has many repeated tags/classes (low entropy).
- A node is matched by position but has a weak path similarity score.

### Adaptive flow

1. Run Idiomorph's default matching for each parent.
2. When ambiguity triggers, build a local index for that parent's child list.
3. Run local consensus on the ambiguous subset of siblings only.
4. If local consensus resolves < X% of ambiguous nodes, escalate to a full
   subtree index for that parent (or the whole document).

This keeps the fast path fast while still fixing the common reorder/prepend
cases that cause state loss.

### Signature and path caching

Cache signatures and paths in a WeakMap to avoid recomputation:

```javascript
const signatureCache = new WeakMap();
const pathCache = new WeakMap();

function getCachedSignature(el, config, includeText) {
  const key = includeText ? "primary" : "secondary";
  let entry = signatureCache.get(el);
  if (!entry) {
    entry = {};
    signatureCache.set(el, entry);
  }
  if (!entry[key]) {
    entry[key] = computeSignature(el, config, includeText);
  }
  return entry[key];
}

function getCachedPath(el, config) {
  if (!pathCache.has(el)) {
    pathCache.set(el, computePath(el, config.pathDepth));
  }
  return pathCache.get(el);
}
```

## Proposed code

The following code sketches the full matcher and how to wire it into Idiomorph.
This is proposed code only and not yet integrated.

### Signature and path helpers

```javascript
function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function getClassSignature(el) {
  if (!el.className) return "";
  return el.className
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function getAllowedAttributes(el, config) {
  const attrs = [];
  for (const attr of el.attributes || []) {
    const name = attr.name;
    if (name === "id") continue;
    if (config.excludeAttributePrefixes.some((p) => name.startsWith(p))) {
      continue;
    }
    if (name.startsWith("data-") && !config.includeDataAttributes) {
      continue;
    }
    if (config.includeAttributes.includes(name)) {
      attrs.push(`${name}=${attr.value}`);
    }
  }
  return attrs.sort().join("|");
}

function computeSignature(el, config, includeText) {
  const tag = el.tagName;
  const classes = getClassSignature(el);
  const attrs = getAllowedAttributes(el, config);
  let text = "";

  const hasElementChildren = el.children && el.children.length > 0;
  if (includeText && (!config.includeTextForLeafOnly || !hasElementChildren)) {
    text = normalizeText(el.textContent || "").slice(0, config.textHintLimit);
  }

  const raw = `${tag}|${classes}|${attrs}|${text}`;
  return shortHash(raw);
}

function shortHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function getNthOfType(el) {
  const tag = el.tagName;
  let index = 1;
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === tag) index++;
    prev = prev.previousElementSibling;
  }
  return index;
}

function isLandmark(el) {
  if (el.getAttribute && el.getAttribute("id")) return true;
  if (el.getAttribute && el.getAttribute("role")) return true;
  const semantic = ["HEADER", "NAV", "MAIN", "FOOTER", "ASIDE", "SECTION", "ARTICLE"];
  return semantic.includes(el.tagName);
}

function getLandmarkToken(el) {
  const id = el.getAttribute && el.getAttribute("id");
  if (id) return `#${id}`;
  const role = el.getAttribute && el.getAttribute("role");
  if (role) return `role=${role}`;
  return el.tagName;
}

function computePath(el, maxDepth) {
  const parts = [];
  let current = el;
  while (current && current.tagName) {
    const segment = `${current.tagName}:nth-of-type(${getNthOfType(current)})`;
    parts.unshift(segment);

    if (isLandmark(current) && current !== el) {
      parts.unshift(getLandmarkToken(current));
      break;
    }
    current = current.parentElement;
    if (parts.length >= maxDepth) break;
  }
  return parts;
}

function pathSimilarity(a, b) {
  let score = 0;
  let i = a.length - 1;
  let j = b.length - 1;
  while (i >= 0 && j >= 0) {
    if (a[i] !== b[j]) break;
    score++;
    i--;
    j--;
  }
  return score;
}
```

### Building the element index

```javascript
function indexElements(root, config) {
  const elements = Array.from(root.querySelectorAll("*"));
  const sigPrimary = new Map();
  const sigSecondary = new Map();
  const meta = new Map();

  elements.forEach((el, i) => {
    const primary = computeSignature(el, config, true);
    const secondary = computeSignature(el, config, false);
    const path = computePath(el, config.pathDepth);

    meta.set(el, {
      primary,
      secondary,
      path,
      domIndex: i,
    });

    if (!sigPrimary.has(primary)) sigPrimary.set(primary, []);
    sigPrimary.get(primary).push(el);

    if (!sigSecondary.has(secondary)) sigSecondary.set(secondary, []);
    sigSecondary.get(secondary).push(el);
  });

  return { elements, sigPrimary, sigSecondary, meta };
}
```

### Scoring and matching

```javascript
const DEFAULT_MATCH_CONFIG = {
  primarySigScore: 1000,
  secondarySigScore: 300,
  pathSegmentScore: 10,
  indexProximityScore: 1,
  minScore: 330,
};

function scoreCandidate(oldEl, newEl, oldMeta, newMeta, config) {
  const o = oldMeta.get(oldEl);
  const n = newMeta.get(newEl);
  let score = 0;

  if (o.primary === n.primary) score += config.primarySigScore;
  else if (o.secondary === n.secondary) score += config.secondarySigScore;

  score += pathSimilarity(o.path, n.path) * config.pathSegmentScore;

  const indexDistance = Math.abs(o.domIndex - n.domIndex);
  score += Math.max(0, 20 - indexDistance) * config.indexProximityScore;

  return score;
}

function findBestMatchForNew(newEl, oldIndex, oldMeta, newMeta, config) {
  const n = newMeta.get(newEl);
  let candidates = oldIndex.sigPrimary.get(n.primary) || [];
  let usedSecondary = false;

  if (candidates.length === 0) {
    candidates = oldIndex.sigSecondary.get(n.secondary) || [];
    usedSecondary = true;
  }

  let best = null;
  let bestScore = 0;
  for (const oldEl of candidates) {
    const score = scoreCandidate(oldEl, newEl, oldMeta, newMeta, config);
    if (usedSecondary && score < config.minScore) continue;
    if (score > bestScore) {
      bestScore = score;
      best = oldEl;
    }
  }
  return bestScore >= config.minScore ? best : null;
}

function findBestMatchForOld(oldEl, newIndex, oldMeta, newMeta, config) {
  const o = oldMeta.get(oldEl);
  let candidates = newIndex.sigPrimary.get(o.primary) || [];
  let usedSecondary = false;

  if (candidates.length === 0) {
    candidates = newIndex.sigSecondary.get(o.secondary) || [];
    usedSecondary = true;
  }

  let best = null;
  let bestScore = 0;
  for (const newEl of candidates) {
    const score = scoreCandidate(oldEl, newEl, oldMeta, newMeta, config);
    if (usedSecondary && score < config.minScore) continue;
    if (score > bestScore) {
      bestScore = score;
      best = newEl;
    }
  }
  return bestScore >= config.minScore ? best : null;
}
```

### Consensus construction

```javascript
function buildConsensusMatches(oldRoot, newRoot, signatureConfig, matchConfig) {
  const oldIndex = indexElements(oldRoot, signatureConfig);
  const newIndex = indexElements(newRoot, signatureConfig);

  const newToOld = new Map();
  const oldToNew = new Map();

  for (const newEl of newIndex.elements) {
    const bestOld = findBestMatchForNew(
      newEl,
      oldIndex,
      oldIndex.meta,
      newIndex.meta,
      matchConfig,
    );
    if (bestOld) newToOld.set(newEl, bestOld);
  }

  for (const oldEl of oldIndex.elements) {
    const bestNew = findBestMatchForOld(
      oldEl,
      newIndex,
      oldIndex.meta,
      newIndex.meta,
      matchConfig,
    );
    if (bestNew) oldToNew.set(oldEl, bestNew);
  }

  const consensus = new Map();
  for (const [newEl, oldEl] of newToOld) {
    if (oldToNew.get(oldEl) === newEl) {
      consensus.set(newEl, oldEl);
    }
  }

  return { consensus, newToOld, oldToNew };
}
```

### Idiomorph hook (proposed)

```javascript
function attachConsensusMatcher(ctx, oldRoot, newRoot) {
  const signatureConfig = { ...DEFAULT_SIGNATURE_CONFIG, pathDepth: 4 };
  const matchConfig = { ...DEFAULT_MATCH_CONFIG };
  ctx.hyperMatches = buildConsensusMatches(
    oldRoot,
    newRoot,
    signatureConfig,
    matchConfig,
  );
}

// Inside Idiomorph's findBestMatch:
// if a precomputed match exists for this new node, use it.
function findBestMatchWithConsensus(ctx, node, startPoint, endPoint) {
  const mapped = ctx.hyperMatches?.consensus.get(node);
  if (mapped) {
    // If the mapped node is already in range, return it.
    if (isNodeBetween(mapped, startPoint, endPoint)) return mapped;
    // Otherwise move it into place, similar to persistent ID handling.
    moveBefore(startPoint?.parentNode, mapped, startPoint);
    return mapped;
  }

  // fall back to existing idiomorph logic if no consensus match
  return findBestMatch(ctx, node, startPoint, endPoint);
}
```

### Adaptive hook (optional)

```javascript
function findBestMatchWithAdaptive(ctx, node, startPoint, endPoint) {
  const defaultMatch = findBestMatch(ctx, node, startPoint, endPoint);
  if (!defaultMatch) return null;

  if (!isAmbiguousMatch(ctx, node, startPoint, endPoint, defaultMatch)) {
    return defaultMatch;
  }

  const siblings = collectSiblingsBetween(startPoint, endPoint);
  const localConsensus = buildLocalConsensus(
    siblings.old,
    siblings.new,
    ctx.signatureConfig,
    ctx.matchConfig,
  );

  const mapped = localConsensus.get(node);
  if (mapped) return mapped;

  if (localConsensus.size < ctx.matchConfig.localConsensusMinCoverage) {
    const fullConsensus = buildConsensusMatches(
      ctx.target,
      ctx.newContent,
      ctx.signatureConfig,
      ctx.matchConfig,
    );
    return fullConsensus.consensus.get(node) || null;
  }

  return null;
}

function isAmbiguousMatch(ctx, node, startPoint, endPoint, defaultMatch) {
  const softMatches = countSoftMatches(ctx, node, startPoint, endPoint);
  if (softMatches >= ctx.matchConfig.ambiguitySoftMatchThreshold) return true;

  const nodePath = getCachedPath(node, ctx.signatureConfig);
  const matchPath = getCachedPath(defaultMatch, ctx.signatureConfig);
  const similarity = pathSimilarity(nodePath, matchPath);
  return similarity < ctx.matchConfig.minPathSimilarity;
}
```

## Configuration knobs

- `textHintLimit`: 32 to 96 characters.
- `pathDepth`: 3 to 6 segments.
- `includeDataAttributes`: opt-in if users encode stable data keys.
- `minScore`: raise to reduce false matches; lower to reduce recreates.
- `ambiguitySoftMatchThreshold`: number of soft matches that triggers local consensus.
- `minPathSimilarity`: minimum path similarity before a default match is accepted.
- `localConsensusMinCoverage`: minimum matches required to avoid escalating to full consensus.

## Complexity

- Indexing: O(n + m)
- Candidate lookup: O(k) per node where k is bucket size
- Total: roughly O(n + m + matches), with worst-case O(n * m) only when all
  elements share identical signatures (rare in practice).

## Expected behavior

- Reorders: content signatures should preserve element identity.
- Duplicates: ancestry path disambiguates.
- Ambiguous matches: consensus rejects them, reducing wrong matches.
- Content changes: may recreate elements; safer than morphing wrong ones.
