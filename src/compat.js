/**
 * compat.js — the 0.5.x `morph(oldNode, newContent, config)` surface on top of
 * mergeDocument and morphElement. Deprecated: new code should call those
 * directly. Option mapping: docs/api.md, "Compatibility: morph()".
 */
import { mergeDocument, morphElement } from "./index.js";
import { mergeIdentityOf } from "./scripts.js";

const SYNC_IGNORE =
  '[editor-ui],[clay~="editor-ui"],[save-ignore],[snapshot-remove],[no-snapshot],[no-save],[save-remove],[freeze],[save-freeze],[clay~="no-save"],[clay~="no-snapshot"],[clay~="freeze"]';
const HISTORY_IGNORE =
  '[editor-ui],[clay~="editor-ui"],[no-undo],[clay~="no-undo"]';
const HISTORY_ROOT_MORPHED =
  '[no-undo]:not([editor-ui]):not([clay~="editor-ui"]),[clay~="no-undo"]:not([editor-ui]):not([clay~="editor-ui"])';

function isExtensionNode(el) {
  if (el.tagName !== "LINK" && el.tagName !== "SCRIPT") return false;
  const url = el.getAttribute("src") || el.getAttribute("href") || "";
  return /^(chrome|moz|safari-web)-extension:/.test(url);
}

// The old scripts.mergeBase accepted any shape that contained the base
// script tags. An element-level three-way merge needs the base element that
// corresponds to the target: in a Document, the element with the target's id,
// else its body or html for a body or html target, else its first body
// child. A base that corresponds to nothing (a lone script tag, say) still
// carries the base of each mergeable script: the base is then the target
// itself with those scripts' base text, so everything else morphs two-way
// and the scripts merge three-way. Never a wrapped base, which would read
// every child as inserted.
function baseFor(oldEl, mergeBase, children, mergeTags) {
  if (mergeBase == null) return undefined;
  if (typeof mergeBase === "string") return mergeBase;
  let el = mergeBase;
  if (el.nodeType === 9) {
    const id = oldEl.getAttribute("id");
    el =
      (id && el.getElementById(id)) ||
      (oldEl.tagName === "BODY"
        ? el.body
        : oldEl.tagName === "HTML"
          ? el.documentElement
          : el.body && el.body.firstElementChild);
  }
  if (!el || el.nodeType !== 1 || el.tagName !== oldEl.tagName)
    el = scriptsBase(oldEl, mergeBase, mergeTags);
  if (!el) return undefined;
  return children ? Array.from(el.childNodes) : el;
}

function scriptsBase(oldEl, mergeBase, mergeTags) {
  const root = mergeBase.nodeType === 9 ? mergeBase.documentElement : mergeBase;
  if (!root || root.nodeType !== 1) return null;
  const baseText = new Map();
  const scripts = [root, ...root.querySelectorAll("script")];
  for (const s of scripts) {
    const id = mergeIdentityOf(s, mergeTags);
    if (id && !baseText.has(id.key)) baseText.set(id.key, s.textContent);
  }
  if (!baseText.size) return null;
  const copy = oldEl.cloneNode(true);
  let found = false;
  for (const s of [copy, ...copy.querySelectorAll("script")]) {
    const id = mergeIdentityOf(s, mergeTags);
    if (id && baseText.has(id.key)) {
      s.textContent = baseText.get(id.key);
      found = true;
    }
  }
  return found ? copy : null;
}

/**
 * The remote document for a document-level morph. A string or a Document is
 * taken as is. An element is the new `<html>` (0.5.x callers hand over a
 * detached clone of the live one): it is adopted into a fresh document as
 * its root, since its ownerDocument is the live document itself and merging
 * that against itself would do nothing.
 */
function remoteDocument(newContent, live) {
  if (typeof newContent === "string" || newContent.nodeType === 9)
    return newContent;
  if (
    newContent.nodeType === 1 &&
    newContent === newContent.ownerDocument.documentElement
  )
    return newContent.ownerDocument;
  const doc = live.implementation.createHTMLDocument("");
  const root =
    newContent.nodeType === 1 && newContent.tagName === "HTML"
      ? newContent
      : null;
  if (root) {
    doc.replaceChild(doc.adoptNode(root), doc.documentElement);
    return doc;
  }
  const nodes =
    newContent.nodeType === 11
      ? Array.from(newContent.childNodes)
      : newContent.nodeType
        ? [newContent]
        : Array.from(newContent);
  for (const n of nodes) doc.body.appendChild(doc.adoptNode(n));
  return doc;
}

export function morph(oldNode, newContent, config = {}) {
  const cfg = config || {};
  // 0.5.4 ran a head-blocking morph after the stylesheets loaded, so a hook
  // that threw rejected the returned Promise. The merge now runs first, so
  // the same error is turned into a rejection here. Without head.block the
  // morph was synchronous and threw, and still does.
  if (!cfg.head?.block) return morphNow(oldNode, newContent, cfg);
  try {
    return morphNow(oldNode, newContent, cfg);
  } catch (e) {
    return Promise.reject(e);
  }
}

function morphNow(oldNode, newContent, cfg) {
  const policy = cfg.policy || "sync";
  // As 0.5.4: the history policy morphs a no-undo root (only its no-undo
  // descendants are exempt), unless that root is editor UI.
  const ignore =
    policy === "raw"
      ? undefined
      : (el, isRoot) =>
          isExtensionNode(el) ||
          (policy === "history"
            ? !(isRoot && el.matches(HISTORY_ROOT_MORPHED)) &&
              el.matches(HISTORY_IGNORE)
            : el.matches(SYNC_IGNORE));
  const hooks = cfg.callbacks || {};
  const options = {
    ignore,
    hooks,
    protectFocusedValue: cfg.ignoreActiveValue === true ? "subtree" : false,
    restoreFocus: cfg.restoreFocus !== false,
    formState: cfg.formStateSync || "attribute",
    scripts: {
      execute: cfg.scripts?.handle !== false,
      merge: cfg.scripts?.merge !== false,
      mergeTags: cfg.scripts?.mergeTags || [],
    },
    head: {
      awaitLoads: !!cfg.head?.block,
      preserve: cfg.head?.shouldPreserve || (() => false),
    },
  };
  if (typeof cfg.key === "function")
    options.identity = { base: cfg.key, local: cfg.key, remote: cfg.key };

  if (oldNode && oldNode.nodeType === 9) {
    return mergeDocument(
      Object.assign({}, options, {
        live: oldNode,
        base: cfg.scripts?.mergeBase || null,
        remote: remoteDocument(newContent, oldNode),
      }),
    );
  }
  if (
    oldNode.tagName === "HTML" &&
    oldNode.parentNode &&
    oldNode.parentNode.nodeType === 9
  ) {
    const o = Object.assign({}, options, {
      live: oldNode.ownerDocument,
      base: cfg.scripts?.mergeBase || null,
      remote: remoteDocument(newContent, oldNode.ownerDocument),
    });
    return mergeDocument(o);
  }
  if (cfg.morphStyle === "innerHTML") options.children = true;
  const base = baseFor(
    oldNode,
    cfg.scripts?.mergeBase,
    !!options.children,
    options.scripts.mergeTags,
  );
  if (base !== undefined) options.base = base;
  return morphElement(oldNode, newContent, options);
}
