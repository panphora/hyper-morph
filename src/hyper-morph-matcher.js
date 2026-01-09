/**
 * hyper-morph — Intelligent DOM Element Matching
 *
 * A content-addressable matching algorithm for DOM morphing. Finds corresponding
 * elements between two DOM trees without requiring explicit IDs or keys.
 *
 * PROBLEM:
 *   When morphing DOM trees, we must decide which old elements correspond to
 *   which new elements. Without explicit IDs, positional matching fails on
 *   reorders and prepends — causing lost focus, broken animations, and reset state.
 *
 * SOLUTION:
 *   Each element gets a content-based "signature" (hash of tag + classes + attrs)
 *   and a structural "path" (position relative to landmarks). Matches are scored
 *   by signature equality + path similarity. High confidence = accept, low = reject.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                              HOW IT WORKS                                    │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                              │
 * │   OLD TREE                          NEW TREE                                │
 * │   ────────                          ────────                                │
 * │                                                                              │
 * │   ┌──────────┐                      ┌──────────┐                            │
 * │   │ Element  │──┐                ┌──│ Element  │                            │
 * │   └──────────┘  │                │  └──────────┘                            │
 * │        │        │                │        │                                 │
 * │        ▼        │                │        ▼                                 │
 * │   ┌──────────┐  │   SIGNATURE    │  ┌──────────┐                            │
 * │   │ sig: a3f │◄─┼───LOOKUP───────┼─►│ sig: a3f │                            │
 * │   │ path: #m │  │                │  │ path: #m │                            │
 * │   └──────────┘  │                │  └──────────┘                            │
 * │        │        │                │        │                                 │
 * │        ▼        │   SCORE PAIR   │        ▼                                 │
 * │   ┌──────────┐  │  ┌──────────┐  │  ┌──────────┐                            │
 * │   │ sig: b7x │◄─┴─►│ sig=+100 │◄─┴─►│ sig: b7x │                            │
 * │   │ path: #s │     │path=+30  │     │ path: #s │                            │
 * │   └──────────┘     │conf=130  │     └──────────┘                            │
 * │                    └──────────┘                                             │
 * │                         │                                                   │
 * │                         ▼                                                   │
 * │                 confidence ≥ 101?                                           │
 * │                    YES → MATCH                                              │
 * │                    NO  → RECREATE                                           │
 * │                                                                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * SCORING MODEL:
 *   Base:    signature match     +100  (required — same tag/classes/attrs)
 *   Bonus:   path segment match  +10   (per matching ancestor, max 4)
 *   Bonus:   text hint match     +20   (element textContent, includes descendants)
 *   Bonus:   unique candidate    +50   (only one element with this signature, if text matches)
 *   Penalty: position drift      -1    (per index difference)
 *
 *   Accept if confidence ≥ 101. Signature alone isn't sufficient — requires additional signal.
 *
 * CACHING:
 *   Metadata and indexes are cached per matcher instance for performance within a morph.
 *   For safety across multiple morphs, use session() which creates fresh caches per call,
 *   or call invalidate(root) after DOM mutations.
 *
 * USAGE:
 *   const matcher = createMatcher();
 *
 *   // Option 1: Session API (recommended for morphing — fresh caches per morph)
 *   const { computeMatches } = matcher.session();
 *   const matches = computeMatches(oldRoot, newRoot);
 *
 *   // Option 2: Direct API (reuses caches — call invalidate() after DOM changes)
 *   const match = matcher.findMatch(newElement, oldRoot);
 *   if (match) {
 *     // match.element is the corresponding old element
 *     // match.confidence is the score (0-200+)
 *   }
 *   matcher.invalidate(oldRoot);  // Call after DOM mutations
 *
 * INTEGRATION WITH IDIOMORPH:
 *   Hook into findBestMatch. If hyper-morph returns high confidence, use it.
 *   Otherwise fall back to Idiomorph's default positional matching.
 *
 * @module hyper-morph
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG = {
  // Signature: what makes an element "the same"
  includeClasses: true,
  includeAttributes: ['href', 'src', 'name', 'type', 'role', 'aria-label', 'alt', 'title'],
  excludeAttributePrefixes: ['data-morph-', 'data-hyper-', 'data-im-'],
  textHintLength: 64,
  excludeIds: true,  // Skip elements with id attributes (let ID-based matching handle them)

  // Path: structural address for disambiguation
  maxPathDepth: 4,
  landmarks: ['HEADER', 'NAV', 'MAIN', 'ASIDE', 'FOOTER', 'SECTION', 'ARTICLE'],

  // Scoring weights
  weights: {
    signature: 100,
    pathSegment: 10,
    textMatch: 20,
    textMismatch: 25,  // Penalty when text differs or asymmetric (one has text, other doesn't)
    uniqueCandidate: 50,
    positionPenalty: 1,
  },

  // Thresholds (101 requires at least one signal beyond signature match)
  minConfidence: 101,
};

// =============================================================================
// SIGNATURE COMPUTATION
// =============================================================================

/**
 * Fast non-cryptographic hash (djb2 algorithm)
 * @param {string} str
 * @returns {string}
 */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return Math.abs(h).toString(36);
}

