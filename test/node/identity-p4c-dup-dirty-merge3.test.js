import { test } from "node:test";
import assert from "node:assert/strict";
// ClayJS steady state (every element carries a converged synthetic id).
// The sender duplicates a column; the receiver concurrently edits a card in
// the original column. Identity says the receiver's edit belongs to the
// original (the element the sender kept); the copy is new.
import { parse, doc, load, lockstepMap, all } from "../lib/identity-witness.js";
import { uniqueAuthored } from "../lib/fast-path-gate.js";

async function run(engine, body, senderEdit, fastPath) {
  const E = await load(engine);
  const base = parse(doc(body)),
    live = parse(doc(body)),
    sender = parse(doc(body));
  const store = E.createIdentityStore("t");
  const bl = lockstepMap(base.documentElement, live.documentElement);
  const sl = lockstepMap(sender.documentElement, live.documentElement);
  let n = 0;
  for (const el of all(live)) {
    store.ensure(el);
    el.__n = ++n;
  }
  for (const el of all(base)) store.adopt(el, store.idOf(bl.get(el)));
  const out = E.createIdentityStore("s");
  const origin = new Map(all(sender).map((el) => [el, sl.get(el)]));
  senderEdit(sender.body);
  for (const el of all(sender)) {
    const o = origin.get(el);
    if (o) out.adopt(el, store.idOf(o));
  }
  const map = out.exportMap(sender.documentElement, (x) => x);
  const remoteHtml = "<!DOCTYPE html>" + sender.documentElement.outerHTML;
  const want = parse(remoteHtml);
  const wl = lockstepMap(sender.documentElement, want.documentElement);
  const liveB = live.body.querySelector("section b");
  for (const el of all(sender))
    if (origin.get(el) === liveB) wl.get(el).firstChild.nodeValue += " LOCAL";
  const expected = want.body.innerHTML;
  // receiver edits "Card one" in the original column
  const b = live.body.querySelector("section b");
  b.firstChild.nodeValue += " LOCAL";
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const cl = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (x) => cl.get(x) || null;
  const authored = uniqueAuthored();
  const identity = {
    base: (el) => authored(el) || store.idOf(el) || null,
    local: (el) => authored(el) || store.idOf(toLive(el) || el) || null,
    remote: { first: authored, map, then: authored },
  };
  const opts = {
    live,
    base,
    local: { root: cap.documentElement, toLive },
    remote: remoteHtml,
    identity,
    scripts: { execute: false },
  };
  if (fastPath !== undefined) opts.fastPath = fastPath;
  const pure = E.merge3(base, cap, parse(remoteHtml), {
    identity,
    scripts: { execute: false },
  });
  const pureSecs = [...pure.doc.body.querySelectorAll("section")]
    .map((s) => (s.innerHTML.includes("LOCAL") ? "LOCAL" : "-"))
    .join(" ");
  const rep = await E.mergeDocument(opts);
  const secs = [...live.body.querySelectorAll("section")];
  return {
    sections: secs
      .map(
        (s) =>
          `#${s.__n ?? "new"}${s.querySelector("h2").textContent === "Todo (old)" ? "(old)" : ""}:${s.innerHTML.includes("LOCAL") ? "LOCAL" : "-"}`,
      )
      .join(" "),
    senderOriginalIndex: [...sender.body.querySelectorAll("section")].findIndex(
      (s) => origin.get(s),
    ),
    merge3Sections: pureSecs,
    equalsExpected: live.body.innerHTML === expected,
    cardsPerSection: secs.map((s) => s.querySelectorAll("li").length).join("/"),
    conflicts: rep.conflicts.map((c) => c.kind + ":" + (c.detail || "")),
    localDiverged: rep.localDiverged,
  };
}
const column = (id) =>
  `<main><section class="col"${id}><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>`;
const cases = [
  [
    "copy above, authored data-id",
    column(' data-id="col-1"'),
    (b) => {
      const s = b.querySelector("section");
      s.before(s.cloneNode(true));
    },
  ],
  [
    "copy above, no authored id",
    column(""),
    (b) => {
      const s = b.querySelector("section");
      s.before(s.cloneNode(true));
    },
  ],
  [
    "copy below, original retitled, authored data-id",
    column(' data-id="col-1"'),
    (b) => {
      const s = b.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
  [
    "copy below, original retitled, no authored id",
    column(""),
    (b) => {
      const s = b.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
  [
    "copy below, card two removed from the original, authored data-id",
    column(' data-id="col-1"'),
    (b) => {
      const s = b.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelectorAll("li")[1].remove();
    },
  ],
];
for (const [name, body, edit] of cases)
  test(`G1 p4c-dup-dirty-merge3 ${name}`, async () => {
    for (const fastPath of [false, true]) {
      const out = await run("candidate", body, edit, fastPath);
      assert.equal(out.equalsExpected, true);
      const expected = ["-", "-"];
      expected[out.senderOriginalIndex] = "LOCAL";
      assert.equal(out.merge3Sections, expected.join(" "));
      assert.deepEqual(out.conflicts, []);
    }
  });
