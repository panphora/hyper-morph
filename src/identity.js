/**
 * identity.js — element identity that never touches the user's DOM or file.
 *
 * A store mints per-tab synthetic ids ("<clientId>:<n>") for live elements
 * and keeps them in a WeakMap. Ids travel between tabs as a path-keyed map
 * over the snapshot clone's element children ("0.1.3" -> id), which is what
 * ClayJS sends beside every live-sync frame. A receiver imports the map onto
 * its parsed frame and, after a merge, adopts the ids of elements it now
 * holds, so the same logical element carries the same id everywhere after
 * one round trip.
 *
 * A path is only meaningful while both sides agree on the shape, so the map
 * carries the sender's element child counts in preorder under the reserved
 * key "~". Where the receiver's count differs (the parser reshaped the
 * markup, or the frame and the map are from different snapshots) that
 * element keeps its own id and nothing below it is imported, on either side.
 * A map without "~" (an older sender) imports by path alone.
 */
export const SHAPE_KEY = "~";

/**
 * @typedef {object} IdentityStore
 * @property {(el: Element) => string | null} idOf
 * @property {(el: Element) => string} ensure
 * @property {(el: Element, id: string) => void} adopt
 * @property {(cloneRoot: Element, toLive: (n: Node) => Node | null) => Record<string, string>} exportMap
 */

/**
 * @param {string} clientId
 * @returns {IdentityStore}
 */
export function createIdentityStore(clientId) {
  const ids = new WeakMap();
  let counter = 0;
  const idOf = (el) => ids.get(el) || null;
  const ensure = (el) => {
    let id = ids.get(el);
    if (!id) {
      id = `${clientId}:${++counter}`;
      ids.set(el, id);
    }
    return id;
  };
  const adopt = (el, id) => {
    if (el && typeof id === "string" && id) ids.set(el, id);
  };
  const exportMap = (cloneRoot, toLive) => {
    const map = {};
    const counts = [];
    const visit = (clone, path) => {
      const live = toLive(clone);
      if (live) map[path] = ensure(live);
      const kids = clone.children;
      counts.push(kids.length);
      for (let i = 0; i < kids.length; i++)
        visit(kids[i], path === "" ? String(i) : `${path}.${i}`);
    };
    visit(cloneRoot, "");
    map[SHAPE_KEY] = counts.join(",");
    return map;
  };
  return { idOf, ensure, adopt, exportMap };
}

/**
 * Apply a path-keyed id map to a parsed tree.
 * @param {Element} root
 * @param {Record<string, string> | null | undefined} map
 * @returns {WeakMap<Element, string>}
 */
export function importMap(root, map) {
  const out = new WeakMap();
  if (!root || !map || typeof map !== "object" || Array.isArray(map))
    return out;
  const shape = map[SHAPE_KEY];
  const counts =
    typeof shape === "string" ? shape.split(",").map(Number) : null;
  let at = 0;
  // Advance past the sender's subtree of a node with n children.
  const skipSender = (n) => {
    for (let k = 0; k < n; k++) skipSender(counts[at++]);
  };
  const visit = (el, path) => {
    const id = map[path];
    if (typeof id === "string" && id) out.set(el, id);
    const kids = el.children;
    if (counts) {
      const sent = counts[at++];
      if (sent !== kids.length) {
        skipSender(sent);
        return;
      }
    }
    for (let i = 0; i < kids.length; i++)
      visit(kids[i], path === "" ? String(i) : `${path}.${i}`);
  };
  visit(root, "");
  return out;
}

/**
 * Compose identity tiers into one function: the first tier that yields a
 * non-empty string wins. Uniqueness is enforced later, per side, by the
 * aligner.
 * @param {Array<(el: Element) => string | null | undefined>} tiers
 * @returns {(el: Element) => string | null}
 */
export function tieredIdentity(tiers) {
  return (el) => {
    for (const t of tiers) {
      const v = t(el);
      if (typeof v === "string" && v !== "") return v;
    }
    return null;
  };
}

/** Default identity: data-id, then id. */
export const defaultIdentity = tieredIdentity([
  (el) => el.getAttribute("data-id"),
  (el) => el.getAttribute("id"),
]);

/**
 * Index one side by usable id: ids that appear on more than one element of
 * the side are dropped from the index (a duplicated value identifies
 * nothing). Ignored subtrees are skipped entirely.
 * @param {Element} root
 * @param {(el: Element) => string | null} idOf
 * @param {(n: Node) => boolean} ignored
 * @returns {Map<string, Element>}
 */
export function indexByIdentity(root, idOf, ignored, fastSelector = null) {
  const map = new Map();
  const dup = new Set();
  const consider = (el) => {
    if (ignored(el)) return;
    const id = idOf(el);
    if (id) {
      if (map.has(id)) dup.add(id);
      else map.set(id, el);
    }
  };
  if (fastSelector) {
    // Only elements the selector names can carry an identity: let the
    // engine find them instead of visiting every element. Template content
    // is inert and invisible to querySelectorAll, so every template (the
    // root included) is queried through its content fragment.
    const query = (scope) => {
      for (const el of scope.querySelectorAll(fastSelector)) consider(el);
      for (const t of scope.querySelectorAll("template"))
        if (t.content) query(t.content);
    };
    consider(root);
    query(root.tagName === "TEMPLATE" && root.content ? root.content : root);
  } else {
    const visit = (el) => {
      consider(el);
      const kids =
        el.tagName === "TEMPLATE" && el.content
          ? el.content.children
          : el.children;
      for (let i = 0; i < kids.length; i++) visit(kids[i]);
    };
    visit(root);
  }
  for (const id of dup) {
    map.delete(id);
    if (id.startsWith("merge:"))
      console.warn(
        `[hyper-morph] merge disabled for duplicate identity "${id.slice(id.indexOf(":", 6) + 1)}"`,
      );
  }
  return map;
}
