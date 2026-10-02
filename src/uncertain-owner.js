import { occurrenceBudget } from "./occurrence-map.js";
import { exactOccurrence } from "./source-retention.js";

const HARD = /\S/;
const LEXICAL = /[\p{L}\p{N}]/u;

function plainOwner(unit, eligible, budget, charge) {
  if (unit?.nodeType !== 1 || !eligible(unit)) return false;
  for (let node = unit.firstChild; node; node = node.nextSibling) {
    charge(budget, 1);
    if (node.nodeType !== 3) return false;
  }
  return !!unit.firstChild;
}

function outsideFragment(unit, budget, charge) {
  for (let parent = unit.parentNode; parent; parent = parent.parentNode) {
    charge(budget, 1);
    if (parent.nodeType === 11) return false;
  }
  return true;
}

function retainedBoundary(original, current, tokensOf, budget, charge) {
  const a = tokensOf(original, budget),
    b = tokensOf(current, budget);
  let af = null,
    al = null,
    bf = null,
    bl = null;
  charge(budget, a.length + b.length);
  for (const token of a)
    if (LEXICAL.test(token.raw)) {
      af ||= token;
      al = token;
    }
  for (const token of b)
    if (LEXICAL.test(token.raw)) {
      bf ||= token;
      bl = token;
    }
  return !!(af && bf && (af.raw === bf.raw || al.raw === bl.raw));
}

export function uncertainSourceOwners({
  base,
  views,
  side,
  attempt,
  eligible,
  blocked,
  baseId,
  model,
  tokensOf,
  charge,
  exhausted,
  limit,
}) {
  if (limit <= 0) return null;
  const budget = occurrenceBudget(limit),
    { V, A, idOf } = views[side],
    other = views[1 - side];
  const [bl, bh, sl, sh] = attempt;
  let records = null;
  try {
    for (let i = bl; i <= bh; i++) {
      charge(budget, 1);
      const source = base[i];
      if (
        source.parentNode?.nodeType !== 1 ||
        blocked.has(source) ||
        A.identical.has(source) ||
        other.A.identical.has(source) ||
        !plainOwner(source, eligible, budget, charge) ||
        baseId(source)
      )
        continue;
      const twin = V.twin(source),
        counterpart = other.V.twin(source);
      if (
        !twin ||
        !counterpart ||
        !V.here(twin) ||
        !other.V.here(counterpart) ||
        A.map.get(source) !== twin ||
        A.reverse.get(twin) !== source ||
        other.A.map.get(source) !== counterpart ||
        other.A.reverse.get(counterpart) !== source ||
        idOf(twin) ||
        other.idOf(counterpart) ||
        twin.tagName !== source.tagName ||
        counterpart.tagName !== source.tagName ||
        !plainOwner(twin, eligible, budget, charge) ||
        !plainOwner(counterpart, eligible, budget, charge)
      )
        continue;
      if (
        !outsideFragment(source, budget, charge) ||
        !outsideFragment(twin, budget, charge) ||
        !outsideFragment(counterpart, budget, charge)
      )
        continue;
      const original = model(source, null, budget),
        current = model(twin, A, budget),
        edited = model(counterpart, other.A, budget);
      const before = original.flat.text,
        kept = current.flat.text,
        opposite = edited.flat.text;
      charge(budget, before.length + kept.length + opposite.length);
      if (
        !HARD.test(before) ||
        !HARD.test(kept) ||
        !HARD.test(opposite) ||
        before === kept ||
        before === opposite ||
        kept === opposite ||
        !retainedBoundary(original, current, tokensOf, budget, charge) ||
        !retainedBoundary(original, edited, tokensOf, budget, charge)
      )
        continue;
      let gained = null,
        ambiguous = false;
      for (let j = sl; j <= sh; j++) {
        charge(budget, 1);
        const target = V.units[j],
          owner = V.baseOf(target);
        if (
          !owner ||
          owner === source ||
          blocked.has(owner) ||
          owner.parentNode !== source.parentNode ||
          target.parentNode !== twin.parentNode ||
          owner.tagName !== source.tagName ||
          target.tagName !== source.tagName ||
          A.map.get(owner) !== target ||
          A.reverse.get(target) !== owner ||
          baseId(owner) !== idOf(target) ||
          !plainOwner(owner, eligible, budget, charge) ||
          !plainOwner(target, eligible, budget, charge)
        )
          continue;
        const previous = model(owner, null, budget),
          destination = model(target, A, budget),
          own = previous.flat.text,
          after = destination.flat.text;
        charge(budget, own.length);
        if (!HARD.test(own) || after.length <= own.length) continue;
        const tokens = tokensOf(destination, budget);
        const at = exactOccurrence(own, after, tokens, budget, charge, true);
        if (
          at < 0 ||
          exactOccurrence(
            before,
            after,
            tokens,
            budget,
            charge,
            true,
            at,
            at + own.length,
          ) < 0
        )
          continue;
        if (gained) {
          ambiguous = true;
          break;
        }
        gained = target;
      }
      if (!gained || ambiguous) continue;
      const local = side === 0 ? twin : counterpart,
        remote = side === 0 ? counterpart : twin;
      (records ||= []).push({
        source,
        local,
        remote,
        models: [
          original,
          side === 0 ? current : edited,
          side === 0 ? edited : current,
        ],
      });
    }
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  return records;
}
