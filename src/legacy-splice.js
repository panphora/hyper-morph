/**
 * legacy-splice.js — findChangedRoots and spliceProtected, kept verbatim from
 * 0.5.x until ClayJS moves to mergeDocument. See docs/rewrite-plan.md 5.1.
 */

//=============================================================================
// Protected splice: findChangedRoots + spliceProtected
//
// Scoped live sync's shared core. findChangedRoots walks two SAME-DOMAIN
// trees (a local capture vs the last-synced/last-saved base) and returns the
// minimal disjoint set of local changes. spliceProtected patches those local
// changes into an incoming parsed document so a subsequent normal morph
// cannot clobber them. Pure tree logic: serialization domains, capture
// pipelines, and identity maps are the caller's business, supplied via
// options (skip / ignoreAttr / tiers).
//=============================================================================

// Sibling/doc index slot marking a tier value that appears more than once on
// one side. A duplicated value identifies nothing, so it is disabled at that
// tier (mirrors createPersistentIds' duplicate discipline).
const DUPLICATE_KEY = Symbol("hyper-morph-duplicate-key");

const DEFAULT_TIERS = [
  (el) => el.getAttribute("data-id"),
  (el) => el.getAttribute("id"),
];

/**
 * Build one Map per tier over a set of elements: value -> element, with
 * duplicated values collapsed to DUPLICATE_KEY.
 * @param {Iterable<Element>} els
 * @param {Array<function(Element): (string|null)>} tiers
 * @returns {Map<string, Element|Symbol>[]}
 */
function buildTierIndex(els, tiers) {
  return tiers.map((tierOf) => {
    const map = new Map();
    for (const el of els) {
      if (el.nodeType !== 1) continue;
      const v = tierOf(el);
      if (v == null || v === "") continue;
      map.set(v, map.has(v) ? DUPLICATE_KEY : el);
    }
    return map;
  });
}

/**
 * Same-tier, both-sides-unique identity match: the first tier whose value
 * uniquely names `el` on its own side AND uniquely names a same-tag element
 * on the other side wins. A value present on one side but duplicated or
 * tag-mismatched on the other disables that tier and the next tier is tried.
 * @param {Element} el
 * @param {Map[]} ownIndex - tier index over el's own side
 * @param {Map[]} otherIndex - tier index over the other side
 * @param {Array<function>} tiers
 * @returns {Element|null}
 */
function matchByTiers(el, ownIndex, otherIndex, tiers) {
  for (let t = 0; t < tiers.length; t++) {
    const v = tiers[t](el);
    if (v == null || v === "") continue;
    if (ownIndex[t].get(v) !== el) continue;
    const hit = otherIndex[t].get(v);
    if (!hit || hit === DUPLICATE_KEY) continue;
    if (hit.tagName !== el.tagName) continue;
    return hit;
  }
  return null;
}

/**
 * True when some tier value uniquely names `el` on its own side — the
 * precondition for the splice to place it in a foreign tree.
 */
function hasUsableKey(el, ownIndex, tiers) {
  for (let t = 0; t < tiers.length; t++) {
    const v = tiers[t](el);
    if (v == null || v === "") continue;
    if (ownIndex[t].get(v) === el) return true;
  }
  return false;
}

/**
 * Diff two same-domain trees and return the minimal disjoint set of local
 * changes as entries:
 *   { type: 'subtree',  el, base } - local element whose whole subtree must
 *     survive; `base` is its counterpart in the base tree, null when the
 *     element is locally new
 *   { type: 'attrs',    el, names, base } - only these attributes changed
 *     locally; `base` is the element's base-tree counterpart
 *   { type: 'deletion', el }  - BASE element the local side deleted
 *   { type: 'head',     el }  - local <head> differs (always one region)
 *
 * Both roots must be same-domain <html> elements (or any corresponding
 * element pair). An empty entries array means the local tree matches base.
 *
 * @param {Element} localRoot
 * @param {Element} baseRoot
 * @param {object} [options]
 * @param {function(Element): boolean} [options.skip] - subtrees excluded from
 *   both sides of the walk (per-tab chrome that legitimately diverges)
 * @param {function(Element, string): boolean} [options.ignoreAttr] -
 *   attributes excluded from comparison (tab-local root attrs)
 * @param {Array<function(Element): (string|null)>} [options.tiers] - identity
 *   tiers for child alignment; MUST be the same tiers the splice uses
 * @returns {{ entries: Array<object> }}
 */
