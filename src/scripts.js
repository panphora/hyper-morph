/**
 * scripts.js — script identity, JSON-merge recognition, inert clones, and
 * the execute-once pass.
 *
 * A script is identified by its normalized src, or by its type and a hash
 * of its text. Scripts inserted by the merge are inert (never run on
 * insertion); after apply, a body script whose signature was not present
 * before executes exactly once by replacement with a fresh element.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** @param {Node} node */
export function isHtmlScript(node) {
  return !!node && node.nodeType === 1 && node.tagName === "SCRIPT" && node.namespaceURI === HTML_NS;
}

/** @param {Element} script */
export function isJsonScript(script) {
  const type = (script.getAttribute("type") || "").split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

/**
 * @param {Element} el
 * @param {string} baseURI
 * @returns {string}
 */
export function scriptSignature(el, baseURI) {
  const src = el.getAttribute("src");
  const type = (el.getAttribute("type") || "text/javascript").split(";")[0].trim().toLowerCase();
  if (src) {
    let abs = src;
    try { const u = new URL(src, baseURI); abs = u.origin + u.pathname + u.search; } catch {}
    return "script|src|" + type + "|" + abs;
  }
  return "script|inline|" + type + "|" + hash(el.textContent.trim());
}

/**
 * @typedef {object} MergeTagRecognizer
 * @property {(el: Element) => boolean} match
 * @property {(el: Element) => string | null | undefined} identity
 * @property {(text: string) => any} [parse]
 */

/** Built-in recognizer: merge="<name>" on a JSON script. */
const builtinRecognizer = {
  match: (el) => el.hasAttribute("merge"),
  identity: (el) => el.getAttribute("merge"),
};

/**
 * Find the merge identity of a JSON script, if any recognizer claims it.
 * @param {Element} el
 * @param {MergeTagRecognizer[]} [extra]
 * @returns {{ key: string, recognizer: MergeTagRecognizer } | null}
 */
export function mergeIdentityOf(el, extra = []) {
  if (!isHtmlScript(el) || el.hasAttribute("src") || !isJsonScript(el)) return null;
  const recognizers = [builtinRecognizer, ...extra];
  for (let i = 0; i < recognizers.length; i++) {
    const r = recognizers[i];
    if (!r.match(el)) continue;
    const raw = r.identity(el);
    if (raw == null || raw === "") return null;
    return { key: i + ":" + raw, recognizer: r };
  }
  return null;
}

/**
 * Signatures of every non-ignored HTML script under root, excluding <head>.
 * @param {Element} root
 * @param {(n: Node) => boolean} ignored
 * @param {string} baseURI
 * @returns {Set<string>}
 */
export function collectBodyScriptSignatures(root, ignored, baseURI) {
  const out = new Set();
  for (const el of root.querySelectorAll("script")) {
    if (!isHtmlScript(el) || ignored(el) || el.closest("head")) continue;
    out.add(scriptSignature(el, baseURI));
  }
  return out;
}

/**
 * Build an inert copy of a script: parsing through innerHTML marks the copy
 * "already started", so it never executes on insertion or move.
 * @param {Element} script
 * @param {Document} doc
 * @returns {Element}
 */
export function makeInertScript(script, doc) {
  const container = doc.createElement("div");
  container.innerHTML = "<scr" + "ipt></scr" + "ipt>";
  const inert = container.firstChild;
  for (const attr of script.attributes) inert.setAttribute(attr.name, attr.value);
  inert.textContent = script.textContent;
  return inert;
}

/**
 * Execute every body script whose signature is new, once, by replacing it
 * with a fresh element. Returns load promises for external scripts.
 * @param {Element} root
 * @param {Set<string>} before - signatures present before apply
 * @param {object} o
 * @param {(n: Node) => boolean} o.ignored
 * @param {Set<Element>} o.skip - scripts that must never execute (merged JSON)
 * @param {string} o.baseURI
 * @param {(n: Node) => boolean | void} o.beforeNodeAdded
 * @param {(n: Node) => void} o.afterNodeAdded
 * @returns {{ executed: Element[], loads: Promise<void>[] }}
 */
export function executeNewScripts(root, before, o) {
  const executed = [], loads = [];
  for (const el of Array.from(root.querySelectorAll("script"))) {
    if (!isHtmlScript(el) || o.ignored(el) || o.skip.has(el) || el.closest("head")) continue;
    if (before.has(scriptSignature(el, o.baseURI))) continue;
    const fresh = el.ownerDocument.createElement("script");
    for (const attr of el.attributes) fresh.setAttribute(attr.name, attr.value);
    fresh.textContent = el.textContent;
    if (o.beforeNodeAdded(fresh) === false) continue;
    if (fresh.hasAttribute("src")) {
      loads.push(new Promise((resolve) => {
        fresh.addEventListener("load", () => resolve());
        fresh.addEventListener("error", () => resolve());
      }));
    }
    el.replaceWith(fresh);
    o.afterNodeAdded(fresh);
    executed.push(fresh);
  }
  return { executed, loads };
}
