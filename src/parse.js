/**
 * parse.js — turn caller input into full Documents, and keep doctypes in step.
 *
 * Every merge works on complete documents. A string always parses to one
 * (DOMParser yields html/head/body even for a fragment). Parsing uses the
 * owner document's window when it has one, so nodes belong to the right
 * realm; a window-less document (one produced by DOMParser itself) falls
 * back to the global DOMParser, the one permitted global in this library.
 */

/**
 * @param {string | Document} input
 * @param {Document} ownerDoc
 * @returns {Document}
 */
export function toDocument(input, ownerDoc) {
  if (typeof input === "string") {
    const win = ownerDoc && ownerDoc.defaultView;
    const Parser = (win && win.DOMParser) || globalThis.DOMParser;
    return new Parser().parseFromString(input, "text/html");
  }
  if (input && input.nodeType === 9) return input;
  throw new TypeError("expected an HTML string or a Document");
}

/**
 * A one-deep parse cache per lane. Live sync reuses one base string across
 * a burst of frames; parsing a full document per frame is the single largest
 * avoidable cost on the dirty path.
 * @param {Document} ownerDoc
 * @returns {function(string, string | Document): Document}
 */
export function createParseCache(ownerDoc) {
  const lanes = new Map();
  return (lane, input) => {
    if (typeof input !== "string") return toDocument(input, ownerDoc);
    const hit = lanes.get(lane);
    if (hit && hit.text === input) return hit.doc;
    const doc = toDocument(input, ownerDoc);
    lanes.set(lane, { text: input, doc });
    return doc;
  };
}

/**
 * Make the live document's doctype match the remote one. A doctype is never
 * removed: document mode cannot change after parse, so this is for
 * serialization fidelity only.
 * @param {Document} live
 * @param {Document} remote
 * @returns {boolean} true when something changed
 */
export function syncDoctype(live, remote) {
  const next = remote.doctype;
  if (!next) return false;
  const cur = live.doctype;
  if (cur && cur.name === next.name && cur.publicId === next.publicId && cur.systemId === next.systemId) return false;
  const created = live.implementation.createDocumentType(next.name, next.publicId, next.systemId);
  if (cur) live.replaceChild(created, cur);
  else live.insertBefore(created, live.documentElement);
  return true;
}
