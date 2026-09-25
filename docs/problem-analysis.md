# DOM Morphing: The Matching Problem

> **Historical.** This report describes the 0.5.x approach (an Idiomorph
> fork with a scoring matcher) and the options considered at the time. It
> is kept as the record of why content-based pairing was chosen. The
> current design is `docs/rewrite-plan.md`; the current contract is
> `docs/api.md`.

A comprehensive report on element matching strategies for DOM morphing, specifically for Hyperclay's live-sync system.

---

## The Problem

When morphing one DOM tree into another, the algorithm must decide **which old elements correspond to which new elements**. Get this wrong, and:

- Form inputs lose focus mid-typing
- CSS transitions break (element destroyed and recreated instead of moved)
- Component state resets (video playback position, scroll position, open/closed state)
- Performance suffers (recreating elements is expensive)
- User experience degrades (flickering, lost work)

**The core challenge:** HTML elements don't have inherent identity. Two `<div class="card">` elements are structurally identical. Without explicit IDs, morphing algorithms must guess which old card corresponds to which new card.

### Hyperclay's Specific Challenges

| Scenario                                      | Problem                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| Admin A adds a card at the top                | All subsequent cards shift down, break positional matching |
| Admin A reorders a list                       | Items get morphed into wrong positions, content jumbles    |
| User edits contenteditable while sync arrives | Focus lost, cursor jumps, text duplicated or lost          |
| Dynamic component generates markup            | No stable IDs, every sync recreates everything             |
| Template loops render identical items         | All items match first item by position                     |

---

## Libraries Considered

### Idiomorph (Current Choice)

**Maintainer:** Big Sky Software (htmx team)
**Approach:** ID set matching + soft matching fallback
**Why we use it:**

- Designed for htmx/Turbo-style full-page morphing
- Head tag handling (merge, append, block)
- Comprehensive callbacks for interception
- Pantry system preserves moved elements
- Active maintenance, good documentation

**Limitations:**

- Without IDs, falls back to positional matching
- No built-in `key` attribute support (like React)
- No content-based matching

### morphdom

**Maintainer:** Patrick Steele (Marko.js team)
**Approach:** ID matching + positional fallback
**Why not:**

- Simpler ID matching (no ID set/subtree analysis)
- No head tag handling
- Less active maintenance
- Fewer callbacks

### nanomorph

**Maintainer:** Choo framework
**Approach:** Minimal positional matching
**Why not:**

- Extremely minimal (good for bundle size, bad for features)
- No callbacks
- No head handling
- No ID set matching
- Designed for Choo's specific use case

### diffhtml

**Maintainer:** Tim Branyen
**Approach:** Virtual DOM style diffing
**Why not:**

- Overkill for HTML string → DOM morphing
- More complex mental model
- Heavier runtime
- Designed for component frameworks

### lit-html / uhtml

**Approach:** Tagged template literals with keyed rendering
**Why not:**

