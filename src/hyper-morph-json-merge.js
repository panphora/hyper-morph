/**
 * hyper-morph-json-merge.js — three-way JSON merge for mergeable script tags.
 *
 * Pure functions, no DOM access, no dependencies. merge.js uses
 * mergeScriptText to merge the text of JSON script tags a recognizer claims
 * (see scripts.merge / scripts.mergeTags in docs/api.md); both functions
 * are also exported standalone from the package root and hyper-morph/json-merge.
 *
 * Semantics: three-way merge of base → local and base → remote. Different
 * keys both survive; genuine same-key conflicts resolve remote-wins. Arrays
 * merge by identity (a keyed field for object elements, the value itself for
 * primitive elements); arrays without usable identity resolve remote-wins
 * wholesale, because a wrong match is worse than a predictable replacement.
 */

import { parseJsonRelaxed } from "./hyper-morph-json-parse.js";

const MISSING = Symbol("hyper-morph-json-merge:missing");

const DEFAULT_KEY_CANDIDATES = [
  "id",
  "_id",
  "uuid",
  "key",
  "slug",
  "code",
  "name",
];

/**
 * @typedef {object} MergeOptions
 * @property {string[]} [keyCandidates] - Field names tried (in order, before
 *   the built-in candidates) as the identity key of object-element arrays.
 * @property {function(string): any} [parse] - Parser for mergeScriptText.
 *   Must throw on invalid input. Default: parseJsonRelaxed (strict JSON plus
 *   unquoted keys, single quotes, trailing commas, and comments).
 */

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {object} obj
 * @param {string} key
 * @returns {boolean}
 */
function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Own-property assignment. A plain `result[key] = value` would mutate the
 * prototype when key is "__proto__", which valid JSON can contain.
 * @param {object} obj
 * @param {string} key
 * @param {any} value
 */
function setKey(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Structural equality over JSON values (array order matters, object key
 * order does not). Also used to compare against the MISSING sentinel, which
 * only equals itself via the identity fast path.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!has(b, key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Core three-way rule for one value position.
 * @param {any} base - may be MISSING
 * @param {any} local
 * @param {any} remote
 * @param {{keyCandidates: string[]}} opts
 * @returns {any}
 */
function mergeValue(base, local, remote, opts) {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote;
  if (deepEqual(remote, base)) return local;
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjects(isPlainObject(base) ? base : {}, local, remote, opts);
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    return mergeArrays(Array.isArray(base) ? base : [], local, remote, opts);
  }
  return remote;
}

/**
 * Presence-aware merge of one slot: any of the three sides may be MISSING.
 * Encodes the deletion table (remote wins on delete-vs-edit races).
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @param {{keyCandidates: string[]}} opts
 * @returns {any} the merged value, or MISSING when the slot is deleted
 */
function mergePresence(base, local, remote, opts) {
  if (local === MISSING && remote === MISSING) return MISSING;
  if (local === MISSING) {
    if (base === MISSING) return remote;
    return deepEqual(remote, base) ? MISSING : remote;
  }
  if (remote === MISSING) {
    return base === MISSING ? local : MISSING;
  }
  return mergeValue(base, local, remote, opts);
}

/**
 * @param {object} base
 * @param {object} local
 * @param {object} remote
 * @param {{keyCandidates: string[]}} opts
 * @returns {object}
 */
function mergeObjects(base, local, remote, opts) {
  const result = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    const merged = mergePresence(
      has(base, key) ? base[key] : MISSING,
      has(local, key) ? local[key] : MISSING,
      has(remote, key) ? remote[key] : MISSING,
      opts,
    );
    if (merged !== MISSING) setKey(result, key, merged);
  }
  return result;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPrimitive(value) {
  return value === null || typeof value !== "object";
}

/**
 * Type-tagged identity string, so 1 and "1" stay distinct.
 * @param {any} value
 * @returns {string}
 */
function identityTag(value) {
  return typeof value + ":" + String(value);
}

/**
 * True when `field` works as the identity key across all three arrays:
 * present on every element, primitive string/number value, unique within
 * each array.
 * @param {string} field
 * @param {any[][]} arrays
 * @returns {boolean}
 */
function qualifiesAsKey(field, arrays) {
  for (const arr of arrays) {
    const seen = new Set();
    for (const item of arr) {
      if (!has(item, field)) return false;
      const value = item[field];
      if (typeof value !== "string" && typeof value !== "number") return false;
      const tag = identityTag(value);
      if (seen.has(tag)) return false;
      seen.add(tag);
    }
  }
  return true;
}

/**
 * Decide how elements of these arrays are identified across versions.
 * @param {any[]} base
 * @param {any[]} local
 * @param {any[]} remote
 * @param {{keyCandidates: string[]}} opts
 * @returns {{kind: "keyed", field: string} | {kind: "self"} | null}
 */
function inferArrayIdentity(base, local, remote, opts) {
  const arrays = [base, local, remote];
  let allObjects = true;
  for (const arr of arrays) {
    for (const item of arr) {
      if (!isPlainObject(item)) allObjects = false;
    }
  }
  if (allObjects) {
    for (const field of opts.keyCandidates) {
      if (qualifiesAsKey(field, arrays)) return { kind: "keyed", field };
    }
    return null;
  }
  for (const arr of arrays) {
    const seen = new Set();
    for (const item of arr) {
      if (!isPrimitive(item)) return null;
      const tag = identityTag(item);
      if (seen.has(tag)) return null;
      seen.add(tag);
    }
  }
  return { kind: "self" };
}

/**
 * Identity-based array merge. Membership and content follow the presence
 * table per identity; ordering takes remote's order as primary and anchors
 * local-only insertions after their nearest preceding surviving neighbor
 * from local's order (falling back to the front).
 * @param {any[]} base
 * @param {any[]} local
 * @param {any[]} remote
 * @param {{keyCandidates: string[]}} opts
 * @returns {any[]}
 */
function mergeArrays(base, local, remote, opts) {
  const identity = inferArrayIdentity(base, local, remote, opts);
  if (!identity) return remote;

  const idOf =
    identity.kind === "self"
      ? identityTag
      : /** @param {any} item */ (item) =>
          identityTag(item[/** @type {{field: string}} */ (identity).field]);

  /** @param {any[]} arr */
  const toMap = (arr) => {
    const map = new Map();
    for (const item of arr) map.set(idOf(item), item);
    return map;
  };
  const baseMap = toMap(base);
  const localMap = toMap(local);
  const remoteMap = toMap(remote);

  const merged = new Map();
  const allIds = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ]);
  for (const id of allIds) {
    const value = mergePresence(
      baseMap.has(id) ? baseMap.get(id) : MISSING,
      localMap.has(id) ? localMap.get(id) : MISSING,
      remoteMap.has(id) ? remoteMap.get(id) : MISSING,
      opts,
    );
    if (value !== MISSING) merged.set(id, value);
  }

  const order = [];
  for (const item of remote) {
    const id = idOf(item);
    if (merged.has(id)) order.push(id);
  }
  for (let i = 0; i < local.length; i++) {
    const id = idOf(local[i]);
    if (!merged.has(id) || order.includes(id)) continue;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prevIndex = order.indexOf(idOf(local[j]));
      if (prevIndex !== -1) {
        insertAt = prevIndex + 1;
        break;
      }
    }
    order.splice(insertAt, 0, id);
  }
  return order.map((id) => merged.get(id));
}