/**
 * Extract sorted class list
 * Works for both HTML elements (className is string) and SVG elements (className is SVGAnimatedString)
 * @param {Element} el
 * @returns {string}
 */
function getClasses(el) {
  // Prefer classList (works for both HTML and SVG in modern browsers)
  if (el.classList && el.classList.length > 0) {
    return Array.from(el.classList).sort().join(' ');
  }
  // Fallback to getAttribute for older browsers or edge cases
  const classAttr = el.getAttribute?.('class');
  if (classAttr) {
    return classAttr.split(/\s+/).filter(Boolean).sort().join(' ');
  }
  return '';
}

/**
 * Extract allowed attributes as sorted string
 * @param {Element} el
 * @param {object} config
 * @returns {string}
 */
function getAttributes(el, config) {
  const attrs = [];
  for (const attr of el.attributes || []) {
    const name = attr.name;
    if (name === 'id' || name === 'class') continue;
    if (config.excludeAttributePrefixes.some(p => name.startsWith(p))) continue;
    if (config.includeAttributes.includes(name)) {
      attrs.push(`${name}=${attr.value}`);
    }
  }
  return attrs.sort().join('|');
}

/**
 * Get text content hint for element matching.
 * Uses textContent which includes all descendant text — intentional for matching
 * container elements by their full content (e.g., cards, list items with nested markup).
 * Note: This means nested text changes will affect parent element matching.
 * @param {Element} el
 * @param {object} config
 * @returns {string}
 */
function getTextHint(el, config) {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, config.textHintLength);
}

/**
 * Compute content-based signature for an element
 * @param {Element} el
 * @param {object} config
 * @returns {string}
 */
function computeSignature(el, config) {
  const parts = [el.tagName];
  if (config.includeClasses) parts.push(getClasses(el));
  parts.push(getAttributes(el, config));
  return hash(parts.join('|'));
}

// =============================================================================
// PATH COMPUTATION
// =============================================================================

/**
 * Get nth-of-type index (1-based, like CSS)
 * @param {Element} el
 * @returns {number}
 */
function getNthOfType(el) {
  const tag = el.tagName;
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === tag) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

/**
 * Check if element is a landmark (stable reference point)
 * @param {Element} el
 * @param {object} config
 * @returns {boolean}
 */
function isLandmark(el, config) {
  if (el.id) return true;
  if (el.getAttribute?.('role')) return true;
  return config.landmarks.includes(el.tagName);
}

/**
 * Get landmark identifier
 * @param {Element} el
 * @returns {string}
 */
function getLandmarkToken(el) {
  if (el.id) return `#${el.id}`;
  const role = el.getAttribute?.('role');
  if (role) return `@${role}`;
  return el.tagName;
}

/**
 * Compute structural path from element to nearest landmark
 * @param {Element} el
 * @param {object} config
 * @returns {string[]}
 */
function computePath(el, config) {
  const segments = [];
  let current = el;

  while (current && current.tagName && segments.length < config.maxPathDepth) {
    const segment = `${current.tagName}:${getNthOfType(current)}`;
    segments.unshift(segment);

    if (current !== el && isLandmark(current, config)) {
      segments.unshift(getLandmarkToken(current));
      break;
    }
    current = current.parentElement;
  }

  return segments;
}