function findChangedRoots(localRoot, baseRoot, options = {}) {
  const skip = options.skip || (() => false);
  const ignoreAttr = options.ignoreAttr || (() => false);
  const tiers =
    options.tiers && options.tiers.length ? options.tiers : DEFAULT_TIERS;

  // Doc-level index over the local tree, built lazily on the first dirty
  // root: promotion decisions must use the same identity scope the splice
  // resolves against (the whole tree), not sibling-level uniqueness.
  let localDocIndex = null;
  function localIndex() {
    if (!localDocIndex) {
      localDocIndex = buildTierIndex(
        [localRoot, ...localRoot.querySelectorAll("*")],
        tiers,
      );
    }
    return localDocIndex;
  }

  let baseDocIndex = null;
  function baseIndex() {
    if (!baseDocIndex) {
      baseDocIndex = buildTierIndex(
        [baseRoot, ...baseRoot.querySelectorAll("*")],
        tiers,
      );
    }
    return baseDocIndex;
  }

  // html / body / head: addressable without keys, and the promotion ceiling.
  function isStructural(el) {
    return !el.parentElement || !el.parentElement.parentElement;
  }

  // A dirty subtree entry is only worth emitting where the splice can
  // address it. A keyless dirty root promotes to its parent instead
  // (returns true), bubbling until a keyed or structural ancestor.
  //
  // `base` is the element's counterpart in the base tree (null when the
  // element is locally new). The splice needs it to arbitrate the
  // no-counterpart case: an element whose own key does not resolve in the
  // target may still exist there under its BASE identity (the key was added
  // locally), and inserting without that check duplicates sections.
  function emitOrPromote(el, base, out) {
    if (isStructural(el) || hasUsableKey(el, localIndex(), tiers)) {
      out.push({ type: "subtree", el, base });
      return false;
    }
    return true;
  }

  function diffAttrNames(localEl, baseEl) {
    const names = [];
    for (const attr of localEl.attributes) {
      if (ignoreAttr(localEl, attr.name)) continue;
      if (baseEl.getAttribute(attr.name) !== attr.value) names.push(attr.name);
    }
    for (const attr of baseEl.attributes) {
      if (ignoreAttr(localEl, attr.name)) continue;
      if (!localEl.hasAttribute(attr.name)) names.push(attr.name);
    }
    return names;
  }

  // Children that participate in the diff: elements not skipped, plus text
  // runs and comment nodes. Adjacent text nodes coalesce into one synthetic
  // run: the local side is a live-DOM clone whose text is split by typing,
  // pasting and IME, while the base side is a parsed string whose text is
  // coalesced by the parser — comparing raw nodes reads byte-identical
  // trees as dirty. Runs also merge ACROSS skipped elements, because a
  // skipped element present on one side only would otherwise split the run
  // on that side alone.
  function comparableChildren(el) {
    const kids = [];
    let textRun = null;
    const flushText = () => {
      if (textRun !== null) {
        kids.push({ nodeType: 3, nodeValue: textRun });
        textRun = null;
      }
    };
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        textRun = (textRun === null ? "" : textRun) + node.nodeValue;
        continue;
      }
      if (node.nodeType === 1 && skip(node)) continue;
      flushText();
      if (node.nodeType === 1 || node.nodeType === 8) kids.push(node);
    }
    flushText();
    return kids;
  }

  // Lockstep pairing precondition: same node type; elements need the same
  // tag and no tier where both sides carry DIFFERENT values (same value or
  // one side absent is fine — an added identity attr is an attr edit).
  function lockstepCompatible(l, b) {
    if (l.nodeType !== b.nodeType) return false;
    if (l.nodeType !== 1) return true;
    if (l.tagName !== b.tagName) return false;
    for (const tierOf of tiers) {
      const lv = tierOf(l);
      const bv = tierOf(b);
      if (lv != null && lv !== "" && bv != null && bv !== "" && lv !== bv)
        return false;
    }
    return true;
  }

  // Non-element content that matters during keyed (non-lockstep) analysis:
  // whitespace-only text between moved/added elements is layout, not state.
  function significantText(kids) {
    let out = "";
    for (const node of kids) {
      if (node.nodeType === 3 && node.nodeValue.trim() !== "")
        out += "\0" + node.nodeValue;
      else if (node.nodeType === 8) out += "" + node.nodeValue;
    }
    return out;
  }

  /**
   * Diff the children of a corresponding pair, writing entries into `out`.
   * Returns true when the pair itself must be promoted to one dirty subtree
   * (text edited, ambiguous keyless structure, or locally reordered keys).
   */
  function diffChildren(localEl, baseEl, out) {
    const L = comparableChildren(localEl);
    const B = comparableChildren(baseEl);

    // Fast path: strict lockstep. Covers the overwhelmingly common case of
    // "same shape, something inside changed".
    if (L.length === B.length) {
      let lockstep = true;
      for (let i = 0; i < L.length; i++) {
        if (!lockstepCompatible(L[i], B[i])) {
          lockstep = false;
          break;
        }
      }
      if (lockstep) {
        for (let i = 0; i < L.length; i++) {
          const l = L[i];
          if (l.nodeType === 1) {
            if (diffPair(l, B[i], out)) return true;
          } else if (l.nodeValue !== B[i].nodeValue) {
            // A text/comment edit dirties the nearest containing element.
            return true;
          }
        }
        return false;
      }
    }

    // Keyed analysis: shapes differ. Elements align by identity; the
    // keyless remainder aligns positionally only when unambiguous.
    const elL = L.filter((n) => n.nodeType === 1);
    const elB = B.filter((n) => n.nodeType === 1);

    if (significantText(L) !== significantText(B)) return true;

    const idxL = buildTierIndex(elL, tiers);
    const idxB = buildTierIndex(elB, tiers);

    const pairs = [];
    const matchedB = new Set();
    const unmatchedL = [];
    for (const l of elL) {
      const b = matchByTiers(l, idxL, idxB, tiers);
      if (b && !matchedB.has(b)) {
        pairs.push([l, b]);
        matchedB.add(b);
      } else {
        unmatchedL.push(l);
      }
    }

    const keylessL = [];
    for (const l of unmatchedL) {
      if (hasUsableKey(l, idxL, tiers)) {
        // Identified locally, absent from base: locally new (or moved in).
        out.push({ type: "subtree", el: l, base: null });
      } else {
        keylessL.push(l);
      }
    }

    const keylessB = [];
    for (const b of elB) {
      if (matchedB.has(b)) continue;
      if (hasUsableKey(b, idxB, tiers)) {
        // Identified in base, absent locally: locally deleted.
        out.push({ type: "deletion", el: b });
      } else {
        keylessB.push(b);
      }
    }

    // Keyless remainders pair positionally only when the runs line up
    // one-to-one by tag. Anything murkier promotes the parent: guessing
    // here is how sections get duplicated.
    if (keylessL.length !== keylessB.length) return true;
    for (let i = 0; i < keylessL.length; i++) {
      if (!lockstepCompatible(keylessL[i], keylessB[i])) return true;
    }

    // A local reorder of paired children is local state (drag-sorted
    // lists). It cannot be expressed as a subtree entry on any child, so
    // the parent is promoted wholesale. The check runs over the COMBINED
    // sequence — keyed pairs interleaved with positionally-paired keyless
    // runs — because a single keyed element moved past keyless siblings
    // produces no keyed-pair inversion at all, and reporting that page
    // clean would let a full morph revert the move and then record the
    // reverted state as saved.
    const baseOf = new Map(pairs);
    for (let i = 0; i < keylessL.length; i++) {
      baseOf.set(keylessL[i], keylessB[i]);
    }
    let lastBasePos = -1;
    for (const l of elL) {
      const b = baseOf.get(l);
      if (!b) continue; // locally new: no base position to violate
      const pos = elB.indexOf(b);
      if (pos < lastBasePos) return true;
      lastBasePos = pos;
    }

    for (let i = 0; i < keylessL.length; i++) {
      if (diffPair(keylessL[i], keylessB[i], out)) return true;
    }
    for (const [l, b] of pairs) {
      if (diffPair(l, b, out)) return true;
    }
    return false;
  }

  /**
   * Diff a corresponding element pair into `out`. Child entries buffer
   * locally so a late promotion discards them instead of double-reporting.
   * Returns true when this pair's change must promote into the PARENT
   * (the local element is dirty but keyless, so the splice couldn't
   * address it — see emitOrPromote).
   */
  function diffPair(localEl, baseEl, out) {
    if (localEl.tagName !== baseEl.tagName) {
      return emitOrPromote(localEl, baseEl, out);
    }
    const names = diffAttrNames(localEl, baseEl);
    const buf = [];
    if (diffChildren(localEl, baseEl, buf)) {
      return emitOrPromote(localEl, baseEl, out);
    }
    if (names.length) {
      // An attr edit is splice-addressable only through the element's
      // SAVED identity: the incoming doc carries the remote's identity,
      // which matches the base side, never a locally-added key. Without a
      // usable base key the entry would be silently dropped as
      // skippedAttrs even though the element survives remotely, so the
      // edit promotes into the parent to be protected as a subtree.
      if (!isStructural(localEl) && !hasUsableKey(baseEl, baseIndex(), tiers)) {
        return true;
      }
      out.push({ type: "attrs", el: localEl, names, base: baseEl });
    }
    out.push(...buf);
    return false;
  }

  const entries = [];

  const rootNames = diffAttrNames(localRoot, baseRoot);
  if (rootNames.length)
    entries.push({ type: "attrs", el: localRoot, names: rootNames });

  const childOf = (root, tag) =>
    Array.from(root.children).find((c) => c.tagName === tag) || null;

  // <head> is one region: any difference inside it yields one head entry,
  // because partial head protection can't be expressed without duplicating
  // signature-bucketed head elements.
  const localHead = childOf(localRoot, "HEAD");
  const baseHead = childOf(baseRoot, "HEAD");
  if (localHead && baseHead) {
    const headBuf = [];
    diffPair(localHead, baseHead, headBuf);
    if (headBuf.length) entries.push({ type: "head", el: localHead });
  } else if (localHead || baseHead) {
    if (localHead) entries.push({ type: "head", el: localHead });
  }

  const localBody = childOf(localRoot, "BODY");
  const baseBody = childOf(baseRoot, "BODY");
  if (localBody && baseBody) {
    diffPair(localBody, baseBody, entries);
  } else if (localBody) {
    entries.push({ type: "subtree", el: localBody, base: null });
  }

  return { entries };
}

