import { flatten, mergeInline, prepareInline } from "./inline-merge.js";
import { createCrossParentOrigins } from "./cross-parent-origins.js";
import { compileOccurrenceMap, occurrenceBudget } from "./occurrence-map.js";
import { MAX_TOKENS } from "./text-merge.js";

export function prepareCrossParentPayload(record, budget) {
  if (record.side !== 0) return null;
  const source = record.native[0].model;
  const owner = record.ownerModels[0];
  const append = record.native[1].from !== 0;
  const ordered = (a, b) =>
    append ? [...a.nodes, ...b.nodes] : [...b.nodes, ...a.nodes];
  const length =
    record.ownerModels.reduce((n, model) => n + model.flat.text.length, 0) +
    source.flat.text.length +
    record.native[2].model.flat.text.length;
  if (length * 8 > budget.remaining) return null;
  budget.remaining -= length * 8;
  const nodes = {
    base: ordered(owner, source),
    local: record.ownerModels[1].nodes,
    remote: ordered(record.ownerModels[2], record.native[2].model),
  };
  const base = flatten(nodes.base);
  const local = record.ownerModels[1].flat;
  const remote = flatten(nodes.remote);
  const sourceStart = append ? owner.flat.text.length : 0;
  const ownerStart = append ? 0 : source.flat.text.length;
  const localMap = compileOccurrenceMap({
    base,
    side: local,
    retained: record.retained.map((run) => ({
      from: ownerStart + run.from,
      to: ownerStart + run.to,
      target: run.targetFrom,
    })),
    transfers: record.runs.map((run) => ({
      from: sourceStart + run.from,
      to: sourceStart + run.to,
      target: run.targetFrom,
      destination: record.owner,
    })),
    budget,
  });
  if (
    localMap.status !== "ready" ||
    localMap.covers(0, base.text.length) !== true
  )
    return null;
  const remoteOwner = record.ownerModels[2].flat;
  const remoteSource = record.native[2].model.flat;
  const retained = [];
  for (const [before, after, from, target] of [
    [
      owner.flat,
      remoteOwner,
      ownerStart,
      append ? 0 : remoteSource.text.length,
    ],
    [
      source.flat,
      remoteSource,
      sourceStart,
      append ? remoteOwner.text.length : 0,
    ],
  ]) {
    const mapped = prepareInline(before, before, after).remoteMap.bTo;
    let start = -1;
    for (let i = 0; i < before.text.length; i++) {
      if (mapped[i] < 0) {
        start = -1;
        continue;
      }
      const last = retained.at(-1);
      if (
        start >= 0 &&
        last.to === from + i &&
        last.target + last.to - last.from === target + mapped[i]
      )
        last.to++;
      else {
        retained.push({
          from: from + i,
          to: from + i + 1,
          target: target + mapped[i],
        });
        start = i;
      }
    }
  }
  const remoteMap = compileOccurrenceMap({
    base,
    side: remote,
    retained,
    transfers: [],
    budget,
  });
  if (remoteMap.status !== "ready") return null;
  const prepared = prepareInline(
    base,
    local,
    remote,
    {},
    { local: localMap, remote: remoteMap },
  );
  if (prepared.localEdits.hunks.length) return null;
  prepared.localMap = localMap;
  prepared.remoteMap = remoteMap;
  return { nodes, prepared };
}