/**
 * Count matching path segments from the end (leaf toward root)
 * @param {string[]} pathA
 * @param {string[]} pathB
 * @returns {number}
 */
function pathSimilarity(pathA, pathB) {
  let matches = 0;
  let i = pathA.length - 1;
  let j = pathB.length - 1;

  while (i >= 0 && j >= 0) {
    if (pathA[i] !== pathB[j]) break;
    matches++;
    i--;
    j--;
  }

  return matches;
}

// =============================================================================
// ELEMENT METADATA
// =============================================================================

/**
 * Get or compute metadata for an element
 * @param {Element} el
 * @param {object} config
 * @param {WeakMap} metaCache
 * @returns {{ signature: string, path: string[], textHint: string }}
 */
function getMeta(el, config, metaCache) {
  if (metaCache.has(el)) return metaCache.get(el);

  const meta = {
    signature: computeSignature(el, config),
    path: computePath(el, config),
    textHint: getTextHint(el, config),
  };

  metaCache.set(el, meta);
  return meta;
}

// =============================================================================
// INDEX BUILDING
// =============================================================================

/**
 * Build signature -> elements index for a root
 * @param {Element} root
 * @param {object} config
 * @param {WeakMap} metaCache
 * @param {WeakMap} indexCache
 * @returns {Map<string, Element[]>}
 */
function buildIndex(root, config, metaCache, indexCache) {
  if (indexCache.has(root)) return indexCache.get(root);

  const index = new Map();
  const elements = root.querySelectorAll('*');

  let domIndex = 0;
  for (const el of elements) {
    const meta = getMeta(el, config, metaCache);
    meta.domIndex = domIndex++;

    if (!index.has(meta.signature)) {
      index.set(meta.signature, []);
    }
    index.get(meta.signature).push(el);
  }

  indexCache.set(root, index);
  return index;
}

/**
 * Clear cached data for a root and its descendants (call after DOM changes)
 * @param {Element} root
 * @param {WeakMap} metaCache
 * @param {WeakMap} indexCache
 */
function invalidateRoot(root, metaCache, indexCache) {
  indexCache.delete(root);

  // Clear metadata for all descendants
  metaCache.delete(root);
  const elements = root.querySelectorAll('*');
  for (const el of elements) {
    metaCache.delete(el);
  }
}

// =============================================================================
// SCORING
// =============================================================================

/**
 * Score a candidate pair
 * @param {Element} newEl
 * @param {Element} oldEl
 * @param {object} config
 * @param {WeakMap} metaCache
 * @param {{ candidateCount: number }} context
 * @returns {{ score: number, breakdown: object }}
 */
function scorePair(newEl, oldEl, config, metaCache, context) {
  const newMeta = getMeta(newEl, config, metaCache);
  const oldMeta = getMeta(oldEl, config, metaCache);
  const weights = config.weights;

  const breakdown = {};
  let score = 0;

  // Signature match (required baseline)
  if (newMeta.signature !== oldMeta.signature) {
    return { score: 0, breakdown: { rejected: 'signature mismatch' } };
  }
  score += weights.signature;
  breakdown.signature = weights.signature;

  // Path similarity bonus
  const pathMatch = pathSimilarity(newMeta.path, oldMeta.path);
  const pathScore = pathMatch * weights.pathSegment;
  score += pathScore;
  breakdown.path = pathScore;

  // Text hint: bonus if matching, penalty if differs or asymmetric
  let textMatches = true;
  if (newMeta.textHint && oldMeta.textHint) {
    // Both have text
    if (newMeta.textHint === oldMeta.textHint) {
      score += weights.textMatch;
      breakdown.text = weights.textMatch;
    } else {
      score -= weights.textMismatch;
      breakdown.text = -weights.textMismatch;
      textMatches = false;
    }
  } else if (newMeta.textHint !== oldMeta.textHint) {
    // One has text, the other doesn't - penalize asymmetric text
    score -= weights.textMismatch;
    breakdown.text = -weights.textMismatch;
    textMatches = false;
  }

  // Unique candidate bonus (only when text matches or both empty)
  if (context.candidateCount === 1 && textMatches) {
    score += weights.uniqueCandidate;
    breakdown.unique = weights.uniqueCandidate;
  }

  // Position drift penalty
  if (typeof newMeta.domIndex === 'number' && typeof oldMeta.domIndex === 'number') {
    const drift = Math.abs(newMeta.domIndex - oldMeta.domIndex);
    const penalty = Math.min(drift * weights.positionPenalty, 20);
    score -= penalty;
    breakdown.drift = -penalty;
  }

  return { score, breakdown };
}

