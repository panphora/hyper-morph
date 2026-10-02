import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/index.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const row = (ids, tail = "") =>
  `<div>${[...ids].map((id) => `<button${id === "-" ? "" : ` sid="${id}"`}>label</button>`).join("")}${tail}</div>`;

for (const shape of ["pure", "dirty"])
  for (const moving of ["local", "remote"])
    for (const conflicts of ["local", "remote", "both"])
      test(`equal atom order: ${moving} alone moves X first, ${shape}, ${conflicts}`, async () => {
        const obs = await runCase(
          E,
          normalize({
            shape,
            identity: "clay",
            base: row("--X"),
            local: row(moving === "local" ? "X--" : "--X", "LOCAL "),
            remote: row(moving === "remote" ? "X--" : "--X", " "),
            options: { conflicts },
          }),
        );
        const { p, report, liveRoot } = obs.raw;
        const buttons = [...liveRoot.querySelectorAll("button")];
        assert.equal(buttons.length, 3);
        assert.ok(buttons.every((el) => el.textContent === "label"));
        if (shape === "pure") {
          const baseButtons = [...p.base.querySelectorAll("button")];
          const owners = buttons.map((el) => report.provenance.get(el)?.base);
          assert.equal(p.sidB.get(owners[0]), "X");
          assert.equal(new Set(owners).size, 3);
          assert.ok(baseButtons.every((el) => owners.includes(el)));
        } else {
          assert.equal(p.sidL.get(buttons[0]), "X");
          for (const captured of p.cap.querySelectorAll("button")) {
            const live = p.capToLive.get(captured);
            assert.ok(buttons.includes(live));
            assert.equal(live.firstChild, p.capToLive.get(captured.firstChild));
          }
        }
        const roots = {
          base: p.base.documentElement,
          local: p.cap.documentElement,
          remote: p.remote.documentElement,
          merged: liveRoot.documentElement,
        };
        assert.deepEqual(
          recoveryProblems(
            report.conflicts,
            finalTree(liveRoot.documentElement),
            shape === "pure",
            shape === "pure" ? roots : {},
          ),
          [],
        );
      });
