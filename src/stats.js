/**
 * stats.js — the per-apply counters carried on a merge report.
 *
 * Numbers only, and only from a closed list: what the merge had to do, never
 * what it saw. Nothing here reads a page's text, ids or tags, and no merge
 * decision reads these.
 */

export function emptyStats() {
  return {
    lazyTwins: 0,
    hashRejected: 0,
    similarTiesStrict: 0,
    similarTiesLoose: 0,
    ambiguousMoves: 0,
  };
}