// =============================================================================
// MATCHING API
// =============================================================================

/**
 * Find the best matching old element for a new element
 * @param {Element} newEl
 * @param {Element} oldRoot
 * @param {object} config
 * @param {WeakMap} metaCache
 * @param {WeakMap} indexCache
 * @returns {{ element: Element, confidence: number, breakdown: object } | null}
 */
function findMatch(newEl, oldRoot, config, metaCache, indexCache) {
  // Skip elements with IDs if excludeIds is enabled
  if (config.excludeIds && newEl.id) {
    return null;
  }

  const index = buildIndex(oldRoot, config, metaCache, indexCache);
  const newMeta = getMeta(newEl, config, metaCache);

  // Compute domIndex for drift penalty if not already set
  // Use sibling count as position estimate (aligns scoring with computeMatches)
  if (typeof newMeta.domIndex !== 'number') {
    let idx = 0;
    let sibling = newEl.previousElementSibling;
    while (sibling) {
      idx++;
      sibling = sibling.previousElementSibling;
    }
    newMeta.domIndex = idx;
  }

  const allCandidates = index.get(newMeta.signature) || [];

  // Filter out ID elements if excludeIds is enabled
  const candidates = config.excludeIds
    ? allCandidates.filter(el => !el.id)
    : allCandidates;

  if (candidates.length === 0) {
    return null;
  }

  let bestMatch = null;
  let bestScore = 0;
  let bestBreakdown = null;

  for (const oldEl of candidates) {
    const { score, breakdown } = scorePair(newEl, oldEl, config, metaCache, {
      candidateCount: candidates.length,
    });

    if (score > bestScore) {
      bestScore = score;
      bestMatch = oldEl;
      bestBreakdown = breakdown;
    }
  }

  if (bestScore < config.minConfidence) {
    return null;
  }

  return {
    element: bestMatch,
    confidence: bestScore,
    breakdown: bestBreakdown,
  };
}

/**
 * Compute all matches between two trees using greedy sorted assignment.
 * Ensures one-to-one matching: each old element can only be matched once.
 * Higher-scoring pairs are assigned first, regardless of document order.
 *
 * @param {Element} oldRoot
 * @param {Element} newRoot
 * @param {object} config
 * @param {WeakMap} metaCache
 * @param {WeakMap} indexCache
 * @returns {Map<Element, Element>}
 */
function computeMatches(oldRoot, newRoot, config, metaCache, indexCache) {
  const newElements = newRoot.querySelectorAll('*');
  const index = buildIndex(oldRoot, config, metaCache, indexCache);

  // Index new elements for domIndex calculation
  let domIndex = 0;
  for (const el of newElements) {
    const meta = getMeta(el, config, metaCache);
    meta.domIndex = domIndex++;
  }

  // Build all candidate pairs with scores
  // Skip elements with IDs if excludeIds is enabled
  const candidates = [];
  for (const newEl of newElements) {
    if (config.excludeIds && newEl.id) continue;

    const newMeta = getMeta(newEl, config, metaCache);
    const allOldCandidates = index.get(newMeta.signature) || [];

    // Filter out ID elements if excludeIds is enabled (fixes candidate count inflation)
    const oldCandidates = config.excludeIds
      ? allOldCandidates.filter(el => !el.id)
      : allOldCandidates;

    for (const oldEl of oldCandidates) {
      const { score, breakdown } = scorePair(newEl, oldEl, config, metaCache, {
        candidateCount: oldCandidates.length,
      });

      if (score >= config.minConfidence) {
        candidates.push({ newEl, oldEl, score, breakdown });
      }
    }
  }

  // Sort by score descending (highest scores first)
  candidates.sort((a, b) => b.score - a.score);

  // Greedy assignment: assign pairs in score order, skip already-matched elements
  const matches = new Map();
  const usedOld = new Set();

  for (const { newEl, oldEl } of candidates) {
    if (matches.has(newEl) || usedOld.has(oldEl)) continue;
    matches.set(newEl, oldEl);
    usedOld.add(oldEl);
  }

  return matches;
}

