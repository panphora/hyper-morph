import { test } from "node:test";
import assert from "node:assert/strict";
// Mirror of p4: the LOCAL tab duplicated a column (unsaved), the remote
// edited a card in the original column. Identity says the remote edit
// belongs to the original (the element both tabs knew); the local copy is new.
import { parse, doc, load, lockstepMap, all } from "../lib/identity-witness.js";
import { uniqueAuthored } from "../lib/fast-path-gate.js";
async function run(engine, body, localEdit) {
  const E = await load(engine);
  const base = parse(doc(body)),
    live = parse(doc(body)),
    sender = parse(doc(body));
  const store = E.createIdentityStore("t");
  const bl = lockstepMap(base.documentElement, live.documentElement);
  const sl = lockstepMap(sender.documentElement, live.documentElement);
  for (const el of all(live)) store.ensure(el);
  for (const el of all(base)) store.adopt(el, store.idOf(bl.get(el)));
  const out = E.createIdentityStore("s");
  for (const el of all(sender)) out.adopt(el, store.idOf(sl.get(el)));
  sender.body.querySelector("section b").firstChild.nodeValue += " REMOTE";
  const map = out.exportMap(sender.documentElement, (x) => x);
  const liveOriginal = live.body.querySelector("section");
  localEdit(live.body);
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const cl = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (x) => cl.get(x) || null;
  const authored = uniqueAuthored();
  const identity = {
    base: (el) => authored(el) || store.idOf(el) || null,
    local: (el) => authored(el) || store.idOf(toLive(el) || el) || null,
    remote: { first: authored, map, then: authored },
  };
  const rep = await E.mergeDocument({
    live,
    base,
    local: { root: cap.documentElement, toLive },
    remote: "<!DOCTYPE html>" + sender.documentElement.outerHTML,
    identity,
    scripts: { execute: false },
  });
  const secs = [...live.body.querySelectorAll("section")];
  return {
    sections: secs
      .map(
        (s) =>
          `${s === liveOriginal ? "original" : "copy"}${s.querySelector("h2").textContent.includes("old") ? "(old)" : ""}:${s.innerHTML.includes("REMOTE") ? "REMOTE" : "-"}`,
      )
      .join(" "),
    conflicts: rep.conflicts.map((c) => c.kind + ":" + (c.detail || "")),
  };
}
const column = (id) =>
  `<main><section class="col"${id}><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>`;
const cases = [
  [
    "local copy above, authored data-id",
    column(' data-id="col-1"'),
    (b) => {
      const s = b.querySelector("section");
      s.before(s.cloneNode(true));
    },
  ],
  [
    "local copy below, original retitled, authored data-id",
    column(' data-id="col-1"'),
    (b) => {
      const s = b.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
  [
    "local copy below, original retitled, no authored id",
    column(""),
    (b) => {
      const s = b.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
];
for (const [name, body, edit] of cases)
  test(`G1 ${name}`, async () => {
    const out = await run("candidate", body, edit);
    assert.match(out.sections, /original(?:\(old\))?:REMOTE/);
    assert.doesNotMatch(out.sections, /copy(?:\(old\))?:REMOTE/);
    assert.deepEqual(out.conflicts, []);
  });
