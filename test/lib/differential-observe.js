import { parse, doc } from "../node/lib/dom.js";

// The observer the differential harness compares two engines by: the merged
// bytes, where every pre-merge live node went, which identities were adopted,
// and the merge's report. Kept out of the test file so what it must see
// (template content, new parents, identity recipients) can be tested directly.

export const contentOf = (n) =>
  n.nodeType === 1 && n.tagName === "TEMPLATE" && n.content ? n.content : null;

/** Visit a tree, entering template content; `owners` maps each content
 * fragment to its template. */
function walk(root, visit, owners) {
  const go = (n) => {
    visit(n);
    const content = contentOf(n);
    if (content) {
      owners.set(content, n);
      go(content);
    }
    for (let c = n.firstChild; c; c = c.nextSibling) go(c);
  };
  go(root);
}

const parentIn = (n, owners) =>
  n.nodeType === 11 ? owners.get(n) || null : n.parentNode;

const indexIn = (n, owners) =>
  n.nodeType === 11
    ? "content"
    : Array.prototype.indexOf.call(n.parentNode.childNodes, n);

/** A node's position in the final tree, as child indexes from the root. */
function address(root, n, owners) {
  const path = [];
  for (let x = n; x && x !== root; x = parentIn(x, owners))
    path.push(indexIn(x, owners));
  return "@" + path.reverse().join("/");
}

export function labelTree(root) {
  const ids = new WeakMap();
  const nodes = [];
  walk(
    root,
    (n) => {
      ids.set(n, nodes.length);
      nodes.push(n);
    },
    new WeakMap(),
  );
  return { root, ids, nodes };
}

/** After the merge: which nodes are reachable, and the template owners. */
export function finalTree(root) {
  const seen = new Set();
  const owners = new WeakMap();
  walk(root, (n) => seen.add(n), owners);
  return { root, seen, owners };
}

const nameOf = (label, final, n) => {
  const id = label.ids.get(n);
  if (id !== undefined) return id;
  return final.seen.has(n) ? address(final.root, n, final.owners) : "detached";
};

/** Where every pre-merge live node went: detached from the final tree, or,
 * connected, the name of its parent there and its index in it. */
export function destinations(label, final) {
  return label.nodes.map((n, i) => {
    if (!final.seen.has(n)) return [i, 0];
    if (n === label.root) return [i, 1];
    const parent = parentIn(n, final.owners);
    return [i, 1, nameOf(label, final, parent), indexIn(n, final.owners)];
  });
}

export const identityList = (identities, label, final) =>
  identities
    .map(([el, id]) => JSON.stringify([nameOf(label, final, el), id]))
    .sort();

export const nodeList = (nodes, label, final) =>
  nodes.map((n) => JSON.stringify(nameOf(label, final, n))).sort();

/** The capture's nodes, paired with the live nodes they became. */
export function lockstepMap(a, b) {
  const m = new WeakMap();
  const go = (x, y) => {
    m.set(x, y);
    const cx = contentOf(x),
      cy = contentOf(y);
    if (cx && cy) go(cx, cy);
    for (
      let p = x.firstChild, q = y.firstChild;
      p && q;
      p = p.nextSibling, q = q.nextSibling
    )
      go(p, q);
  };
  go(a, b);
  return m;
}

const conflictList = (conflicts) =>
  conflicts
    .map((c) =>
      JSON.stringify([c.kind, c.detail === undefined ? null : c.detail]),
    )
    .sort();

const decisionList = (decisions) => [
  decisions.length,
  decisions.map((d) => d.kind).sort(),
];

/** A report's fields as the diff compares them: node lists by name. */
const reported = (report, label, final) => ({
  adoptedIdentities: identityList(report.identities || [], label, final),
  conflicts: conflictList(report.conflicts || []),
  decisions: decisionList(report.decisions || []),
  localDiverged: report.localDiverged,
  moved:
    report.moved === undefined ? null : nodeList(report.moved, label, final),
  replaced:
    report.replaced === undefined
      ? null
      : nodeList(report.replaced, label, final),
});

/**
 * One engine's view of one input in one shape: the merged bytes and every
 * live-node, identity, conflict and decision field a merge can observe.
 */
export async function observe(engine, shape, inputs) {
  const { b, l, r } = inputs;
  if (shape === "pure") {
    // The pure merge without hooks omits subtrees identical on both sides:
    // its output is an instruction for apply, not a document. The fuzz gate's
    // pure merge reads the whole output, so ask for a visit.
    const res = engine.merge3(parse(doc(b)), parse(doc(l)), parse(doc(r)), {
      hooks: { beforeNodeMorphed: () => {} },
    });
    return {
      html: res.doc.body.innerHTML,
      nodeDestinations: [],
      adoptedIdentities: [],
      conflicts: conflictList(res.conflicts),
      decisions: decisionList(res.decisions),
      localDiverged: res.localDiverged,
      moved: [],
      replaced: [],
    };
  }
  if (shape === "element") {
    const live = parse(doc("<section>" + l + "</section>"));
    const label = labelTree(live.documentElement);
    const report = await engine.morphElement(live.body.firstElementChild, r, {
      base: b,
      children: true,
    });
    const final = finalTree(live.documentElement);
    return {
      html: live.body.innerHTML,
      nodeDestinations: destinations(label, final),
      ...reported(report, label, final),
    };
  }
  const live = parse(doc(shape === "clean" ? b : l));
  const label = labelTree(live.documentElement);
  let base, local;
  if (shape === "clean") {
    const cap = parse(doc(b));
    const toLive = lockstepMap(cap.documentElement, live.documentElement);
    base = cap;
    local = {
      root: cap.documentElement,
      toLive: (n) => toLive.get(n) || null,
    };
  } else {
    base = doc(b);
  }
  const report = await engine.mergeDocument({
    live,
    base,
    local,
    remote: doc(r),
  });
  const final = finalTree(live.documentElement);
  return {
    html: live.body.innerHTML,
    nodeDestinations: destinations(label, final),
    ...reported(report, label, final),
  };
}
