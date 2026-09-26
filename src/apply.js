/**
 * apply.js — make a live tree match a merged tree, keeping live nodes.
 *
 * Every merged node carries provenance naming the local node(s) it came
 * from; `toLive` maps those to live nodes. Apply therefore never searches:
 * a merged element with a live twin is moved into place and updated, one
 * without is inserted as an inert clone, and live nodes nothing claimed are
 * removed in a final pass after every move has happened.
 */

import { makeInertScript, isHtmlScript } from "./scripts.js";
import { merge3Text } from "./text-merge.js";

const XHTML = "http://www.w3.org/1999/xhtml";
const FORM_TAGS = new Set(["INPUT", "OPTION", "TEXTAREA"]);

/**
 * @typedef {object} ApplyOptions
 * @property {(n: Node) => Node | null} toLive
 * @property {(n: Node) => boolean} ignored
 * @property {"attribute" | "property"} formState
 * @property {boolean | "subtree"} protectFocusedValue
 * @property {boolean} [restoreFocus]
 * @property {object} hooks
 * @property {boolean} [childrenOnly]
 */

/**
 * @param {Element} liveRoot
 * @param {Element} mergedRoot
 * @param {import("./merge.js").MergeResult} result
 * @param {ApplyOptions} o
 */
export function apply(liveRoot, mergedRoot, result, o) {
  const doc = liveRoot.ownerDocument;
  const { provenance, textMappers } = result;
  const hooks = o.hooks;
  const applied = [];
  const moved = [],
    replaced = [];
  const claimed = new Set();
  const leftovers = [];
  const identities = [];
  const mergedScriptsLive = new Set();
  const heldBy = new Map(); // merged text node -> live text node holding its text

  const inRoot = (n) =>
    !!n &&
    (n === liveRoot ||
      liveRoot.contains(n) ||
      (liveRoot.nodeType === 1 &&
        liveRoot.tagName === "TEMPLATE" &&
        liveRoot.content.contains(n)));

  // Pre-pass: resolve every merged node's live twin(s) once.
  const liveOf = new Map(); // merged node -> live node (element, or first text node of a run)
  const runOf = new Map(); // merged text node -> live text nodes of its run
  // live text node -> { merged, shift } for a run merged whole, or a list of
  // { merged, from, to, flatStart } when an inline merge spread the node's
  // characters over several output nodes (provenance.caret).
  const liveTextInfo = new Map();
  (function resolve(m) {
    const p = provenance.get(m);
    if (p) {
      if (m.nodeType === 1) {
        const lv = p.local ? o.toLive(p.local) : null;
        if (lv && inRoot(lv) && lv.nodeType === 1) liveOf.set(m, lv);
      } else if (Array.isArray(p.local)) {
        const nodes = p.local
          .map((n) => o.toLive(n))
          .filter((n) => n && inRoot(n) && n.nodeType === m.nodeType);
        if (nodes.length) {
          liveOf.set(m, nodes[0]);
          runOf.set(m, nodes);
        }
        if (Array.isArray(p.caret)) {
          for (const c of p.caret) {
            const n = o.toLive(c.node);
            if (!n || !inRoot(n) || n.nodeType !== 3) continue;
            let list = liveTextInfo.get(n);
            if (!Array.isArray(list)) liveTextInfo.set(n, (list = []));
            list.push({
              merged: m,
              from: c.from,
              to: c.to,
              flatStart: c.flatStart,
            });
          }
        } else {
          let shift = 0;
          for (const n of nodes) {
            liveTextInfo.set(n, { merged: m, shift });
            shift += n.nodeValue.length;
          }
        }
      }
    }
    const kids =
      m.nodeType === 1 && m.tagName === "TEMPLATE" && m.content
        ? m.content.childNodes
        : m.childNodes;
    for (const c of kids) resolve(c);
  })(mergedRoot);

  const liveTwins = new Set();
  for (const lv of liveOf.values()) liveTwins.add(lv);
  for (const nodes of runOf.values()) for (const n of nodes) liveTwins.add(n);

  const focus =
    o.restoreFocus === false ? null : captureFocus(doc, liveTextInfo);

  if (o.childrenOnly) applyChildren(liveRoot, mergedRoot);
  else applyElement(liveRoot, mergedRoot);

  // Final pass: remove what nothing claimed.
  for (const { node, parent } of leftovers) {
    if (claimed.has(node) || !node.parentNode) continue;
    if (node.nodeType === 1 && (o.ignored(node) || preserved(node))) continue;
    removeNode(node, parent);
  }

  restoreFocus(doc, focus, liveTextInfo, textMappers, runOf, heldBy);

  return { applied, moved, replaced, identities, mergedScriptsLive, liveOf };

  // -------------------------------------------------------------------
  function applyElement(liveEl, mergedEl) {
    claimed.add(liveEl);
    const p = provenance.get(mergedEl);
    if (p && p.remote && result.remoteIdOf) {
      const id = result.remoteIdOf(p.remote);
      if (id) identities.push([liveEl, id]);
    }
    if (p && p.unchanged) {
      // Identical markup on every side. Two things can still differ below
      // it: identities (owed only when the caller supplied an identity of
      // its own) and form state, which lives in properties the comparison
      // never sees (a value set by script on a built node, property mode).
      if (result.customIdentity && p.remote) adoptLockstep(liveEl, p.remote);
      if (p.remote) syncFormStateDeep(liveEl, p.remote);
      return;
    }
    if (hooks.beforeNodeMorphed(liveEl, mergedEl) === false) return;
    syncAttributes(liveEl, mergedEl);
    const tag = liveEl.tagName;
    if (isHtmlScript(liveEl)) {
      if (liveEl.textContent !== mergedEl.textContent) {
        applied.push({
          kind: "text",
          node: liveEl,
          before: liveEl.textContent,
          after: mergedEl.textContent,
        });
        liveEl.textContent = mergedEl.textContent;
      }
      if (result.mergedScripts.has(mergedEl)) mergedScriptsLive.add(liveEl);
    } else if (tag === "TEXTAREA") {
      syncTextarea(liveEl, mergedEl, p);
    } else {
      syncFormState(liveEl, mergedEl, p);
      const lt = tag === "TEMPLATE" && liveEl.content ? liveEl.content : liveEl;
      const mt =
        tag === "TEMPLATE" && mergedEl.content ? mergedEl.content : mergedEl;
      if (
        o.protectFocusedValue === "subtree" &&
        isFocused(liveEl) &&
        liveEl !== doc.body
      )
        claimSubtree(lt);
      else applyChildren(lt, mt);
    }
    hooks.afterNodeMorphed(liveEl, mergedEl);
  }

  // The focused element's children are left as they are: claimed, so no
  // other parent pulls one out and the final pass removes none.
  function claimSubtree(parent) {
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      claimed.add(c);
      if (c.nodeType === 1) claimSubtree(c);
    }
  }

  function applyChildren(liveParent, mergedParent) {
    let cursor = nextUsable(liveParent.firstChild);
    const seenHere = new Set();
    for (const m of Array.from(mergedParent.childNodes)) {
      let lv = liveOf.get(m);
      if (lv && claimed.has(lv) && !seenHere.has(lv)) lv = null; // claimed by another parent already
      const pv = provenance.get(m);
      if (pv && pv.pinned) {
        // An ignored live element the inline merge placed: it keeps its
        // offset in the text and is never synced.
        if (lv && lv.nodeType === 1) {
          if (
            lv.parentNode !== liveParent ||
            nextUsable(lv.nextSibling) !== cursor
          )
            moveBefore(liveParent, lv, cursor);
          claimed.add(lv);
          seenHere.add(lv);
        }
        continue;
      }
      if (lv && lv.nodeType === 1) {
        if (lv !== cursor) {
          const from = lv.parentNode;
          if (from === liveParent && cursor && holdsFocus(lv)) {
            // A same-parent reorder of the node holding focus: moving it
            // drops the selection (moveBefore) or the focus itself
            // (insertBefore), so the unplaced siblings before it step past
            // it instead. Same final order, focus untouched.
            const after = lv.nextSibling;
            for (let n = cursor; n && n !== lv; ) {
              const next = n.nextSibling;
              moveBefore(liveParent, n, after);
              n = next;
            }
          } else {
            moveBefore(liveParent, lv, cursor);
            if (from !== liveParent) {
              moved.push(lv);
              applied.push({ kind: "move", el: lv, from, to: liveParent });
            }
          }
        }
        seenHere.add(lv);
        applyElement(lv, m);
        cursor = nextUsable(lv.nextSibling);
        continue;
      }
      if (lv && lv.nodeType !== 1) {
        // Text or comment run: reuse the first live member, drop the rest.
        const run = runOf.get(m) || [lv];
        if (lv !== cursor) moveBefore(liveParent, lv, cursor);
        let text = m.nodeValue;
        if (m.nodeType === 3) {
          // Typing landed after the snapshot: merge it in.
          const snapshotValue = provenanceLocalValue(m);
          const current = run.map((n) => n.nodeValue).join("");
          if (snapshotValue != null && current !== snapshotValue) {
            text = merge3Text(snapshotValue, current, m.nodeValue).text;
          }
        }
        if (hooks.beforeNodeMorphed(lv, m) !== false) {
          if (lv.nodeValue !== text) {
            applied.push({
              kind: "text",
              node: lv,
              before: lv.nodeValue,
              after: text,
            });
            lv.nodeValue = text;
          }
          hooks.afterNodeMorphed(lv, m);
        }
        claimed.add(lv);
        seenHere.add(lv);
        heldBy.set(m, lv);
        cursor = nextUsable(lv.nextSibling);
        continue;
      }
      // No live twin: a text node may reuse an unclaimed live text node at the cursor.
      if (
        m.nodeType === 3 &&
        cursor &&
        cursor.nodeType === 3 &&
        !claimed.has(cursor) &&
        !liveTextInfo.has(cursor)
      ) {
        if (cursor.nodeValue !== m.nodeValue) {
          applied.push({
            kind: "text",
            node: cursor,
            before: cursor.nodeValue,
            after: m.nodeValue,
          });
          cursor.nodeValue = m.nodeValue;
        }
        claimed.add(cursor);
        heldBy.set(m, cursor);
        cursor = nextUsable(cursor.nextSibling);
        continue;
      }
      // Insert a full inert copy, then graft: descendants of a new element
      // may still have live twins (an element moved into a new wrapper, a
      // wrapper whose tag changed), and those replace their cloned stand-ins
      // once the copy is connected, so moveBefore can keep their state.
      // An unchanged subtree carries no children in the merged tree; when
      // its live twin is unavailable, clone the remote original instead.
      const pm = provenance.get(m);
      const clone = deepInert(pm && pm.unchanged && pm.remote ? pm.remote : m);
      if (hooks.beforeNodeAdded(clone) === false) continue;
      liveParent.insertBefore(clone, cursor);
      claimed.add(clone);
      if (clone.nodeType === 3) heldBy.set(m, clone);
      if (clone.nodeType === 1) {
        replaced.push(clone);
        recordIdentities(clone, m);
        if (!isHtmlScript(clone)) graft(clone, m);
      }
      // The graft may have moved the cursor node into the clone.
      cursor = nextUsable(clone.nextSibling);
      applied.push({ kind: "insert", node: clone, parent: liveParent });
      hooks.afterNodeAdded(clone);
    }
    for (const child of Array.from(liveParent.childNodes)) {
      if (claimed.has(child) || seenHere.has(child)) continue;
      if (child.nodeType === 1 && (o.ignored(child) || preserved(child)))
        continue;
      // A leftover with a merged twin elsewhere is moved out when that parent
      // is applied; anything else can go now, so hooks see settled state.
      if (liveTwins.has(child))
        leftovers.push({ node: child, parent: liveParent });
      else removeNode(child, liveParent);
    }
  }

  /**
   * A head child the caller asked to keep (`head.preserve`) is never removed
   * by the merge, only ever updated in place when the remote carries it.
   */
  function preserved(el) {
    return (
      o.preserve &&
      el.parentNode &&
      el.parentNode.nodeType === 1 &&
      el.parentNode.tagName === "HEAD" &&
      o.preserve(el) === true
    );
  }

  function provenanceLocalValue(m) {
    const p = provenance.get(m);
    if (!p || !Array.isArray(p.local)) return null;
    return p.local.map((n) => n.nodeValue).join("");
  }
  function provenanceValue(m) {
    return provenance.get(m);
  }

  /**
   * Walk a live subtree and its identical remote twin, syncing the form
   * state of every form control. Only subtrees that hold one pay for it.
   */
  function syncFormStateDeep(liveEl, remoteEl) {
    if (
      !FORM_TAGS.has(liveEl.tagName) &&
      !liveEl.querySelector("input,option,textarea")
    )
      return;
    const walk = (l, r) => {
      if (l.tagName !== r.tagName) return;
      if (l.tagName === "TEXTAREA") syncTextarea(l, r, { remote: r });
      else if (FORM_TAGS.has(l.tagName)) syncFormState(l, r, { remote: r });
      const lk = mergedChildren(l),
        rk = mergedChildren(r);
      if (lk.length !== rk.length) return;
      for (let i = 0; i < lk.length; i++) walk(lk[i], rk[i]);
    };
    walk(liveEl, remoteEl);
  }

  /** Walk a live subtree and its identical remote twin, adopting remote ids. */
  function adoptLockstep(liveEl, remoteEl) {
    const lk = mergedChildren(liveEl),
      rk = mergedChildren(remoteEl);
    if (lk.length !== rk.length) return;
    for (let i = 0; i < lk.length; i++) {
      const id = result.remoteIdOf(rk[i]);
      if (id) identities.push([lk[i], id]);
      adoptLockstep(lk[i], rk[i]);
    }
  }

  /**
   * The element children the merge compared: ignored elements are invisible
   * to it, and so are text nodes, which the live DOM may hold split. Two
   * subtrees the merge called identical have these in lockstep.
   */
  function mergedChildren(el) {
    const root = el.tagName === "TEMPLATE" && el.content ? el.content : el;
    return Array.from(root.children).filter((c) => !o.ignored(c));
  }

  function recordIdentities(liveEl, mergedEl) {
    if (!result.remoteIdOf) return;
    const walk = (l, m) => {
      const p = provenance.get(m);
      if (p && p.remote && m.nodeType === 1) {
        const id = result.remoteIdOf(p.remote);
        if (id) identities.push([l, id]);
      }
      const lk = l.childNodes,
        mk = m.childNodes;
      for (let i = 0; i < lk.length && i < mk.length; i++) walk(lk[i], mk[i]);
    };
    walk(liveEl, mergedEl);
  }

  function nextUsable(n) {
    while (n && n.nodeType === 1 && o.ignored(n)) n = n.nextSibling;
    return n;
  }

  function moveBefore(parent, node, before) {
    if (
      typeof parent.moveBefore === "function" &&
      node.ownerDocument === parent.ownerDocument
    ) {
      try {
        parent.moveBefore(node, before);
        return;
      } catch {}
    }
    parent.insertBefore(node, before);
  }

  function removeNode(node, parent) {
    if (hooks.beforeNodeRemoved(node) === false) return;
    node.parentNode.removeChild(node);
    applied.push({ kind: "remove", node, parent });
    hooks.afterNodeRemoved(node);
  }

  function deepInert(m) {
    if (isHtmlScript(m)) return makeInertScript(m, doc);
    const clone = doc.importNode(m, true);
    if (clone.nodeType === 1)
      for (const s of Array.from(clone.querySelectorAll("script")))
        if (isHtmlScript(s)) s.replaceWith(makeInertScript(s, doc));
    return clone;
  }

  /**
   * Walk an inserted copy and the merged node it was cloned from in
   * lockstep; wherever the merged node has a live twin, the twin replaces
   * the cloned stand-in and is applied in place.
   */
  function graft(cloneEl, m) {
    const cKids =
      cloneEl.tagName === "TEMPLATE" && cloneEl.content
        ? cloneEl.content
        : cloneEl;
    const mKids = m.tagName === "TEMPLATE" && m.content ? m.content : m;
    const cs = Array.from(cKids.childNodes),
      ms = Array.from(mKids.childNodes);
    for (let i = 0; i < ms.length && i < cs.length; i++) {
      const mc = ms[i],
        cc = cs[i];
      let lv = liveOf.get(mc);
      if (lv && claimed.has(lv)) lv = null;
      if (lv) {
        const from = lv.parentNode;
        moveBefore(cKids, lv, cc);
        cc.remove();
        if (lv.nodeType === 1) {
          if (from !== cKids) {
            moved.push(lv);
            applied.push({ kind: "move", el: lv, from, to: cKids });
          }
          applyElement(lv, mc);
        } else {
          claimed.add(lv);
          heldBy.set(mc, lv);
          if (lv.nodeValue !== mc.nodeValue) {
            applied.push({
              kind: "text",
              node: lv,
              before: lv.nodeValue,
              after: mc.nodeValue,
            });
            lv.nodeValue = mc.nodeValue;
          }
        }
        continue;
      }
      claimed.add(cc);
      if (cc.nodeType === 3) heldBy.set(mc, cc);
      if (mc.nodeType === 1 && !isHtmlScript(mc)) graft(cc, mc);
    }
  }

  function syncAttributes(liveEl, mergedEl) {
    for (const attr of Array.from(mergedEl.attributes)) {
      if (
        isFormStateAttr(liveEl, attr.name) ||
        o.ignoreAttribute(liveEl, attr.name)
      )
        continue;
      const cur = attr.namespaceURI
        ? liveEl.getAttributeNS(attr.namespaceURI, attr.localName)
        : liveEl.getAttribute(attr.name);
      if (cur === attr.value) continue;
      if (hooks.beforeAttributeUpdated(attr.name, liveEl, "update") === false)
        continue;
      if (attr.namespaceURI)
        liveEl.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      else liveEl.setAttribute(attr.name, attr.value);
      applied.push({
        kind: "attr",
        el: liveEl,
        name: attr.name,
        before: cur,
        after: attr.value,
      });
    }
    for (const attr of Array.from(liveEl.attributes)) {
      if (
        isFormStateAttr(liveEl, attr.name) ||
        o.ignoreAttribute(liveEl, attr.name)
      )
        continue;
      const has = attr.namespaceURI
        ? mergedEl.hasAttributeNS(attr.namespaceURI, attr.localName)
        : mergedEl.hasAttribute(attr.name);
      if (has) continue;
      if (hooks.beforeAttributeUpdated(attr.name, liveEl, "remove") === false)
        continue;
      const before = attr.value;
      if (attr.namespaceURI)
        liveEl.removeAttributeNS(attr.namespaceURI, attr.localName);
      else liveEl.removeAttribute(attr.name);
      applied.push({
        kind: "attr",
        el: liveEl,
        name: attr.name,
        before,
        after: null,
      });
    }
  }

  function isFormStateAttr(el, name) {
    const tag = el.tagName;
    if (tag === "INPUT")
      return name === "value" || name === "checked" || name === "disabled";
    if (tag === "OPTION") return name === "selected";
    return false;
  }

  function isFocused(el) {
    return el === doc.activeElement;
  }

  function holdsFocus(el) {
    const active = doc.activeElement;
    return !!active && active !== doc.body && el.contains(active);
  }

  /**
   * The original remote node, when the caller built it in memory and set a
   * live property that its attribute does not carry. Parsed content never
   * differs, so the merged attribute is authoritative for it.
   */
  function builtRemote(p) {
    const r = p && p.remote;
    return r && r.nodeType === 1 ? r : null;
  }

  function syncFormState(liveEl, mergedEl, p) {
    const tag = liveEl.tagName;
    const built = builtRemote(p);
    const src = o.formState === "property" && built ? built : mergedEl;
    if (tag === "INPUT") {
      const protect = o.protectFocusedValue && isFocused(liveEl);
      const type = (liveEl.getAttribute("type") || "").toLowerCase();
      const textLike =
        type !== "file" && type !== "checkbox" && type !== "radio";
      // A built node whose value property differs from its value attribute
      // was set by script; honor the property. Without the attribute the
      // attribute rule still wins: an absent attribute clears the value.
      const propertyValue =
        built &&
        built.hasAttribute("value") &&
        built.value !== built.getAttribute("value")
          ? built.value
          : null;
      if (textLike && !protect) {
        if (o.formState === "property") {
          if (
            liveEl.value !== src.value &&
            hooks.beforeAttributeUpdated("value", liveEl, "update") !== false
          )
            liveEl.value = src.value;
        } else if (mergedEl.hasAttribute("value") || propertyValue != null) {
          const v =
            propertyValue != null
              ? propertyValue
              : mergedEl.getAttribute("value");
          if (
            liveEl.getAttribute("value") !== v &&
            hooks.beforeAttributeUpdated("value", liveEl, "update") !== false
          ) {
            liveEl.setAttribute("value", v);
            if (liveEl.value !== v) liveEl.value = v;
            applied.push({
              kind: "attr",
              el: liveEl,
              name: "value",
              before: null,
              after: v,
            });
          } else if (liveEl.value !== v && liveEl.getAttribute("value") === v) {
            liveEl.value = v;
          }
        } else if (liveEl.hasAttribute("value") || liveEl.value !== "") {
          if (
            hooks.beforeAttributeUpdated("value", liveEl, "remove") !== false
          ) {
            liveEl.removeAttribute("value");
            liveEl.value = "";
            applied.push({
              kind: "attr",
              el: liveEl,
              name: "value",
              before: "",
              after: null,
            });
          }
        }
      }
      if (!textLike && type !== "file") {
        // Checkbox and radio: the value attribute is plain data, never a
        // live property to reconcile.
        const mv = mergedEl.getAttribute("value");
        if (mv == null) {
          if (
            liveEl.hasAttribute("value") &&
            hooks.beforeAttributeUpdated("value", liveEl, "remove") !== false
          )
            liveEl.removeAttribute("value");
        } else if (
          liveEl.getAttribute("value") !== mv &&
          hooks.beforeAttributeUpdated("value", liveEl, "update") !== false
        )
          liveEl.setAttribute("value", mv);
      }
      syncBoolean(liveEl, src, "checked");
      syncBoolean(liveEl, src, "disabled");
      if (
        o.formState === "property" &&
        liveEl.indeterminate !== src.indeterminate
      )
        liveEl.indeterminate = src.indeterminate;
    } else if (tag === "OPTION") {
      syncBoolean(liveEl, src, "selected");
    }
  }

  function syncBoolean(liveEl, src, name) {
    const want =
      o.formState === "property" ? !!src[name] : src.hasAttribute(name);
    if (o.formState !== "property") {
      const has = liveEl.hasAttribute(name);
      if (has !== want) {
        if (
          hooks.beforeAttributeUpdated(
            name,
            liveEl,
            want ? "update" : "remove",
          ) === false
        )
          return;
        if (want) liveEl.setAttribute(name, "");
        else liveEl.removeAttribute(name);
        applied.push({
          kind: "attr",
          el: liveEl,
          name,
          before: has ? "" : null,
          after: want ? "" : null,
        });
      }
    }
    if (liveEl[name] !== want) liveEl[name] = want;
  }

  function syncTextarea(liveEl, mergedEl, p) {
    // The focused textarea keeps both its text and its value: its text is
    // its default value, and rewriting it under the caret is the edit the
    // protection exists to prevent.
    if (o.protectFocusedValue && isFocused(liveEl)) return;
    if (hooks.beforeAttributeUpdated("value", liveEl, "update") === false)
      return;
    const built = builtRemote(p);
    const text = mergedEl.textContent;
    const value =
      built && built.value !== built.defaultValue ? built.value : text;
    if (o.formState !== "property" && liveEl.textContent !== text) {
      applied.push({
        kind: "text",
        node: liveEl,
        before: liveEl.textContent,
        after: text,
      });
      liveEl.textContent = text;
    }
    if (liveEl.value !== value) liveEl.value = value;
  }
}