export function createCrossParentConsumer({
  L,
  R,
  twinIn,
  unitsOf,
  view,
  parentOf,
  ignored,
  remoteWins,
  eligible,
  build,
  out,
  policy,
  provenance,
  textMappers,
  segments,
  conflicts,
  conflict,
  decisions,
}) {
  const budget = occurrenceBudget(MAX_TOKENS * 32);
  const safe = (node) => {
    let depth = 0;
    for (let current = node; current; current = parentOf(current)) {
      if (++depth > 64) return false;
      if (current.nodeType === 1 && (ignored(current) || remoteWins(current)))
        return false;
    }
    return true;
  };
  const origins = createCrossParentOrigins({
    parentOf,
    eligible,
    ignored,
    remoteWins,
    budget,
    describe(parent) {
      const local = twinIn(L, parent),
        remote = twinIn(R, parent);
      if (!local || !remote || !safe(parent) || !safe(local) || !safe(remote))
        return null;
      return {
        base: unitsOf(parent),
        views: [
          { A: L, V: view(L, local, parent, false) },
          { A: R, V: view(R, remote, parent, false) },
        ],
      };
    },
  });
  const visited = new WeakSet();
  const byOwner = new WeakMap();
  const claimed = new WeakSet();
  const pending = [];

  function ensureParent(parent) {
    if (!parent || visited.has(parent)) return;
    visited.add(parent);
    const plan = origins.get(parent);
    if (plan?.status !== "ready") return;
    for (const record of plan.records) {
      const physical =
        parent.tagName === "TEMPLATE" && parent.content
          ? parent.content
          : parent;
      if (
        physical.childNodes.length !==
          record.native[0].model.nodes.length + 1 ||
        !record.owners.every(safe)
      )
        continue;
      const payload = prepareCrossParentPayload(record, budget);
      if (!payload) continue;
      const entry = {
        record,
        payload,
        state: "planned",
        output: null,
        result: null,
      };
      byOwner.set(record.owner, entry);
      claimed.add(record.source);
      claimed.add(record.native[2].unit);
      pending.push(entry);
    }
  }

  function render(owner, element) {
    const entry = byOwner.get(owner);
    if (!entry) return false;
    if (!entry.result) {
      entry.result = mergeInline({
        ...entry.payload.nodes,
        prepared: entry.payload.prepared,
        out,
        policy,
        provenance,
        textMappers,
        conflicts,
        conflict,
        decisions,
        node: element,
      });
      if (entry.result.conflicts.length)
        throw new Error("Unsupported cross-parent payload conflict");
      segments.push(...entry.result.segments);
      entry.decision = { kind: "text", node: element, source: "local" };
      decisions.push(entry.decision);
    }
    entry.decision.node = element;
    element.replaceChildren(...entry.result.nodes);
    entry.output = element;
    entry.state = "built";
    return true;
  }

  function drain(root) {
    if (!pending.length) return;
    const attached = new WeakSet();
    const parents = new WeakMap();
    const authority = new WeakMap();
    const outputs = new WeakMap();
    const children = (node) =>
      node.tagName === "TEMPLATE" && node.content ? node.content : node;
    const add = (source, node) => {
      if (!source) return;
      if (Array.isArray(source)) {
        for (const part of source) add(part, node);
        return;
      }
      let list = outputs.get(source);
      if (!list) outputs.set(source, (list = []));
      list.push(node);
    };
    const index = (node, parent = null, inherited = false) => {
      attached.add(node);
      parents.set(node, parent);
      const p = provenance.get(node);
      const authoritative =
        inherited || !!(p && remoteWins(p.remote || p.base));
      authority.set(node, authoritative);
      if (p)
        for (const source of [p.base, p.local, p.remote]) add(source, node);
      if (p?.pinned || p?.unchanged) return;
      for (const child of children(node).childNodes)
        index(child, node, authoritative);
    };
    const allowed = (source) =>
      (outputs.get(source) || []).find(
        (node) =>
          node.nodeType === 1 &&
          !authority.get(node) &&
          !provenance.get(node)?.pinned &&
          !provenance.get(node)?.unchanged,
      );
    const childAt = (source, parent) => {
      for (const output of outputs.get(source) || []) {
        let child = output;
        while (child && parents.get(child) !== parent)
          child = parents.get(child);
        if (child) return child;
      }
      return null;
    };
    const insert = (node, parent, port) => {
      const target = children(parent);
      for (let next = port.nextSibling; next; next = next.nextSibling) {
        const anchor = childAt(next, parent);
        if (anchor) {
          target.insertBefore(node, anchor);
          return;
        }
      }
      for (
        let previous = port.previousSibling;
        previous;
        previous = previous.previousSibling
      ) {
        const anchor = childAt(previous, parent);
        if (anchor) {
          target.insertBefore(node, anchor.nextSibling);
          return;
        }
      }
      target.appendChild(node);
    };
    index(root);
    for (const entry of pending) {
      const { record } = entry;
      let owner =
        allowed(record.owner) ||
        allowed(record.owners[1]) ||
        allowed(record.owners[2]);
      if (owner) {
        if (
          !entry.result ||
          entry.output !== owner ||
          entry.result.nodes.some(
            (node) => !attached.has(node) || parents.get(node) !== owner,
          ) ||
          owner.textContent !== entry.result.text
        ) {
          render(record.owner, owner);
          index(owner, parents.get(owner), authority.get(owner));
        }
      } else {
        let source = record.parent,
          port = record.owner,
          parent = null;
        while (source && !parent) {
          parent = allowed(source);
          if (!parent) {
            port = source;
            source = parentOf(source);
          }
        }
        if (!parent)
          throw new Error(
            "A cross-parent payload has no allowed surviving parent",
          );
        owner =
          entry.output ||
          build(record.owner, record.owners[1], record.owners[2], false);
        if (!entry.result) render(record.owner, owner);
        insert(owner, parent, port);
        index(owner, parent, authority.get(parent));
      }
      entry.state = "attached";
    }
  }

  return {
    ensureParent,
    ensureOwner(owner) {
      ensureParent(parentOf(owner));
    },
    consumes(unit) {
      return claimed.has(unit);
    },
    render,
    drain,
  };
}
