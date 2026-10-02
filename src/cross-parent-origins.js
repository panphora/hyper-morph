import { flatten } from "./inline-merge.js";
import { BREAK, MAX_TOKENS } from "./text-merge.js";
import { compileOccurrenceMap, occurrenceBudget } from "./occurrence-map.js";

export function planCrossParentOrigins({
  parent,
  base,
  views,
  eligible,
  ignored,
  remoteWins,
  budget = occurrenceBudget(MAX_TOKENS * 32),
  maxUnits = 256,
  maxCharacters = MAX_TOKENS,
}) {
  const empty = (status, reason = null) => ({
    status,
    reason,
    parent,
    records: [],
  });
  if (views.some(({ V }) => V.asBase)) return empty("none");
  if (
    ignored(parent) ||
    remoteWins(parent) ||
    views.some(({ V }) => !V.el || ignored(V.el) || remoteWins(V.el))
  )
    return empty("none");
  const count = base.length + views[0].V.units.length + views[1].V.units.length;
  if (count > maxUnits) return empty("fallback", "unit-limit");
  const exhausted = Symbol();
  const charge = (amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
    budget.crossParentSteps = (budget.crossParentSteps || 0) + amount;
  };
  const models = new Map();
  let characters = 0;
  const model = (unit) => {
    charge(1);
    if (models.has(unit)) return models.get(unit);
    const raw = unit.nodeType === 1 ? unit.childNodes : unit.nodes;
    charge(raw.length * 4 + 1);
    const nodes = unit.nodeType === 1 ? Array.from(raw) : raw;
    let length = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType !== 3 || (i && nodes[i - 1].nextSibling !== node)) {
        models.set(unit, null);
        return null;
      }
      length += node.data.length;
    }
    if (length > maxCharacters - characters) throw exhausted;
    charge(length * 8 + 1);
    characters += length;
    const flat = flatten(nodes);
    if (flat.text.includes(BREAK)) {
      models.set(unit, null);
      return null;
    }
    const value = { unit, nodes, flat };
    models.set(unit, value);
    return value;
  };
  const records = [];
  try {
    charge(count * 8 + 1);
    for (let side = 0; side < 2; side++) {
      const V = views[side].V,
        other = views[1 - side].V;
      const sources = [];
      const multiplicity = new Map();
      for (let index = 0; index < base.length; index++) {
        charge(1);
        const source = base[index];
        if (source.kind !== "text" || V.twin(source)) continue;
        const opposite = other.twin(source);
        if (!opposite || opposite.kind !== "text" || !other.here(opposite))
          continue;
        const sourceModel = model(source),
          oppositeModel = model(opposite);
        if (!sourceModel || !oppositeModel || !/\S/.test(sourceModel.flat.text))
          continue;
        charge(sourceModel.flat.text.length * 2 + 1);
        const text = sourceModel.flat.text;
        multiplicity.set(text, (multiplicity.get(text) || 0) + 1);
        sources.push({ source, opposite, sourceModel, oppositeModel, index });
      }
      for (const item of sources) {
        const { source, opposite, sourceModel, oppositeModel, index } = item;
        const matches = [];
        for (const direction of [-1, 1]) {
          charge(1);
          const owner = base[index + direction];
          if (
            !owner ||
            owner.nodeType !== 1 ||
            !eligible(owner) ||
            ignored(owner) ||
            remoteWins(owner)
          )
            continue;
          const first = sourceModel.nodes[0],
            last = sourceModel.nodes.at(-1);
          if (
            direction === -1
              ? first?.previousSibling !== owner
              : last?.nextSibling !== owner
          )
            continue;
          const target = V.twin(owner),
            moved = other.twin(owner);
          if (
            !target ||
            !moved ||
            !V.here(target) ||
            other.here(moved) ||
            V.baseOf(target) !== owner ||
            other.baseOf(moved) !== owner ||
            !eligible(target) ||
            !eligible(moved) ||
            ignored(target) ||
            ignored(moved) ||
            remoteWins(target) ||
            remoteWins(moved) ||
            target.tagName !== owner.tagName ||
            moved.tagName !== owner.tagName ||
            target.namespaceURI !== owner.namespaceURI ||
            moved.namespaceURI !== owner.namespaceURI
          )
            continue;
          const ownerBase = model(owner),
            joined = model(target),
            ownerOther = model(moved);
          if (
            !ownerBase ||
            !joined ||
            !ownerOther ||
            !/\S/.test(ownerBase.flat.text)
          )
            continue;
          const before = ownerBase.flat.text,
            incoming = sourceModel.flat.text,
            after = joined.flat.text;
          charge((before.length + incoming.length + after.length) * 3 + 1);
          if (after.length !== before.length + incoming.length) continue;
          const append = direction === -1;
          if (
            append
              ? !after.startsWith(before) || !after.endsWith(incoming)
              : !after.startsWith(incoming) || !after.endsWith(before)
          )
            continue;
          matches.push({
            owner,
            target,
            moved,
            ownerBase,
            joined,
            ownerOther,
            targetFrom: append ? before.length : 0,
            retainedFrom: append ? 0 : incoming.length,
          });
        }
        if (!matches.length) continue;
        if (
          matches.length !== 1 ||
          multiplicity.get(sourceModel.flat.text) !== 1
        )
          return empty("fallback", "ambiguous-origin");
        const match = matches[0];
        const {
          owner,
          target,
          moved,
          ownerBase,
          joined,
          ownerOther,
          targetFrom,
          retainedFrom,
        } = match;
        charge(records.length + 1);
        if (records.some((record) => record.owner === owner))
          return empty("fallback", "ambiguous-owner");
        const run = {
          source,
          target,
          from: 0,
          to: sourceModel.flat.text.length,
          targetFrom,
        };
        const proof = compileOccurrenceMap({
          base: sourceModel.flat,
          side: joined.flat,
          retained: [],
          transfers: [
            {
              from: run.from,
              to: run.to,
              target: targetFrom,
              destination: owner,
            },
          ],
          budget,
        });
        if (proof.status !== "ready" || proof.covers(run.from, run.to) !== true)
          return empty("fallback", proof.reason || "work-limit");
        const native = [
          {
            unit: source,
            model: sourceModel,
            from: 0,
            to: sourceModel.flat.text.length,
          },
          null,
          null,
        ];
        native[side + 1] = {
          unit: target,
          model: joined,
          from: targetFrom,
          to: targetFrom + sourceModel.flat.text.length,
        };
        native[2 - side] = {
          unit: opposite,
          model: oppositeModel,
          from: 0,
          to: oppositeModel.flat.text.length,
        };
        const ownerModels = [ownerBase, null, null];
        ownerModels[side + 1] = joined;
        ownerModels[2 - side] = ownerOther;
        const owners = [owner, null, null];
        owners[side + 1] = target;
        owners[2 - side] = moved;
        records.push({
          side,
          parent,
          source,
          target,
          owner,
          owners,
          ownerModels,
          native,
          models,
          runs: [run],
          proof,
          retained: [
            {
              source: owner,
              target,
              from: 0,
              to: ownerBase.flat.text.length,
              targetFrom: retainedFrom,
            },
          ],
        });
      }
    }
    return records.length
      ? { status: "ready", reason: null, parent, records }
      : empty("none");
  } catch (error) {
    if (error !== exhausted) throw error;
    return empty("fallback", "work-limit");
  }
}

export function createCrossParentOrigins({ describe, parentOf, ...options }) {
  const parents = new WeakMap();
  const owners = new WeakMap();
  const budget = options.budget || occurrenceBudget(MAX_TOKENS * 32);
  const get = (parent) => {
    if (!parent) return null;
    if (parents.has(parent)) return parents.get(parent);
    parents.set(parent, { status: "planning", parent, records: [] });
    const input = describe(parent);
    const result = input
      ? planCrossParentOrigins({ ...options, ...input, parent, budget })
      : { status: "none", reason: null, parent, records: [] };
    parents.set(parent, result);
    if (result.status === "ready")
      for (const record of result.records) owners.set(record.owner, [record]);
    return result;
  };
  return {
    get,
    forOwner(owner) {
      const plan = get(parentOf(owner));
      return plan?.status === "ready" ? owners.get(owner) || null : null;
    },
  };
}
