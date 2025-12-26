# Idiomorph + Hyperclay Integration Ideas

Ideas for improving Idiomorph or our usage of it for Hyperclay's live-sync and save system.

---

## 1. Use `afterHeadMorphed` for Script Detection

Idiomorph already provides an `afterHeadMorphed` callback that receives `{added, kept, removed}`. We can use this to detect script changes without writing our own comparison logic.

```javascript
Idiomorph.morph(document.documentElement, newHtml, {
  head: {
    afterHeadMorphed(headEl, { added, kept, removed }) {
      const scriptsAdded = added.filter(n => n.tagName === 'SCRIPT');
      const scriptsRemoved = removed.filter(n => n.tagName === 'SCRIPT');

      if (scriptsAdded.length || scriptsRemoved.length) {
        showRefreshNotice();
      }
    }
  }
});
```

**Why:** Idiomorph already tracks what changed. We just need to filter for scripts.

---

## 2. Add Native `ignoreSelector` Option

Currently we'd need to use callbacks to skip elements. A native option would be cleaner:

```javascript
Idiomorph.morph(oldEl, newEl, {
  ignoreSelector: '[save-ignore], [data-local-only]'
});
```

**Why:** Hyperclay has `save-ignore` elements (admin toolbars, popovers) that shouldn't be morphed. A declarative option is simpler than callbacks.

---

## 3. Use `im-preserve` for Local Admin UI

Idiomorph already has `im-preserve="true"` which keeps elements even if they're not in the new content. We could mark local admin UI with this:

```html
<div class="color-picker-popover" im-preserve="true" save-ignore>
  <!-- This stays even if the synced content doesn't have it -->
</div>
```

**Why:** Prevents other admins' syncs from removing your open modals/popovers.

---

## 4. Dry-Run Mode for Diff Reports

Add a mode that returns what would change without actually changing it:

```javascript
const diff = Idiomorph.diff(oldEl, newEl);
// Returns: { added: [...], removed: [...], morphed: [...], attributes: [...] }
```

**Why:** Hyperclay could show users what changed before applying, or use this for smarter head-change detection.

---

## 5. Use `head.block` to Wait for Stylesheets

Idiomorph has a `head.block` option that waits for new stylesheets/scripts to load before morphing the body. We should enable this:

```javascript
Idiomorph.morph(document.documentElement, newHtml, {
  head: {
    style: 'merge',
    block: true  // Wait for new CSS to load before morphing body
  }
});
```

**Why:** Prevents flash of unstyled content when CSS changes during live-sync.

---

## 6. Extend `ignoreActiveValue` to Contenteditable

Idiomorph has `ignoreActiveValue` for inputs/textareas. Hyperclay also uses contenteditable divs. We could extend this:

```javascript
Idiomorph.morph(oldEl, newEl, {
  ignoreActiveValue: true,
  ignoreActiveContentEditable: true  // New option
});
```

**Why:** If Admin A is typing in a contenteditable region, Admin B's sync shouldn't interrupt them.

---

## 7. Custom ID Attribute for Matching

Idiomorph matches by `id` attribute. Hyperclay uses `data-id` in some places. We could support custom ID attributes:

```javascript
Idiomorph.morph(oldEl, newEl, {
  idAttribute: 'data-id'  // or ['id', 'data-id']
});
```

**Why:** Better matching for dynamically generated components that use data-id instead of id.

---

## 8. Element-Specific Morph Strategies

Different element types might need different handling:

```javascript
Idiomorph.morph(oldEl, newEl, {
  strategies: {
    'SCRIPT': 'skip',      // Never morph scripts
    'STYLE': 'replace',    // Replace entirely, don't merge
    'IFRAME': 'preserve',  // Never touch iframes
    'VIDEO': 'preserve',   // Don't interrupt video playback
  }
});
```

**Why:** Hyperclay has media elements, embeds, and scripts that need special handling.

---

## 9. `beforeMorph` Hook for Preparation

A hook that runs once before any morphing starts, receiving both trees:

```javascript
Idiomorph.morph(oldEl, newEl, {
  callbacks: {
    beforeMorph(oldRoot, newRoot, ctx) {
      // Prepare both trees before morphing
      // Could strip certain elements, add markers, etc.
    }
  }
});
```

**Why:** Hyperclay could use this to strip `save-ignore` from incoming content before Idiomorph sees it.

---

## 10. Morph Subtree Only

Ability to morph just a subtree without affecting the rest:

```javascript
// Only morph the main content area
Idiomorph.morph(
  document.querySelector('main'),
  newDoc.querySelector('main'),
  { morphStyle: 'innerHTML' }
);
```

This already works, but we should use it more. Currently live-sync morphs the entire body.

**Why:** More targeted morphing = less chance of disrupting other parts of the UI.

---

## 11. Animation-Aware Removal

Wait for CSS transitions/animations to complete before removing elements:

```javascript
Idiomorph.morph(oldEl, newEl, {
  animateRemovals: true,  // Waits for 'transitionend' before removing
  removalDelay: 300       // Or just a fixed delay
});
```

**Why:** Smooth transitions when sections are removed during live-sync.

---

## 12. Morph Events for External Listeners

Dispatch custom events during morph so other code can react:

```javascript
// Idiomorph would dispatch:
// - 'idiomorph:beforeMorph' on document
// - 'idiomorph:nodeAdded' on the added node
// - 'idiomorph:nodeMorphed' on the morphed node
// - 'idiomorph:nodeRemoved' on the removed node's parent
// - 'idiomorph:afterMorph' on document

document.addEventListener('idiomorph:nodeAdded', (e) => {
  // Re-initialize any components in the new node
  initComponents(e.target);
});
```

**Why:** Hyperclay components might need to reinitialize after being morphed in. Events are cleaner than callbacks.

---

## Quick Wins (Can Do Now)

1. **Use `afterHeadMorphed`** — Already exists, just need to wire it up
2. **Use `im-preserve`** — Already exists, just add to our admin UI elements
3. **Use `head.block: true`** — Already exists, prevents FOUC
4. **Use callbacks for script detection** — Already exists, we explored this

## Medium Effort (Modify Idiomorph)

5. **Add `ignoreSelector`** — New option, moderate code change
6. **Extend `ignoreActiveValue` to contenteditable** — Small code change
7. **Custom ID attribute** — Small code change

## Larger Features (Future)

8. **Dry-run diff mode** — Significant new feature
9. **Element-specific strategies** — New config structure
10. **Animation-aware removal** — Async complexity
11. **Morph events** — Would need to integrate with component systems
12. **beforeMorph hook** — New callback type
