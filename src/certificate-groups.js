import { ATOM, MARK_TAGS, flatten } from "./inline-merge.js";
import { MAX_TOKENS, allAscii, textTokens } from "./text-merge.js";

export function replacementViews({
  base,
  views,
  eligible,
  baseId,
  ignored,
  remoteWins,
  atomKey,
  limit = MAX_TOKENS * 8,
}) {
  if (limit <= 0) return null;
  const exhausted = Symbol();
  const charge = (budget, amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
  };
  const positions = [new Map(), new Map()];
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < views[side].V.units.length; i++)
      positions[side].set(views[side].V.units[i], i);
  const prev = new Int32Array(base.length),
    next = new Int32Array(base.length);
  const common = (unit) =>
    views.every(({ V }, side) => {
      const twin = V.twin(unit);
      return twin && positions[side].has(twin);
    });
  let last = -1;
  for (let i = 0; i < base.length; i++) {
    prev[i] = last;
    if (common(base[i])) last = i;
  }
  last = base.length;
  for (let i = base.length - 1; i >= 0; i--) {
    next[i] = last;
    if (common(base[i])) last = i;
  }
  const models = new Map();
  const model = (unit, budget) => {
    charge(budget, 1);
    if (models.has(unit)) return models.get(unit);
    let node = unit.firstChild,
      depth = 1;
    while (node) {
      charge(budget, depth * 8 + 8);
      if (node.nodeType === 3) charge(budget, node.data.length * 8);
      const descend =
        node.nodeType === 1 &&
        MARK_TAGS.has(node.tagName) &&
        !ignored(node) &&
        !remoteWins(node) &&
        node.firstChild;
      if (descend) {
        node = node.firstChild;
        depth++;
        continue;
      }
      while (node && node !== unit && !node.nextSibling) {
        node = node.parentNode;
        depth--;
      }
      node = !node || node === unit ? null : node.nextSibling;
    }
    const value = flatten(Array.from(unit.childNodes), { ignored, remoteWins });
    models.set(unit, value);
    return value;
  };
  const sameAtoms = (short, long, shift, A, B, budget) => {
    for (const atom of short.atoms) {
      charge(budget, 1);
      const other = long.atomAt.get(atom.i + shift);
      if (!other) return false;
      const a = A?.reverse.get(atom.el) || atomKey(atom.el);
      const b = B?.reverse.get(other.el) || atomKey(other.el);
      if (a !== b) return false;
    }
    return true;
  };
  const endpoint = (left, right, A, B, budget) => {
    const short = left.text.length <= right.text.length ? left : right;
    const long = short === left ? right : left;
    charge(budget, short.text.length + long.text.length);
    if (!short.text || !/\S/.test(short.text.replaceAll(ATOM, "")))
      return false;
    let at;
    if (short.text === long.text) at = 0;
    else {
      const extra = long.text.length - short.text.length;
      charge(budget, (extra + 1) * short.text.length * 2);
      if (long.text.startsWith(short.text)) at = 0;
      else if (long.text.endsWith(short.text)) at = extra;
      else return false;
      if (
        long.text.indexOf(short.text) !== at ||
        long.text.lastIndexOf(short.text) !== at
      )
        return false;
      charge(budget, long.text.length * 2);
      let offset = 0,
        start = at === 0,
        end = false;
      for (const token of textTokens(long.text, allAscii(long.text))) {
        offset += token.len;
        if (offset === at) start = true;
        if (offset === at + short.text.length) end = true;
      }
      if (!start || !end) return false;
    }
    return short === left
      ? sameAtoms(short, long, at, A, B, budget)
      : sameAtoms(short, long, at, B, A, budget);
  };
  let additions = null;
  for (let side = 0; side < 2; side++) {
    const { V, A, idOf } = views[side],
      other = views[1 - side];
    if (V.asBase) continue;
    for (let index = 0; index < base.length; index++) {
      const source = base[index];
      if (V.twin(source) || !eligible(source)) continue;
      const known = other.V.twin(source);
      if (!known || !positions[1 - side].has(known) || !eligible(known))
        continue;
      const budget = { remaining: limit };
      try {
        const left = prev[index],
          right = next[index];
        let slots = 0;
        for (let i = left + 1; i < right; i++) {
          charge(budget, 1);
          if (!V.twin(base[i]) && other.V.twin(base[i]) && eligible(base[i]))
            slots++;
        }
        if (slots !== 1) continue;
        if (model(source, budget).text === model(known, budget).text) continue;
        const lo = left < 0 ? -1 : positions[side].get(V.twin(base[left]));
        const hi =
          right === base.length
            ? V.units.length
            : positions[side].get(V.twin(base[right]));
        if (lo === undefined || hi === undefined || lo >= hi) continue;
        let candidate = null;
        for (let j = lo + 1; j < hi; j++) {
          charge(budget, 1);
          const unit = V.units[j];
          if (
            V.baseOf(unit) ||
            !eligible(unit) ||
            unit.tagName !== source.tagName ||
            unit.namespaceURI !== source.namespaceURI
          )
            continue;
          const a = baseId(source),
            b = other.idOf(known),
            c = idOf(unit);
          if ((a && b && a !== b) || (a && c && a !== c) || (b && c && b !== c))
            continue;
          if (
            !endpoint(
              model(known, budget),
              model(unit, budget),
              other.A,
              A,
              budget,
            )
          )
            continue;
          if (candidate) {
            candidate = null;
            break;
          }
          candidate = unit;
        }
        if (!candidate) continue;
        if (!additions) additions = [new Map(), new Map()];
        additions[side].set(source, candidate);
      } catch (error) {
        if (error !== exhausted) throw error;
      }
    }
  }
  if (!additions) return null;
  return views.map(({ V }, side) => {
    const forward = additions[side];
    if (!forward.size) return V;
    const reverse = new Map();
    for (const [source, target] of forward) reverse.set(target, source);
    return {
      ...V,
      twin: (unit) => forward.get(unit) || V.twin(unit),
      baseOf: (unit) => reverse.get(unit) || V.baseOf(unit),
    };
  });
}
