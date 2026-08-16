import { createMatcher } from "./hyper-morph-matcher.js";
import { mergeJson, mergeScriptText } from "./hyper-morph-json-merge.js";
import {
  parseJsonRelaxed,
  parseRulesRelaxed,
} from "./hyper-morph-json-parse.js";

/**
 * @typedef {object} ConfigHead
 *
 * @property {'merge' | 'append' | 'morph' | 'none'} [style]
 * @property {boolean} [block]
 * @property {boolean} [ignore]
 * @property {function(Element): boolean} [shouldPreserve]
 * @property {function(Element): boolean} [shouldReAppend]
 * @property {function(Element): boolean} [shouldRemove]
 * @property {function(Element, {added: Node[], kept: Element[], removed: Element[]}): void} [afterHeadMorphed]
 */

/**
 * @typedef {object} MergeTagRecognizer
 *
 * @property {function(Element): boolean} match - Whether this recognizer handles the script element.
 * @property {function(Element): (string|null|undefined)} identity - Stable identity pairing the tag across base, local, and incoming HTML. null/undefined/empty disables merging for the tag.
 * @property {function(string): any} [parse] - Parser for this tag family's JSON dialect. Must throw on invalid input. Default: JSON.parse
 */

/**
 * @typedef {object} ConfigScripts
 *
 * @property {boolean} [handle] - Whether to execute scripts. New scripts (ones not present before the morph) execute exactly once after the morph completes; scripts that already existed never re-execute (unless shouldReAppend opts them in). Set to false to keep new scripts inert. Default: true
 * @property {'outerHTML' | 'smart'} [matchMode] - How to match scripts. 'outerHTML' (exact match) or 'smart' (normalized URL/content hash). Default: 'outerHTML'
 * @property {boolean} [merge] - Set false to disable script-tag merging entirely for this morph (deliberate rewinds/restores must overwrite, not merge). Default: true
 * @property {string | Element | Document | null} [mergeBase] - Last-synced HTML (string, Element, or Document): the base version for three-way merging of mergeable script tags. Without it, merges degrade to two-way (local additions survive, deletions don't propagate). Default: null
 * @property {MergeTagRecognizer[]} [mergeTags] - Extra recognizers for mergeable JSON script tags, checked after the built-in recognizer for the `merge` attribute.
 * @property {function(Element): boolean} [shouldPreserve]
 * @property {function(Element): boolean} [shouldReAppend]
 * @property {function(Element): boolean} [shouldRemove]
 * @property {function(Element, {added: Node[], kept: Element[], removed: Element[]}): void} [afterScriptsHandled]
 */

/**
 * @typedef {object} ConfigCallbacks
 *
 * @property {function(Node): boolean} [beforeNodeAdded]
 * @property {function(Node): void} [afterNodeAdded]
 * @property {function(Element, Node): boolean} [beforeNodeMorphed]
 * @property {function(Element, Node): void} [afterNodeMorphed]
 * @property {function(Element): boolean} [beforeNodeRemoved]
 * @property {function(Element): void} [afterNodeRemoved]
 * @property {function(string, Element, "update" | "remove"): boolean} [beforeAttributeUpdated]
 */

/**
 * @typedef {object} Config
 *
 * @property {'outerHTML' | 'innerHTML'} [morphStyle]
 * @property {boolean} [ignoreActive]
 * @property {boolean} [ignoreActiveValue]
 * @property {boolean} [restoreFocus]
 * @property {'attribute' | 'property'} [formStateSync] - How to sync form-control state across morphs. Default `'attribute'`: the new element's `value` / `checked` / `selected` ATTRIBUTES are authoritative — typical for HTML-serialization use cases like hyperclay-livesync where keystrokes are mirrored into attributes so cloneNode/outerHTML captures them. Set to `'property'` when callers build the new fragment via `document.createElement` + property assignment (e.g. an in-memory rebuild of a CMS form); in `'property'` mode the morph reads/writes form-control state via PROPERTY assignment only, leaving attributes untouched.
 * @property {ConfigCallbacks} [callbacks]
 * @property {ConfigHead} [head]
 * @property {ConfigScripts} [scripts]
 * @property {function(Element): (string|null|undefined)} [key] - Optional identity callback. Equal non-null returns pair elements regardless of position or content scoring. Duplicate keys on either side fall through to content scoring.
 */

/**
 * @typedef {function} NoOp
 *
 * @returns {void}
 */

/**
 * @typedef {object} ConfigHeadInternal
 *
 * @property {'merge' | 'append' | 'morph' | 'none'} style
 * @property {boolean} [block]
 * @property {boolean} [ignore]
 * @property {(function(Element): boolean) | NoOp} shouldPreserve
 * @property {(function(Element): boolean) | NoOp} shouldReAppend
 * @property {(function(Element): boolean) | NoOp} shouldRemove
 * @property {(function(Element, {added: Node[], kept: Element[], removed: Element[]}): void) | NoOp} afterHeadMorphed
 */

/**
 * @typedef {object} ConfigScriptsInternal
 *
 * @property {boolean} handle
 * @property {'outerHTML' | 'smart'} matchMode
 * @property {boolean} [merge]
 * @property {string | Element | Document | null} [mergeBase]
 * @property {MergeTagRecognizer[]} [mergeTags]
 * @property {(function(Element): boolean) | NoOp} shouldPreserve
 * @property {(function(Element): boolean) | NoOp} shouldReAppend
 * @property {(function(Element): boolean) | NoOp} shouldRemove
 * @property {(function(Element, {added: Node[], kept: Element[], removed: Element[]}): void) | NoOp} afterScriptsHandled
 */

/**
 * @typedef {object} ConfigCallbacksInternal
 *
 * @property {(function(Node): boolean) | NoOp} beforeNodeAdded
 * @property {(function(Node): void) | NoOp} afterNodeAdded
 * @property {(function(Node, Node): boolean) | NoOp} beforeNodeMorphed
 * @property {(function(Node, Node): void) | NoOp} afterNodeMorphed
 * @property {(function(Node): boolean) | NoOp} beforeNodeRemoved
 * @property {(function(Node): void) | NoOp} afterNodeRemoved
 * @property {(function(string, Element, "update" | "remove"): boolean) | NoOp} beforeAttributeUpdated
 */

/**
 * @typedef {object} ConfigInternal
 *
 * @property {'outerHTML' | 'innerHTML'} morphStyle
 * @property {boolean} [ignoreActive]
 * @property {boolean} [ignoreActiveValue]
 * @property {boolean} [restoreFocus]
 * @property {'attribute' | 'property'} [formStateSync]
 * @property {ConfigCallbacksInternal} callbacks
 * @property {ConfigHeadInternal} head
 * @property {ConfigScriptsInternal} scripts
 * @property {function(Element): (string|null|undefined)} [key]
 */

/**
 * @typedef {Object} IdSets
 * @property {Set<string>} persistentIds
 * @property {Map<Node, Set<string>>} idMap
 */

/**
 * @typedef {Function} Morph
 *
 * @param {Element | Document} oldNode
 * @param {Element | Node | HTMLCollection | Node[] | string | null} newContent
 * @param {Config} [config]
 * @returns {Node[] | Promise<Node[]>}
 */

// base IIFE to define HyperMorph
/**
 *
 * @type {{defaults: ConfigInternal, morph: Morph}}
 */
