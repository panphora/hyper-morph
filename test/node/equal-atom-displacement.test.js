import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/index.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const button = (id) =>
  `<button${id === "-" ? "" : ` sid="${id}"`}>label</button>`;
const row = (ids, tail = "") =>
  `<div>${[...ids].map(button).join("")}${tail}</div>`;
const cases = [
  {
    name: "one-sided named move beside anonymous siblings",
    base: "--X",
    local: "--X",
    remote: "X--",
  },
  {
    name: "competing named moves beside anonymous siblings",
    base: "--X",
    local: "X--",
    remote: "-X-",
  },
  {
    name: "named move beside duplicate identities",
    base: "AAB",
    local: "BAA",
    remote: "ABA",
  },
];

function validRecovery(obs, shape) {
  const { p, report, liveRoot } = obs.raw;
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
}

for (const fixture of cases)
  for (const shape of ["pure", "dirty"])
    for (const conflicts of ["local", "remote", "both"])
      test(`atom displacement: ${fixture.name}, ${shape}, ${conflicts}`, async () => {
        const obs = await runCase(
          E,
          normalize({
            shape,
            identity: "clay",
            base: row(fixture.base),
            local: row(fixture.local, "LOCAL "),
            remote: row(fixture.remote, " "),
            options: { conflicts },
          }),
        );
        const { p, report, liveRoot } = obs.raw;
        const buttons = [...liveRoot.querySelectorAll("button")];
        assert.equal(buttons.length, 3);
        assert.ok(buttons.every((el) => el.textContent === "label"));
        if (shape === "dirty") {
          for (const captured of p.cap.querySelectorAll("button")) {
            const live = p.capToLive.get(captured);
            assert.ok(
              buttons.includes(live),
              "every original live button survives, including unnamed and duplicate-named buttons",
            );
            assert.equal(live.firstChild, p.capToLive.get(captured.firstChild));
          }
        } else {
          const baseButtons = [...p.base.querySelectorAll("button")];
          const owners = buttons.map((el) => report.provenance.get(el)?.base);
          assert.equal(new Set(owners).size, 3);
          assert.ok(baseButtons.every((el) => owners.includes(el)));
        }
        validRecovery(obs, shape);
      });

for (const shape of ["pure", "dirty"])
  for (const mirror of [false, true])
    test(`atom displacement: a deleted anonymous sibling stays deleted, ${shape}, mirror ${mirror}`, async () => {
      const local = row("-X", "LOCAL ");
      const remote = row("X--", " ");
      const obs = await runCase(
        E,
        normalize({
          shape,
          identity: "clay",
          base: row("--X"),
          local: mirror ? remote : local,
          remote: mirror ? local : remote,
        }),
      );
      const { p, report, liveRoot } = obs.raw;
      const buttons = [...liveRoot.querySelectorAll("button")];
      assert.equal(buttons.length, 2);
      assert.ok(buttons.every((el) => el.textContent === "label"));
      if (shape === "dirty") {
        const named = [...p.sidL].find(([, id]) => id === "X")[0];
        assert.ok(buttons.includes(named));
      }
      validRecovery(obs, shape);
    });
