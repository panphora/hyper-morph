/**
 * hyper-morph-json-merge.js — three-way JSON merge for mergeable script tags.
 *
 * Pure functions, no DOM access, no dependencies. merge.js uses
 * mergeScriptText to merge the text of JSON script tags a recognizer claims
 * (see scripts.merge / scripts.mergeTags in docs/api.md); both functions
 * are also exported standalone from the package root and hyper-morph/json-merge.
 *
 * Semantics: three-way merge of base → local and base → remote. Different
 * keys both survive; genuine same-key conflicts resolve remote-wins and are
 * reported through onConflict. Arrays merge by identity (a keyed field for
 * object elements, the value itself for primitive elements). Arrays without
 * usable identity, and primitive arrays, merge position by position when
 * base, local and remote have the same length, and otherwise resolve
 * remote-wins wholesale, because a wrong match is worse than a predictable
 * replacement.
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
 * @typedef {object} JsonConflict
 * @property {string} path - JSONPath-like location, e.g. `$.players[id="a"].x`
 *   or `$.grid[0][1]`; `$` is the root.
 * @property {any} base - undefined when absent
 * @property {any} local - undefined when absent (deleted)
 * @property {any} remote - undefined when absent (deleted)
 * @property {any} resolved - the value kept; undefined when the slot was deleted
 */

/**
 * @typedef {object} MergeOptions
 * @property {string[]} [keyCandidates] - Field names tried (in order, before
 *   the built-in candidates) as the identity key of object-element arrays.
 *   An entry `path:field` applies only to the array at that dot-separated
 *   object-key path (array levels are skipped; `:field` is a root array),
 *   and replaces the candidate list there.
 * @property {function(JsonConflict): void} [onConflict] - Called once per
 *   genuine conflict.
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

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * @param {string} path
 * @param {string} key
 * @returns {string}
 */
function keySegment(path, key) {
  return IDENT.test(key)
    ? path + "." + key
    : path + "[" + JSON.stringify(key) + "]";
}

/**
 * @param {string} keyPath
 * @param {string} key
 * @returns {string}
 */
function childKeyPath(keyPath, key) {
  return keyPath === "" ? key : keyPath + "." + key;
}

/**
 * Record a conflict and return the value that resolves it.
 * @param {any} opts
 * @param {string} path
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @param {any} resolved
 * @returns {any} resolved
 */
function conflictResolved(opts, path, base, local, remote, resolved) {
  if (opts.onConflict) {
    const out = (v) => (v === MISSING ? undefined : v);
    opts.onConflict({
      path,
      base: out(base),
      local: out(local),
      remote: out(remote),
      resolved: out(resolved),
    });
  }
  return resolved;
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
 * @param {any} opts
 * @param {string} path - display path of this position
 * @param {string} keyPath - object keys only, used for per-path identity keys
 * @returns {any}
 */
function mergeValue(base, local, remote, opts, path, keyPath) {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote;
  if (deepEqual(remote, base)) return local;
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjects(
      isPlainObject(base) ? base : {},
      local,
      remote,
      opts,
      path,
      keyPath,
    );
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    return mergeArrays(base, local, remote, opts, path, keyPath);
  }
  return conflictResolved(opts, path, base, local, remote, remote);
}

/**
 * Presence-aware merge of one slot: any of the three sides may be MISSING.
 * Encodes the deletion table (remote wins on delete-vs-edit races).
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @param {any} opts
 * @param {string} path
 * @param {string} keyPath
 * @returns {any} the merged value, or MISSING when the slot is deleted
 */
function mergePresence(base, local, remote, opts, path, keyPath) {
  if (local === MISSING && remote === MISSING) return MISSING;
  if (local === MISSING) {
    if (base === MISSING) return remote;
    return deepEqual(remote, base)
      ? MISSING
      : conflictResolved(opts, path, base, local, remote, remote);
  }
  if (remote === MISSING) {
    if (base === MISSING) return local;
    return deepEqual(local, base)
      ? MISSING
      : conflictResolved(opts, path, base, local, remote, MISSING);
  }
  return mergeValue(base, local, remote, opts, path, keyPath);
}

/**
 * @param {object} base
 * @param {object} local
 * @param {object} remote
 * @param {any} opts
 * @param {string} path
 * @param {string} keyPath
 * @returns {object}
 */