/**
 * Three-way merge of parsed JSON values. Pass base as `undefined` when no
 * base version exists: the merge degrades to a two-way deep merge (local
 * additions survive, remote wins conflicts, deletions don't propagate).
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @param {MergeOptions} [options]
 * @returns {any}
 */
function mergeJson(base, local, remote, options = {}) {
  const keyCandidates = options.keyCandidates
    ? [...options.keyCandidates, ...DEFAULT_KEY_CANDIDATES]
    : DEFAULT_KEY_CANDIDATES;
  return mergeValue(base === undefined ? MISSING : base, local, remote, {
    keyCandidates,
  });
}

/**
 * Text-level entry point: parse the three sides, merge whichever of them are
 * valid ("keep only valid JSON"), and serialize so that receivers converge
 * byte-identically with a sender whenever the merged result equals one side.
 *
 * Degradation: local+remote invalid → remote text (today's replace).
 * local invalid → remote text. remote invalid → local text untouched.
 * base invalid or absent → two-way merge (warns only when invalid; an
 * absent base is the normal bootstrap state).
 *
 * @param {string | undefined | null} baseText
 * @param {string} localText
 * @param {string} remoteText
 * @param {MergeOptions} [options]
 * @returns {{text: string, warnings: string[]}}
 */
function mergeScriptText(baseText, localText, remoteText, options = {}) {
  const parse = options.parse || parseJsonRelaxed;
  /** @type {string[]} */
  const warnings = [];
  /**
   * @param {string | undefined | null} text
   * @param {string} label
   * @returns {any}
   */
  const tryParse = (text, label) => {
    if (typeof text !== "string") return MISSING;
    try {
      return parse(text);
    } catch (err) {
      warnings.push(
        `${label} side is not valid JSON (${/** @type {Error} */ (err).message})`,
      );
      return MISSING;
    }
  };

  const local = tryParse(localText, "local");
  const remote = tryParse(remoteText, "remote");
  if (local === MISSING) return { text: remoteText, warnings };
  if (remote === MISSING) return { text: localText, warnings };

  const base = tryParse(baseText, "base");
  const merged = mergeJson(
    base === MISSING ? undefined : base,
    local,
    remote,
    options,
  );
  if (deepEqual(merged, remote)) return { text: remoteText, warnings };
  if (deepEqual(merged, local)) return { text: localText, warnings };
  return { text: JSON.stringify(merged, null, 2), warnings };
}

export { mergeJson, mergeScriptText };