/**
 * Explain why two elements do or don't match
 * @param {Element} newEl
 * @param {Element} oldEl
 * @param {object} config
 * @param {WeakMap} metaCache
 * @returns {{ matches: boolean, score: number, breakdown: object, newMeta: object, oldMeta: object }}
 */
function explain(newEl, oldEl, config, metaCache) {
  const newMeta = getMeta(newEl, config, metaCache);
  const oldMeta = getMeta(oldEl, config, metaCache);
  const { score, breakdown } = scorePair(newEl, oldEl, config, metaCache, { candidateCount: 1 });

  return {
    matches: score >= config.minConfidence,
    score,
    breakdown,
    newMeta: { signature: newMeta.signature, path: newMeta.path, textHint: newMeta.textHint },
    oldMeta: { signature: oldMeta.signature, path: oldMeta.path, textHint: oldMeta.textHint },
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Create a matcher instance with optional config overrides.
 *
 * CACHING MODES:
 * - Default: Caches persist across calls for performance. Call invalidate(root)
 *   after DOM mutations, or use session() for automatic fresh caches.
 * - Session: Use session() to get a context with fresh caches, guaranteeing
 *   no stale data. Recommended for morph operations.
 *
 * @param {object} [configOverrides]
 * @returns {object}
 */
function createMatcher(configOverrides = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...configOverrides,
    weights: { ...DEFAULT_CONFIG.weights, ...configOverrides.weights },
  };

  // Instance-scoped caches (WeakMaps for automatic garbage collection)
  // Each matcher has its own cache, preventing cross-config contamination
  const metaCache = new WeakMap();
  const indexCache = new WeakMap();

  return {
    /**
     * Find the best matching old element for a new element.
     * Uses persistent caches — call invalidate() after DOM changes or use session().
     * @param {Element} newEl - Element from the new tree
     * @param {Element} oldRoot - Root of the old tree to search
     * @returns {{ element: Element, confidence: number, breakdown: object } | null}
     */
    findMatch: (newEl, oldRoot) => findMatch(newEl, oldRoot, config, metaCache, indexCache),

    /**
     * Compute all matches between two trees.
     * Uses persistent caches — call invalidate() after DOM changes or use session().
     * @param {Element} oldRoot - Root of the old tree
     * @param {Element} newRoot - Root of the new tree
     * @returns {Map<Element, Element>} Map of newEl -> oldEl
     */
    computeMatches: (oldRoot, newRoot) => computeMatches(oldRoot, newRoot, config, metaCache, indexCache),

    /**
     * Explain why two elements do or don't match (for debugging)
     * @param {Element} newEl
     * @param {Element} oldEl
     * @returns {{ matches: boolean, score: number, breakdown: object }}
     */
    explain: (newEl, oldEl) => explain(newEl, oldEl, config, metaCache),

    /**
     * Clear cached data for a root and its descendants.
     * Call this after DOM mutations if reusing the matcher.
     * @param {Element} root
     */
    invalidate: (root) => invalidateRoot(root, metaCache, indexCache),

    /**
     * Create a session with fresh caches for a single morph operation.
     * Guarantees no stale data from previous morphs. Recommended usage:
     *
     *   const { findMatch, computeMatches } = matcher.session();
     *   const matches = computeMatches(oldRoot, newRoot);
     *
     * @returns {{ findMatch: Function, computeMatches: Function, explain: Function }}
     */
    session: () => {
      const sessionMetaCache = new WeakMap();
      const sessionIndexCache = new WeakMap();
      return {
        findMatch: (newEl, oldRoot) => findMatch(newEl, oldRoot, config, sessionMetaCache, sessionIndexCache),
        computeMatches: (oldRoot, newRoot) => computeMatches(oldRoot, newRoot, config, sessionMetaCache, sessionIndexCache),
        explain: (newEl, oldEl) => explain(newEl, oldEl, config, sessionMetaCache),
      };
    },

    /**
     * Get the active configuration
     * @returns {object}
     */
    getConfig: () => ({ ...config }),
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { createMatcher, DEFAULT_CONFIG };
export default createMatcher;
