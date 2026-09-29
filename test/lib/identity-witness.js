import { JSDOM } from "jsdom";
const dom = new JSDOM(
  "<!DOCTYPE html><html><head></head><body></body></html>",
  { url: "http://localhost/page.html" },
);
globalThis.window = dom.window;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.document = dom.window.document;
export const parse = (html) =>
  new dom.window.DOMParser().parseFromString(html, "text/html");
export const doc = (body, head = "") =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
export async function load() {
  return import("../../src/index.js");
}
export function lockstepMap(a, b) {
  const m = new Map();
  const go = (x, y) => {
    m.set(x, y);
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
export const all = (d) => [
  d.documentElement,
  ...d.documentElement.querySelectorAll("*"),
];

// ClayJS-shaped mergeDocument with synthetic ids given per body element in
// preorder (0 = no id). Returns bytes, live-node destinations, conflicts.
export async function runSynthetic(
  engine,
  {
    baseBody,
    localEdit,
    remoteBody,
    ids,
    remoteIds,
    fastPath,
    head = "",
    plainIds = false,
  },
) {
  const E = typeof engine === "string" ? await load(engine) : engine;
  const base = parse(doc(baseBody, head));
  const live = parse(doc(baseBody, head));
  localEdit && localEdit(live.body);
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const toLiveM = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (n) => toLiveM.get(n) || null;
  const remote = parse(doc(remoteBody, head));
  const idB = new WeakMap(),
    idL = new WeakMap(),
    idR = new WeakMap();
  const tag = (root, list, m) => {
    const els = [...root.body.querySelectorAll("*")];
    list.forEach((id, i) => id && m.set(els[i], id));
  };
  tag(base, ids, idB);
  tag(live, ids, idL);
  tag(remote, remoteIds, idR);
  let n = 0;
  for (const el of all(live)) el.__n = ++n;
  // ClayJS shape: base/local are functions (authored first, then the store),
  // the remote is a path map from the sender's store (every element gets an
  // id there; unconverged ones are fresh), authored first and then.
  const { uniqueAuthored } = await import("./fast-path-gate.js");
  const authored = uniqueAuthored();
  const sender = E.createIdentityStore("s");
  for (const el of all(remote)) if (idR.get(el)) sender.adopt(el, idR.get(el));
  const map = sender.exportMap(remote.documentElement, (x) => x);
  const identity = plainIds
    ? {
        base: (el) => idB.get(el) || null,
        local: (el) => idL.get(toLive(el) || el) || null,
        remote: (el) => idR.get(el) || null,
      }
    : {
        base: (el) => authored(el) || idB.get(el) || null,
        local: (el) => authored(el) || idL.get(toLive(el) || el) || null,
        remote: { first: authored, map, then: authored },
      };
  const clean = !localEdit;
  const opts = {
    live,
    base: clean ? cap : base,
    local: { root: cap.documentElement, toLive },
    remote,
    identity,
    scripts: { execute: false },
  };
  if (fastPath !== undefined) opts.fastPath = fastPath;
  const report = await E.mergeDocument(opts);
  return {
    html: live.body.innerHTML,
    nodes: [...live.body.querySelectorAll("*")]
      .map((e) => `${e.tagName.toLowerCase()}#${e.__n ?? "new"}`)
      .join(" "),
    conflicts: report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
    localDiverged: report.localDiverged,
    fallback: report.stats && report.stats.fastPathFallback,
    taken: report.stats && report.stats.fastPathTaken,
  };
}
