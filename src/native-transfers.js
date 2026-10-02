import { flatten } from "./inline-merge.js";
import {
  BREAK,
  MAX_EDITS,
  MAX_TOKENS,
  allAscii,
  diff,
  textTokens,
} from "./text-merge.js";
import { compileOccurrenceMap, occurrenceBudget } from "./occurrence-map.js";

export function planNativeTransfers({
  base,
  local,
  remote,
  localTwin,
  remoteTwin,
  eligible,
  nodes,
  budget = occurrenceBudget(MAX_TOKENS * 32),
}) {
  const charge = (amount) => {
    if (amount > budget.remaining) return false;
    budget.remaining -= amount;
    budget.nativeSteps = (budget.nativeSteps || 0) + amount;
    return true;
  };
  if (
    base.length < 2 ||
    local.length !== base.length ||
    remote.length !== base.length ||
    !charge(base.length * 12)
  )
    return null;
  for (const [side, units] of [
    ["base", base],
    ["local", local],
    ["remote", remote],
  ]) {
    const raw = nodes[side];
    if (raw.length !== units.length || raw.some((node, i) => node !== units[i]))
      return null;
  }

  const owners = [];
  let total = 0;
  for (let index = 0; index < base.length; index++) {
    const B = base[index],
      L = local[index],
      R = remote[index];
    if (localTwin(B) !== L || remoteTwin(B) !== R) return null;
    const text = {};
    for (const [side, node] of [
      ["base", B],
      ["local", L],
      ["remote", R],
    ]) {
      if (
        !eligible(node) ||
        node.tagName !== B.tagName ||
        node.namespaceURI !== B.namespaceURI ||
        !charge(node.childNodes.length + 1)
      )
        return null;
      let value = "";
      for (const child of node.childNodes) {
        if (child.nodeType !== 3 || !charge(child.data.length * 4 + 1))
          return null;
        value += child.data;
      }
      if (value.includes(BREAK)) return null;
      total += value.length + 1;
      if (total > MAX_TOKENS) return null;
      text[side] = value;
    }
    owners.push({ base: B, local: L, remote: R, index, text });
  }
  const fast = owners.every((owner) =>
    allAscii(owner.text.base, owner.text.local, owner.text.remote),
  );
  const hunks = { local: [], remote: [] };
  for (const owner of owners) {
    owner.hunks = { local: [], remote: [] };
    for (const side of ["local", "remote"]) {
      const B = owner.text.base,
        S = owner.text[side];
      if (B === S) continue;
      const size = B.length + S.length + 4;
      const scan = size * 8;
      if (!charge(scan)) return null;
      const room = Math.floor(budget.remaining / 8);
      const depth = Math.min(
        MAX_EDITS,
        Math.max(0, Math.floor((Math.sqrt(size * size + room) - size) / 2)),
      );
      if (depth < 1 || !charge(4 * (depth + 1) * (size + depth + 1)))
        return null;
      let delta = 0;
      for (const edit of diff(B, S, depth)) {
        if (!charge(edit.text.length + 1)) return null;
        const ss = edit.bs + delta;
        const h = {
          ...edit,
          ss,
          se: ss + edit.text.length,
          toks: textTokens(edit.text, fast),
          owner: owner.base,
          ownerIndex: owner.index,
        };
        owner.hunks[side].push(h);
        hunks[side].push(h);
        delta += edit.text.length - (edit.be - edit.bs);
      }
    }
  }

  const transfers = [];
  const byOrigin = { local: new Map(), remote: new Map() };
  for (const side of ["local", "remote"]) {
    const removed = new Map(),
      inserted = new Map();
    const add = (map, text, h) => {
      if (map.has(text)) map.set(text, null);
      else map.set(text, h);
    };
    for (const h of hunks[side]) {
      if (!charge(1)) return null;
      const B = owners[h.ownerIndex].text.base;
      if (h.bs < h.be && h.text === "") {
        const text = B.slice(h.bs, h.be);
        if (!charge(text.length * 2)) return null;
        if (/\S/.test(text)) add(removed, text, h);
      } else if (h.bs === h.be && /\S/.test(h.text)) {
        if (!charge(h.text.length * 2)) return null;
        add(inserted, h.text, h);
      }
    }
    for (const [text, deletion] of removed) {
      if (!charge(text.length + 1)) return null;
      const insertion = inserted.get(text);
      if (!deletion || !insertion || deletion.owner === insertion.owner)
        continue;
      const source = owners[deletion.ownerIndex];
      if (!charge(source.text.base.length)) return null;
      if (
        !/\S/.test(
          source.text.base.slice(0, deletion.bs) +
            source.text.base.slice(deletion.be),
        )
      )
        continue;
      const key = `${source.index}:${deletion.bs}:${deletion.be}`;
      const event = {
        key,
        side,
        source: deletion.owner,
        destination: insertion.owner,
        deletion,
        insertion,
      };
      deletion.transferOut = event;
      insertion.transferIn = event;
      byOrigin[side].set(key, event);
      transfers.push(event);
    }
  }
  if (!transfers.length) return null;

  const overlaps = (a, b) => a.bs < b.be && b.bs < a.be;
  const insertion = (h) => h.bs === h.be;
  const touches = (a, b) =>
    a.bs <= b.be && b.bs <= a.be && insertion(a) !== insertion(b);
  const same = (a, b) => a.bs === b.bs && a.be === b.be && a.text === b.text;
  const transported = (h) => !!(h.transferIn || h.transferOut);
  for (const event of transfers) {
    const opposite = event.side === "local" ? "remote" : "local";
    const source = owners[event.deletion.ownerIndex];
    for (const h of source.hunks[opposite]) {
      if (!charge(1)) return null;
      if (overlaps(event.deletion, h) && h.transferOut?.key !== event.key)
        return null;
    }
  }
  for (const owner of owners) {
    for (const l of owner.hunks.local) {
      for (const r of owner.hunks.remote) {
        if (!charge(1)) return null;
        if (same(l, r)) {
          if (l.transferIn?.key !== r.transferIn?.key) return null;
          continue;
        }
        if (
          overlaps(l, r) ||
          (touches(l, r) && !transported(l) && !transported(r))
        )
          return null;
      }
    }
  }

  if (!charge(total * 8)) return null;
  const blocks = new Set([...base, ...local, ...remote]);
  const flats = {
    base: flatten(base, { blocks }),
    local: flatten(local, { blocks }),
    remote: flatten(remote, { blocks }),
  };
  const starts = {};
  for (const side of ["base", "local", "remote"]) {
    const flat = flats[side];
    if (flat.atoms.length || flat.pins.length) return null;
    starts[side] = new Map(
      flat.marks
        .filter((mark) => mark.block)
        .map((mark) => [mark.el, mark.from]),
    );
  }
  for (const owner of owners) {
    const bs = starts.base.get(owner.base);
    if (bs === undefined) return null;
    for (const side of ["local", "remote"]) {
      const ss = starts[side].get(owner[side]);
      if (ss === undefined) return null;
      for (const h of owner.hunks[side]) {
        h.bs += bs;
        h.be += bs;
        h.ss += ss;
        h.se += ss;
      }
    }
  }
  for (const event of transfers) {
    event.bs = event.deletion.bs;
    event.be = event.deletion.be;
    event.ss = event.insertion.ss;
    event.se = event.insertion.se;
  }

  const maps = {};
  for (const side of ["local", "remote"]) {
    let bi = 0,
      si = 0;
    const retained = [];
    for (const h of hunks[side]) {
      if (!charge(1)) return null;
      if (h.bs > bi) retained.push({ from: bi, to: h.bs, target: si });
      bi = h.be;
      si = h.se;
    }
    if (bi < flats.base.text.length)
      retained.push({ from: bi, to: flats.base.text.length, target: si });
    const moved = transfers
      .filter((event) => event.side === side)
      .map((event) => ({
        from: event.bs,
        to: event.be,
        target: event.ss,
        destination: event.destination,
      }));
    maps[side] = compileOccurrenceMap({
      base: flats.base,
      side: flats[side],
      retained,
      transfers: moved,
      budget,
    });
    if (maps[side].status !== "ready") return null;
  }
  if (!charge(flats.base.text.length)) return null;
  return {
    owners,
    blocks,
    transfers,
    byOrigin,
    budget,
    prepared: {
      base: flats.base,
      local: flats.local,
      remote: flats.remote,
      lines: false,
      baseTokens: textTokens(flats.base.text, fast),
      localEdits: { hunks: hunks.local, respell: new Map() },
      remoteEdits: { hunks: hunks.remote, respell: new Map() },
      localMap: maps.local,
      remoteMap: maps.remote,
      full: null,
    },
  };
}