// ---------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------
function captureFocus(doc, liveTextInfo) {
  const el = doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) return null;
  const state = {
    el,
    id: el.getAttribute && el.getAttribute("id"),
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
  };
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      state.selection = [
        el.selectionStart,
        el.selectionEnd,
        el.selectionDirection,
      ];
    } catch {}
    return state;
  }
  const sel = doc.getSelection && doc.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    state.range = {
      sc: r.startContainer,
      so: r.startOffset,
      ec: r.endContainer,
      eo: r.endOffset,
    };
  }
  return state;
}

function restoreFocus(doc, state, liveTextInfo, textMappers, runOf, heldBy) {
  if (!state) return;
  let el = state.el;
  if (!el.isConnected && state.id) el = doc.getElementById(state.id);
  if (!el || !el.isConnected) return;
  if (doc.activeElement !== el) {
    try {
      el.focus({ preventScroll: true });
    } catch {}
  }
  try {
    el.scrollTop = state.scrollTop;
    el.scrollLeft = state.scrollLeft;
  } catch {}
  if (state.selection) {
    // Only a selection that was lost is put back; one that a hook or the
    // page set during the apply stands.
    try {
      if (
        el.setSelectionRange &&
        !el.selectionEnd &&
        state.selection[1] != null
      )
        el.setSelectionRange(
          state.selection[0],
          state.selection[1],
          state.selection[2] || "none",
        );
    } catch {}
    return;
  }
  if (!state.range) return;
  const mapPoint = (node, offset) => {
    const info = liveTextInfo.get(node);
    if (Array.isArray(info)) {
      // A text node an inline merge spread over output nodes: the entry
      // whose local offset range holds the caret names the output node, its
      // live holder takes the caret, and the flat mapper places it.
      const entry =
        info.find((e) => offset >= e.from && offset < e.to) ||
        info.find((e) => offset === e.to) ||
        info[info.length - 1];
      const target = heldBy.get(entry.merged);
      if (!target || !target.isConnected) return null;
      const mapper = textMappers.get(entry.merged);
      const mapped =
        mapper && mapper.flat ? mapper.flat(entry.flatStart + offset) : offset;
      return [target, Math.max(0, Math.min(mapped, target.nodeValue.length))];
    }
    // A text node inside a merged run: map through the run's offset mapper
    // into the run's surviving first member.
    if (info) {
      const survivor = (runOf.get(info.merged) || [node])[0];
      if (!survivor.isConnected) return null;
      const mapper = textMappers.get(info.merged);
      const runOffset = info.shift + offset;
      const mapped = mapper ? mapper(runOffset) : runOffset;
      return [
        survivor,
        Math.max(0, Math.min(mapped, survivor.nodeValue.length)),
      ];
    }
    if (node.isConnected)
      return [
        node,
        Math.min(
          offset,
          node.nodeType === 3 ? node.nodeValue.length : node.childNodes.length,
        ),
      ];
    return null;
  };
  const s = mapPoint(state.range.sc, state.range.so),
    e = mapPoint(state.range.ec, state.range.eo);
  if (!s || !e) return;
  try {
    const r = doc.createRange();
    r.setStart(s[0], s[1]);
    r.setEnd(e[0], e[1]);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
}