- Template-based, not arbitrary HTML morphing
- Requires source code changes (can't morph existing HTML)
- Designed for component authoring, not full-page sync

### set-dom

**Maintainer:** Dylan Piercey
**Approach:** Similar to morphdom
**Why not:**

- Less active
- Fewer features than Idiomorph
- No compelling advantage

### Why Idiomorph Wins

For Hyperclay's use case (arbitrary HTML pages, real-time sync, no framework), Idiomorph is the best fit:

- Handles full documents (head + body)
- Callbacks let us intercept for scripts, save-ignore, etc.
- ID set matching helps with nested structures
- Active project with responsive maintainer

**But:** The matching problem remains. Without IDs, Idiomorph guesses by position.

---

## The Matching Algorithm (Current)

### How Idiomorph Matches Today

```
For each new child:
  1. Scan old children for ID SET MATCH
     - Does any old child share descendant IDs with this new child?
     - If yes → match found, morph that old child

  2. If no ID match, scan for SOFT MATCH
     - Same nodeType?
     - Same tagName?
     - If old has id, does new have same id (or no id)?
     - If yes → tentative match

  3. SOFT MATCH TIEBREAKER
     - If multiple soft matches, take first one
     - If next new sibling would soft-match current old child, skip to avoid churn

  4. If no match → create new element from scratch
```

### Where It Breaks Down

**Prepending:**

```html
<!-- Old -->
<ul>
  <li>Apple</li>
  <li>Banana</li>
</ul>

<!-- New -->
<ul>
  <li>NEW ITEM</li>
  ← Soft-matches "Apple" (both are first
  <li>)</li>
  <li>Apple</li>
  ← Soft-matches "Banana"
  <li>Banana</li>
  ← No match, gets inserted
</ul>
```

Result: "Apple" DOM node now says "NEW ITEM". Focus in "Apple" input would be lost.

**Reordering:**

```html
<!-- Old -->
<div id="list">
  <div class="card">A</div>
  <div class="card">B</div>
  <div class="card">C</div>
</div>

<!-- New -->
<div id="list">
  <div class="card">C</div>
  <div class="card">A</div>
  <div class="card">B</div>
</div>
```

Result: Card A's DOM node gets content "C". Card B's gets "A". Card C's gets "B". No actual reordering — just content replacement.

---

## Proposed Solutions

### Strategy 1: Content-Addressable DOM

**Concept:** Give every element a deterministic signature based on its content, like Git's content-addressable storage. Same content = same signature = match.

**Implementation:**

```javascript
function computeSignature(el) {
  const tag = el.tagName;

  // Sort attributes for determinism, exclude morph-specific ones
  const attrs = [...el.attributes]
    .filter((a) => !a.name.startsWith("data-morph"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `${a.name}=${a.value}`)
    .join("|");

  // Text hint: first 50 chars of text content
  const textHint = el.textContent?.trim().slice(0, 50) || "";

  // Compute short hash
  const raw = `${tag}:${attrs}:${textHint}`;
  return shortHash(raw); // e.g., first 8 chars of SHA-256
}

function stampTree(root) {
  root.querySelectorAll("*:not([id])").forEach((el) => {
    el.setAttribute("data-morph-sig", computeSignature(el));
  });
}

// Modify Idiomorph's isSoftMatch to check data-morph-sig
function isSoftMatch(oldNode, newNode) {
  const oldSig = oldNode.getAttribute?.("data-morph-sig");
  const newSig = newNode.getAttribute?.("data-morph-sig");

  if (oldSig && newSig) {
    return oldSig === newSig;
  }

  // Fall back to existing logic...
}
```

**Pros:**

- Elements become self-identifying
- Works for dynamic content
- No manual ID assignment needed
- Deterministic across browsers/sessions

**Cons:**

- Signature changes when content changes (by design, but might not always be desired)
- Hash computation overhead (minimal, but exists)
- Elements with identical content get identical signatures (disambiguation needed)

**Disambiguation for identical elements:**

```javascript
function stampTreeWithIndex(root) {
  const sigCounts = new Map();

  root.querySelectorAll("*:not([id])").forEach((el) => {
    const sig = computeSignature(el);
    const count = sigCounts.get(sig) || 0;
    sigCounts.set(sig, count + 1);

    // Append index for duplicate signatures
    el.setAttribute("data-morph-sig", `${sig}-${count}`);
  });
}
```

**Best for:** Dynamic lists, repeated components, content-driven matching.

---

### Strategy 2: Structural Ancestry Fingerprinting

**Concept:** Identify elements by their position relative to landmark elements (those with IDs). "Third child of #sidebar's second section" is a stable address.

**Implementation:**

```javascript
function getAncestryPath(el) {
  const parts = [];
  let current = el;

  while (current.parentElement) {
    const parent = current.parentElement;
    const landmark = current.closest("[id]");

    if (landmark && landmark !== current) {
      // Found a landmark ancestor
      const index = [...parent.children]
        .filter((c) => c.tagName === current.tagName)
        .indexOf(current);

      parts.unshift(`#${landmark.id}>${current.tagName}:nth-of-type(${index})`);
      break;
    } else {
      // No landmark yet, keep climbing
      const index = [...parent.children]
        .filter((c) => c.tagName === current.tagName)
        .indexOf(current);
      parts.unshift(`${current.tagName}:nth-of-type(${index})`);
    }

    current = parent;
  }

  return parts.join("/");
}

