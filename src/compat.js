/**
 * compat.js — the 0.5.x `morph(oldNode, newContent, config)` surface on top of
 * mergeDocument and morphElement. Deprecated: new code should call those
 * directly. Option mapping: docs/api.md, "Compatibility: morph()".
 */
import { mergeDocument, morphElement } from "./index.js";

const SYNC_IGNORE =
  '[editor-ui],[clay~="editor-ui"],[save-ignore],[snapshot-remove],[no-snapshot],[no-save],[save-remove],[freeze],[save-freeze],[clay~="no-save"],[clay~="no-snapshot"],[clay~="freeze"]';
const HISTORY_IGNORE =
  '[editor-ui],[clay~="editor-ui"],[no-undo],[clay~="no-undo"]';

function isExtensionNode(el) {
  if (el.tagName !== "LINK" && el.tagName !== "SCRIPT") return false;
  const url = el.getAttribute("src") || el.getAttribute("href") || "";
  return /^(chrome|moz|safari-web)-extension:/.test(url);
}

// The old scripts.mergeBase accepted any shape that contained the base
// script tags. An element-level three-way merge needs a base that
// corresponds to the element, so wrap what does not.
function baseFor(oldEl, mergeBase) {
  if (mergeBase == null) return undefined;
  if (typeof mergeBase === "string") return mergeBase;
  if (mergeBase.nodeType === 9)
    mergeBase = mergeBase.body.firstElementChild || mergeBase.documentElement;
  if (mergeBase.tagName === oldEl.tagName) return mergeBase;
  const wrap = oldEl.ownerDocument.createElement(oldEl.tagName);
  wrap.appendChild(mergeBase.cloneNode(true));
  return wrap;
}

export function morph(oldNode, newContent, config = {}) {
  const cfg = config || {};
  const policy = cfg.policy || "sync";
  const ignore =
    policy === "raw"
      ? undefined
      : (el) =>
          el.matches(policy === "history" ? HISTORY_IGNORE : SYNC_IGNORE) ||
          isExtensionNode(el);
  const hooks = cfg.callbacks || {};
  const options = {
    ignore,
    hooks,
    protectFocusedValue: cfg.ignoreActiveValue === true,
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
    const remote =
      typeof newContent === "string"
        ? newContent
        : newContent.nodeType === 9
          ? newContent
          : newContent.ownerDocument;
    return mergeDocument(
      Object.assign({}, options, {
        live: oldNode,
        base: cfg.scripts?.mergeBase || null,
        remote,
      }),
    );
  }
  if (
    oldNode.tagName === "HTML" &&
    oldNode.parentNode &&
    oldNode.parentNode.nodeType === 9
  ) {
    const remote =
      typeof newContent === "string"
        ? newContent
        : newContent.nodeType === 9
          ? newContent
          : newContent.ownerDocument;
    const o = Object.assign({}, options, {
      live: oldNode.ownerDocument,
      base: cfg.scripts?.mergeBase || null,
      remote,
    });
    return mergeDocument(o);
  }
  if (cfg.morphStyle === "innerHTML") options.children = true;
  const base = baseFor(oldNode, cfg.scripts?.mergeBase);
  if (base !== undefined) options.base = base;
  return morphElement(oldNode, newContent, options);
}
