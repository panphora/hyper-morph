import { occurrenceBudget } from "./occurrence-map.js";

const SPACE = /\s/;
const HARD = /\S/;

export function exactOccurrence(
  needle,
  text,
  tokens,
  budget,
  charge,
  unique,
  ownerFrom = -1,
  ownerTo = -1,
) {
  if (!needle.length) return -1;
  charge(budget, needle.length);
  const prefix = new Int32Array(needle.length);
  let matched = 0;
  for (let i = 1; i < needle.length; i++) {
    charge(budget, 1);
    while (matched) {
      charge(budget, 1);
      if (needle[matched] === needle[i]) break;
      matched = prefix[matched - 1];
    }
    charge(budget, 1);
    if (needle[matched] === needle[i]) matched++;
    prefix[i] = matched;
  }
  let found = -1,
    startToken = 0,
    endToken = 0;
  matched = 0;
  for (let i = 0; i < text.length; i++) {
    charge(budget, 1);
    while (matched) {
      charge(budget, 1);
      if (needle[matched] === text[i]) break;
      matched = prefix[matched - 1];
    }
    charge(budget, 1);
    if (needle[matched] === text[i]) matched++;
    if (matched !== needle.length) continue;
    const start = i + 1 - needle.length,
      end = i + 1;
    matched = prefix[matched - 1];
    while (startToken < tokens.length && tokens[startToken].from < start) {
      charge(budget, 1);
      startToken++;
    }
    while (endToken < tokens.length && tokens[endToken].to < end) {
      charge(budget, 1);
      endToken++;
    }
    charge(budget, 6);
    if (
      startToken === tokens.length ||
      endToken === tokens.length ||
      tokens[startToken].from !== start ||
      tokens[endToken].to !== end ||
      (ownerFrom >= 0 && start < ownerTo && end > ownerFrom)
    )
      continue;
    if (!unique) return start;
    if (found >= 0) return -1;
    found = start;
  }
  return found;
}

function plain(model) {
  return !model.flat.atoms.length && !model.flat.pins?.length;
}

export function certifiedSourceRetention(record, certificates, budget, charge) {
  let covered = null;
  for (const certificate of certificates) {
    charge(budget, 1);
    if (
      certificate.source !== record.source ||
      certificate.side !== record.side
    )
      continue;
    for (const run of certificate.runs) {
      charge(budget, 1);
      if (run.source !== record.source) continue;
      const from = Math.max(record.from, run.from),
        to = Math.min(record.to, run.to);
      if (from >= to) continue;
      if (!covered) {
        charge(budget, record.to - record.from);
        covered = new Uint8Array(record.to - record.from);
      }
      charge(budget, to - from);
      covered.fill(1, from - record.from, to - record.from);
    }
  }
  if (!covered) return false;
  charge(budget, record.to - record.from);
  let hard = false;
  for (let i = record.from; i < record.to; i++) {
    if (!HARD.test(record.flat.text[i])) continue;
    if (!covered[i - record.from]) return false;
    hard = true;
  }
  return hard;
}

export function endpointSourceRetention({
  source,
  side,
  views,
  eligible,
  blocked,
  baseId,
  model,
  tokensOf,
  budget,
  charge,
}) {
  const { V, A, idOf } = views[side],
    other = views[1 - side];
  if (
    source.nodeType !== 1 ||
    A.identical.has(source) ||
    other.A.identical.has(source) ||
    blocked.has(source) ||
    !eligible(source)
  )
    return null;
  const twin = V.twin(source),
    counterpart = other.V.twin(source);
  if (
    !twin ||
    !counterpart ||
    A.map.get(source) !== twin ||
    A.reverse.get(twin) !== source ||
    other.A.map.get(source) !== counterpart ||
    other.A.reverse.get(counterpart) !== source ||
    !V.here(twin) ||
    !other.V.here(counterpart) ||
    !eligible(twin) ||
    !eligible(counterpart)
  )
    return null;
  const identity = baseId(source);
  if (identity !== idOf(twin) || identity !== other.idOf(counterpart))
    return null;
  const original = model(source, null, budget),
    current = model(twin, A, budget),
    edited = model(counterpart, other.A, budget);
  if (!plain(original) || !plain(current) || !plain(edited)) return null;
  const before = original.flat.text,
    kept = current.flat.text;
  charge(budget, before.length + kept.length * 3);
  if (!HARD.test(kept) || kept.length >= before.length) return null;
  const prefix = before.startsWith(kept),
    suffix = before.endsWith(kept);
  if (prefix === suffix) return null;
  const from = prefix ? kept.length : 0,
    to = prefix ? before.length : before.length - kept.length;
  let start = from,
    end = to;
  while (start < end) {
    charge(budget, 1);
    if (!SPACE.test(before[start])) break;
    start++;
  }
  while (end > start) {
    charge(budget, 1);
    if (!SPACE.test(before[end - 1])) break;
    end--;
  }
  if (start === end) return null;
  const sourceTokens = tokensOf(original, budget);
  let begins = false,
    ends = false;
  for (const token of sourceTokens) {
    charge(budget, 1);
    if (token.from === start) begins = true;
    if (token.to === end) ends = true;
  }
  if (!begins || !ends) return null;
  return { source, side, flat: original.flat, from, to };
}