// Examples:
// "#main-content>DIV:nth-of-type(2)/P:nth-of-type(0)"
// "#sidebar>UL:nth-of-type(0)/LI:nth-of-type(3)"
```

**Pros:**

- Uses existing IDs as anchors
- No content hashing overhead
- Structural stability (content can change, path stays same)
- Intuitive mental model

**Cons:**

- Breaks if landmark element is removed/moved
- Sensitive to sibling insertion (indices shift)
- Requires at least some IDs in the document

**Best for:** Documents with stable landmark structure, semantic HTML with IDs on major sections.

---

### Strategy 3: Bidirectional Best-Match Consensus

**Concept:** Match from old→new AND new→old. Only accept matches where both directions agree. Eliminates ambiguous matches.

**Implementation:**

```javascript
function findConsensusMatches(oldRoot, newRoot) {
  const oldNodes = [...oldRoot.querySelectorAll("*")];
  const newNodes = [...newRoot.querySelectorAll("*")];

  // Forward matching: for each old node, find best new node
  const oldToNew = new Map();
  for (const oldNode of oldNodes) {
    const bestNew = findBestMatch(oldNode, newNodes);
    if (bestNew) oldToNew.set(oldNode, bestNew);
  }

  // Backward matching: for each new node, find best old node
  const newToOld = new Map();
  for (const newNode of newNodes) {
    const bestOld = findBestMatch(newNode, oldNodes);
    if (bestOld) newToOld.set(newNode, bestOld);
  }

  // Consensus: only keep bidirectional agreements
  const confirmedMatches = new Map();
  for (const [oldNode, newNode] of oldToNew) {
    if (newToOld.get(newNode) === oldNode) {
      confirmedMatches.set(oldNode, newNode);
    }
  }

  return confirmedMatches;
}

