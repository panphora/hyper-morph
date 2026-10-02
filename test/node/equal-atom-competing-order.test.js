import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/index.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const row = (ids, tail = "") =>
  `<div>${[...ids].map((id) => `<button${id === "-" ? "" : ` sid="${id}"`}>label</button>`).join("")}${tail}</div>`;
const cases = [
  {
    name: "anonymous siblings",
    base: "--X",
    local: "X--",
    remote: "-X-",
    conflicts: 2,
    order: {
      local: {
        base: [2, 1, 0],
        local: [0, 1, 2],
        remote: [1, 2, 0],
        named: "X--",
      },
      remote: {
        base: [0, 2, 1],
        local: [2, 0, 1],
        remote: [0, 1, 2],
        named: "-X-",
      },
    },
  },
  {
    name: "duplicate identities",
    base: "AAB",
    local: "BAA",
    remote: "ABA",
    conflicts: 1,
    order: {
      local: {
        base: [2, 0, 1],
        local: [0, 2, 1],
        remote: [1, 0, 2],
        named: "BAA",
      },
      remote: {
        base: [0, 2, 1],
        local: [2, 0, 1],
        remote: [0, 1, 2],
        named: "ABA",
      },
    },
  },
];

for (const fixture of cases)
  for (const shape of ["pure", "dirty"])
    for (const conflicts of ["local", "remote"])
      test(`competing atom order: ${fixture.name}, ${shape}, ${conflicts}`, async () => {
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
        const captures = [...p.cap.querySelectorAll("button")];
        const expected = fixture.order[conflicts];
        assert.equal(buttons.length, 3);
        assert.ok(buttons.every((el) => el.textContent === "label"));
        if (shape === "pure") {
          const bases = [...p.base.querySelectorAll("button")];
          const remotes = [...p.remote.querySelectorAll("button")];
          const sources = buttons.map((el) => report.provenance.get(el));
          assert.deepEqual(
            sources.map((source) => bases.indexOf(source.base)),
            expected.base,
          );
          assert.deepEqual(
            sources.map((source) => captures.indexOf(source.local)),
            expected.local,
          );
          assert.deepEqual(
            sources.map((source) => remotes.indexOf(source.remote)),
            expected.remote,
          );
          assert.equal(
            sources.map((source) => p.sidB.get(source.base) || "-").join(""),
            expected.named,
          );
        } else {
          const localOrder = buttons.map((el) =>
            captures.findIndex((captured) => p.capToLive.get(captured) === el),
          );
          assert.deepEqual(localOrder, expected.local);
          assert.equal(
            buttons.map((el) => p.sidL.get(el) || "-").join(""),
            expected.named,
          );
          for (const captured of captures) {
            const live = p.capToLive.get(captured);
            assert.ok(buttons.includes(live));
            assert.equal(live.firstChild, p.capToLive.get(captured.firstChild));
          }
        }
        assert.deepEqual(
          report.conflicts.map((c) => [c.kind, c.detail]),
          Array.from({ length: fixture.conflicts }, () => [
            "structure",
            "both-moved",
          ]),
        );
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
