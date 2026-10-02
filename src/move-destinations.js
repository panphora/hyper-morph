const isElement = (node) => node?.nodeType === 1;
const childrenOf = (node) =>
  node?.tagName === "TEMPLATE" && node.content ? node.content : node;

export function createMoveDestinations({
  provenance,
  parentOf,
  twins,
  baseOf,
  build,
  ignored,
  remoteWins,
  discarded,
}) {
  const planned = new Map();
  const built = new WeakMap();

  function plan(base, sourceSide, source, selected = false) {
    if (!isElement(base) || !isElement(source)) return null;
    let record = planned.get(base);
    if (!record) {
      const output = built.get(base) || null;
      record = {
        owner: base,
        parent: parentOf(source),
        port: source,
        sourceSide,
        originalParent: parentOf(base),
        originalPort: base,
        selected,
        state: output ? "built" : "planned",
        output,
        disposition: null,
      };
      planned.set(base, record);
    } else if (selected || (!record.selected && sourceSide === "remote")) {
      record.parent = parentOf(source);
      record.port = source;
      record.sourceSide = sourceSide;
      record.selected = selected;
    }
    return record;
  }

  function produced(base, output) {
    if (!isElement(base) || !isElement(output)) return;
    if (!built.has(base)) built.set(base, output);
    const record = planned.get(base);
    if (record && record.state !== "attached" && !record.output) {
      record.output = output;
      record.state = "built";
    }
  }

  function drain(root) {
    if (!planned.size) return;
    const outputs = new Map();
    const outputParents = new WeakMap();
    const outputAuthority = new WeakMap();
    const attached = new WeakSet();
    const visiting = new Set();

    const add = (source, entry) => {
      if (!source) return;
      if (Array.isArray(source)) {
        for (const node of source) add(node, entry);
        return;
      }
      let entries = outputs.get(source);
      if (!entries) outputs.set(source, (entries = []));
      entries.push(entry);
    };

    const representedSubtree = (source, entry) => {
      if (!source) return;
      const stack = [source];
      while (stack.length) {
        const node = stack.pop();
        add(node, entry);
        for (const child of childrenOf(node).childNodes) stack.push(child);
      }
    };

    function index(node, parent = null, inheritedAuthority = false) {
      if (attached.has(node)) return;
      attached.add(node);
      outputParents.set(node, parent);
      const p = provenance.get(node);
      const authority =
        inheritedAuthority || !!(p && remoteWins(p.remote || p.base));
      outputAuthority.set(node, authority);
      const entry = { node, kind: "node", authority };
      if (p?.pinned) {
        representedSubtree(p.local, { ...entry, kind: "ignored" });
      } else if (p?.unchanged) {
        for (const source of [p.base, p.local, p.remote])
          representedSubtree(source, { ...entry, kind: "unchanged" });
      } else if (p) {
        for (const source of [p.base, p.local, p.remote]) add(source, entry);
        if (isElement(p.local)) {
          for (const child of childrenOf(p.local).children)
            if (ignored(child))
              representedSubtree(child, { ...entry, kind: "ignored" });
        }
      }
      for (const child of childrenOf(node).childNodes)
        index(child, node, authority);
    }

    const representation = (record) => {
      if (record.output && attached.has(record.output)) {
        record.state = "attached";
        record.disposition = "node";
        return true;
      }
      const { local, remote } = twins(record.owner);
      for (const source of [record.owner, local, remote]) {
        const entries = outputs.get(source);
        if (entries?.length) {
          const entry = entries.find((x) => x.kind === "node") || entries[0];
          record.output = entry.node;
          record.state = "attached";
          record.disposition = entry.kind;
          return true;
        }
      }
      return false;
    };

    const directParent = (source, record) => {
      const entries = outputs.get(source) || [];
      return entries.find(
        (entry) =>
          entry.kind === "node" &&
          isElement(entry.node) &&
          (!entry.authority || record.sourceSide === "remote"),
      )?.node;
    };

    const childAt = (source, parent, last) => {
      const entries = outputs.get(source) || [];
      const ordered = last ? [...entries].reverse() : entries;
      for (const entry of ordered) {
        if (entry.kind !== "node") continue;
        let node = entry.node;
        while (node && outputParents.get(node) !== parent)
          node = outputParents.get(node);
        if (node) return node;
      }
      return null;
    };

    const insert = (node, parent, port) => {
      const target = childrenOf(parent);
      for (
        let prev = port?.previousSibling;
        prev;
        prev = prev.previousSibling
      ) {
        const anchor = childAt(prev, parent, true);
        if (anchor) {
          target.insertBefore(node, anchor.nextSibling);
          return;
        }
      }
      for (let next = port?.nextSibling; next; next = next.nextSibling) {
        const anchor = childAt(next, parent, false);
        if (anchor) {
          target.insertBefore(node, anchor);
          return;
        }
      }
      target.appendChild(node);
    };

    function settleParent(source, side, record) {
      const base = side === "base" ? source : baseOf(source, side);
      const parentRecord = planned.get(base);
      if (parentRecord && parentRecord !== record) settle(parentRecord);
    }

    function settle(record) {
      if (
        record.state === "attached" ||
        record.disposition === "remote-wins" ||
        visiting.has(record) ||
        representation(record)
      )
        return;
      visiting.add(record);
      const { local, remote } = twins(record.owner);
      if (remoteWins(remote || record.owner)) {
        if (!remote) {
          record.disposition = "remote-wins";
          discarded(record.owner, local);
          visiting.delete(record);
          return;
        }
        record.parent = parentOf(remote);
        record.port = remote;
        record.sourceSide = "remote";
      }

      settleParent(record.parent, record.sourceSide, record);
      if (representation(record)) {
        visiting.delete(record);
        return;
      }
      let parent = directParent(record.parent, record);
      let port = record.port;
      if (!parent) {
        settleParent(record.originalParent, "base", record);
        if (representation(record)) {
          visiting.delete(record);
          return;
        }
        let source = record.originalParent;
        port = record.originalPort;
        while (source && !parent) {
          parent = directParent(source, record);
          if (!parent) {
            port = source;
            source = parentOf(source);
          }
        }
      }
      if (!parent) {
        throw new Error("A planned move has no allowed surviving parent");
      }
      const node = record.output || build(record.owner);
      record.output = node;
      record.state = "built";
      insert(node, parent, port);
      index(node, parent, outputAuthority.get(parent) || false);
      representation(record);
      visiting.delete(record);
    }

    index(root);
    for (const record of planned.values()) settle(record);
  }

  return { planned, has: (base) => planned.has(base), plan, produced, drain };
}