function findBestMatch(node, candidates) {
  let bestScore = 0;
  let bestMatch = null;

  for (const candidate of candidates) {
    const score = computeSimilarity(node, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore > THRESHOLD ? bestMatch : null;
}

function computeSimilarity(a, b) {
  let score = 0;

  // Same tag
  if (a.tagName === b.tagName) score += 10;

  // Same ID
  if (a.id && a.id === b.id) score += 100;

  // Same classes
  const sharedClasses = [...a.classList].filter((c) => b.classList.contains(c));
  score += sharedClasses.length * 5;

  // Similar text content
  const textSimilarity = computeTextSimilarity(a.textContent, b.textContent);
  score += textSimilarity * 20;

  // Same attributes
  const aAttrs = new Set(
    [...a.attributes].map((attr) => `${attr.name}=${attr.value}`),
  );
  const bAttrs = new Set(
    [...b.attributes].map((attr) => `${attr.name}=${attr.value}`),
  );
  const sharedAttrs = [...aAttrs].filter((attr) => bAttrs.has(attr));
  score += sharedAttrs.length * 3;

  return score;
}
```

**Pros:**

- Eliminates ambiguous matches entirely
- No false positives — only confident matches proceed
- Works without any IDs
- Mathematically sound approach

**Cons:**

- 2x matching work (both directions)
- Unmatched elements get recreated (might be fine, might lose state)
- More complex implementation

**Best for:** Situations where correctness matters more than performance, complex reordering scenarios.

---

### Strategy 4: Shadow ID Persistence

**Concept:** Assign invisible, persistent IDs to elements that survive serialization and sync. Unlike content signatures, these IDs track element _identity_, not content.

**Implementation:**

```javascript
// WeakMap to track identity across sessions (in-memory)
const elementIdentities = new WeakMap();
let nextIdentityId = 1;

function getOrCreateIdentity(el) {
  if (!elementIdentities.has(el)) {
    elementIdentities.set(el, `eid-${nextIdentityId++}`);
  }
  return elementIdentities.get(el);
}

// Before serializing for sync/save:
function prepareForSync(liveRoot, cloneRoot) {
  const liveEls = liveRoot.querySelectorAll("*");
  const cloneEls = cloneRoot.querySelectorAll("*");

  liveEls.forEach((liveEl, i) => {
    const identity = getOrCreateIdentity(liveEl);
    cloneEls[i].setAttribute("data-eid", identity);
  });
}

// When receiving sync:
function applySync(liveRoot, incomingRoot) {
  // Build map of incoming eids
  const incomingByEid = new Map();
  incomingRoot.querySelectorAll("[data-eid]").forEach((el) => {
    incomingByEid.set(el.getAttribute("data-eid"), el);
  });

  // Build map of live eids
  const liveByEid = new Map();
  liveRoot.querySelectorAll("*").forEach((el) => {
    const eid = getOrCreateIdentity(el);
    liveByEid.set(eid, el);
  });

  // Match by eid
  // ... proceed with morphing using eid-based matching
}
```

**Pros:**

- True identity tracking (element stays "itself" even if content changes)
- Survives content edits, attribute changes, moves
- Explicit and predictable

**Cons:**

- Requires coordination between sender and receiver
- WeakMap identity lost on page refresh (need persistence strategy)
- Adds attributes to serialized HTML

**Persistence across page loads:**

```javascript
// On page load, restore identities from existing data-eid attributes
function restoreIdentities(root) {
  let maxId = 0;
  root.querySelectorAll("[data-eid]").forEach((el) => {
    const eid = el.getAttribute("data-eid");
    elementIdentities.set(el, eid);

    const num = parseInt(eid.replace("eid-", ""), 10);
    if (num > maxId) maxId = num;
  });
  nextIdentityId = maxId + 1;
}
```

**Best for:** Long editing sessions, collaborative editing where element identity matters.

---

### Strategy 5: Tree Edit Distance (Zhang-Shasha)

**Concept:** Treat DOM morphing as a tree transformation problem. Compute the minimum-cost sequence of operations (insert, delete, rename, move) to transform old tree into new tree. Apply exactly those operations.

**Implementation:**

```javascript
// Simplified conceptual implementation
// Real implementation would use Zhang-Shasha or APTED algorithm

function computeEditScript(oldTree, newTree) {
  const operations = [];

  // Build cost matrix using dynamic programming
  // This is O(n * m) where n, m are tree sizes
  const costMatrix = buildCostMatrix(oldTree, newTree);

  // Backtrack to find optimal operations
  let i = oldTree.size, j = newTree.size;
  while (i > 0 || j > 0) {
    if (costMatrix[i][j] came from DELETE) {
      operations.push({ type: 'delete', node: oldTree.nodes[i] });
      i--;
    } else if (costMatrix[i][j] came from INSERT) {
      operations.push({ type: 'insert', node: newTree.nodes[j], position: ... });
      j--;
    } else if (costMatrix[i][j] came from MATCH/RENAME) {
      if (oldTree.nodes[i].label !== newTree.nodes[j].label) {
        operations.push({ type: 'update', old: oldTree.nodes[i], new: newTree.nodes[j] });
      }
      i--; j--;
    }
  }

  return operations.reverse();
}

function applyEditScript(root, operations) {
  for (const op of operations) {
    switch (op.type) {
      case 'delete':
        op.node.remove();
        break;
      case 'insert':
        op.position.parent.insertBefore(op.node.cloneNode(true), op.position.before);
        break;
      case 'update':
        morphAttributes(op.old, op.new);
        break;
      case 'move':
        op.newParent.insertBefore(op.node, op.before);
        break;
    }
  }
}
```

**Pros:**

- Mathematically optimal — provably minimal operations
- Handles any transformation correctly
- Well-studied algorithms exist (Zhang-Shasha, APTED, RTED)

**Cons:**

- Expensive: O(n²) to O(n⁴) depending on algorithm
- Complex to implement correctly
- May be overkill for typical morphing scenarios

**Optimizations:**

- Cache subtree hashes, skip identical subtrees
- Use fast path for common cases (only leaves changed)
- Limit depth for deeply nested structures
- Run async for large trees

**Best for:** Complex transformations where correctness is paramount, academic/reference implementation.

---

### Strategy 6: Semantic Role Matching

**Concept:** Match elements by their semantic "role" in the document — inferred from HTML semantics, ARIA, class naming conventions, and structural position. Humans identify "the navigation" or "the sidebar" regardless of exact markup.

**Implementation:**

```javascript
function inferSemanticRole(el) {
  // Explicit ARIA role
  const ariaRole = el.getAttribute("role");
  if (ariaRole) return `aria:${ariaRole}`;

  // Semantic HTML5 tags
  const semanticTags = {
    HEADER: "banner",
    NAV: "navigation",
    MAIN: "main",
    FOOTER: "contentinfo",
    ARTICLE: "article",
    ASIDE: "complementary",
    SECTION: "region",
    FORM: "form",
    SEARCH: "search",
  };
  if (semanticTags[el.tagName]) {
    // Include accessible name if present
    const name =
      el.getAttribute("aria-label") ||
      el.querySelector("h1,h2,h3")?.textContent?.slice(0, 20);
    return name
      ? `${semanticTags[el.tagName]}:${name}`
      : semanticTags[el.tagName];
  }

  // Common class conventions
  const classPatterns = [
    { pattern: /\b(nav|navigation|menu)\b/i, role: "navigation" },
    { pattern: /\b(sidebar|aside)\b/i, role: "complementary" },
    { pattern: /\b(header|masthead)\b/i, role: "banner" },
    { pattern: /\b(footer)\b/i, role: "contentinfo" },
    { pattern: /\b(card|tile)\b/i, role: "card" },
    { pattern: /\b(modal|dialog)\b/i, role: "dialog" },
    { pattern: /\b(list|grid)\b/i, role: "list" },
    { pattern: /\b(item|entry)\b/i, role: "listitem" },
    { pattern: /\b(btn|button|cta)\b/i, role: "button" },
  ];

  for (const { pattern, role } of classPatterns) {
    if (pattern.test(el.className)) {
      // For cards/items, include distinguishing content
      if (role === "card" || role === "listitem") {
        const heading = el.querySelector(
          "h1,h2,h3,h4,h5,h6,[class*=title],[class*=heading]",
        );
        if (heading) return `${role}:${heading.textContent?.slice(0, 30)}`;
      }
      return role;
    }
  }

  // Structural inference
  if (el.tagName === "UL" || el.tagName === "OL") return "list";
  if (el.tagName === "LI") {
    const text = el.textContent?.slice(0, 30);
    return text ? `listitem:${text}` : "listitem";
  }
  if (el.tagName === "H1") return "heading:primary";
  if (el.tagName === "H2") return `heading:${el.textContent?.slice(0, 30)}`;

  return null; // No semantic role inferred
}

function matchBySemanticRole(oldRoot, newRoot) {
  // Build role maps
  const oldByRole = new Map();
  oldRoot.querySelectorAll("*").forEach((el) => {
    const role = inferSemanticRole(el);
    if (role) {
      if (!oldByRole.has(role)) oldByRole.set(role, []);
      oldByRole.get(role).push(el);
    }
  });

  const matches = new Map();
  newRoot.querySelectorAll("*").forEach((newEl) => {
    const role = inferSemanticRole(newEl);
    if (role && oldByRole.has(role)) {
      const candidates = oldByRole.get(role);
      if (candidates.length === 1) {
        // Unique role match
        matches.set(candidates[0], newEl);
        candidates.length = 0; // Mark as used
      } else if (candidates.length > 1) {
        // Multiple candidates — use additional heuristics
        const best = findBestCandidate(candidates, newEl);
        if (best) {
          matches.set(best, newEl);
          candidates.splice(candidates.indexOf(best), 1);
        }
      }
    }
  });

  return matches;
}
```

**Pros:**

- Matches how humans think about page structure
- Resilient to markup changes (div→section, restructuring)
- Works well with semantic HTML
- No IDs required

**Cons:**

- Heuristic — can be wrong for unusual markup
- Requires well-structured HTML for best results
- Multiple elements with same role need fallback

**Best for:** Content-focused sites, semantic HTML, accessibility-conscious codebases.

---

## Comparison Matrix

| Strategy                | Robustness | Performance | Invasiveness          | Best Use Case                            |
| ----------------------- | ---------- | ----------- | --------------------- | ---------------------------------------- |
| Content-Addressable     | ★★★★☆      | ★★★★☆       | ★★★☆☆ (adds attrs)    | Dynamic lists, content-driven            |
| Ancestry Fingerprinting | ★★★☆☆      | ★★★★★       | ★★★★★ (none)          | Stable landmarks, semantic HTML          |
| Bidirectional Consensus | ★★★★★      | ★★☆☆☆       | ★★★★★ (none)          | Complex reordering, correctness-critical |
| Shadow ID Persistence   | ★★★★★      | ★★★★★       | ★★☆☆☆ (attrs + state) | Long sessions, collaborative editing     |
| Tree Edit Distance      | ★★★★★      | ★☆☆☆☆       | ★★★★★ (none)          | Reference impl, correctness research     |
| Semantic Role Matching  | ★★★☆☆      | ★★★★☆       | ★★★★★ (none)          | Semantic HTML, content sites             |

---

## Recommendation for Hyperclay

### Immediate (Low Effort)

1. **Encourage IDs on major sections** — Document this as best practice for live-sync
2. **Use `im-preserve` for local UI** — Prevent popover destruction during sync

### Short-Term (Medium Effort)

3. **Implement Content-Addressable signatures** — Auto-stamp repeated elements before sync
4. **Add `data-morph-key` support to Idiomorph** — Like React's `key` prop

### Long-Term (Higher Effort)

5. **Shadow ID persistence** — For true element identity in collaborative editing
6. **Semantic role matching as fallback** — When no IDs or signatures exist

### Suggested Layered Approach

```javascript
function matchElements(oldEl, newEl) {
  // Layer 1: Explicit ID
  if (oldEl.id && oldEl.id === newEl.id) return true;

  // Layer 2: Shadow ID (if available)
  const oldEid = getElementIdentity(oldEl);
  const newEid = newEl.getAttribute("data-eid");
  if (oldEid && newEid && oldEid === newEid) return true;

  // Layer 3: Content signature
  const oldSig = oldEl.getAttribute("data-morph-sig");
  const newSig = newEl.getAttribute("data-morph-sig");
  if (oldSig && newSig && oldSig === newSig) return true;

  // Layer 4: Semantic role
  const oldRole = inferSemanticRole(oldEl);
  const newRole = inferSemanticRole(newEl);
  if (oldRole && newRole && oldRole === newRole) return true;

  // Layer 5: Soft match (tag + position)
  return oldEl.tagName === newEl.tagName;
}
```

This layered approach provides multiple opportunities for correct matching before falling back to positional guessing.

---

## Appendix: Hash Function for Signatures

```javascript
// Fast, non-cryptographic hash for content signatures
// Uses djb2 algorithm — simple, fast, good distribution

function shortHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

// Usage:
shortHash("DIV:class=card|data-id=123:Hello World");
// Returns something like "a3f9x2k1"
```

---

## References

- [Idiomorph GitHub](https://github.com/bigskysoftware/idiomorph)
- [morphdom GitHub](https://github.com/patrick-steele-idem/morphdom)
- [Zhang-Shasha Tree Edit Distance](https://epubs.siam.org/doi/10.1137/0218082)
- [APTED Algorithm](https://github.com/DatabaseGroup/apted)
- [React Reconciliation](https://reactjs.org/docs/reconciliation.html)
