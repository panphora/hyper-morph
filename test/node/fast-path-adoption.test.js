import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  labelTree,
  finalTree,
  nameOf,
  destinations,
} from "../lib/differential-observe.js";
import { clayIdentity } from "../lib/fast-path-gate.js";

for (const mode of ["late-move", "append-hook", "replace-hook"]) {
  test(`fast adoption reads actual live descendants: ${mode}`, async () => {
    const run = async (fastPath) => {
      const html = doc(
        '<main class="old"><p>old</p></main><aside><p>side</p></aside>',
      );
      const live = parse(html),
        cap = parse(html);
      const remote = parse(
        html.replace('class="old"', 'class="new"').replace(">old<", ">NEW<"),
      );
      const lock = lockstepMap(cap.documentElement, live.documentElement);
      const toLive = (n) => lock.get(n) || null;
      const labels = labelTree(live.documentElement);
      const store = E.createIdentityStore("t");
      const map = store.exportMap(cap.documentElement, toLive);
      const expected = store.idOf(live.querySelector("aside p"));
      if (mode === "late-move")
        live.querySelector("aside").append(live.querySelector("main p"));
      const report = await E.mergeDocument({
        live,
        base: cap,
        local: { root: cap.documentElement, toLive },
        remote,
        fastPath,
        identity: clayIdentity(store, toLive, map),
        scripts: { execute: false },
        hooks: {
          beforeAttributeUpdated(name, el) {
            if (
              mode === "late-move" ||
              name !== "class" ||
              el.tagName !== "MAIN"
            )
              return;
            const aside = el.ownerDocument.querySelector("aside");
            if (mode === "replace-hook")
              aside.firstElementChild.replaceWith(
                aside.firstElementChild.cloneNode(true),
              );
            else aside.append(el.ownerDocument.createElement("i"));
          },
        },
      });
      const final = finalTree(live.documentElement);
      for (const [el, id] of report.identities) store.adopt(el, id);
      assert.equal(store.idOf(live.querySelector("aside p")), expected);
      assert.equal(report.stats.fastPathTaken, Number(fastPath));
      return {
        html: live.documentElement.outerHTML,
        destinations: destinations(labels, final),
        identities: report.identities.map(([el, id]) => [
          nameOf(labels, final, el),
          id,
        ]),
        outsideId: store.idOf(live.querySelector("aside p")),
      };
    };
    assert.deepEqual(await run(true), await run(false));
  });
}