export function createMergeMoveDestinations(
  provenance,
  parentOf,
  L,
  R,
  twinIn,
  mergeElement,
  ignored,
  remoteWins,
  conflicts,
  conflict,
  changed,
  lRoot,
  rRoot,
) {
  let sideOwners = null;
  const moveParent = (node) => {
    if (!node) return null;
    const known = parentOf(node);
    if (known || node.parentNode?.nodeType !== 11) return known;
    if (!sideOwners) {
      sideOwners = new WeakMap();
      const stack = [lRoot, rRoot];
      while (stack.length) {
        const next = stack.pop();
        const target = childrenOf(next);
        if (target !== next) sideOwners.set(target, next);
        for (const child of target.children) stack.push(child);
      }
    }
    return sideOwners.get(node.parentNode) || null;
  };
  const registry = createMoveDestinations({
    provenance,
    parentOf: moveParent,
    twins: (base) => ({
      local: twinIn(L, base),
      remote: twinIn(R, base),
    }),
    baseOf: (node, side) =>
      node ? (side === "local" ? L : R).reverse.get(node) || null : null,
    build: (base) =>
      mergeElement(base, twinIn(L, base), twinIn(R, base), false),
    ignored,
    remoteWins,
    discarded: (base, local) => {
      if (
        local &&
        changed(base, local, L) &&
        !conflicts.some((c) => c.detail === "remote-wins" && c.base === base)
      )
        conflict(
          {
            kind: "structure",
            el: null,
            detail: "remote-wins",
            base,
            local,
            remote: null,
          },
          { subject: base },
        );
    },
  });
  return registry;
}
