import { ATOM, MARK_TAGS, flatten } from "./inline-merge.js";
import {
  MAX_TOKENS,
  MAX_EDITS,
  allAscii,
  diffTokens,
  textTokens,
} from "./text-merge.js";
import { compileOccurrenceMap, occurrenceBudget } from "./occurrence-map.js";

const NON_SPACE = /\S/;
const SPACE = /\s/;
const SOFT = /[\s\u001e]/g;
const EVIDENCE = /[^\s\p{P}\u001e\ufffc]/u;

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
    if (!short.text || !NON_SPACE.test(short.text.replaceAll(ATOM, "")))
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

export function certificateGroups({
  base,
  views,
  eligible,
  ignored,
  remoteWins,
  baseId,
  atomKey,
  limit = MAX_TOKENS * 32,
}) {
  if (limit <= 0) return null;
  const baseSet = new Set(base);
  const bPos = new Map(base.map((unit, i) => [unit, i]));
  const models = new Map();
  const certificates = [];
  const blocked = new Set();
  for (const unit of base)
    for (const { V } of views) {
      const twin = V.twin(unit);
      if (twin && !V.asBase && !V.here(twin)) blocked.add(unit);
    }
  const blocks = new Set();
  const exhausted = Symbol();
  const charge = (budget, amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
  };
  const model = (unit, A, budget) => {
    charge(budget, 1);
    let value = models.get(unit);
    if (value) return value;
    if (unit.nodeType === 1) {
      let node = unit.firstChild,
        depth = 1;
      while (node) {
        charge(budget, depth * 8 + 8);
        if (node.nodeType === 3) charge(budget, node.data.length * 8);
        if (
          node.nodeType === 1 &&
          MARK_TAGS.has(node.tagName) &&
          !ignored(node) &&
          !remoteWins(node) &&
          node.firstChild
        ) {
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
    } else charge(budget, unit.value.length * 8 + unit.nodes.length);
    const nodes =
      unit.nodeType === 1 ? Array.from(unit.childNodes) : unit.nodes;
    const flat =
      nodes.length === 1 && nodes[0].nodeType === 3
        ? {
            text: nodes[0].data,
            nodes: [{ node: nodes[0], s: 0, e: nodes[0].data.length }],
            atoms: [],
          }
        : flatten(nodes, { ignored, remoteWins });
    value = { unit, flat, alignment: A, tokens: null };
    models.set(unit, value);
    return value;
  };
  const tokensOf = (value, budget) => {
    if (value.tokens) return value.tokens;
    charge(budget, value.flat.text.length * 8);
    const { unit, flat, alignment: A } = value;
    const tokens = [];
    const fast = allAscii(flat.text);
    let at = 0;
    const addText = (end) => {
      for (const token of textTokens(flat.text.slice(at, end), fast)) {
        token.from = at;
        token.to = at + token.len;
        token.unit = unit;
        tokens.push(token);
        at += token.len;
      }
    };
    for (const atom of flat.atoms) {
      addText(atom.i);
      const key =
        remoteWins(atom.el) && atom.el.nodeType === 1
          ? "w" + atom.el.tagName + "#" + (atom.el.id || "")
          : atomKey(A?.reverse.get(atom.el) || atom.el);
      tokens.push({
        k: key,
        raw: ATOM,
        len: 1,
        from: at,
        to: at + 1,
        unit,
        atom: true,
      });
      at++;
    }
    addText(flat.text.length);
    value.tokens = tokens;
    return tokens;
  };
  const equalAtoms = (X, Y, from, length, budget) => {
    if (!X.flat.atoms.length && !Y.flat.atoms.length) return true;
    const xt = tokensOf(X, budget),
      yt = tokensOf(Y, budget);
    charge(budget, xt.length + yt.length);
    let xi = 0;
    for (const y of yt) {
      if (!y.atom || y.from < from || y.from >= from + length) continue;
      while (xi < xt.length && !xt[xi].atom) xi++;
      const x = xt[xi++];
      if (!x || x.from !== y.from - from || x.k !== y.k) return false;
    }
    while (xi < xt.length) if (xt[xi++].atom) return false;
    return true;
  };
  const equalPairs = (B, S, budget) => {
    const size = B.length + S.length + 4;
    if (size * 8 > budget.remaining) return null;
    budget.remaining -= size * 8;
    const allowance = Math.floor(budget.remaining / 8);
    const depth = Math.min(
      B.length + S.length,
      MAX_EDITS,
      Math.floor((Math.sqrt(size * size + allowance) - size) / 2),
    );
    const cost = 4 * (depth + 1) * (size + depth + 1);
    if (depth < 1 || cost > budget.remaining) return null;
    budget.remaining -= cost;
    const edits = diffTokens(B, S, depth);
    const pairs = [];
    let bi = 0,
      si = 0;
    for (const h of edits.hunks) {
      while (bi < h.bs) {
        if (B[bi].raw === S[si].raw) pairs.push([B[bi], S[si]]);
        bi++;
        si++;
      }
      bi = h.be;
      si += h.toks.length;
    }
    while (bi < B.length && si < S.length) {
      if (B[bi].raw === S[si].raw) pairs.push([B[bi], S[si]]);
      bi++;
      si++;
    }
    return pairs;
  };
  const append = (runs, source, target, from, to, targetFrom, budget) => {
    if (to <= from) return;
    const last = runs[runs.length - 1];
    if (
      last &&
      last.source === source &&
      last.target === target &&
      last.to <= from &&
      last.targetFrom - last.from === targetFrom - from
    ) {
      charge(budget, (from - last.to) * 3);
      const before = models.get(source).flat.text;
      const after = models.get(target).flat.text;
      let same = true;
      for (let i = last.to; i < from; i++)
        if (
          !SPACE.test(before[i]) ||
          before[i] !== after[targetFrom + i - from]
        ) {
          same = false;
          break;
        }
      if (same) {
        last.to = to;
        return;
      }
    }
    runs.push({ source, target, from, to, targetFrom });
  };
  const hard = (text) => text.replace(SOFT, "");
  for (let side = 0; side < views.length; side++) {
    const { V, A, idOf } = views[side];
    if (V.asBase) continue;
    const positions = new Map(V.units.map((unit, i) => [unit, i]));
    const twinHere = (unit) => {
      const twin = V.twin(unit);
      return twin && positions.has(twin) ? twin : null;
    };
    const nearest = (units, retained) => {
      const prev = new Int32Array(units.length),
        next = new Int32Array(units.length);
      let last = -1;
      for (let i = 0; i < units.length; i++) {
        prev[i] = last;
        if (retained(units[i])) last = i;
      }
      last = units.length;
      for (let i = units.length - 1; i >= 0; i--) {
        next[i] = last;
        if (retained(units[i])) last = i;
      }
      return { prev, next };
    };
    const bn = nearest(base, twinHere),
      sn = nearest(V.units, (unit) => baseSet.has(V.baseOf(unit)));
    const windows = new Map();
    const window = (bl, bh, sl, sh) => {
      if (bl > bh || sl > sh) return;
      const key = `${bl}:${bh}:${sl}:${sh}`;
      windows.set(key, [bl, bh, sl, sh]);
    };
    for (let j = 0; j < V.units.length; j++) {
      const unit = V.units[j];
      if (V.baseOf(unit) || !eligible(unit)) continue;
      const lo = sn.prev[j],
        hi = sn.next[j];
      const bl = lo < 0 ? 0 : bPos.get(V.baseOf(V.units[lo]));
      const bh =
        hi === V.units.length
          ? base.length - 1
          : bPos.get(V.baseOf(V.units[hi]));
      window(bl, bh, Math.max(0, lo), Math.min(V.units.length - 1, hi));
    }
    for (let i = 0; i < base.length; i++) {
      const unit = base[i];
      if (blocked.has(unit) || !eligible(unit)) continue;
      if (!V.twin(unit)) {
        const lo = bn.prev[i],
          hi = bn.next[i];
        const sl = lo < 0 ? 0 : positions.get(twinHere(base[lo]));
        const sh =
          hi === base.length
            ? V.units.length - 1
            : positions.get(twinHere(base[hi]));
        window(Math.max(0, lo), Math.min(base.length - 1, hi), sl, sh);
      }
      const twin = twinHere(unit);
      if (!twin || A.identical.has(unit) || !eligible(twin)) continue;
      let next = i + 1;
      while (
        next < base.length &&
        base[next].kind === "text" &&
        !base[next].value.trim()
      )
        next++;
      if (next >= base.length || !eligible(base[next])) continue;
      const nextTwin = twinHere(base[next]);
      if (!nextTwin || A.identical.has(base[next]) || !eligible(nextTwin))
        continue;
      const j = positions.get(twin),
        k = positions.get(nextTwin);
      if (j < k) window(i, next, j, k);
    }
    let attempts = Array.from(windows.values());
    const consumedWindows = new Set();
    if (attempts.length > 1) {
      const unionBudget = occurrenceBudget(limit);
      try {
        charge(unionBudget, attempts.length * 4);
        const ordered = attempts.slice().sort((a, b) => {
          charge(unionBudget, 1);
          return a[0] - b[0] || a[2] - b[2];
        });
        const unions = [];
        let current = null;
        for (const item of ordered) {
          charge(unionBudget, 1);
          if (
            current &&
            item[0] <= current[1] &&
            item[2] <= current[3] &&
            item[3] >= current[2]
          ) {
            current[1] = Math.max(current[1], item[1]);
            current[2] = Math.min(current[2], item[2]);
            current[3] = Math.max(current[3], item[3]);
            current[4].push(item);
          } else {
            if (current?.[4].length > 1) unions.push(current);
            current = [item[0], item[1], item[2], item[3], [item]];
          }
        }
        if (current?.[4].length > 1) unions.push(current);
        attempts = unions.concat(attempts);
      } catch (error) {
        if (error !== exhausted) throw error;
      }
    }
    for (const attempt of attempts) {
      if (consumedWindows.has(attempt)) continue;
      const [bl, bh, sl, sh, members] = attempt;
      const budget = occurrenceBudget(limit);
      const pending = [],
        pendingBlocks = new Set();
      try {
        charge(budget, (bh - bl + sh - sl + 2) * 4);
        const B = base
          .slice(bl, bh + 1)
          .filter(
            (unit) =>
              !A.identical.has(unit) && eligible(unit) && !blocked.has(unit),
          );
        const S = V.units
          .slice(sl, sh + 1)
          .filter(
            (unit) =>
              eligible(unit) &&
              (!V.baseOf(unit) || baseSet.has(V.baseOf(unit))) &&
              !A.identical.has(V.baseOf(unit)) &&
              !blocked.has(V.baseOf(unit)),
          );
        const sSet = new Set(S);
        let failed = false;
        let before = "",
          after = "",
          total = 0;
        for (const unit of B) {
          const M = model(unit, null, budget);
          before += M.flat.text;
          total += M.flat.text.length;
        }
        for (const unit of S) {
          const M = model(unit, A, budget);
          after += M.flat.text;
          total += M.flat.text.length;
        }
        charge(budget, total);
        const beforeHard = hard(before),
          afterHard = hard(after);
        const conservation = beforeHard === afterHard;
        if (members && !conservation) continue;
        const reserved = conservation ? null : new Map();
        if (reserved)
          for (const unit of B.concat(S)) {
            const length = models.get(unit).flat.text.length;
            charge(budget, length * 16);
            reserved.set(unit, new Uint8Array(length));
          }
        const whole = (list) => {
          const spans = [];
          for (const unit of list) {
            const M = models.get(unit);
            if (M.flat.atoms.length) spans.push(...tokensOf(M, budget));
            else spans.push({ unit, raw: M.flat.text, from: 0 });
          }
          return spans;
        };
        const retained = [];
        for (const unit of conservation ? [] : B) {
          const twin = twinHere(unit);
          if (!sSet.has(twin)) continue;
          const original = model(unit, null, budget),
            current = model(twin, A, budget);
          charge(budget, original.flat.text.length + current.flat.text.length);
          const at =
            original.flat.text &&
            current.flat.text.startsWith(original.flat.text)
              ? 0
              : original.flat.text &&
                  current.flat.text.endsWith(original.flat.text)
                ? current.flat.text.length - original.flat.text.length
                : -1;
          if (
            at >= 0 &&
            equalAtoms(original, current, at, original.flat.text.length, budget)
          ) {
            reserved.get(unit).fill(1);
            reserved.get(twin).fill(1, at, at + original.flat.text.length);
            append(
              retained,
              unit,
              twin,
              0,
              original.flat.text.length,
              at,
              budget,
            );
            continue;
          }
          const pairs = equalPairs(
            tokensOf(original, budget),
            tokensOf(current, budget),
            budget,
          );
          if (!pairs) {
            failed = true;
            break;
          }
          for (const [x, y] of pairs) {
            reserved.get(unit).fill(1, x.from, x.to);
            reserved.get(twin).fill(1, y.from, y.to);
            append(retained, unit, twin, x.from, x.to, y.from, budget);
          }
        }
        if (failed) continue;
        const residual = (list) => {
          const tokens = [];
          for (const unit of list) {
            const M = model(unit, baseSet.has(unit) ? null : A, budget),
              used = reserved.get(unit);
            for (const token of tokensOf(M, budget)) {
              let at = token.from;
              while (at < token.to) {
                while (at < token.to && used[at]) at++;
                const from = at;
                while (at < token.to && !used[at]) at++;
                if (at > from) {
                  const raw = M.flat.text.slice(from, at);
                  if (NON_SPACE.test(raw))
                    tokens.push({
                      ...token,
                      raw,
                      len: at - from,
                      k: token.atom ? token.k : raw,
                      from,
                      to: at,
                    });
                }
              }
            }
          }
          return tokens;
        };
        const bt = conservation ? whole(B) : residual(B),
          st = conservation ? whole(S) : residual(S);
        const bhard = conservation
          ? beforeHard
          : bt.map((token) => hard(token.raw)).join("");
        const shard = conservation
          ? afterHard
          : st.map((token) => hard(token.raw)).join("");
        if (!bhard || !shard) continue;
        const matches = [];
        if (bhard === shard) {
          let ti = 0,
            tj = 0,
            bi = 0,
            sj = 0;
          while (ti < bt.length && tj < st.length) {
            const x = bt[ti],
              y = st[tj];
            while (bi < x.raw.length && SPACE.test(x.raw[bi])) bi++;
            while (sj < y.raw.length && SPACE.test(y.raw[sj])) sj++;
            if (bi === x.raw.length) {
              ti++;
              bi = 0;
              continue;
            }
            if (sj === y.raw.length) {
              tj++;
              sj = 0;
              continue;
            }
            if (x.atom || y.atom) {
              if (x.k !== y.k) {
                failed = true;
                break;
              }
            }
            append(
              matches,
              x.unit,
              y.unit,
              x.from + bi,
              x.from + bi + 1,
              y.from + sj,
              budget,
            );
            bi++;
            sj++;
          }
        } else {
          const pairs = equalPairs(bt, st, budget);
          if (!pairs) continue;
          for (const [x, y] of pairs)
            append(matches, x.unit, y.unit, x.from, x.to, y.from, budget);
        }
        if (failed) continue;
        const bySource = new Map();
        for (const run of matches) {
          if (twinHere(run.source) === run.target) {
            if (conservation) retained.push(run);
            continue;
          }
          if (!bySource.has(run.source)) bySource.set(run.source, []);
          bySource.get(run.source).push(run);
        }
        for (const [source, runs] of bySource) {
          const sourceModel = model(source, null, budget),
            twin = twinHere(source);
          const sourceText = sourceModel.flat.text;
          const selected = [];
          const replacementTargets = new Set();
          const other = views[1 - side],
            counterpart = other.V.twin(source);
          const replacement =
            counterpart && other.V.here(counterpart)
              ? model(counterpart, other.A, budget)
              : null;
          const sameModel = (x, y) => {
            const xt = tokensOf(x, budget),
              yt = tokensOf(y, budget);
            charge(
              budget,
              x.flat.text.length + y.flat.text.length + xt.length + yt.length,
            );
            return (
              x.flat.text === y.flat.text &&
              xt.length === yt.length &&
              xt.every((token, i) => token.k === yt[i].k)
            );
          };
          const echoedRewrite =
            twin &&
            replacement &&
            replacement.flat.text !== sourceText &&
            sameModel(model(twin, A, budget), replacement);
          for (const target of new Set(runs.map((run) => run.target))) {
            if (source.nodeType !== 1 && target.nodeType !== 1) continue;
            const targetModel = model(target, A, budget),
              targetBase = V.baseOf(target);
            if (source.nodeType !== 1 && targetBase) continue;
            charge(
              budget,
              sourceText.length * 2 +
                targetModel.flat.text.length * 3 +
                retained.length * 2,
            );
            if (
              twin &&
              hard(sourceText) === hard(targetModel.flat.text) &&
              model(twin, A, budget).flat.text.trim()
            )
              continue;
            if (
              !twin &&
              !targetBase &&
              source.nodeType === 1 &&
              target.nodeType === 1
            ) {
              const a = baseId(source),
                b = idOf(target);
              if (a && b && a !== b) continue;
            }
            const targetText = targetModel.flat.text;
            const carriesWhole =
              sourceText &&
              (targetText.startsWith(sourceText) ||
                targetText.endsWith(sourceText));
            let joinedRewrite = false;
            if (
              !twin &&
              replacement &&
              targetBase &&
              replacement.flat.text !== sourceText
            ) {
              const before = model(targetBase, null, budget).flat.text;
              const left =
                bPos.get(source) < bPos.get(targetBase)
                  ? replacement.flat.text
                  : before;
              const right =
                bPos.get(source) < bPos.get(targetBase)
                  ? before
                  : replacement.flat.text;
              charge(budget, left.length + right.length + targetText.length);
              joinedRewrite =
                !!left &&
                !!right &&
                left.length + right.length <= targetText.length &&
                targetText.startsWith(left) &&
                targetText.endsWith(right) &&
                !targetText
                  .slice(left.length, targetText.length - right.length)
                  .trim();
            }
            const replacementProof =
              !sourceModel.flat.atoms.length &&
              !replacement?.flat.atoms.length &&
              !targetModel.flat.atoms.length &&
              ((echoedRewrite && carriesWhole) || joinedRewrite);
            if (twin && targetBase) {
              const kept = model(twin, A, budget).flat.text;
              const pureSource =
                sourceText.startsWith(kept) || sourceText.endsWith(kept);
              const targetBefore = model(targetBase, null, budget).flat.text;
              const gain = targetModel.flat.text;
              const pureTarget =
                gain.startsWith(targetBefore) || gain.endsWith(targetBefore);
              const orphanSlot =
                !views[1 - side].V.twin(targetBase) &&
                !retained.some(
                  (run) =>
                    run.source === targetBase &&
                    NON_SPACE.test(targetBefore.slice(run.from, run.to)),
                );
              if (
                !conservation &&
                ((!pureSource && !replacementProof) ||
                  (!pureTarget && !orphanSlot))
              )
                continue;
            }
            if (replacementProof) replacementTargets.add(target);
            charge(budget, runs.length);
            selected.push(...runs.filter((run) => run.target === target));
          }
          if (!selected.length) continue;
          const covered = new Uint8Array(sourceText.length);
          charge(budget, sourceText.length * 4 + retained.length);
          for (const run of selected) covered.fill(1, run.from, run.to);
          const hardIndices = [];
          for (let i = 0; i < sourceText.length; i++)
            if (!SPACE.test(sourceText[i])) hardIndices.push(i);
          if (!hardIndices.length) continue;
          const targets = new Set(selected.map((run) => run.target));
          const evidence = hardIndices.filter((i) =>
            EVIDENCE.test(sourceText[i]),
          );
          if (
            !selected.some((run) =>
              EVIDENCE.test(sourceText.slice(run.from, run.to)),
            ) &&
            !hardIndices.every((i) => covered[i])
          )
            continue;
          if (
            !twin &&
            !Array.from(targets).some((target) =>
              replacementTargets.has(target),
            ) &&
            !hardIndices.every((i) => covered[i]) &&
            !(
              evidence.length &&
              covered[evidence[0]] &&
              covered[evidence[evidence.length - 1]] &&
              targets.size === 1
            )
          )
            continue;
          if (
            twin &&
            !(
              hardIndices.every((i) => covered[i]) &&
              (conservation ||
                Array.from(targets).some((target) =>
                  replacementTargets.has(target),
                ))
            ) &&
            !retained.some(
              (run) =>
                run.source === source &&
                NON_SPACE.test(sourceText.slice(run.from, run.to)),
            )
          )
            continue;
          for (const target of targets) {
            charge(budget, selected.length);
            const targetRuns = selected.filter((run) => run.target === target);
            pending.push({
              side,
              source,
              target,
              runs: targetRuns,
              models,
              retained,
            });
            if (source.nodeType === 1) pendingBlocks.add(source);
            if (target.nodeType === 1) pendingBlocks.add(target);
            const targetBase = V.baseOf(target);
            if (targetBase?.nodeType === 1) pendingBlocks.add(targetBase);
          }
        }
        certificates.push(...pending);
        if (members && pending.length)
          for (const member of members) consumedWindows.add(member);
        for (const unit of pendingBlocks) blocks.add(unit);
      } catch (error) {
        if (error !== exhausted) throw error;
      }
    }
  }
  for (const unit of base) {
    if (!blocks.has(unit)) continue;
    for (const { V } of views) {
      const twin = V.twin(unit);
      if (twin && V.here(twin)) blocks.add(twin);
    }
  }
  if (!certificates.length) return null;
  const certificatesBySource = new Map();
  for (const certificate of certificates) {
    let list = certificatesBySource.get(certificate.source);
    if (!list) certificatesBySource.set(certificate.source, (list = []));
    list.push(certificate);
  }
  return { blocks, certificates, certificatesBySource, models };
}

export function certifiedOrigins({
  certificates,
  scopes,
  flats,
  keys,
  limit = MAX_TOKENS * 32,
}) {
  const exhausted = Symbol();
  const budget = occurrenceBudget(limit);
  const charge = (amount) => {
    if (amount > budget.remaining) throw exhausted;
    budget.remaining -= amount;
  };
  const sets = scopes.map((units) => new Set(units));
  const positions = new Map();
  const nativeIndexes = new Map();
  const project = (model, flat) => {
    let byFlat = positions.get(model);
    if (!byFlat) positions.set(model, (byFlat = new Map()));
    if (byFlat.has(flat)) return byFlat.get(flat);
    charge(model.text.length);
    let index = nativeIndexes.get(flat);
    if (!index) {
      charge(flat.nodes.length + flat.atoms.length);
      index = { nodes: new Map(), atoms: new Map() };
      for (const range of flat.nodes) index.nodes.set(range.node, range);
      for (const atom of flat.atoms) index.atoms.set(atom.el, atom.i);
      nativeIndexes.set(flat, index);
    }
    const { nodes, atoms } = index;
    const result = new Int32Array(model.text.length).fill(-1);
    for (const range of model.nodes) {
      const actual = nodes.get(range.node);
      if (!actual || range.e - range.s !== actual.e - actual.s) continue;
      charge(range.e - range.s);
      for (let i = range.s; i < range.e; i++)
        result[i] = actual.s + i - range.s;
    }
    for (const atom of model.atoms) {
      const actual = atoms.get(atom.el);
      if (actual !== undefined) result[atom.i] = actual;
    }
    byFlat.set(flat, result);
    return result;
  };
  const append = (runs, from, to, target, kind) => {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.to === from &&
      last.target + last.to - last.from === target &&
      last.kind === kind
    )
      last.to = to;
    else runs.push({ from, to, target, kind });
  };
  const tokenize = (flat, key, from, to) => {
    charge((to - from) * 4);
    const tokens = [];
    let at = from;
    const textTo = (end) => {
      const text = flat.text.slice(at, end);
      for (const token of textTokens(text, allAscii(text))) {
        token.from = at;
        token.to = at + token.len;
        tokens.push(token);
        at += token.len;
      }
    };
    let lo = 0,
      hi = flat.atoms.length;
    while (lo < hi) {
      charge(1);
      const mid = (lo + hi) >>> 1;
      if (flat.atoms[mid].i < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < flat.atoms.length && flat.atoms[i].i < to; i++) {
      charge(1);
      const atom = flat.atoms[i];
      textTo(atom.i);
      tokens.push({ k: key(atom), raw: ATOM, len: 1, from: at, to: at + 1 });
      at++;
    }
    textTo(to);
    return tokens;
  };
  const gap = (runs, side, from, to, start, end) => {
    if (from === to || start === end) return;
    if (to - from === end - start) {
      charge((to - from) * 4);
      let same = true;
      for (let b = from, s = start; b < to; b++, s++) {
        if (flats[0].text[b] !== flats[side].text[s]) {
          same = false;
          break;
        }
        const ba = flats[0].atomAt.get(b),
          sa = flats[side].atomAt.get(s);
        if (!!ba !== !!sa || (ba && keys[0](ba) !== keys[side](sa))) {
          same = false;
          break;
        }
      }
      if (same) {
        append(runs, from, to, start, "retained");
        return;
      }
    }
    const B = tokenize(flats[0], keys[0], from, to);
    const S = tokenize(flats[side], keys[side], start, end);
    const size = B.length + S.length + 4;
    const depth = Math.min(
      B.length + S.length,
      MAX_EDITS,
      Math.floor((Math.sqrt(size * size + budget.remaining / 2) - size) / 2),
    );
    if (depth < 1) throw exhausted;
    charge(4 * (depth + 1) * (size + depth + 1));
    const edits = diffTokens(B, S, depth);
    let bi = 0,
      si = 0;
    const equal = () => {
      const x = B[bi++],
        y = S[si++];
      charge(x.len);
      if (x.raw === y.raw) append(runs, x.from, x.to, y.from, "retained");
    };
    for (const h of edits.hunks) {
      while (bi < h.bs) equal();
      bi = h.be;
      si += h.toks.length;
    }
    while (bi < B.length && si < S.length) equal();
  };
  const compile = (side) => {
    const selected = certificates.filter(
      (c) =>
        c.side === side - 1 &&
        sets[0].has(c.source) &&
        sets[side].has(c.target),
    );
    if (!selected.length) return null;
    const anchors = [];
    const add = (run, models, kind) => {
      if (!sets[0].has(run.source) || !sets[side].has(run.target)) return;
      const bp = project(models.get(run.source).flat, flats[0]);
      const sp = project(models.get(run.target).flat, flats[side]);
      charge(run.to - run.from);
      for (let k = 0; k < run.to - run.from; k++) {
        const from = bp[run.from + k],
          target = sp[run.targetFrom + k];
        if (from < 0 || target < 0) throw exhausted;
        append(anchors, from, from + 1, target, kind);
      }
    };
    const retainedArrays = new Set();
    for (const cert of selected) {
      if (!retainedArrays.has(cert.retained)) {
        retainedArrays.add(cert.retained);
        for (const run of cert.retained) add(run, cert.models, "retained");
      }
      for (const run of cert.runs) add(run, cert.models, "transfer");
    }
    anchors.sort((a, b) => {
      charge(1);
      return a.from - b.from || a.target - b.target;
    });
    const ordered = [];
    for (const run of anchors) {
      charge(1);
      const last = ordered[ordered.length - 1];
      if (last && run.from < last.to) {
        if (run.target - run.from !== last.target - last.from) throw exhausted;
        last.to = Math.max(last.to, run.to);
        if (run.kind === "transfer") last.kind = "transfer";
      } else ordered.push(run);
    }
    const runs = [];
    let bi = 0,
      si = 0;
    for (const run of ordered) {
      if (run.target < si) throw exhausted;
      gap(runs, side, bi, run.from, si, run.target);
      runs.push(run);
      bi = run.to;
      si = run.target + run.to - run.from;
    }
    gap(runs, side, bi, flats[0].text.length, si, flats[side].text.length);
    const result = compileOccurrenceMap({
      base: flats[0],
      side: flats[side],
      retained: runs.filter((r) => r.kind === "retained"),
      transfers: runs.filter((r) => r.kind === "transfer"),
      baseAtomKey: keys[0],
      sideAtomKey: keys[side],
      budget,
    });
    if (result.status !== "ready" || !result.monotone) throw exhausted;
    return result;
  };
  try {
    const local = compile(1),
      remote = compile(2);
    return local || remote ? { local, remote } : { fallback: true };
  } catch (error) {
    if (error !== exhausted) throw error;
    return { fallback: true };
  }
}

export function inlineScopeUnits(partition, group, complete = false) {
  let first = -1,
    last = -1;
  for (let i = 0; i < partition.list.length; i++) {
    const cell = partition.list[i];
    if (cell.bLo < group.lo || cell.bLo > group.hi) continue;
    if (first < 0) first = i;
    last = i;
  }
  const out = [];
  for (let i = first; i >= 0 && i <= last; i++) {
    const cell = partition.list[i];
    const from =
      !complete && i === first
        ? cell.inlineStart < 0
          ? cell.to
          : cell.inlineStart
        : cell.from;
    const to =
      !complete && i === last
        ? cell.inlineEnd < 0
          ? cell.from
          : cell.inlineEnd
        : cell.to;
    for (let j = from; j < to; j++) out.push(partition.units[j]);
    if (i < last) out.push(partition.units[cell.next]);
  }
  return out;
}