var HyperMorph = (function () {
  "use strict";

  /**
   * @typedef {object} MorphContext
   *
   * @property {Element} target
   * @property {Element} newContent
   * @property {ConfigInternal} config
   * @property {ConfigInternal['morphStyle']} morphStyle
   * @property {ConfigInternal['ignoreActive']} ignoreActive
   * @property {ConfigInternal['ignoreActiveValue']} ignoreActiveValue
   * @property {ConfigInternal['restoreFocus']} restoreFocus
   * @property {ConfigInternal['formStateSync']} formStateSync
   * @property {Map<Node, Set<string>>} idMap
   * @property {Set<string>} persistentIds
   * @property {ConfigInternal['callbacks']} callbacks
   * @property {ConfigInternal['head']} head
   * @property {ConfigInternal['scripts']} scripts
   * @property {MergeContext | null} merge - mergeable-script pairing/base state, null when neither tree has a mergeable script
   * @property {HTMLDivElement} pantry
   * @property {Element[]} activeElementAndParents
   * @property {Map<Element, Element>} hyperMatches - hyper-match results (newEl -> oldEl)
   * @property {Set<Element>} hyperMatchedOldElements - old elements that are hyper-matched
   */

  //=============================================================================
  // AND NOW IT BEGINS...
  //=============================================================================

  const noOp = () => {};

  const SYNC_IGNORE_SELECTOR =
    '[save-ignore],[snapshot-remove],[no-snapshot],[no-save],[save-remove],[freeze],[save-freeze],[clay~="no-save"],[clay~="no-snapshot"],[clay~="freeze"]';

  /**
   * Check if an element should be ignored during morphing.
   * Sync-ignored nodes are local-instance chrome: never morphed into, removed,
   * or synced, and never used as a morph target. Markers:
   *   - save-ignore: explicit "leave me alone".
   *   - snapshot-remove / no-snapshot: stripped from every snapshot (save, sync,
   *     comparison), so a receiver must keep its own local copy rather than
   *     delete it as a stray node.
   *   - no-save / save-remove: stripped from every saved file. A receiver
   *     morphing saved HTML would otherwise delete its own runtime copy.
   *   - freeze / save-freeze: saved as authored; runtime changes are
   *     per-instance, so a receiver keeps its own runtime state instead of
   *     being reset to the sender's.
   * Browser extension <script>/<link> elements are also ignored.
   * @param {Node} node
   * @returns {boolean}
   */
  function shouldIgnoreForSync(node) {
    if (!(node instanceof Element)) return false;

    if (node.matches(SYNC_IGNORE_SELECTOR)) return true;

    // Browser extension elements (never sync these)
    if (node.tagName === "LINK" || node.tagName === "SCRIPT") {
      const url = node.getAttribute("src") || node.getAttribute("href") || "";
      if (
        url.startsWith("chrome-extension://") ||
        url.startsWith("moz-extension://") ||
        url.startsWith("safari-web-extension://")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Subtree-aware variant: true when the node OR ANY ANCESTOR is sync-ignored.
   * The matcher must use this one — descendants of an ignored region would
   * otherwise stay in the match index and get moved out of local-only chrome.
   * @param {Node} node
   * @returns {boolean}
   */
  function shouldIgnoreForSyncDeep(node) {
    if (!(node instanceof Element)) return false;
    if (node.closest(SYNC_IGNORE_SELECTOR)) return true;
    return shouldIgnoreForSync(node);
  }

  // Create a matcher instance for use in morphing. Sync-ignored chrome is
  // excluded from candidacy so incoming content is never matched into a
  // local-only node.
  const HyperMatchMatcher = createMatcher({
    shouldIgnore: shouldIgnoreForSyncDeep,
  });

  /**
   * Get a signature for script matching.
   * - mergeable scripts (both modes): identity-based, so a content change
   *   never reads as a new script — this is what stops the clone-swap and
   *   re-execution churn for merge tags
   * - 'outerHTML' mode: exact outerHTML string (default, backward compatible)
   * - 'smart' mode: normalized src URL (external) or content hash (inline)
   * @param {Element} script
   * @param {'outerHTML' | 'smart'} [mode='outerHTML']
   * @param {MergeContext | null} [merge]
   * @returns {string}
   */
  function getScriptSignature(script, mode, merge) {
    if (merge) {
      const found = merge.identityOf(script);
      if (found && !merge.disabled.has(found.key)) {
        return "hm-merge:" + found.key;
      }
    }
    if (mode !== "smart") {
      return script.outerHTML;
    }

    const src = script.getAttribute("src");
    const type = script.getAttribute("type") || "text/javascript";

    if (src) {
      // External script: normalize URL (preserve query, strip hash).
      // The query string is kept because cache-busting tokens like ?v=123 are
      // semantically meaningful — stripping them would make different asset
      // versions collide and block new versions from being loaded.
      try {
        const url = new URL(src, window.location.href);
        return `ext:${type}:${url.origin}${url.pathname}${url.search}`;
      } catch {
        return `ext:${type}:${src}`;
      }
    } else {
      // Inline script: hash of trimmed content
      const content = script.textContent.trim();
      let hash = 5381;
      for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
      }
      return `inline:${type}:${Math.abs(hash).toString(36)}`;
    }
  }

  const HTML_NS = "http://www.w3.org/1999/xhtml";

  /**
   * @param {Node} node
   * @returns {boolean}
   */
  function isHtmlScript(node) {
    return (
      node instanceof Element &&
      node.tagName === "SCRIPT" &&
      node.namespaceURI === HTML_NS
    );
  }

  /**
   * Build an inert copy of a script element. Fragment parsing marks scripts
   * "already started", so the copy never executes — not when inserted, not when
   * moved, not when cloned — while still serializing identically. This makes
   * handleBodyScripts the single place scripts ever execute.
   * @param {Element} script
   * @returns {Element}
   */
  function makeInertScript(script) {
    const container = document.createElement("div");
    container.innerHTML = "<scr" + "ipt></scr" + "ipt>";
    const inert = /** @type {Element} */ (container.firstChild);
    for (const attr of script.attributes) {
      inert.setAttribute(attr.name, attr.value);
    }
    inert.textContent = script.textContent;
    return inert;
  }

  /**
   * Replace every HTML script in the subtree (including the root itself) with
   * an inert copy.
   * @param {Node} root
   * @returns {Node} the root, or its inert replacement if root was a script
   */
  function neutralizeScripts(root) {
    if (isHtmlScript(root)) {
      return makeInertScript(/** @type {Element} */ (root));
    }
    if (root instanceof Element) {
      for (const script of root.querySelectorAll("script")) {
        if (isHtmlScript(script)) {
          script.replaceWith(makeInertScript(script));
        }
      }
    }
    return root;
  }

  /**
   * True for script types whose content is JSON data, never executable code.
   * Merging is restricted to these: merging JS text is meaningless, and the
   * merge path must never interact with script execution.
   * @param {Element} script
   * @returns {boolean}
   */
  function isJsonScript(script) {
    const type = (script.getAttribute("type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return type === "application/json" || type.endsWith("+json");
  }

  /**
   * Built-in recognizer: `merge="<name>"` opts a JSON script tag into
   * three-way merging; the attribute value is its identity.
   * @type {MergeTagRecognizer}
   */
  const builtinMergeRecognizer = {
    match: (el) => el.hasAttribute("merge"),
    identity: (el) => el.getAttribute("merge"),
  };

  /**
   * @typedef {object} MergeIdentity
   * @property {string} key - recognizer-namespaced identity used for pairing/signatures
   * @property {string} raw - the author-visible identity (for warnings)
   * @property {MergeTagRecognizer} recognizer
   */

  /**
   * @typedef {object} MergeContext
   * @property {function(Node): (MergeIdentity | null)} identityOf
   * @property {Set<string>} disabled - identities that appear more than once in a tree (merge off, today's behavior)
   * @property {Map<string, Element>} oldByKey
   * @property {Map<string, Element>} newByKey
   * @property {function(): Map<string, string>} baseTexts - lazy: parses mergeBase on first merged pair
   */

  /**
   * Build the merge context for mergeable script tags (`[merge]` plus any
   * scripts.mergeTags recognizers). Returns null when neither tree contains
   * one, so the common case costs a single scan and never parses mergeBase.
   * @param {Element} oldNode
   * @param {Element} newContent - normalized parent (possibly a SlicedParentNode duck-type)
   * @param {ConfigScriptsInternal} scriptsConfig
   * @returns {MergeContext | null}
   */
  function createMergeContext(oldNode, newContent, scriptsConfig) {
    if (scriptsConfig.merge === false) return null;
    const recognizers = [
      builtinMergeRecognizer,
      ...(scriptsConfig.mergeTags || []),
    ];
    const identityCache = new WeakMap();

    /** @type {MergeContext['identityOf']} */
    const identityOf = (node) => {
      if (identityCache.has(node)) return identityCache.get(node);
      let found = null;
      if (
        isHtmlScript(node) &&
        !(/** @type {Element} */ (node).getAttribute("src")) &&
        !shouldIgnoreForSyncDeep(node)
      ) {
        const el = /** @type {Element} */ (node);
        for (let i = 0; i < recognizers.length; i++) {
          if (!recognizers[i].match(el)) continue;
          if (!isJsonScript(el)) {
            console.warn(
              "[hyper-morph] merge ignored: script type is not JSON",
              el,
            );
          } else {
            const raw = recognizers[i].identity(el);
            if (raw != null && raw !== "") {
              found = { key: i + ":" + raw, raw, recognizer: recognizers[i] };
            }
          }
          break;
        }
      }
      identityCache.set(node, found);
      return found;
    };

    const disabled = new Set();
    /** @param {Element} root */
    const collect = (root) => {
      const map = new Map();
      /** @param {Element} el */
      const visit = (el) => {
        const found = identityOf(el);
        if (!found) return;
        if (map.has(found.key)) {
          disabled.add(found.key);
          console.warn(
            `[hyper-morph] merge disabled for duplicate identity "${found.raw}"`,
          );
        } else {
          map.set(found.key, el);
        }
      };
      if (isHtmlScript(root)) visit(root);
      for (const el of root.querySelectorAll("script")) visit(el);
      return map;
    };
    const oldByKey = collect(oldNode);
    const newByKey = collect(
      // @ts-ignore - unwrap a SlicedParentNode to its real single-node root
      /** @type {Element} */ (newContent.__hyperMorphRoot || newContent),
    );

    if (oldByKey.size === 0 && newByKey.size === 0) return null;

    /** @type {Map<string, string> | null} */
    let baseTextsMap = null;
    const baseTexts = () => {
      if (baseTextsMap) return baseTextsMap;
      baseTextsMap = new Map();
      const mergeBase = scriptsConfig.mergeBase;
      if (!mergeBase) return baseTextsMap;
      /** @type {Element} */
      let baseRoot;
      if (typeof mergeBase === "string") {
        baseRoot = new DOMParser().parseFromString(
          mergeBase,
          "text/html",
        ).documentElement;
      } else if (mergeBase instanceof Document) {
        baseRoot = mergeBase.documentElement;
      } else {
        baseRoot = mergeBase;
      }
      /** @param {Element} el */
      const record = (el) => {
        const found = identityOf(el);
        if (found && !baseTextsMap.has(found.key)) {
          baseTextsMap.set(found.key, el.textContent);
        }
      };
      if (isHtmlScript(baseRoot)) record(baseRoot);
      for (const el of baseRoot.querySelectorAll("script")) record(el);
      return baseTextsMap;
    };

    return { identityOf, disabled, oldByKey, newByKey, baseTexts };
  }

  /**
   * If old and new are the same mergeable script (same recognizer identity),
   * merge their JSON text three-way against the base version and write the
   * result into the old element. Returns true when handled: the caller must
   * then skip child morphing so the merged text survives.
   * @param {MorphContext} ctx
   * @param {Node} oldNode
   * @param {Node} newContent
   * @returns {boolean}
   */
  function morphMergeableScript(ctx, oldNode, newContent) {
    const merge = ctx.merge;
    if (!merge) return false;
    const oldFound = merge.identityOf(oldNode);
    if (!oldFound || merge.disabled.has(oldFound.key)) return false;
    const newFound = merge.identityOf(newContent);
    if (!newFound || newFound.key !== oldFound.key) return false;

    const oldEl = /** @type {Element} */ (oldNode);
    const newEl = /** @type {Element} */ (newContent);
    const keyAttr =
      newEl.getAttribute("merge-key") || oldEl.getAttribute("merge-key");
    const { text, warnings } = mergeScriptText(
      merge.baseTexts().get(oldFound.key),
      oldEl.textContent,
      newEl.textContent,
      {
        parse: oldFound.recognizer.parse,
        keyCandidates: keyAttr
          ? keyAttr.split(/[\s,]+/).filter(Boolean)
          : undefined,
      },
    );
    for (const warning of warnings) {
      console.warn(`[hyper-morph] merge "${oldFound.raw}": ${warning}`);
    }
    if (oldEl.textContent !== text) {
      oldEl.textContent = text;
    }
    return true;
  }

  /**
   * Default configuration values, updatable by users now
   * @type {ConfigInternal}
   */
  const defaults = {
    morphStyle: "outerHTML",
    callbacks: {
      beforeNodeAdded: noOp,
      afterNodeAdded: noOp,
      beforeNodeMorphed: noOp,
      afterNodeMorphed: noOp,
      beforeNodeRemoved: noOp,
      afterNodeRemoved: noOp,
      beforeAttributeUpdated: noOp,
    },
    head: {
      style: "merge",
      shouldPreserve: (elt) => elt.getAttribute("im-preserve") === "true",
      shouldReAppend: (elt) => elt.getAttribute("im-re-append") === "true",
      shouldRemove: noOp,
      afterHeadMorphed: noOp,
    },
    scripts: {
      handle: true,
      matchMode: "outerHTML", // 'outerHTML' | 'smart'
      shouldPreserve: (elt) => elt.getAttribute("im-preserve") === "true",
      shouldReAppend: (elt) => elt.getAttribute("im-re-append") === "true",
      shouldRemove: noOp,
      afterScriptsHandled: noOp,
    },
    restoreFocus: true,
  };

  //=============================================================================
  // HYPER-MORPH: Content-based element matching (imported from hyper-morph-matcher.js)
  //=============================================================================
  const HyperMatch = {
    /**
     * Compute all matches between two trees.
     * Uses session API for fresh caches per morph operation.
     * @param {Element} oldRoot
     * @param {Element} newRoot
     * @returns {Map<Element, Element>} Map of newEl -> oldEl
     */
    computeMatches(oldRoot, newRoot) {
      const { computeMatches } = HyperMatchMatcher.session();
      return computeMatches(oldRoot, newRoot);
    },
  };

  /**
   * Core morph function for morphing one DOM tree to another
   *
   * @param {Element | Document} oldNode
   * @param {Element | Node | HTMLCollection | Node[] | string | null} newContent
   * @param {Config} [config]
   * @returns {Promise<Node[]> | Node[]}
   */
  function morph(oldNode, newContent, config = {}) {
    oldNode = normalizeElement(oldNode);
    const newNode = normalizeParent(newContent);
    const ctx = createMorphContext(oldNode, newNode, config);

    // Collect old script signatures before morph (for body script handling)
    const oldScriptSignatures = ctx.scripts.handle
      ? new Set(
          Array.from(oldNode.querySelectorAll("script")).map((s) =>
            getScriptSignature(s, ctx.scripts.matchMode, ctx.merge),
          ),
        )
      : null;

    const focusState = captureFocusState(ctx);

    const morphed = withHeadBlocking(
      ctx,
      oldNode,
      newNode,
      /** @param {MorphContext} ctx */ (ctx) => {
        if (ctx.morphStyle === "innerHTML") {
          morphChildren(ctx, oldNode, newNode);
          return Array.from(oldNode.childNodes);
        } else {
          return morphOuterHTML(ctx, oldNode, newNode);
        }
      },
    );

    // Everything after the morph body must wait for it: with head.block the
    // body runs async, and scripts/pantry/focus all need the post-morph DOM.
    /**
     * @param {Node[]} morphedNodes
     * @returns {Node[] | Promise<Node[]>}
     */
    const finish = (morphedNodes) => {
      if (focusState) restoreFocusState(ctx, focusState);
      drainPantry(ctx);
      const scriptPromises = oldScriptSignatures
        ? handleBodyScripts(morphedNodes, oldScriptSignatures, ctx)
        : [];
      if (scriptPromises.length > 0) {
        return Promise.all(scriptPromises).then(() => morphedNodes);
      }
      return morphedNodes;
    };

    return morphed instanceof Promise ? morphed.then(finish) : finish(morphed);
  }

  /**
   * Nodes parked in the pantry but never reclaimed still owe callers their
   * removal callbacks before being discarded with the pantry.
   * @param {MorphContext} ctx
   */
  function drainPantry(ctx) {
    for (const node of Array.from(ctx.pantry.childNodes)) {
      if (ctx.callbacks.beforeNodeRemoved(node) !== false) {
        ctx.callbacks.afterNodeRemoved(node);
      }
    }
    ctx.pantry.remove();
  }

  /**
   * Morph just the outerHTML of the oldNode to the newContent
   * We have to be careful because the oldNode could have siblings which need to be untouched
   * @param {MorphContext} ctx
   * @param {Element} oldNode
   * @param {Element} newNode
   * @returns {Node[]}
   */
  function morphOuterHTML(ctx, oldNode, newNode) {
    const oldParent = normalizeParent(oldNode);
    morphChildren(
      ctx,
      oldParent,
      newNode,
      // these two optional params are the secret sauce
      oldNode, // start point for iteration
      oldNode.nextSibling, // end point for iteration
    );
    // this is safe even with siblings, because normalizeParent returns a SlicedParentNode if needed.
    return Array.from(oldParent.childNodes);
  }

  /**
   * @param {MorphContext} ctx
   * @returns {{ element: HTMLInputElement | HTMLTextAreaElement, id: string, selectionStart: number | null, selectionEnd: number | null } | null}
   */
  function captureFocusState(ctx) {
    if (!ctx.config.restoreFocus) return null;
    const activeElement = document.activeElement;

    // don't bother if the active element is not an input or textarea
    if (
      !(
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement
      )
    ) {
      return null;
    }

    const { id, selectionStart, selectionEnd } = activeElement;
    return { element: activeElement, id, selectionStart, selectionEnd };
  }

  /**
   * @param {MorphContext} ctx
   * @param {NonNullable<ReturnType<typeof captureFocusState>>} focusState
   */
  function restoreFocusState(ctx, focusState) {
    let activeElement = focusState.element;
    if (
      focusState.id &&
      focusState.id !== document.activeElement?.getAttribute("id")
    ) {
      activeElement = ctx.target.querySelector(
        `[id="${CSS.escape(focusState.id)}"]`,
      );
      activeElement?.focus();
    }
    if (
      activeElement &&
      !activeElement.selectionEnd &&
      focusState.selectionEnd != null
    ) {
      try {
        activeElement.setSelectionRange(
          focusState.selectionStart,
          focusState.selectionEnd,
        );
      } catch {
        // selection is unsupported on the element's current input type
      }
    }
  }

  const morphChildren = (function () {
    /**
     * This is the core algorithm for matching up children.  The idea is to use id sets to try to match up
     * nodes as faithfully as possible.  We greedily match, which allows us to keep the algorithm fast, but
     * by using id sets, we are able to better match up with content deeper in the DOM.
     *
     * Basic algorithm:
     * - for each node in the new content:
     *   - search self and siblings for an id set match, falling back to a soft match
     *   - if match found
     *     - remove any nodes up to the match:
     *       - pantry persistent nodes
     *       - delete the rest
     *     - morph the match
     *   - elsif no match found, and node is persistent
     *     - find its match by querying the old root (future) and pantry (past)
     *     - move it and its children here
     *     - morph it
     *   - else
     *     - create a new node from scratch as a last result
     *
     * @param {MorphContext} ctx the merge context
     * @param {Element} oldParent the old content that we are merging the new content into
     * @param {Element} newParent the parent element of the new content
     * @param {Node|null} [insertionPoint] the point in the DOM we start morphing at (defaults to first child)
     * @param {Node|null} [endPoint] the point in the DOM we stop morphing at (defaults to after last child)
     */
    function morphChildren(
      ctx,
      oldParent,
      newParent,
      insertionPoint = null,
      endPoint = null,
    ) {
      // normalize
      if (
        oldParent instanceof HTMLTemplateElement &&
        newParent instanceof HTMLTemplateElement
      ) {
        // @ts-ignore we can pretend the DocumentFragment is an Element
        oldParent = oldParent.content;
        // @ts-ignore ditto
        newParent = newParent.content;
      }
      insertionPoint ||= oldParent.firstChild;

      // run through all the new content
      for (const newChild of newParent.childNodes) {
        // Skip elements with save-ignore - they shouldn't be synced from source
        if (shouldIgnoreForSync(newChild)) {
          continue;
        }

        // once we reach the end of the old parent content skip to the end and insert the rest
        if (insertionPoint && insertionPoint != endPoint) {
          const bestMatch = findBestMatch(
            ctx,
            newChild,
            insertionPoint,
            endPoint,
          );
          if (bestMatch) {
            // if the node to morph is not at the insertion point then remove/move up to it
            if (bestMatch !== insertionPoint) {
              removeNodesBetween(ctx, insertionPoint, bestMatch);
            }
            morphNode(bestMatch, newChild, ctx);
            insertionPoint = bestMatch.nextSibling;
            continue;
          }
        }

        // if the matching node is elsewhere in the original content
        if (newChild instanceof Element) {
          // we can pretend the id is non-null because the next `.has` line will reject it if not
          const newChildId = /** @type {String} */ (
            newChild.getAttribute("id")
          );
          if (ctx.persistentIds.has(newChildId)) {
            // move it and all its children here and morph
            const movedChild = moveBeforeById(
              oldParent,
              newChildId,
              insertionPoint,
              ctx,
            );
            morphNode(movedChild, newChild, ctx);
            insertionPoint = movedChild.nextSibling;
            continue;
          }

          // Check if hyper-match found this element outside the current range
          // Only use hyper-match for elements without persistent IDs
          if (!ctx.idMap.has(newChild)) {
            const hyperMatch = ctx.hyperMatches.get(newChild);
            if (
              hyperMatch &&
              !ctx.idMap.has(hyperMatch) &&
              !containsMoveTarget(hyperMatch, oldParent)
            ) {
              // Move the hyper-matched element here (from future or pantry)
              moveBefore(oldParent, hyperMatch, insertionPoint);
              morphNode(hyperMatch, newChild, ctx);
              insertionPoint = hyperMatch.nextSibling;
              continue;
            }
          }
        }

        // last resort: insert the new node from scratch
        const insertedNode = createNode(
          oldParent,
          newChild,
          insertionPoint,
          ctx,
        );
        // could be null if beforeNodeAdded prevented insertion
        if (insertedNode) {
          insertionPoint = insertedNode.nextSibling;
        }
      }

      // remove any remaining old nodes that didn't match up with new content
      while (insertionPoint && insertionPoint != endPoint) {
        const tempNode = insertionPoint;
        insertionPoint = insertionPoint.nextSibling;
        // Preserve elements with save-ignore - they shouldn't be removed during sync
        if (!shouldIgnoreForSync(tempNode)) {
          removeNode(ctx, tempNode);
        }
      }
    }

    /**
     * This performs the action of inserting a new node while handling situations where the node contains
     * elements with persistent ids and possible state info we can still preserve by moving in and then morphing
     *
     * @param {Element} oldParent
     * @param {Node} newChild
     * @param {Node|null} insertionPoint
     * @param {MorphContext} ctx
     * @returns {Node|null}
     */
    function createNode(oldParent, newChild, insertionPoint, ctx) {
      if (ctx.callbacks.beforeNodeAdded(newChild) === false) return null;
      if (ctx.idMap.has(newChild)) {
        // node has children with ids with possible state so create a dummy elt of same type and apply full morph algorithm
        const newElt = /** @type {Element} */ (newChild);
        const newEmptyChild = document.createElementNS(
          newElt.namespaceURI,
          newElt.localName,
        );
        oldParent.insertBefore(newEmptyChild, insertionPoint);
        morphNode(newEmptyChild, newChild, ctx);
        ctx.callbacks.afterNodeAdded(newEmptyChild);
        return newEmptyChild;
      } else {
        // optimisation: no id state to preserve so we can just insert a clone of the newChild and its descendants
        const newClonedChild = neutralizeScripts(
          document.importNode(newChild, true),
        ); // importNode to not mutate newParent
        oldParent.insertBefore(newClonedChild, insertionPoint);
        ctx.callbacks.afterNodeAdded(newClonedChild);
        return newClonedChild;
      }
    }

    //=============================================================================
    // Matching Functions
    //=============================================================================
    const findBestMatch = (function () {
      /**
       * Scans forward from the startPoint to the endPoint looking for a match
       * for the node. Priority order:
       * 1. Hyper-match (content-based) - if in range
       * 2. ID set match (explicit IDs)
       * 3. Soft match (same tag/nodeType) - fallback
       *
       * @param {Node} node
       * @param {MorphContext} ctx
       * @param {Node | null} startPoint
       * @param {Node | null} endPoint
       * @returns {Node | null}
       */
      function findBestMatch(ctx, node, startPoint, endPoint) {
        // Check if hyper-match found a result for this node (only for Elements)
        // Skip hyper-match for nodes with persistent IDs (let ID-based matching handle them)
        const hyperMatch =
          node instanceof Element && !ctx.idMap.has(node)
            ? ctx.hyperMatches.get(node)
            : null;

        let softMatch = null;
        let nextSibling = node.nextSibling;
        let siblingSoftMatchCount = 0;

        let cursor = startPoint;
        while (cursor && cursor != endPoint) {
          // Sync-ignored local nodes (chrome) are invisible to matching: never a
          // morph target, so incoming content can't be morphed into them.
          if (shouldIgnoreForSync(cursor)) {
            cursor = cursor.nextSibling;
            continue;
          }
          // soft matching is a prerequisite for id set matching and hyper-matching
          if (isSoftMatch(cursor, node)) {
            // Priority 1: ID set match (for elements with persistent IDs)
            if (isIdSetMatch(ctx, cursor, node)) {
              return cursor;
            }

            // Priority 2: Hyper-match (for anonymous elements without IDs in subtree)
            // Only use if cursor doesn't have persistent IDs (to avoid stealing from ID-based matching)
            if (cursor === hyperMatch && !ctx.idMap.has(cursor)) {
              return cursor;
            }

            // Priority 3: Save soft match as fallback
            if (softMatch === null) {
              // Skip if cursor will hard match something else in the future
              const isHyperMatched =
                cursor instanceof Element &&
                ctx.hyperMatchedOldElements.has(cursor);
              if (!ctx.idMap.has(cursor) && !isHyperMatched) {
                softMatch = cursor;
              }
            }
          }
          if (
            softMatch === null &&
            nextSibling &&
            isSoftMatch(cursor, nextSibling)
          ) {
            // The next new node has a soft match with this node, so
            // increment the count of future soft matches
            siblingSoftMatchCount++;
            nextSibling = nextSibling.nextSibling;

            // If there are two future soft matches, block soft matching for this node to allow
            // future siblings to soft match. This is to reduce churn in the DOM when an element
            // is prepended.
            if (siblingSoftMatchCount >= 2) {
              softMatch = undefined;
            }
          }

          // if the current node contains active element, stop looking for better future matches,
          // because if one is found, this node will be moved to the pantry, reparenting it and thus losing focus
          // @ts-ignore pretend cursor is Element rather than Node, we're just testing for array inclusion
          if (ctx.activeElementAndParents.includes(cursor)) break;

          cursor = cursor.nextSibling;
        }

        return softMatch || null;
      }

      /**
       *
       * @param {MorphContext} ctx
       * @param {Node} oldNode
       * @param {Node} newNode
       * @returns {boolean}
       */
      function isIdSetMatch(ctx, oldNode, newNode) {
        let oldSet = ctx.idMap.get(oldNode);
        let newSet = ctx.idMap.get(newNode);

        if (!newSet || !oldSet) return false;

        for (const id of oldSet) {
          // a potential match is an id in the new and old nodes that
          // has not already been merged into the DOM
          // But the newNode content we call this on has not been
          // merged yet and we don't allow duplicate IDs so it is simple
          if (newSet.has(id)) {
            return true;
          }
        }
        return false;
      }

      /**
       *
       * @param {Node} oldNode
       * @param {Node} newNode
       * @returns {boolean}
       */
      function isSoftMatch(oldNode, newNode) {
        // ok to cast: if one is not element, `id` and `tagName` will be undefined and we'll just compare that.
        const oldElt = /** @type {Element} */ (oldNode);
        const newElt = /** @type {Element} */ (newNode);

        return (
          oldElt.nodeType === newElt.nodeType &&
          oldElt.tagName === newElt.tagName &&
          // If oldElt has an `id` with possible state and it doesn't match newElt.id then avoid morphing.
          // We'll still match an anonymous node with an IDed newElt, though, because if it got this far,
          // its not persistent, and new nodes can't have any hidden state.
          // We can't use .id because of form input shadowing, and we can't count on .getAttribute's presence because it could be a document-fragment
          (!oldElt.getAttribute?.("id") ||
            oldElt.getAttribute?.("id") === newElt.getAttribute?.("id"))
        );
      }

      return findBestMatch;
    })();

    //=============================================================================
    // DOM Manipulation Functions
    //=============================================================================

    /**
     * Gets rid of an unwanted DOM node; strategy depends on nature of its reuse:
     * - Persistent nodes (ID-matched or hyper-matched) will be moved to the pantry for later reuse
     * - Other nodes will have their hooks called, and then are removed
     * @param {MorphContext} ctx
     * @param {Node} node
     */
    function removeNode(ctx, node) {
      // are we going to id set match or hyper-match this later?
      // Note: hyper-match only applies to elements without persistent IDs
      const isHyperMatched =
        node instanceof Element &&
        ctx.hyperMatchedOldElements.has(node) &&
        !ctx.idMap.has(node);
      if (ctx.idMap.has(node) || isHyperMatched) {
        // skip callbacks and move to pantry
        moveBefore(ctx.pantry, node, null);
      } else {
        // remove for realsies
        if (ctx.callbacks.beforeNodeRemoved(node) === false) return;
        node.parentNode?.removeChild(node);
        ctx.callbacks.afterNodeRemoved(node);
      }
    }

    /**
     * Remove nodes between the start and end nodes
     * @param {MorphContext} ctx
     * @param {Node} startInclusive
     * @param {Node} endExclusive
     * @returns {Node|null}
     */
    function removeNodesBetween(ctx, startInclusive, endExclusive) {
      /** @type {Node | null} */
      let cursor = startInclusive;
      // remove nodes until the endExclusive node
      while (cursor && cursor !== endExclusive) {
        let tempNode = /** @type {Node} */ (cursor);
        cursor = cursor.nextSibling;
        // Preserve elements with save-ignore
        if (!shouldIgnoreForSync(tempNode)) {
          removeNode(ctx, tempNode);
        }
      }
      return cursor;
    }

    /**
     * Search for an element by id within the document and pantry, and move it using moveBefore.
     *
     * @param {Element} parentNode - The parent node to which the element will be moved.
     * @param {string} id - The ID of the element to be moved.
     * @param {Node | null} after - The reference node to insert the element before.
     *                              If `null`, the element is appended as the last child.
     * @param {MorphContext} ctx
     * @returns {Element} The found element
     */
    function moveBeforeById(parentNode, id, after, ctx) {
      const target =
        /** @type {Element} - will always be found */
        (
          // ctx.target.id unsafe because of form input shadowing
          // ctx.target could be a document fragment which doesn't have `getAttribute`
          (ctx.target.getAttribute?.("id") === id && ctx.target) ||
            ctx.target.querySelector(`[id="${CSS.escape(id)}"]`) ||
            ctx.pantry.querySelector(`[id="${CSS.escape(id)}"]`)
        );
      removeElementFromAncestorsIdMaps(target, ctx);
      moveBefore(parentNode, target, after);
      return target;
    }

    /**
     * Removes an element from its ancestors' id maps. This is needed when an element is moved from the
     * "future" via `moveBeforeId`. Otherwise, its erstwhile ancestors could be mistakenly moved to the
     * pantry rather than being deleted, preventing their removal hooks from being called.
     *
     * @param {Element} element - element to remove from its ancestors' id maps
     * @param {MorphContext} ctx
     */
    function removeElementFromAncestorsIdMaps(element, ctx) {
      // we know id is non-null String, because this function is only called on elements with ids
      const id = /** @type {String} */ (element.getAttribute("id"));
      /** @ts-ignore - safe to loop in this way **/
      while ((element = element.parentNode)) {
        let idSet = ctx.idMap.get(element);
        if (idSet) {
          idSet.delete(id);
          if (!idSet.size) {
            ctx.idMap.delete(element);
          }
        }
      }
    }

    /**
     * Moves an element before another element within the same parent.
     * Uses the proposed `moveBefore` API if available (and working), otherwise falls back to `insertBefore`.
     * This is essentialy a forward-compat wrapper.
     *
     * @param {Element} parentNode - The parent node containing the after element.
     * @param {Node} element - The element to be moved.
     * @param {Node | null} after - The reference node to insert `element` before.
     *                              If `null`, `element` is appended as the last child.
     */
    function moveBefore(parentNode, element, after) {
      // @ts-ignore - use proposed moveBefore feature
      if (parentNode.moveBefore) {
        try {
          // @ts-ignore - use proposed moveBefore feature
          parentNode.moveBefore(element, after);
        } catch (e) {
          // fall back to insertBefore as some browsers may fail on moveBefore when trying to move Dom disconnected nodes to pantry
          parentNode.insertBefore(element, after);
        }
      } else {
        parentNode.insertBefore(element, after);
      }
    }

    /**
     * True when moving `element` into `oldParent` would create a cycle
     * (element is an ancestor of the destination) — both moveBefore and
     * insertBefore throw HierarchyRequestError on such moves.
     * @param {Element} element
     * @param {Element} oldParent - may be a SlicedParentNode duck-type
     * @returns {boolean}
     */
    function containsMoveTarget(element, oldParent) {
      const parentEl =
        oldParent instanceof Element
          ? oldParent
          : /** @type {any} */ (oldParent).realParentNode;
      return !!parentEl && element.contains(parentEl);
    }

    return morphChildren;
  })();

  //=============================================================================
  // Single Node Morphing Code
  //=============================================================================
  const morphNode = (function () {
    /**
     * @param {Node} oldNode root node to merge content into
     * @param {Node} newContent new content to merge
     * @param {MorphContext} ctx the merge context
     * @returns {Node | null} the element that ended up in the DOM
     */
    function morphNode(oldNode, newContent, ctx) {
      if (ctx.ignoreActive && oldNode === document.activeElement) {
        // don't morph focused element
        return null;
      }

      if (ctx.callbacks.beforeNodeMorphed(oldNode, newContent) === false) {
        return oldNode;
      }

      if (oldNode instanceof HTMLHeadElement && ctx.head.ignore) {
        // ignore the head element
      } else if (
        oldNode instanceof HTMLHeadElement &&
        ctx.head.style !== "morph"
      ) {
        // ok to cast: if newContent wasn't also a <head>, it would've got caught in the `!isSoftMatch` branch above
        handleHeadElement(
          oldNode,
          /** @type {HTMLHeadElement} */ (newContent),
          ctx,
        );
      } else {
        morphAttributes(oldNode, newContent, ctx);
        if (!morphMergeableScript(ctx, oldNode, newContent)) {
          if (!ignoreValueOfActiveElement(oldNode, ctx)) {
            // @ts-ignore newContent can be a node here because .firstChild will be null
            morphChildren(ctx, oldNode, newContent);
          }
        }
      }
      ctx.callbacks.afterNodeMorphed(oldNode, newContent);
      return oldNode;
    }

    /**
     * syncs the oldNode to the newNode, copying over all attributes and
     * inner element state from the newNode to the oldNode
     *
     * @param {Node} oldNode the node to copy attributes & state to
     * @param {Node} newNode the node to copy attributes & state from
     * @param {MorphContext} ctx the merge context
     */
    function morphAttributes(oldNode, newNode, ctx) {
      let type = newNode.nodeType;

      // if is an element type, sync the attributes from the
      // new node into the new node
      if (type === 1 /* element type */) {
        const oldElt = /** @type {Element} */ (oldNode);
        const newElt = /** @type {Element} */ (newNode);

        const oldAttributes = oldElt.attributes;
        const newAttributes = newElt.attributes;
        for (const newAttribute of newAttributes) {
          if (ignoreAttribute(newAttribute.name, oldElt, "update", ctx)) {
            continue;
          }
          if (oldElt.getAttribute(newAttribute.name) !== newAttribute.value) {
            oldElt.setAttribute(newAttribute.name, newAttribute.value);
          }
        }
        // iterate backwards to avoid skipping over items when a delete occurs
        for (let i = oldAttributes.length - 1; 0 <= i; i--) {
          const oldAttribute = oldAttributes[i];

          // toAttributes is a live NamedNodeMap, so iteration+mutation is unsafe
          // e.g. custom element attribute callbacks can remove other attributes
          if (!oldAttribute) continue;

          if (!newElt.hasAttribute(oldAttribute.name)) {
            if (ignoreAttribute(oldAttribute.name, oldElt, "remove", ctx)) {
              continue;
            }
            oldElt.removeAttribute(oldAttribute.name);
          }
        }

        if (!ignoreValueOfActiveElement(oldElt, ctx)) {
          syncInputValue(oldElt, newElt, ctx);
        }
      }

      // sync text nodes
      if (type === 8 /* comment */ || type === 3 /* text */) {
        if (oldNode.nodeValue !== newNode.nodeValue) {
          oldNode.nodeValue = newNode.nodeValue;
        }
      }
    }

    /**
     * NB: many bothans died to bring us information:
     *
     *  https://github.com/patrick-steele-idem/morphdom/blob/master/src/specialElHandlers.js
     *  https://github.com/choojs/nanomorph/blob/master/lib/morph.jsL113
     *
     * @param {Element} oldElement the element to sync the input value to
     * @param {Element} newElement the element to sync the input value from
     * @param {MorphContext} ctx the merge context
     */
    function syncInputValue(oldElement, newElement, ctx) {
      if (
        oldElement instanceof HTMLInputElement &&
        newElement instanceof HTMLInputElement &&
        newElement.type !== "file"
      ) {
        let newValue = newElement.value;
        let oldValue = oldElement.value;

        // sync boolean attributes
        syncBooleanAttribute(oldElement, newElement, "checked", ctx);
        syncBooleanAttribute(oldElement, newElement, "disabled", ctx);

        // indeterminate is property-only (invisible to serialization), so only
        // property mode may sync it — attribute mode would clear local state
        // on every snapshot morph.
        if (
          ctx.formStateSync === "property" &&
          oldElement.indeterminate !== newElement.indeterminate
        ) {
          oldElement.indeterminate = newElement.indeterminate;
        }

        if (ctx.formStateSync === "property") {
          // Property-driven: the live property is authoritative on both sides.
          // No attribute mutations — leaves serialization concerns to callers.
          if (oldValue !== newValue) {
            if (!ignoreAttribute("value", oldElement, "update", ctx)) {
              oldElement.value = newValue;
            }
          }
        } else if (!newElement.hasAttribute("value")) {
          if (!ignoreAttribute("value", oldElement, "remove", ctx)) {
            oldElement.value = "";
            oldElement.removeAttribute("value");
          }
        } else if (oldValue !== newValue) {
          if (!ignoreAttribute("value", oldElement, "update", ctx)) {
            oldElement.setAttribute("value", newValue);
            oldElement.value = newValue;
          }
        }
        // TODO: QUESTION(1cg): this used to only check `newElement` unlike the other branches -- why?
        // did I break something?
      } else if (
        oldElement instanceof HTMLOptionElement &&
        newElement instanceof HTMLOptionElement
      ) {
        syncBooleanAttribute(oldElement, newElement, "selected", ctx);
      } else if (
        oldElement instanceof HTMLTextAreaElement &&
        newElement instanceof HTMLTextAreaElement
      ) {
        let newValue = newElement.value;
        let oldValue = oldElement.value;
        if (ignoreAttribute("value", oldElement, "update", ctx)) {
          return;
        }
        if (newValue !== oldValue) {
          oldElement.value = newValue;
        }
        if (ctx.formStateSync === "property") return;
        if (
          oldElement.firstChild &&
          oldElement.firstChild.nodeValue !== newValue
        ) {
          oldElement.firstChild.nodeValue = newValue;
        }
      }
    }

    /**
     * @param {Element} oldElement element to write the value to
     * @param {Element} newElement element to read the value from
     * @param {string} attributeName the attribute name
     * @param {MorphContext} ctx the merge context
     */
    function syncBooleanAttribute(oldElement, newElement, attributeName, ctx) {
      // @ts-ignore this function is only used on boolean attrs that are reflected as dom properties
      const newLiveValue = newElement[attributeName],
        // @ts-ignore ditto
        oldLiveValue = oldElement[attributeName];
      if (newLiveValue !== oldLiveValue) {
        const ignoreUpdate = ignoreAttribute(
          attributeName,
          oldElement,
          "update",
          ctx,
        );
        if (!ignoreUpdate) {
          // update attribute's associated DOM property
          // @ts-ignore this function is only used on boolean attrs that are reflected as dom properties
          oldElement[attributeName] = newElement[attributeName];
        }
        // Property-driven mode: skip attribute mutation. The property write
        // above is enough — callers don't care about HTML-serializable form
        // state (no livesync, no cloneNode roundtripping).
        if (ctx.formStateSync === "property") return;
        if (newLiveValue) {
          if (!ignoreUpdate) {
            // https://developer.mozilla.org/en-US/docs/Glossary/Boolean/HTML
            // this is the correct way to set a boolean attribute to "true"
            oldElement.setAttribute(attributeName, "");
          }
        } else {
          if (!ignoreAttribute(attributeName, oldElement, "remove", ctx)) {
            oldElement.removeAttribute(attributeName);
          }
        }
      }
    }

    /**
     * @param {string} attr the attribute to be mutated
     * @param {Element} element the element that is going to be updated
     * @param {"update" | "remove"} updateType
     * @param {MorphContext} ctx the merge context
     * @returns {boolean} true if the attribute should be ignored, false otherwise
     */
    function ignoreAttribute(attr, element, updateType, ctx) {
      if (
        attr === "value" &&
        ctx.ignoreActiveValue &&
        element === document.activeElement
      ) {
        return true;
      }
      return (
        ctx.callbacks.beforeAttributeUpdated(attr, element, updateType) ===
        false
      );
    }

    /**
     * @param {Node} possibleActiveElement
     * @param {MorphContext} ctx
     * @returns {boolean}
     */
    function ignoreValueOfActiveElement(possibleActiveElement, ctx) {
      return (
        !!ctx.ignoreActiveValue &&
        possibleActiveElement === document.activeElement &&
        possibleActiveElement !== document.body
      );
    }

    return morphNode;
  })();

  //=============================================================================
  // Head Management Functions
  //=============================================================================
  /**
   * @param {MorphContext} ctx
   * @param {Element} oldNode
   * @param {Element} newNode
   * @param {function} callback
   * @returns {Node[] | Promise<Node[]>}
   */
  function withHeadBlocking(ctx, oldNode, newNode, callback) {
    if (ctx.head.block) {
      const oldHead = oldNode.querySelector("head");
      const newHead = newNode.querySelector("head");
      if (oldHead && newHead) {
        const promises = handleHeadElement(oldHead, newHead, ctx);
        // when head promises resolve, proceed ignoring the head tag
        return Promise.all(promises).then(() => {
          ctx.head.block = false;
          ctx.head.ignore = true;
          return callback(ctx);
        });
      }
    }
    // just proceed if we not head blocking
    return callback(ctx);
  }

  /**
   * Only elements that reliably fire a load event are awaited: scripts with a
   * src, and stylesheet links. Other href-bearing head elements (canonical,
   * alternate, manifest) never fire load and would hang head blocking forever.
   * @param {Element} elt
   * @returns {boolean}
   */
  function waitsForLoad(elt) {
    if (elt.tagName === "SCRIPT") return !!elt.getAttribute("src");
    if (elt.tagName === "LINK") {
      const rel = (elt.getAttribute("rel") || "").toLowerCase().split(/\s+/);
      return rel.includes("stylesheet") && !!elt.getAttribute("href");
    }
    return false;
  }

  /**
   *  The HEAD tag can be handled specially, either w/ a 'merge' or 'append' style
   *
   * @param {Element} oldHead
   * @param {Element} newHead
   * @param {MorphContext} ctx
   * @returns {Promise<void>[]}
   */
  function handleHeadElement(oldHead, newHead, ctx) {
    let added = [];
    let removed = [];
    let preserved = [];
    let nodesToAppend = [];

    const matchMode = ctx.scripts.matchMode;

    // Helper to get element signature (smart matching for scripts and links, outerHTML for others)
    const getSignature = (el) => {
      if (el.tagName === "SCRIPT") {
        return getScriptSignature(el, matchMode, ctx.merge);
      }
      // Smart matching for link elements (stylesheets, etc.)
      if (el.tagName === "LINK" && matchMode === "smart") {
        const href = el.getAttribute("href");
        if (href) {
          try {
            const url = new URL(href, window.location.href);
            const rel = el.getAttribute("rel") || "";
            // Include rel to distinguish stylesheet vs preload vs icon, etc.
            // Preserve query (cache-busting tokens like ?v=123 are significant),
            // drop hash (not meaningful for stylesheet loading).
            return `link:${rel}:${url.origin}${url.pathname}${url.search}`;
          } catch {
            // Invalid URL, fall back to outerHTML
          }
        }
      }
      return el.outerHTML;
    };

    // put all new head elements into buckets by signature — a Map<sig, Element[]>
    // multiset, so duplicate identical elements (e.g. two same preload links)
    // are each accounted for instead of collapsing.
    // Skip elements with save-ignore - they shouldn't be synced from source
    let srcToNewHeadNodes = new Map();
    for (const newHeadChild of newHead.children) {
      if (shouldIgnoreForSync(newHeadChild)) {
        continue;
      }
      const sig = getSignature(newHeadChild);
      let bucket = srcToNewHeadNodes.get(sig);
      if (!bucket) {
        bucket = [];
        srcToNewHeadNodes.set(sig, bucket);
      }
      bucket.push(newHeadChild);
    }

    // for each elt in the current head
    for (const currentHeadElt of oldHead.children) {
      // If the current head element is in the map
      const sig = getSignature(currentHeadElt);
      const bucket = srcToNewHeadNodes.get(sig);
      let inNewContent = !!(bucket && bucket.length);
      let isReAppended = ctx.head.shouldReAppend(currentHeadElt);
      let isPreserved = ctx.head.shouldPreserve(currentHeadElt);
      if (inNewContent || isPreserved) {
        if (isReAppended) {
          // remove the current version and let the new version replace it and re-execute
          removed.push(currentHeadElt);
        } else {
          // this element already exists and should not be re-appended, so remove it from
          // the new content map, preserving it in the DOM
          if (bucket && bucket.length) {
            const newHeadElt = bucket.pop();
            if (!bucket.length) srcToNewHeadNodes.delete(sig);
            // Mergeable scripts match by identity, so the preserved element's
            // text may differ from the incoming one: merge it in place. Head
            // preserve keeps attributes as-is, matching head semantics.
            morphMergeableScript(ctx, currentHeadElt, newHeadElt);
          }
          preserved.push(currentHeadElt);
        }
      } else {
        if (ctx.head.style === "append") {
          // we are appending and this existing element is not new content
          // so if and only if it is marked for re-append do we do anything
          if (isReAppended) {
            removed.push(currentHeadElt);
            nodesToAppend.push(currentHeadElt);
          }
        } else {
          // if this is a merge, we remove this content since it is not in the new head
          // Preserve elements with save-ignore - they shouldn't be removed during sync
          if (
            ctx.head.shouldRemove(currentHeadElt) !== false &&
            !shouldIgnoreForSync(currentHeadElt)
          ) {
            removed.push(currentHeadElt);
          }
        }
      }
    }

    // Push the remaining new head elements in the Map into the
    // nodes to append to the head tag
    for (const bucket of srcToNewHeadNodes.values()) {
      nodesToAppend.push(...bucket);
    }

    let promises = [];
    for (const newNode of nodesToAppend) {
      // TODO: This could theoretically be null, based on type
      let newElt = /** @type {ChildNode} */ (
        document.createRange().createContextualFragment(newNode.outerHTML)
          .firstChild
      );
      if (ctx.callbacks.beforeNodeAdded(newElt) !== false) {
        if (newElt instanceof Element && waitsForLoad(newElt)) {
          /** @type {(result?: any) => void} */ let resolve;
          let promise = new Promise(function (_resolve) {
            resolve = _resolve;
          });
          newElt.addEventListener("load", function () {
            resolve();
          });
          newElt.addEventListener("error", function () {
            resolve(); // resolve on error too — head.block must never hang
          });
          promises.push(promise);
        }
        oldHead.appendChild(newElt);
        ctx.callbacks.afterNodeAdded(newElt);
        added.push(newElt);
      }
    }

    // remove all removed elements, after we have appended the new elements to avoid
    // additional network requests for things like style sheets
    for (const removedElement of removed) {
      if (ctx.callbacks.beforeNodeRemoved(removedElement) !== false) {
        oldHead.removeChild(removedElement);
        ctx.callbacks.afterNodeRemoved(removedElement);
      }
    }

    ctx.head.afterHeadMorphed(oldHead, {
      added: added,
      kept: preserved,
      removed: removed,
    });
    return promises;
  }

  /**
   * Execute new scripts after a morph. Insertion is inert (see
   * neutralizeScripts), so this is the single place scripts run: a script that
   * wasn't in the pre-morph DOM executes exactly once, after the morph
   * settles. Head scripts are handled by handleHeadElement; sync-ignored
   * regions are local chrome and are left alone.
   * @param {Node[]} morphedNodes - The nodes the morph produced
   * @param {Set<string>} oldScriptSignatures - Set of signatures from scripts before morph
   * @param {MorphContext} ctx
   * @returns {Promise<void>[]}
   */
  function handleBodyScripts(morphedNodes, oldScriptSignatures, ctx) {
    if (!ctx.scripts.handle) return [];

    const added = [];
    const removed = [];
    const preserved = [];
    const scriptsToExecute = [];

    const matchMode = ctx.scripts.matchMode;
    const currentScripts = [];
    for (const node of morphedNodes) {
      if (!(node instanceof Element)) continue;
      if (isHtmlScript(node)) currentScripts.push(node);
      for (const script of node.querySelectorAll("script")) {
        if (isHtmlScript(script)) currentScripts.push(script);
      }
    }

    for (const script of currentScripts) {
      if (script.closest("head")) continue;
      if (shouldIgnoreForSyncDeep(script)) continue;
      const signature = getScriptSignature(script, matchMode, ctx.merge);
      const existedBefore = oldScriptSignatures.has(signature);
      const isPreserved = ctx.scripts.shouldPreserve(script);
      const isReAppended = ctx.scripts.shouldReAppend(script);

      if (existedBefore || isPreserved) {
        if (isReAppended) {
          removed.push(script);
          scriptsToExecute.push(script);
        } else {
          preserved.push(script);
        }
      } else {
        // New script - needs to be executed
        scriptsToExecute.push(script);
      }
    }

    const promises = [];

    for (const script of scriptsToExecute) {
      if (ctx.callbacks.beforeNodeAdded(script) === false) continue;

      // A fresh createElement copy has no "already started" flag, so
      // inserting it executes it (inline) or loads it (src).
      const executableScript = document.createElement("script");
      for (const attr of script.attributes) {
        executableScript.setAttribute(attr.name, attr.value);
      }
      executableScript.textContent = script.textContent;

      if (executableScript.src) {
        /** @type {(result?: any) => void} */ let resolve;
        const promise = new Promise(function (_resolve) {
          resolve = _resolve;
        });
        executableScript.addEventListener("load", function () {
          resolve();
        });
        executableScript.addEventListener("error", function () {
          resolve(); // Resolve even on error to not block
        });
        promises.push(promise);
      }

      script.replaceWith(executableScript);
      ctx.callbacks.afterNodeAdded(executableScript);
      added.push(executableScript);
    }

    ctx.scripts.afterScriptsHandled(ctx.target, {
      added: added,
      kept: preserved,
      removed: removed,
    });

    return promises;
  }

  //=============================================================================
  // Create Morph Context Functions
  //=============================================================================
  const createMorphContext = (function () {
    /**
     *
     * @param {Element} oldNode
     * @param {Element} newContent
     * @param {Config} config
     * @returns {MorphContext}
     */
    function createMorphContext(oldNode, newContent, config) {
      const { persistentIds, idMap } = createIdMaps(oldNode, newContent);

      // Compute hyper-match results for content-based matching
      const hyperMatches = HyperMatch.computeMatches(oldNode, newContent);

      // Optional: override hyperMatches with caller-supplied identity via config.key.
      // The function is invoked on every Element in both trees; equal non-null
      // return values pair the elements regardless of content-scoring outcome.
      // Duplicate keys on either side fall through to content scoring (mirrors
      // createPersistentIds duplicate handling).
      if (typeof config.key === "function") {
        const oldByKey = new Map();
        const oldDupKeys = new Set();
        const visitOld = (el) => {
          const k = config.key(el);
          if (k != null) {
            if (oldByKey.has(k)) oldDupKeys.add(k);
            else oldByKey.set(k, el);
          }
        };
        if (oldNode instanceof Element) visitOld(oldNode);
        for (const el of oldNode.querySelectorAll("*")) visitOld(el);
        for (const k of oldDupKeys) oldByKey.delete(k);

        const reverse = new Map();
        for (const [n, o] of hyperMatches) reverse.set(o, n);

        // @ts-ignore — see createIdMaps for the same __hyperMorphRoot pattern
        const newRoot = newContent.__hyperMorphRoot || newContent;

        // Two-pass dup detection on the new side, mirroring the old-tree
        // path. Without this, the first occurrence of a duplicate key
        // would still pair while later occurrences are skipped — an
        // asymmetry that breaks the "drop on either side" guarantee.
        const newByKey = new Map();
        const newDupKeys = new Set();
        const visitNew = (el) => {
          const k = config.key(el);
          if (k != null) {
            if (newByKey.has(k)) newDupKeys.add(k);
            else newByKey.set(k, el);
          }
        };
        if (newRoot instanceof Element) visitNew(newRoot);
        for (const el of newRoot.querySelectorAll("*")) visitNew(el);
        for (const k of newDupKeys) newByKey.delete(k);

        for (const [k, newEl] of newByKey) {
          const oldEl = oldByKey.get(k);
          if (!oldEl) continue;
          if (oldEl.tagName !== newEl.tagName) continue;

          const prevNew = reverse.get(oldEl);
          if (prevNew && prevNew !== newEl) hyperMatches.delete(prevNew);
          const prevOld = hyperMatches.get(newEl);
          if (prevOld && prevOld !== oldEl) reverse.delete(prevOld);

          hyperMatches.set(newEl, oldEl);
          reverse.set(oldEl, newEl);
        }
      }

      const mergedConfig = mergeDefaults(config);

      // Force-pair mergeable scripts by identity so a content-changed data
      // tag still morphs into its live counterpart instead of soft-matching
      // a stranger or being treated as new. Runs after the config.key block
      // so merge pairing wins for merge tags; same reciprocal-cleanup
      // discipline as that block.
      const mergeCtx = createMergeContext(
        oldNode,
        newContent,
        mergedConfig.scripts,
      );
      if (mergeCtx) {
        const reverse = new Map();
        for (const [n, o] of hyperMatches) reverse.set(o, n);
        for (const [key, newEl] of mergeCtx.newByKey) {
          if (mergeCtx.disabled.has(key)) continue;
          const oldEl = mergeCtx.oldByKey.get(key);
          if (!oldEl) continue;
          const prevNew = reverse.get(oldEl);
          if (prevNew && prevNew !== newEl) hyperMatches.delete(prevNew);
          const prevOld = hyperMatches.get(newEl);
          if (prevOld && prevOld !== oldEl) reverse.delete(prevOld);
          hyperMatches.set(newEl, oldEl);
          reverse.set(oldEl, newEl);
        }
      }

      // Build set of old elements that are hyper-matched (for pantry logic).
      // Runs after the optional key block so it always reflects final pairings.
      const hyperMatchedOldElements = new Set();
      for (const oldEl of hyperMatches.values()) {
        hyperMatchedOldElements.add(oldEl);
      }

      const morphStyle = mergedConfig.morphStyle || "outerHTML";
      if (!["innerHTML", "outerHTML"].includes(morphStyle)) {
        throw new Error(`Do not understand how to morph style ${morphStyle}`);
      }

      return {
        target: oldNode,
        newContent: newContent,
        config: mergedConfig,
        morphStyle: morphStyle,
        ignoreActive: mergedConfig.ignoreActive,
        ignoreActiveValue: mergedConfig.ignoreActiveValue,
        restoreFocus: mergedConfig.restoreFocus,
        formStateSync: mergedConfig.formStateSync || "attribute",
        idMap: idMap,
        persistentIds: persistentIds,
        hyperMatches: hyperMatches,
        hyperMatchedOldElements: hyperMatchedOldElements,
        merge: mergeCtx,
        pantry: createPantry(),
        activeElementAndParents: createActiveElementAndParents(oldNode),
        callbacks: mergedConfig.callbacks,
        head: mergedConfig.head,
        scripts: mergedConfig.scripts,
      };
    }

    /**
     * Deep merges the config object and the HyperMorph.defaults object to
     * produce a final configuration object
     * @param {Config} config
     * @returns {ConfigInternal}
     */
    function mergeDefaults(config) {
      let finalConfig = Object.assign({}, defaults);

      // copy top level stuff into final config
      Object.assign(finalConfig, config);

      // copy callbacks into final config (do this to deep merge the callbacks)
      finalConfig.callbacks = Object.assign(
        {},
        defaults.callbacks,
        config.callbacks,
      );

      // copy head config into final config  (do this to deep merge the head)
      finalConfig.head = Object.assign({}, defaults.head, config.head);

      // copy scripts config into final config (do this to deep merge the scripts)
      finalConfig.scripts = Object.assign({}, defaults.scripts, config.scripts);

      return finalConfig;
    }

    /**
     * @returns {HTMLDivElement}
     */
    function createPantry() {
      const pantry = document.createElement("div");
      pantry.hidden = true;
      document.body.insertAdjacentElement("afterend", pantry);
      return pantry;
    }

    /**
     * @param {Element} oldNode
     * @returns {Element[]}
     */
    function createActiveElementAndParents(oldNode) {
      /** @type {Element[]} */
      let activeElementAndParents = [];
      let elt = document.activeElement;
      if (elt?.tagName !== "BODY" && oldNode.contains(elt)) {
        while (elt) {
          activeElementAndParents.push(elt);
          if (elt === oldNode) break;
          elt = elt.parentElement;
        }
      }
      return activeElementAndParents;
    }

    /**
     * Returns all elements with an ID contained within the root element and its descendants
     *
     * @param {Element} root
     * @returns {Element[]}
     */
    function findIdElements(root) {
      let elements = Array.from(root.querySelectorAll("[id]"));
      // root could be a document fragment which doesn't have `getAttribute`
      if (root.getAttribute?.("id")) {
        elements.push(root);
      }
      return elements;
    }

    /**
     * A bottom-up algorithm that populates a map of Element -> IdSet.
     * The idSet for a given element is the set of all IDs contained within its subtree.
     * As an optimzation, we filter these IDs through the given list of persistent IDs,
     * because we don't need to bother considering IDed elements that won't be in the new content.
     *
     * @param {Map<Node, Set<string>>} idMap
     * @param {Set<string>} persistentIds
     * @param {Element} root
     * @param {Element[]} elements
     */
    function populateIdMapWithTree(idMap, persistentIds, root, elements) {
      for (const elt of elements) {
        // we can pretend id is non-null String, because the .has line will reject it immediately if not
        const id = /** @type {String} */ (elt.getAttribute("id"));
        if (persistentIds.has(id)) {
          /** @type {Element|null} */
          let current = elt;
          // walk up the parent hierarchy of that element, adding the id
          // of element to the parent's id set
          while (current) {
            let idSet = idMap.get(current);
            // if the id set doesn't exist, create it and insert it in the map
            if (idSet == null) {
              idSet = new Set();
              idMap.set(current, idSet);
            }
            idSet.add(id);

            if (current === root) break;
            current = current.parentElement;
          }
        }
      }
    }

    /**
     * This function computes a map of nodes to all ids contained within that node (inclusive of the
     * node).  This map can be used to ask if two nodes have intersecting sets of ids, which allows
     * for a looser definition of "matching" than tradition id matching, and allows child nodes
     * to contribute to a parent nodes matching.
     *
     * @param {Element} oldContent  the old content that will be morphed
     * @param {Element} newContent  the new content to morph to
     * @returns {IdSets}
     */
    function createIdMaps(oldContent, newContent) {
      const oldIdElements = findIdElements(oldContent);
      const newIdElements = findIdElements(newContent);

      const persistentIds = createPersistentIds(oldIdElements, newIdElements);

      /** @type {Map<Node, Set<string>>} */
      let idMap = new Map();
      populateIdMapWithTree(idMap, persistentIds, oldContent, oldIdElements);

      /** @ts-ignore - if newContent is a duck-typed parent, pass its single child node as the root to halt upwards iteration */
      const newRoot = newContent.__hyperMorphRoot || newContent;
      populateIdMapWithTree(idMap, persistentIds, newRoot, newIdElements);

      return { persistentIds, idMap };
    }

    /**
     * This function computes the set of ids that persist between the two contents excluding duplicates
     *
     * @param {Element[]} oldIdElements
     * @param {Element[]} newIdElements
     * @returns {Set<string>}
     */
    function createPersistentIds(oldIdElements, newIdElements) {
      let duplicateIds = new Set();

      /** @type {Map<string, string>} */
      let oldIdTagNameMap = new Map();
      for (const elt of oldIdElements) {
        const id = /** @type {String} */ (elt.getAttribute("id"));
        if (oldIdTagNameMap.has(id)) {
          duplicateIds.add(id);
        } else {
          oldIdTagNameMap.set(id, elt.tagName);
        }
      }

      let persistentIds = new Set();
      for (const elt of newIdElements) {
        const id = /** @type {String} */ (elt.getAttribute("id"));
        if (persistentIds.has(id)) {
          duplicateIds.add(id);
        } else if (oldIdTagNameMap.get(id) === elt.tagName) {
          persistentIds.add(id);
        }
        // skip if tag types mismatch because its not possible to morph one tag into another
      }

      for (const id of duplicateIds) {
        persistentIds.delete(id);
      }
      return persistentIds;
    }

    return createMorphContext;
  })();

  //=============================================================================
  // HTML Normalization Functions
  //=============================================================================
  const { normalizeElement, normalizeParent } = (function () {
    /** @type {WeakSet<Node>} */
    const generatedByHyperMorph = new WeakSet();

    /**
     *
     * @param {Element | Document} content
     * @returns {Element}
     */
    function normalizeElement(content) {
      if (content instanceof Document) {
        return content.documentElement;
      } else {
        return content;
      }
    }

    /**
     *
     * @param {null | string | Node | HTMLCollection | Node[] | Document & {generatedByHyperMorph:boolean}} newContent
     * @returns {Element}
     */
    function normalizeParent(newContent) {
      if (newContent == null) {
        return document.createElement("div"); // dummy parent element
      } else if (typeof newContent === "string") {
        return normalizeParent(parseContent(newContent));
      } else if (
        generatedByHyperMorph.has(/** @type {Element} */ (newContent))
      ) {
        // the template tag created by HyperMorph parsing can serve as a dummy parent
        return /** @type {Element} */ (newContent);
      } else if (newContent instanceof Node) {
        if (newContent.parentNode) {
          // we can't use the parent directly because newContent may have siblings
          // that we don't want in the morph, and reparenting might be expensive (TODO is it?),
          // so instead we create a fake parent node that only sees a slice of its children.
          /** @type {Element} */
          return /** @type {any} */ (new SlicedParentNode(newContent));
        } else {
          // a single node is added as a child to a dummy parent
          const dummyParent = document.createElement("div");
          dummyParent.append(newContent);
          return dummyParent;
        }
      } else {
        // all nodes in the array or HTMLElement collection are consolidated under
        // a single dummy parent element
        const dummyParent = document.createElement("div");
        for (const elt of [...newContent]) {
          dummyParent.append(elt);
        }
        return dummyParent;
      }
    }

    /**
     * A fake duck-typed parent element to wrap a single node, without actually reparenting it.
     * This is useful because the node may have siblings that we don't want in the morph, and it may also be moved
     * or replaced with one or more elements during the morph. This class effectively allows us a window into
     * a slice of a node's children.
     * "If it walks like a duck, and quacks like a duck, then it must be a duck!" -- James Whitcomb Riley (1849–1916)
     */
    class SlicedParentNode {
      /** @param {Node} node */
      constructor(node) {
        this.originalNode = node;
        this.realParentNode = /** @type {Element} */ (node.parentNode);
        this.previousSibling = node.previousSibling;
        this.nextSibling = node.nextSibling;
      }

      /** @returns {Node[]} */
      get childNodes() {
        // return slice of realParent's current childNodes, based on previousSibling and nextSibling
        const nodes = [];
        let cursor = this.previousSibling
          ? this.previousSibling.nextSibling
          : this.realParentNode.firstChild;
        while (cursor && cursor != this.nextSibling) {
          nodes.push(cursor);
          cursor = cursor.nextSibling;
        }
        return nodes;
      }

      /**
       * @param {string} selector
       * @returns {Element[]}
       */
      querySelectorAll(selector) {
        return this.childNodes.reduce((results, node) => {
          if (node instanceof Element) {
            if (node.matches(selector)) results.push(node);
            const nodeList = node.querySelectorAll(selector);
            for (let i = 0; i < nodeList.length; i++) {
              results.push(nodeList[i]);
            }
          }
          return results;
        }, /** @type {Element[]} */ ([]));
      }

      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      insertBefore(node, referenceNode) {
        return this.realParentNode.insertBefore(node, referenceNode);
      }

      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      moveBefore(node, referenceNode) {
        // @ts-ignore - use new moveBefore feature
        return this.realParentNode.moveBefore(node, referenceNode);
      }

      /**
       * for later use with populateIdMapWithTree to halt upwards iteration
       * @returns {Node}
       */
      get __hyperMorphRoot() {
        return this.originalNode;
      }
    }

    /**
     * Strip the regions where a literal </body>-like token can appear as raw
     * text — comments, RCDATA/RAWTEXT elements (script/style/textarea/title),
     * and svg — so full-document detection only sees real structure. The svg
     * strip loops until stable so nested svgs collapse fully. Open-tag
     * matching is quoted-attribute-aware.
     * @param {string} html
     * @returns {string}
     */
    function sanitizeForDetection(html) {
      const openTag = (name) => `<${name}(?:\\s(?:[^>"']|"[^"]*"|'[^']*')*)?>`;
      let out = html.replace(/<!--[\s\S]*?-->/g, "");
      for (const tag of ["script", "style", "textarea", "title"]) {
        out = out.replace(
          new RegExp(`${openTag(tag)}[\\s\\S]*?</${tag}\\s*>`, "gi"),
          "",
        );
      }
      const svgRe = new RegExp(`${openTag("svg")}[\\s\\S]*?</svg\\s*>`, "gi");
      let prev;
      do {
        prev = out;
        out = out.replace(svgRe, "");
      } while (out !== prev);
      return out;
    }

    /**
     *
     * @param {string} newContent
     * @returns {Node | null | DocumentFragment}
     */
    function parseContent(newContent) {
      let parser = new DOMParser();

      let detectionContent = sanitizeForDetection(newContent);

      // if the newContent contains a html, head or body tag, we can simply parse it w/o wrapping
      if (
        detectionContent.match(/<\/html>/) ||
        detectionContent.match(/<\/head>/) ||
        detectionContent.match(/<\/body>/)
      ) {
        let content = parser.parseFromString(newContent, "text/html");
        // if it is a full HTML document, return the document itself as the parent container
        if (detectionContent.match(/<\/html>/)) {
          generatedByHyperMorph.add(content);
          return content;
        } else {
          // otherwise return the html element as the parent container
          let htmlElement = content.firstChild;
          if (htmlElement) {
            generatedByHyperMorph.add(htmlElement);
          }
          return htmlElement;
        }
      } else {
        // if it is partial HTML, wrap it in a template tag to provide a parent element and also to help
        // deal with touchy tags like tr, tbody, etc.
        let responseDoc = parser.parseFromString(
          "<body><template>" + newContent + "</template></body>",
          "text/html",
        );
        let content = /** @type {HTMLTemplateElement} */ (
          responseDoc.body.querySelector("template")
        ).content;
        generatedByHyperMorph.add(content);
        return content;
      }
    }

    return { normalizeElement, normalizeParent };
  })();

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
        if (baseEl.getAttribute(attr.name) !== attr.value)
          names.push(attr.name);
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
          out += " " + node.nodeValue;
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

  //=============================================================================
  // This is what ends up becoming the HyperMorph global object
  //=============================================================================
  return {
    morph,
    defaults,
    findChangedRoots,
    spliceProtected,
    mergeJson,
    mergeScriptText,
    parseJsonRelaxed,
    parseRulesRelaxed,
  };
})();

// ES module exports
export { HyperMorph };
export const morph = HyperMorph.morph;
export const defaults = HyperMorph.defaults;
export const findChangedRoots = HyperMorph.findChangedRoots;
export const spliceProtected = HyperMorph.spliceProtected;
export { mergeJson, mergeScriptText, parseJsonRelaxed, parseRulesRelaxed };
export default HyperMorph;