export function declinedSourceRetentions({
  base,
  views,
  side,
  attempt,
  eligible,
  blocked,
  baseId,
  model,
  tokensOf,
  certificates,
  charge,
  exhausted,
  limit,
}) {
  if (limit <= 0) return null;
  const budget = occurrenceBudget(limit);
  const { V, A, idOf } = views[side],
    other = views[1 - side];
  const [bl, bh, sl, sh] = attempt;
  let records = null;
  try {
    for (let i = bl; i <= bh; i++) {
      charge(budget, 1);
      const source = base[i];
      if (
        source.nodeType !== 1 ||
        A.identical.has(source) ||
        other.A.identical.has(source) ||
        blocked.has(source) ||
        !eligible(source)
      )
        continue;
      const record = endpointSourceRetention({
        source,
        side,
        views,
        eligible,
        blocked,
        baseId,
        model,
        tokensOf,
        budget,
        charge,
      });
      if (!record) continue;
      if (certifiedSourceRetention(record, certificates, budget, charge))
        continue;
      const { flat, from, to } = record;
      charge(budget, (to - from) * 2);
      const needle = flat.text.slice(from, to).trim();
      for (let j = sl; j <= sh; j++) {
        charge(budget, 1);
        const target = V.units[j],
          owner = V.baseOf(target);
        if (
          !owner ||
          owner === source ||
          owner.nodeType !== 1 ||
          target.nodeType !== 1 ||
          owner.parentNode !== source.parentNode ||
          target.parentNode !== A.map.get(source).parentNode ||
          A.map.get(owner) !== target ||
          A.reverse.get(target) !== owner ||
          blocked.has(owner) ||
          !eligible(owner) ||
          !eligible(target) ||
          baseId(owner) !== idOf(target)
        )
          continue;
        const oldOwner = model(owner, null, budget),
          newOwner = model(target, A, budget);
        if (!plain(oldOwner) || !plain(newOwner)) continue;
        const ownText = oldOwner.flat.text,
          after = newOwner.flat.text;
        charge(budget, ownText.length);
        if (!HARD.test(ownText) || after.length <= ownText.length) continue;
        const tokens = tokensOf(newOwner, budget);
        const at = exactOccurrence(
          ownText,
          after,
          tokens,
          budget,
          charge,
          true,
        );
        if (at < 0) continue;
        if (
          exactOccurrence(
            needle,
            after,
            tokens,
            budget,
            charge,
            false,
            at,
            at + ownText.length,
          ) < 0
        )
          continue;
        (records ||= []).push(record);
        break;
      }
    }
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  return records;
}

export function retainedSourcePolicy(records, source, fb, fl, fr, policy, rec) {
  if (
    policy === "both" ||
    fb.atoms.length ||
    fl.atoms.length ||
    fr.atoms.length
  )
    return policy;
  const deletingRemote = policy === "remote";
  if (
    deletingRemote
      ? rec.rss !== rec.rse || rec.lss === rec.lse || rec.local === rec.base
      : rec.lss !== rec.lse || rec.rss === rec.rse || rec.remote === rec.base
  )
    return policy;
  for (const record of records) {
    if (
      record.source !== source ||
      record.side !== (deletingRemote ? 1 : 0) ||
      record.flat.text !== fb.text ||
      record.flat.nodes.length !== fb.nodes.length ||
      rec.be <= record.from ||
      rec.bs >= record.to
    )
      continue;
    let valid = true;
    for (let i = 0; i < fb.nodes.length; i++) {
      const saved = record.flat.nodes[i],
        actual = fb.nodes[i];
      if (
        saved.node !== actual.node ||
        saved.s !== actual.s ||
        saved.e !== actual.e
      ) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    let hard = false;
    for (let i = rec.bs; i < rec.be; i++) {
      if (!HARD.test(fb.text[i])) continue;
      if (i < record.from || i >= record.to) {
        valid = false;
        break;
      }
      hard = true;
    }
    if (valid && hard) return deletingRemote ? "local" : "remote";
  }
  return policy;
}
