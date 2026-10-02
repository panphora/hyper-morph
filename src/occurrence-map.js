import { BREAK, MAX_TOKENS } from "./text-merge.js";

export function occurrenceBudget(limit = MAX_TOKENS * 8) {
  return {
    remaining: limit,
    comparisons: 0,
    sortComparisons: 0,
    mapCells: 0,
    mapWrites: 0,
    coverageChecks: 0,
  };
}

export function compileOccurrenceMap({
  base,
  side,
  retained,
  transfers,
  baseAtomKey = (atom) => atom.el,
  sideAtomKey = (atom) => atom.el,
  budget = occurrenceBudget(),
}) {
  const runs = [];
  const fallback = (reason) => ({ status: "fallback", reason });
  const charge = (n) => {
    if (n > budget.remaining) return false;
    budget.remaining -= n;
    return true;
  };
  if (!charge((retained.length + transfers.length) * 3))
    return fallback("work-limit");

  for (const [kind, input] of [
    ["retained", retained],
    ["transfer", transfers],
  ]) {
    for (const run of input) {
      const { from, to, target } = run;
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        !Number.isInteger(target) ||
        from < 0 ||
        to <= from ||
        to > base.text.length ||
        target < 0 ||
        target + to - from > side.text.length
      )
        return fallback("invalid-range");
      runs.push({ ...run, kind });
    }
  }

  const exhausted = Symbol();
  const compare = (fn) => (a, b) => {
    if (!charge(1)) throw exhausted;
    budget.sortComparisons++;
    return fn(a, b);
  };
  let byBase, bySide;
  try {
    byBase = runs
      .slice()
      .sort(compare((a, b) => a.from - b.from || a.to - b.to));
    bySide = runs
      .slice()
      .sort(
        compare(
          (a, b) => a.target - b.target || a.to - a.from - (b.to - b.from),
        ),
      );
  } catch (error) {
    if (error === exhausted) return fallback("work-limit");
    throw error;
  }

  if (!charge(runs.length * 2)) return fallback("work-limit");

  for (let i = 1; i < byBase.length; i++)
    if (byBase[i].from < byBase[i - 1].to) return fallback("source-overlap");
  for (let i = 1; i < bySide.length; i++)
    if (
      bySide[i].target <
      bySide[i - 1].target + bySide[i - 1].to - bySide[i - 1].from
    )
      return fallback("target-overlap");

  for (const run of byBase) {
    const length = run.to - run.from;
    if (!charge(length)) return fallback("work-limit");
    for (let k = 0; k < length; k++) {
      const bi = run.from + k,
        si = run.target + k;
      budget.comparisons++;
      if (base.text[bi] !== side.text[si])
        return fallback("unequal-occurrence");
      const ba = base.atomAt.get(bi),
        sa = side.atomAt.get(si);
      if (!!ba !== !!sa || (ba && baseAtomKey(ba) !== sideAtomKey(sa)))
        return fallback("different-atom");
    }
  }

  const cells = base.text.length + side.text.length + 2;
  const writes = runs.reduce((n, run) => n + (run.to - run.from) * 2, 2);
  if (!charge(cells + writes + runs.length)) return fallback("work-limit");
  const bTo = new Int32Array(base.text.length + 1).fill(-1),
    toB = new Int32Array(side.text.length + 1).fill(-1);
  budget.mapCells += cells;
  budget.mapWrites += writes;
  let last = -1,
    monotone = true;
  for (const run of byBase) {
    if (run.target < last) monotone = false;
    last = run.target + run.to - run.from;
    for (let k = 0; k < run.to - run.from; k++) {
      bTo[run.from + k] = run.target + k;
      toB[run.target + k] = run.from + k;
    }
  }
  bTo[base.text.length] = side.text.length;
  toB[side.text.length] = base.text.length;

  const covers = (from, to) => {
    if (!charge(to - from)) return null;
    budget.coverageChecks += to - from;
    for (let i = from; i < to; i++)
      if (base.text[i] !== BREAK && !/\s/.test(base.text[i]) && bTo[i] < 0)
        return false;
    return true;
  };

  return { status: "ready", runs: byBase, bTo, toB, monotone, covers };
}
