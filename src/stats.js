/**
 * stats.js — the per-apply counters carried on a merge report.
 *
 * Numbers only, and only from a closed list: what the merge had to do, never
 * what it saw. Nothing here reads a page's text, ids or tags, and no merge
 * decision reads these. The one exception to "numbers" is
 * `fastPathFallback`: the name of the check that sent a `fastPath` call to
 * the full merge, from the closed list below, or null.
 */

/** Why a `fastPath` call took the full merge. */
export const FAST_PATH_BAILS = Object.freeze([
  "root-tag",
  "equal",
  "root-attrs",
  "root-level",
  "not-in-body",
  "ignored-ancestor",
  "remote-wins-ancestor",
  "form-ancestor",
  "script-or-template",
  "no-live-twin",
  "live-detached",
  "ancestor-live",
  "sibling-live",
  "outside-id-changed",
  "chain-unpaired",
]);

export function emptyStats() {
  return {
    lazyTwins: 0,
    hashRejected: 0,
    similarTiesStrict: 0,
    similarTiesLoose: 0,
    ambiguousMoves: 0,
    certificationPairs: 0,
    certificationVisited: 0,
    fastPathAttempted: 0,
    fastPathTaken: 0,
    fastPathFallback: null,
  };
}
