// The clean-live shape of the structural fuzz: the receiver's tab is a live
// copy of the capture (base === local), the sender's edits arrive as the
// remote. Reuses the generator in test/lib/structure-fuzz.js.
import { parse, doc } from "./dom.js";
import { mergeDocument } from "../../../src/index.js";
import { fuzz } from "../../lib/structure-fuzz.js";

const SHOW_ALL = 0xffffffff;

export function tagNodes(root) {
  const ids = new WeakMap();
  let n = 0;
  const w = root.ownerDocument.createTreeWalker(root, SHOW_ALL);
  let node = root;
  do {
    ids.set(node, n++);
  } while ((node = w.nextNode()));
  return ids;
}

export function survivors(root, ids) {
  const out = [];
  const w = root.ownerDocument.createTreeWalker(root, SHOW_ALL);
  let node = root;
  do {
    const id = ids.get(node);
    out.push(id === undefined ? "N" : id);
  } while ((node = w.nextNode()));
  return out.join(",");
}

export function lockstepMap(a, b) {
  const m = new WeakMap();
  const wa = a.ownerDocument.createTreeWalker(a, SHOW_ALL),
    wb = b.ownerDocument.createTreeWalker(b, SHOW_ALL);
  let x = a,
    y = b;
  do {
    m.set(x, y);
    x = wa.nextNode();
    y = wb.nextNode();
  } while (x && y);
  return m;
}

/** One row per seed, in seed order: the merged live bytes, the remote's bytes,
 * the conflicts the merge reported, and the live nodes that survived. */
export async function cleanRows(from, to) {
  const rows = [];
  await fuzz(from, to, async (html, local, remote) => {
    const live = parse(doc(html)),
      cap = parse(doc(html));
    const toLive = lockstepMap(cap.documentElement, live.documentElement);
    const ids = tagNodes(live.documentElement);
    const report = await mergeDocument({
      live,
      base: cap,
      local: {
        root: cap.documentElement,
        toLive: (n) => toLive.get(n) || null,
      },
      remote: doc(remote),
    });
    rows.push({
      frame: parse(doc(remote)).body.innerHTML,
      html: live.body.innerHTML,
      conflicts: report.conflicts.map((c) => c.kind),
      survivors: survivors(live.documentElement, ids),
    });
    return { html: live.body.innerHTML, conflicts: report.conflicts };
  });
  return rows;
}
