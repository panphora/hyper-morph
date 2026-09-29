import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import {
  clayIdentity,
  observeClean,
  differences,
} from "../lib/fast-path-gate.js";
import { HAND, handInput } from "../lib/fast-path-cases.js";

async function mergeCopies(body, edit, fastPath, share = () => true) {
  const live = parse(doc(body)),
    cap = parse(doc(body)),
    sender = parse(doc(body));
  const receiver = E.createIdentityStore("receiver");
  const senderStore = E.createIdentityStore("sender");
  const initial = senderStore.exportMap(sender.documentElement, (n) => n);
  const imported = E.importMap(live.documentElement, initial);
  for (const el of live.querySelectorAll("*")) {
    if (share(el)) receiver.adopt(el, imported.get(el));
  }
  edit(sender);
  const map = senderStore.exportMap(sender.documentElement, (n) => n);
  const values = Object.entries(map)
    .filter(([k]) => k !== "~" && k !== "^")
    .map(([, v]) => v);
  assert.equal(new Set(values).size, sender.querySelectorAll("*").length);
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (n) => lock.get(n) || null;
  const report = await E.mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive },
    remote: sender.documentElement.outerHTML,
    identity: clayIdentity(receiver, toLive, map),
    scripts: { execute: false },
    fastPath,
  });
  assert.equal(live.body.innerHTML, sender.body.innerHTML);
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.localDiverged, false);
}

for (const position of ["above", "below"]) {
  test(`copied authored column ${position} retains both contents`, async () => {
    for (const fastPath of [false, true])
      await mergeCopies(
        '<main><section class="col" data-id="col-1"><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>',
        (sender) => {
          const original = sender.querySelector("section");
          const copy = original.cloneNode(true);
          if (position === "above") original.before(copy);
          else {
            original.after(copy);
            original.querySelector("h2").textContent = "Todo (old)";
          }
        },
        fastPath,
      );
  });
}

test("copied column with only deep converged identities retains both contents", async () => {
  for (const fastPath of [false, true])
    await mergeCopies(
      '<main><section class="col"><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>',
      (sender) => {
        const original = sender.querySelector("section");
        original.after(original.cloneNode(true));
        original.querySelector("h2").textContent = "Todo (old)";
      },
      fastPath,
      (el) => !["SECTION", "H2", "UL", "LI"].includes(el.tagName),
    );
});

test("cloned wrapper retaining an original deep node preserves the nested copy", async () => {
  for (const fastPath of [false, true])
    await mergeCopies(
      "<div><p><em><b>x words</b></em></p><span>old</span></div><p>tail</p>",
      (sender) => {
        const original = sender.body.firstElementChild;
        const replacement = original.cloneNode(true);
        replacement
          .querySelector("span")
          .replaceChildren(original.cloneNode(true));
        replacement.querySelector("b").replaceWith(original.querySelector("b"));
        original.replaceWith(replacement);
      },
      fastPath,
    );
});

test("G2 identity sharing sweep preserves every copy in all 512 masks", async () => {
  const input = handInput(HAND.find((h) => h.name.startsWith("G2")));
  let losses = 0,
    unequal = 0;
  for (let mask = 0; mask < 512; mask++) {
    const variant = (engine, { cap, remote, toLive }) => {
      const store = engine.createIdentityStore("t");
      const cm = store.exportMap(cap.documentElement, toLive);
      const map = engine
        .createIdentityStore("s")
        .exportMap(remote.documentElement, (n) => n);
      let i = 0;
      for (const k of Object.keys(cm))
        if (k !== "~" && k !== "^") {
          if (mask & (1 << i) && map[k]) map[k] = cm[k];
          i++;
        }
      return clayIdentity(store, toLive, map);
    };
    const full = await observeClean(E, input, variant, false);
    const fast = await observeClean(E, input, variant, true);
    losses += Number(full.html !== input.r);
    unequal += Number(differences(full, fast).length !== 0);
  }
  assert.equal(losses, 0, "content losses across 512 masks");
  assert.equal(unequal, 0, "fast/full differences across 512 masks");
});
