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
import { merge3Text, diff } from "./text-merge.js";
import { MARK_TAGS } from "./inline-merge.js";

const XHTML = "http://www.w3.org/1999/xhtml";
const FORM_TAGS = new Set(["INPUT", "OPTION", "TEXTAREA"]);
const HTML_SPACE = /[\t\n\f\r ]+/;

/**
 * @typedef {object} ApplyOptions
 * @property {(n: Node) => Node | null} toLive
 * @property {Element} [localRoot]
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
  const twinsByParent = new Map();
  const mergedScriptsLive = new Set();
  const heldBy = new Map(); // merged text node -> live text node holding its text
  // For the conflict report only: where an inserted copy (and each stand-in
  // kept inside one) landed, and the merged nodes a hook kept out of the DOM.
  const track = result.conflicts.length > 0;
  const insertedLive = new Map();
  const vetoed = new Set();
  const vetoedAttrs = new Map();
  const attrVeto = (el, name) => {
    let names = vetoedAttrs.get(el);
    if (!names) vetoedAttrs.set(el, (names = new Set()));
    names.add(name);
  };
  const removedVetoes = track ? new Set() : null;
  const beforeAttribute = (name, el, action) => {
    const answer = hooks.beforeAttributeUpdated(name, el, action);
    if (track && answer === false) attrVeto(el, name);
    return answer;
  };

  const inRoot = (n) =>
    !!n &&
    (n === liveRoot ||
      liveRoot.contains(n) ||
      (liveRoot.nodeType === 1 &&
        liveRoot.tagName === "TEMPLATE" &&
        liveRoot.content.contains(n)));

  // Pre-pass: resolve every merged node's live twin(s) once.
  const liveOf = new Map(); // merged node -> live node (element, or first text node of a run)
  const mergedOf = new Map(); // live node -> the merged node it is the twin of
  const runOf = new Map(); // merged text node -> live text nodes of its run
  const keptRuns = new Set(); // merged text nodes whose live run was left split
  // live text node -> { merged, shift } for a run merged whole, or a list of
  // { merged, from, to, flatStart } when an inline merge spread the node's
  // characters over several output nodes (provenance.caret).
  const liveTextInfo = new Map();
  (function resolve(m) {
    const p = provenance.get(m);
    if (p) {
      if (m.nodeType === 1) {
        const lv = p.local ? o.toLive(p.local) : null;
        if (lv && inRoot(lv) && lv.nodeType === 1) {
          liveOf.set(m, lv);
          mergedOf.set(lv, m);
        }
      } else if (Array.isArray(p.local)) {
        const nodes = withSplits(
          p.local,
          p.local
            .map((n) => o.toLive(n))
            .filter((n) => n && inRoot(n) && n.nodeType === m.nodeType),
        );
        if (nodes.length) {
          liveOf.set(m, nodes[0]);
          mergedOf.set(nodes[0], m);
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

  const localHeadTwins =
    o.localRoot && o.localRoot !== liveRoot ? new Set() : null;
  if (localHeadTwins)
    for (let h = o.localRoot.firstElementChild; h; h = h.nextElementSibling) {
      if (h.tagName !== "HEAD") continue;
      for (let c = h.firstElementChild; c; c = c.nextElementSibling) {
        const lv = o.toLive(c);
        if (lv) localHeadTwins.add(lv);
      }
    }

  // Typing that landed after the local snapshot, per inline segment: the
  // segment's live text is rebuilt from its local nodes and the typing is
  // replayed onto the merged text through the caret map, so a node the
  // merge split or re-wrapped keeps what was typed into it. A hunk whose
  // characters the merge dropped or edited is a conflict, and the merge
  // wins it.
  for (const seg of result.segments || []) replayTyping(seg);

  const focus =
    o.restoreFocus === false ? null : captureFocus(doc, liveTextInfo);

  if (o.childrenOnly) applyChildren(kidsOf(liveRoot), kidsOf(mergedRoot));
  else applyElement(liveRoot, mergedRoot);

  // Final pass: remove what nothing claimed.
  for (const { node, parent } of leftovers) {
    if (claimed.has(node) || !node.parentNode) continue;
    if (node.nodeType === 1 && (o.ignored(node) || preserved(node))) continue;
    removeNode(node, parent);
  }

  restoreFocus(doc, focus, liveTextInfo, textMappers, runOf, heldBy, keptRuns);

  return {
    applied,
    moved,
    replaced,
    identities,
    mergedScriptsLive,
    liveOf,
    heldBy,
    runOf,
    keptRuns,
    insertedLive,
    vetoed,
    vetoedAttrs,
    removedVetoes,
  };

  // -------------------------------------------------------------------
  // Word-level hunks carry the untouched letters of the word; drop them so
  // typing at a word edge is an insertion at that edge.
  function trimHunk(flatLocal, h) {
    const old = flatLocal.slice(h.bs, h.be);
    let p = 0;
    while (p < old.length && p < h.text.length && old[p] === h.text[p]) p++;
    let s = 0;
    while (
      s < old.length - p &&
      s < h.text.length - p &&
      old[old.length - 1 - s] === h.text[h.text.length - 1 - s]
    )
      s++;
    return {
      bs: h.bs + p,
      be: h.be - s,
      text: h.text.slice(p, h.text.length - s),
    };
  }
  // A text node the browser split off a live twin after the snapshot (an
  // edit command, typing) has no snapshot twin of its own. It joins the run
  // of the twin it follows, so its text is read as typing and the node is
  // dropped with the rest of the run, instead of its text counting as
  // deleted.
  function withSplits(localNodes, lives) {
    if (!lives.length) return lives;
    const sets = [];
    for (const ln of localNodes) {
      const parent = ln.parentNode;
      if (!parent) continue;
      let set = twinsByParent.get(parent);
      if (!set) {
        set = new Set();
        for (let c = parent.firstChild; c; c = c.nextSibling)
          if (c.nodeType === 3) set.add(o.toLive(c));
        twinsByParent.set(parent, set);
      }
      if (!sets.includes(set)) sets.push(set);
    }
    const twins = { has: (x) => sets.some((s) => s.has(x)) };
    const out = [];
    for (const n of lives) {
      out.push(n);
      for (
        let x = n.nextSibling;
        x && x.nodeType === 3 && !twins.has(x) && !out.includes(x);
        x = x.nextSibling
      )
        out.push(x);
    }
    return out;
  }

  function replayTyping(seg) {
    const twinsOf = [];
    for (const ln of seg.localNodes) {
      const n = o.toLive(ln.node);
      if (!n || !inRoot(n) || n.nodeType !== 3) return;
      twinsOf.push(n);
    }
    const lives = withSplits(
      seg.localNodes.map((ln) => ln.node),
      twinsOf,
    );
    if (!lives.length) return;
    const current = lives.map((n) => n.nodeValue).join("");
    const { flatLocal, lToM, mapLocal } = seg;
    if (current === flatLocal) return;
    const nodes = seg.textNodes.map((t) => ({
      node: t.node,
      ms: t.ms,
      me: t.me,
    }));
    const liveStart = [];
    let acc = 0;
    for (const n of lives) {
      liveStart.push(acc);
      acc += n.nodeValue.length;
    }
    // The live node an insertion was typed into: the one holding all of it.
    const typedInto = (at, len) =>
      lives.find(
        (n, k) =>
          liveStart[k] <= at && at + len <= liveStart[k] + n.nodeValue.length,
      ) || null;
    const edits = [];
    let delta = 0;
    for (const h of diff(flatLocal, current).map((h) =>
      trimHunk(flatLocal, h),
    )) {
      const at = h.bs + delta;
      delta += h.text.length - (h.be - h.bs);
      let ms, me;
      if (h.be > h.bs) {
        ms = lToM[h.bs];
        let kept = ms >= 0;
        for (let i = h.bs; kept && i < h.be; i++)
          if (lToM[i] !== ms + (i - h.bs)) kept = false;
        if (!kept) continue;
        me = ms + (h.be - h.bs);
      } else {
        const before = h.bs > 0 ? lToM[h.bs - 1] : 0,
          after = h.bs < flatLocal.length ? lToM[h.bs] : 0;
        if (before < 0 || after < 0) continue;
        ms = me = mapLocal(h.bs);
      }
      edits.push({
        ms,
        me,
        text: h.text,
        live: me === ms ? typedInto(at, h.text.length) : null,
      });
    }
    // From the end, so the offsets of the edits still to come stay valid.
    edits.sort((a, b) => b.ms - a.ms);
    const holds = (x, live) =>
      (runOf.get(x.node) || [liveOf.get(x.node)]).includes(live);
    const isMark = (n) => !!n && n.nodeType === 1 && MARK_TAGS.has(n.tagName);
    for (const e of edits) {
      let t = nodes.find((x) => x.ms <= e.ms && e.me <= x.me && e.ms < x.me);
      // An insertion where one output node ends and the next starts belongs
      // to the node holding the live node it was typed into: replayed into
      // the neighbour, it would land there and stay in its own node too.
      if (t && e.live && t.ms === e.ms && !holds(t, e.live)) {
        const own = nodes.find((x) => x.me === e.ms && holds(x, e.live));
        if (own) t = own;
      }
      if (!t && e.me === e.ms) {
        // An insertion at a node boundary goes outside the marks that end
        // or start there, as the inline merge places an edge insertion.
        const ends = nodes.find((x) => x.me === e.ms),
          starts = nodes.find((x) => x.ms === e.ms);
        const ref = ends || starts;
        if (!ref) continue;
        let n = ref.node;
        while (
          isMark(n.parentNode) &&
          (ends ? n.parentNode.lastChild : n.parentNode.firstChild) === n
        )
          n = n.parentNode;
        if (n === ref.node) t = ref;
        else {
          const fresh = n.ownerDocument.createTextNode(e.text);
          n.parentNode.insertBefore(fresh, ends ? n.nextSibling : n);
          continue;
        }
      }
      if (!t) continue;
      const v = t.node.nodeValue;
      t.node.nodeValue =
        v.slice(0, e.ms - t.ms) + e.text + v.slice(e.me - t.ms);
      t.me += e.text.length - (e.me - e.ms);
    }
  }

  // The children of a template live in its content fragment.
  function kidsOf(el) {
    return el.nodeType === 1 && el.tagName === "TEMPLATE" && el.content
      ? el.content
      : el;
  }

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
    if (hooks.beforeNodeMorphed(liveEl, mergedEl) === false) {
      vetoed.add(mergedEl);
      return;
    }
    syncAttributes(
      liveEl,
      mergedEl,
      o.keepLiveOnly &&
        p &&
        p.local &&
        p.local.nodeType === 1 &&
        p.local !== liveEl
        ? p.local
        : null,
    );
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
  // other parent pulls one out and the final pass removes none. A child the
  // merge moved under another parent is the exception: left unclaimed, that
  // parent moves it, where a claim would make it clone a second copy.
  function claimSubtree(parent) {
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      const m = mergedOf.get(c);
      if (m && liveOf.get(m.parentNode) !== parent) continue;
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
        const current = run.map((n) => n.nodeValue).join("");
        let text = m.nodeValue;
        if (m.nodeType === 3) {
          // Typing landed after the snapshot: merge it in.
          const snapshotValue = provenanceLocalValue(m);
          if (snapshotValue != null && current !== snapshotValue) {
            text = merge3Text(snapshotValue, current, m.nodeValue).text;
          }
        }
        // A run the merge leaves as it is keeps every node typing split it
        // into: folding it into the first would drop the rest, and every
        // range pointing into them, for no change.
        if (
          run.length > 1 &&
          current === text &&
          !run.includes(cursor, 1) &&
          run.every(
            (n, i) =>
              n.parentNode === liveParent &&
              (i === 0 || run[i - 1].nextSibling === n),
          )
        ) {
          if (lv !== cursor)
            for (const n of run) moveBefore(liveParent, n, cursor);
          if (hooks.beforeNodeMorphed(lv, m) !== false)
            hooks.afterNodeMorphed(lv, m);
          else if (track) vetoed.add(m);
          for (const n of run) {
            claimed.add(n);
            seenHere.add(n);
          }
          heldBy.set(m, lv);
          keptRuns.add(m);
          cursor = nextUsable(run[run.length - 1].nextSibling);
          continue;
        }
        if (lv !== cursor) moveBefore(liveParent, lv, cursor);
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
        } else vetoed.add(m);
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
      if (hooks.beforeNodeAdded(clone) === false) {
        vetoed.add(m);
        continue;
      }
      liveParent.insertBefore(clone, cursor);
      claimed.add(clone);
      if (track) insertedLive.set(m, clone);
      if (clone.nodeType === 3) heldBy.set(m, clone);
      if (clone.nodeType === 1) {
        replaced.push(clone);
        recordIdentities(clone, m);
        if (result.customIdentity && pm && pm.unchanged && pm.remote)
          adoptLockstep(clone, pm.remote);
        if (!isHtmlScript(clone)) graft(clone, m);
        // A copy carries attributes only. In property mode the caller's
        // built node is the source of form state, so the copy takes the
        // properties set on it, as the node itself would have carried them.
        if (o.formState === "property" && builtRemote(pm))
          syncFormStateDeep(clone, pm.remote);
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
   * by the merge, only ever updated in place when the remote carries it. A
   * runtime head tag (no local twin) is never removed either.
   */
  function preserved(el) {
    return (
      el.parentNode &&
      el.parentNode.nodeType === 1 &&
      el.parentNode.tagName === "HEAD" &&
      ((localHeadTwins && !localHeadTwins.has(el)) ||
        (o.preserve && o.preserve(el) === true))
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
    if (hooks.beforeNodeRemoved(node) === false) {
      if (track) removedVetoes.add(node);
      return;
    }
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
      const pm = provenance.get(mc);
      if (pm && pm.pinned) {
        // An ignored live element the inline merge placed: it moves into the
        // copy as it is and is never synced. Without its live node there is
        // nothing to place, and its bare stand-in goes.
        if (lv && lv.nodeType === 1) {
          const from = lv.parentNode;
          moveBefore(cKids, lv, cc);
          if (from !== cKids) {
            moved.push(lv);
            applied.push({ kind: "move", el: lv, from, to: cKids });
          }
          claimed.add(lv);
        }
        cc.remove();
        continue;
      }
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
      if (track) insertedLive.set(mc, cc);
      if (cc.nodeType === 3) heldBy.set(mc, cc);
      if (pm && pm.unchanged && pm.remote) {
        fillFrom(cc, pm.remote);
        if (result.customIdentity) adoptLockstep(cc, pm.remote);
      } else if (mc.nodeType === 1 && !isHtmlScript(mc)) graft(cc, mc);
    }
  }

  function fillFrom(el, src) {
    const to = el.tagName === "TEMPLATE" && el.content ? el.content : el;
    const from = src.tagName === "TEMPLATE" && src.content ? src.content : src;
    for (const k of Array.from(from.childNodes)) to.appendChild(deepInert(k));
  }

  // With a captured local side, an attribute or class token the live element
  // carries and the capture does not is live-only state (a snapshot hook took
  // it out). The merge never saw it, so the merge never writes over it.
  function attrOf(el, attr) {
    return attr.namespaceURI
      ? el.getAttributeNS(attr.namespaceURI, attr.localName)
      : el.getAttribute(attr.name);
  }
  function liveOnlyTokens(cur, captured) {
    const had = new Set((captured || "").split(HTML_SPACE).filter(Boolean));
    return (cur || "").split(HTML_SPACE).filter((t) => t && !had.has(t));
  }

  function syncAttributes(liveEl, mergedEl, local) {
    for (const attr of Array.from(mergedEl.attributes)) {
      if (
        isFormStateAttr(liveEl, attr.name) ||
        o.ignoreAttribute(liveEl, attr.name)
      )
        continue;
      const cur = attrOf(liveEl, attr);
      if (cur === attr.value) continue;
      if (local && attrOf(local, attr) === attr.value) continue;
      let value = attr.value;
      if (local && attr.name === "class" && !attr.namespaceURI) {
        const next = attr.value.split(HTML_SPACE).filter(Boolean);
        const extra = liveOnlyTokens(cur, local.getAttribute("class")).filter(
          (t) => !next.includes(t),
        );
        if (extra.length) value = [...next, ...extra].join(" ");
      }
      if (cur === value) continue;
      if (hooks.beforeAttributeUpdated(attr.name, liveEl, "update") === false) {
        if (track) attrVeto(mergedEl, attr.name);
        continue;
      }
      if (attr.namespaceURI)
        liveEl.setAttributeNS(attr.namespaceURI, attr.name, value);
      else liveEl.setAttribute(attr.name, value);
      applied.push({
        kind: "attr",
        el: liveEl,
        name: attr.name,
        before: cur,
        after: value,
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
      if (local && attr.name === "class" && !attr.namespaceURI) {
        const keep = liveOnlyTokens(attr.value, local.getAttribute("class"));
        if (keep.length) {
          const value = keep.join(" ");
          if (value === attr.value) continue;
          if (
            hooks.beforeAttributeUpdated("class", liveEl, "update") === false
          ) {
            if (track) attrVeto(mergedEl, "class");
            continue;
          }
          liveEl.setAttribute("class", value);
          applied.push({
            kind: "attr",
            el: liveEl,
            name: "class",
            before: attr.value,
            after: value,
          });
          continue;
        }
      }
      if (local && attrOf(local, attr) === null) continue;
      if (hooks.beforeAttributeUpdated(attr.name, liveEl, "remove") === false) {
        if (track) attrVeto(mergedEl, attr.name);
        continue;
      }
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
          // The attribute follows the merge in both modes; property mode only
          // picks which side drives the live value. The attribute goes first,
          // since setting it moves the value of an input nobody typed into.
          const a = mergedEl.getAttribute("value");
          const was = liveEl.getAttribute("value");
          if (
            (was !== a || liveEl.value !== src.value) &&
            beforeAttribute(
              "value",
              liveEl,
              a == null ? "remove" : "update",
            ) !== false
          ) {
            if (was !== a) {
              if (a == null) liveEl.removeAttribute("value");
              else liveEl.setAttribute("value", a);
              applied.push({
                kind: "attr",
                el: liveEl,
                name: "value",
                before: was,
                after: a,
              });
            }
            if (liveEl.value !== src.value) liveEl.value = src.value;
          }
        } else if (mergedEl.hasAttribute("value") || propertyValue != null) {
          const v =
            propertyValue != null
              ? propertyValue
              : mergedEl.getAttribute("value");
          if (
            liveEl.getAttribute("value") !== v &&
            beforeAttribute("value", liveEl, "update") !== false
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
          if (beforeAttribute("value", liveEl, "remove") !== false) {
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
            beforeAttribute("value", liveEl, "remove") !== false
          )
            liveEl.removeAttribute("value");
        } else if (
          liveEl.getAttribute("value") !== mv &&
          beforeAttribute("value", liveEl, "update") !== false
        )
          liveEl.setAttribute("value", mv);
      }
      // A focused checkbox or radio is mid-interaction as much as a focused
      // text input mid-typing: its checked state is the user's, not the
      // document's.
      if (!protect) {
        syncBoolean(liveEl, src, "checked");
        if (
          o.formState === "property" &&
          liveEl.indeterminate !== src.indeterminate
        )
          liveEl.indeterminate = src.indeterminate;
      }
      syncBoolean(liveEl, src, "disabled");
    } else if (tag === "OPTION") {
      const select = liveEl.parentNode && liveEl.closest("select");
      if (!(o.protectFocusedValue && select && isFocused(select)))
        syncBoolean(liveEl, src, "selected");
    }
  }

  function syncBoolean(liveEl, src, name) {
    const want =
      o.formState === "property" ? !!src[name] : src.hasAttribute(name);
    if (o.formState !== "property") {
      const has = liveEl.hasAttribute(name);
      if (has !== want) {
        if (beforeAttribute(name, liveEl, want ? "update" : "remove") === false)
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
    if (beforeAttribute("value", liveEl, "update") === false) return;
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

function restoreFocus(
  doc,
  state,
  liveTextInfo,
  textMappers,
  runOf,
  heldBy,
  keptRuns,
) {
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
    if (info && !keptRuns.has(info.merged)) {
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
