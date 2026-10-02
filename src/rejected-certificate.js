import { occurrenceBudget } from "./occurrence-map.js";
import { MAX_TOKENS } from "./text-merge.js";

const HARD = /\S/;

export function rejectedCertificateRetentions({
  certificates,
  scopes,
  views,
  eligible,
  baseId,
  limit = MAX_TOKENS * 32,
}) {
  const budget = occurrenceBudget(limit),
    exhausted = Symbol(),
    records = [];
  const charge = (n) => {
    if (n > budget.remaining) throw exhausted;
    budget.remaining -= n;
  };
  const read = (unit, model = null) => {
    charge(1);
    if (
      !unit ||
      unit.nodeType !== 1 ||
      unit.parentNode?.nodeType !== 1 ||
      !eligible(unit)
    )
      return null;
    for (let p = unit.parentNode; p; p = p.parentNode) {
      charge(1);
      if (p.nodeType === 11) return null;
    }
    let text = "",
      i = 0;
    for (const node of unit.childNodes) {
      charge(1);
      if (node.nodeType !== 3) return null;
      charge(node.data.length * 4 + 1);
      if (model) {
        const range = model.flat.nodes[i++];
        if (
          !range ||
          range.node !== node ||
          range.s !== text.length ||
          range.e !== text.length + node.data.length
        )
          return null;
      }
      text += node.data;
    }
    charge(text.length * 3 + 1);
    if (
      model &&
      (model.flat.atoms.length ||
        model.flat.pins?.length ||
        i !== model.flat.nodes.length ||
        model.flat.text !== text)
    )
      return null;
    return HARD.test(text) ? text : null;
  };
  try {
    charge(
      scopes[0].length +
        scopes[1].length +
        scopes[2].length +
        certificates.length,
    );
    const sets = scopes.map((units) => new Set(units)),
      bySource = new Map();
    for (const cert of certificates) {
      charge(1);
      let list = bySource.get(cert.source);
      if (!list) bySource.set(cert.source, (list = []));
      list.push(cert);
    }
    for (const list of bySource.values()) {
      const entries = [null, null],
        completed = [];
      for (const cert of list) {
        charge(1);
        const { source, target, side, models, runs } = cert;
        if (
          (side !== 0 && side !== 1) ||
          !sets[0].has(source) ||
          !sets[side + 1].has(target)
        )
          continue;
        const { V, A, idOf } = views[side],
          other = views[1 - side];
        const twin = V.twin(source),
          counterpart = other.V.twin(source),
          owner = V.baseOf(target);
        if (
          !twin ||
          !counterpart ||
          !owner ||
          owner === source ||
          !sets[0].has(owner) ||
          !sets[side + 1].has(twin) ||
          !sets[2 - side].has(counterpart) ||
          A.map.get(source) !== twin ||
          A.reverse.get(twin) !== source ||
          other.A.map.get(source) !== counterpart ||
          other.A.reverse.get(counterpart) !== source ||
          A.map.get(owner) !== target ||
          A.reverse.get(target) !== owner ||
          target.parentNode !== twin.parentNode ||
          owner.parentNode !== source.parentNode ||
          source.tagName !== twin.tagName ||
          source.tagName !== counterpart.tagName ||
          baseId(source) !== idOf(twin) ||
          baseId(source) !== other.idOf(counterpart) ||
          baseId(owner) !== idOf(target)
        )
          continue;
        const original = models.get(source),
          destination = models.get(target);
        if (!original || !destination) continue;
        const before = read(source, original),
          after = read(target, destination),
          kept = read(twin),
          opposite = read(counterpart);
        charge((before?.length || 0) + (opposite?.length || 0));
        if (
          before === null ||
          after === null ||
          kept === null ||
          opposite === null ||
          opposite === before
        )
          continue;
        let valid = runs.length > 0,
          hard = false;
        for (const run of runs) {
          charge(1);
          if (
            run.source !== source ||
            run.target !== target ||
            !Number.isInteger(run.from) ||
            !Number.isInteger(run.to) ||
            !Number.isInteger(run.targetFrom) ||
            run.from < 0 ||
            run.to <= run.from ||
            run.to > before.length ||
            run.targetFrom < 0 ||
            run.targetFrom + run.to - run.from > after.length
          ) {
            valid = false;
            break;
          }
          charge((run.to - run.from) * 3);
          for (let i = run.from; i < run.to; i++) {
            if (before[i] !== after[run.targetFrom + i - run.from]) {
              valid = false;
              break;
            }
            if (HARD.test(before[i])) hard = true;
          }
          if (!valid) break;
        }
        if (!valid || !hard) continue;
        let entry = entries[side];
        if (!entry) {
          charge(before.length);
          entry = entries[side] = {
            source,
            side,
            flat: original.flat,
            before,
            covered: new Uint8Array(before.length),
          };
        }
        for (const run of runs) {
          charge(run.to - run.from);
          entry.covered.fill(1, run.from, run.to);
        }
      }
      for (const entry of entries) {
        if (!entry) continue;
        const { source, side, flat, before, covered } = entry;
        charge(before.length * 3 + 1);
        let from = -1,
          to = -1;
        for (let i = 0; i <= before.length; i++) {
          if (i < before.length && covered[i]) {
            if (from < 0) from = i;
            to = i + 1;
          } else if (
            (i === before.length || HARD.test(before[i])) &&
            from >= 0
          ) {
            completed.push({ source, side, flat, from, to });
            from = to = -1;
          }
        }
      }
      charge(completed.length);
      records.push(...completed);
    }
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  return { records, budget };
}