/**
 * Patch local changes (entries from findChangedRoots) into an incoming
 * parsed document, in place. After a successful splice, a normal full
 * morph of targetDoc applies the incoming content everywhere EXCEPT the
 * regions the local side changed.
 *
 * Conflict policy: edits beat deletes (a locally-edited section a remote
 * deleted is reinserted); local deletions beat remote edits to the deleted
 * section; a dirty root that cannot be identified or placed holds the WHOLE
 * frame back ({ ok: false }) — the caller must then apply nothing.
 *
 * @param {Document} targetDoc - parsed incoming document (mutated)
 * @param {Array<object>} entries
 * @param {object} [options]
 * @param {Array<function(Element): (string|null)>} [options.tiers] - the
 *   same identity tiers findChangedRoots used
 * @returns {{ ok: boolean, placed: Array<{entry: object, imported: Element}>,
 *   held: object|null, skippedAttrs: number }}
 */
function spliceProtected(targetDoc, entries, options = {}) {
  const tiers =
    options.tiers && options.tiers.length ? options.tiers : DEFAULT_TIERS;
  const targetRoot = targetDoc.documentElement;
  const placed = [];
  let skippedAttrs = 0;

  const hold = (entry) => ({ ok: false, placed, held: entry, skippedAttrs });

  if (!targetRoot) return hold(null);

  function indexOver(root) {
    const all = [root, ...root.querySelectorAll("*")];
    return buildTierIndex(all, tiers);
  }

  const targetIndex = indexOver(targetRoot);

  // Per-source-tree indexes for the entries' own sides (subtree/attrs/head
  // entries hold local-capture nodes; deletion entries hold base nodes).
  const sideIndexes = new Map();
  const sideIndexFor = (el) => {
    const root = el.getRootNode();
    let idx = sideIndexes.get(root);
    if (!idx) {
      const rootEl = root.nodeType === 9 ? root.documentElement : root;
      idx = indexOver(rootEl);
      sideIndexes.set(root, idx);
    }
    return idx;
  };

  // html/body/head are addressable without keys; everything else resolves
  // through the tiers.
  function structuralTarget(el) {
    if (!el.parentElement && el.tagName === "HTML") return targetRoot;
    if (
      el.parentElement &&
      !el.parentElement.parentElement &&
      el.parentElement.tagName === "HTML"
    ) {
      if (el.tagName === "BODY") return targetDoc.body || null;
      if (el.tagName === "HEAD") return targetDoc.head || null;
    }
    return null;
  }

  function resolve(el) {
    const structural = structuralTarget(el);
    if (structural) return structural;
    return matchByTiers(el, sideIndexFor(el), targetIndex, tiers);
  }

  // A tier match can name a node an earlier entry already detached (a
  // deletion removed it, or a placed subtree replaced it). Operating on a
  // detached node is a silent no-op — replaceWith on a parentless element
  // drops the entry from the merge entirely — so only nodes still in the
  // target document count as counterparts.
  function resolveLive(el) {
    if (!el) return null;
    const match = resolve(el);
    return match && match.isConnected ? match : null;
  }

  function register(imported) {
    for (let t = 0; t < tiers.length; t++) {
      const v = tiers[t](imported);
      if (v != null && v !== "") targetIndex[t].set(v, imported);
    }
  }

  // Local deletions first: they only remove, so they can't invalidate a
  // later entry's anchor (anchors resolve from the local tree, where the
  // deleted element does not exist).
  for (const entry of entries) {
    if (entry.type !== "deletion") continue;
    const counterpart = resolve(entry.el);
    if (counterpart && counterpart !== targetRoot) counterpart.remove();
  }

  const rest = entries
    .filter((e) => e.type !== "deletion")
    .sort((a, b) => {
      if (a.el === b.el) return 0;
      const pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

  for (const entry of rest) {
    if (entry.type === "head") {
      const imported = targetDoc.importNode(entry.el, true);
      if (targetDoc.head) {
        targetDoc.head.replaceWith(imported);
      } else {
        targetRoot.insertBefore(imported, targetRoot.firstChild);
      }
      placed.push({ entry, imported });
      continue;
    }

    if (entry.type === "attrs") {
      // The element's own identity may have been edited locally (a changed
      // id is itself an attr entry), so its BASE identity — what the
      // incoming doc still carries — is tried as a fallback.
      const counterpart = resolveLive(entry.el) || resolveLive(entry.base);
      if (!counterpart) {
        // The element is gone remotely and the only local change was an
        // attribute: reinserting the subtree would resurrect stale content,
        // so the remote delete wins and the attribute edit is dropped.
        skippedAttrs++;
        continue;
      }
      for (const name of entry.names) {
        if (entry.el.hasAttribute(name)) {
          counterpart.setAttribute(name, entry.el.getAttribute(name));
        } else {
          counterpart.removeAttribute(name);
        }
      }
      continue;
    }

    // subtree
    const el = entry.el;

    // A whole-document dirty root is not a splice, it's a hold: silently
    // replacing the entire incoming document defeats the sync.
    if (structuralTarget(el)) return hold(entry);

    const counterpart = resolveLive(el) || resolveLive(entry.base);
    if (counterpart) {
      const imported = targetDoc.importNode(el, true);
      counterpart.replaceWith(imported);
      register(imported);
      placed.push({ entry, imported });
      continue;
    }

    // No counterpart, under either identity. Three cases:
    // - Locally new (base == null): insert at the local position.
    // - Existed before under a usable identity (base keyed) the target no
    //   longer contains: the remote deleted it; edits beat deletes, so it
    //   reinserts.
    // - Existed before but never addressably (base keyless — its only
    //   identity was added locally, unsaved): the target may still contain
    //   it somewhere this splice cannot see, and inserting would duplicate
    //   the section on disk. The frame holds instead; the tab keeps its
    //   local state and converges through its own save.
    if (
      entry.base != null &&
      !hasUsableKey(entry.base, sideIndexFor(entry.base), tiers)
    ) {
      return hold(entry);
    }
    if (!hasUsableKey(el, sideIndexFor(el), tiers)) return hold(entry);

    const parentEl = el.parentElement;
    if (!parentEl) return hold(entry);
    const parentC = resolveLive(parentEl);
    if (!parentC) return hold(entry);

    let anchor = null;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      const c = resolveLive(s);
      if (c && c.parentNode === parentC) {
        anchor = c;
        break;
      }
    }

    const imported = targetDoc.importNode(el, true);
    if (anchor) {
      parentC.insertBefore(imported, anchor.nextSibling);
    } else {
      // No identified preceding sibling: fall back to the local child
      // index, so an element appended at the end of a keyless run lands
      // at the end, not the front.
      const idx = Array.prototype.indexOf.call(parentEl.children, el);
      parentC.insertBefore(imported, parentC.children[idx] || null);
    }
    register(imported);
    placed.push({ entry, imported });
  }

  return { ok: true, placed, held: null, skippedAttrs };
}

export { findChangedRoots, spliceProtected };