function mergeObjects(base, local, remote, opts, path, keyPath) {
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
      keySegment(path, key),
      childKeyPath(keyPath, key),
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
 * @param {any} opts
 * @param {string} keyPath
 * @returns {{kind: "keyed", field: string} | {kind: "self"} | null}
 */
function inferArrayIdentity(base, local, remote, opts, keyPath) {
  const arrays = [base, local, remote];
  let allObjects = true;
  for (const arr of arrays) {
    for (const item of arr) {
      if (!isPlainObject(item)) allObjects = false;
    }
  }
  if (allObjects) {
    const pathField = opts.keyPaths.get(keyPath);
    const candidates =
      pathField !== undefined ? [pathField] : opts.keyCandidates;
    for (const field of candidates) {
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
 * from local's order (falling back to the front). Arrays without identity,
 * and primitive arrays, merge position by position when all three sides have
 * the same length.
 * @param {any} base - may be MISSING or a non-array
 * @param {any[]} local
 * @param {any[]} remote
 * @param {any} opts
 * @param {string} path
 * @param {string} keyPath
 * @returns {any[]}
 */
function mergeArrays(base, local, remote, opts, path, keyPath) {
  const baseArr = Array.isArray(base) ? base : [];
  const identity = inferArrayIdentity(baseArr, local, remote, opts, keyPath);
  const sameLength =
    Array.isArray(base) &&
    base.length === local.length &&
    base.length === remote.length;
  if (!identity || (identity.kind === "self" && sameLength)) {
    if (sameLength) {
      return local.map((item, i) =>
        mergeValue(
          base[i],
          item,
          remote[i],
          opts,
          path + "[" + i + "]",
          keyPath,
        ),
      );
    }
    return conflictResolved(opts, path, base, local, remote, remote);
  }

  const idOf =
    identity.kind === "self"
      ? identityTag
      : /** @param {any} item */ (item) =>
          identityTag(item[/** @type {{field: string}} */ (identity).field]);
  /** @param {any} item */
  const segmentOf = (item) =>
    identity.kind === "self"
      ? path + "[" + JSON.stringify(item) + "]"
      : path +
        "[" +
        identity.field +
        "=" +
        JSON.stringify(item[identity.field]) +
        "]";

  const segments = new Map();
  /** @param {any[]} arr */
  const toMap = (arr) => {
    const map = new Map();
    for (const item of arr) {
      const id = idOf(item);
      map.set(id, item);
      if (!segments.has(id)) segments.set(id, segmentOf(item));
    }
    return map;
  };
  const baseMap = toMap(baseArr);
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
      segments.get(id),
      keyPath,
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
 * @param {MergeOptions} options
 */
function resolveOptions(options) {
  const keyPaths = new Map();
  const plain = [];
  for (const token of options.keyCandidates || []) {
    const i = token.lastIndexOf(":");
    if (i >= 0) keyPaths.set(token.slice(0, i), token.slice(i + 1));
    else plain.push(token);
  }
  return {
    keyCandidates: [...plain, ...DEFAULT_KEY_CANDIDATES],
    keyPaths,
    onConflict: options.onConflict || null,
  };
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
  return mergeValue(
    base === undefined ? MISSING : base,
    local,
    remote,
    resolveOptions(options),
    "$",
    "",
  );
}

/**
 * Serialize value in the style of sample: a single-line sample gives compact
 * JSON; an indented sample gives the same indent unit, re-indented to the
 * sample's starting column, with the sample's leading and trailing
 * whitespace. `<` is escaped so the text can never close its script element.
 * @param {any} value
 * @param {string} sample
 * @returns {string}
 */
function serializeLike(value, sample) {
  const leading = /^\s*/.exec(sample)[0];
  const trailing = /\s*$/.exec(sample.slice(leading.length))[0];
  const body = sample.slice(leading.length, sample.length - trailing.length);
  const column = leading.slice(leading.lastIndexOf("\n") + 1);
  const nested = /\n([ \t]+)\S/.exec(body);
  let json;
  if (!nested) {
    json = JSON.stringify(value);
  } else {
    const indent = nested[1];
    const unit =
      indent.length > column.length && indent.startsWith(column)
        ? indent.slice(column.length)
        : "  ";
    json = JSON.stringify(value, null, unit).replace(/\n/g, "\n" + column);
  }
  return leading + json.replace(/</g, "\\u003c") + trailing;
}

/**
 * Text-level entry point: parse the three sides, merge whichever of them are
 * valid ("keep only valid JSON"), and serialize so that receivers converge
 * byte-identically with a sender whenever the merged result equals one side.
 * Genuine conflicts are returned in conflicts (see JsonConflict).
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
 * @returns {{text: string, warnings: string[], conflicts: JsonConflict[]}}
 */
function mergeScriptText(baseText, localText, remoteText, options = {}) {
  const parse = options.parse || parseJsonRelaxed;
  /** @type {string[]} */
  const warnings = [];
  const conflicts = [];
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
  if (local === MISSING) return { text: remoteText, warnings, conflicts };
  if (remote === MISSING) return { text: localText, warnings, conflicts };

  const base = tryParse(baseText, "base");
  const merged = mergeJson(base === MISSING ? undefined : base, local, remote, {
    ...options,
    onConflict: (c) => {
      conflicts.push(c);
      options.onConflict?.(c);
    },
  });
  if (deepEqual(merged, remote))
    return { text: remoteText, warnings, conflicts };
  if (deepEqual(merged, local)) return { text: localText, warnings, conflicts };
  return { text: serializeLike(merged, remoteText), warnings, conflicts };
}

export { mergeJson, mergeScriptText };
