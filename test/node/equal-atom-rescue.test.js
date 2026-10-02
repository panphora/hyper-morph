import assert from "node:assert/strict";
import { test } from "node:test";
import * as E from "../../src/index.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const button = (id) => `<button${id ? ` sid="${id}"` : ""}>label</button>`;
const row = (ids, tail = "") =>
  `<div>${[...ids].map(button).join("")}${tail}</div>`;
const cases = [
  {
    name: "competing equal-button swaps retain every owner",
    base: row("ABC"),
    local: row("CBA", "LOCAL "),
    remote: row("BAC", " "),
    owners: ["A", "B", "C"],
    detail: "both-moved",
  },
  {
    name: "the original one-sided equal-button swap remains intact",
    base: row("AB"),
    local: row("AB", "LOCAL "),
    remote: row("BA", " "),
    owners: ["A", "B"],
    order: ["B", "A"],
  },
  {
    name: "deletion versus equal-image swap retains the shared owner",
    base: '<p>a <img sid="A" src="i.png"> b <img sid="B" src="i.png"> c</p>',
    local: '<p>a <img sid="A" src="i.png"> b  c</p>',
    remote: '<p>a <img sid="B" src="i.png"> b <img sid="A" src="i.png"> c</p>',
    owners: ["A", "B"],
    detail: "move-beats-delete",
  },
  {
    name: "conflicting copies claim each identified atom once",
    remoteCopy: "B",
    base: `<p>${button("A")} old ${button("B")}</p>`,
    local: `<p>LOCAL ${button("B")}${button("A")}</p>`,
    remote: `<p>${button("B")}${button("A")} REMOTE</p>`,
    owners: ["A", "B"],
  },
];

function ownerIds(obs, shape) {
  const { p, report, liveRoot } = obs.raw;
  const adopted = new Map(report.identities || []);
  return [...liveRoot.querySelectorAll("button,img")].map((el) => {
    if (shape !== "pure") return p.sidL.get(el) || adopted.get(el);
    const source = report.provenance.get(el);
    return (
      p.sidB.get(source?.base) ||
      p.sidCap.get(source?.local) ||
      p.sidR.get(source?.remote)
    );
  });
}

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
    for (const mirror of [false, true])
      for (const conflicts of ["local", "remote", "both"])
        test(`equal atom ownership: ${fixture.name}, ${shape}, mirror ${mirror}, ${conflicts}`, async () => {
          const obs = await runCase(
            E,
            normalize({
              ...fixture,
              shape,
              identity: "clay",
              local: mirror ? fixture.remote : fixture.local,
              remote: mirror ? fixture.local : fixture.remote,
              options: { conflicts },
            }),
          );
          const { p, report, liveRoot } = obs.raw;
          const atoms = [...liveRoot.querySelectorAll("button,img")];
          const ids = ownerIds(obs, shape);
          assert.equal(atoms.length, fixture.owners.length);
          assert.deepEqual([...ids].sort(), fixture.owners);
          if (fixture.order) assert.deepEqual(ids, fixture.order);
          for (const el of atoms)
            if (el.tagName === "BUTTON") assert.equal(el.textContent, "label");
          if (fixture.detail) {
            assert.ok(
              report.conflicts.some((c) => c.detail === fixture.detail),
            );
            assert.equal(
              report.conflicts.filter((c) => c.kind === "structure").length,
              1,
            );
          }
          if (shape === "dirty") {
            for (const [el, id] of p.sidL) {
              if (!fixture.owners.includes(id)) continue;
              if (conflicts === "remote" && fixture.remoteCopy === id) {
                assert.equal(el.isConnected, false);
                assert.ok(
                  report.conflicts.some(
                    (c) => c.kind === "text" && c.recovery.localLost,
                  ),
                );
              } else
                assert.ok(atoms.includes(el), `original live ${id} remains`);
            }
            for (const [cap, id] of p.sidCap) {
              if (
                cap.tagName !== "BUTTON" ||
                !fixture.owners.includes(id) ||
                (conflicts === "remote" && fixture.remoteCopy === id)
              )
                continue;
              assert.equal(
                p.capToLive.get(cap).firstChild,
                p.capToLive.get(cap.firstChild),
                `original live text ${id} remains`,
              );
            }
          }
          validRecovery(obs, shape);
        });

for (const shape of ["pure", "dirty"]) {
  test(`equal atom ownership: anonymous equal atoms retain positional behavior, ${shape}`, async () => {
    const buttons = button(null).repeat(3);
    const obs = await runCase(
      E,
      normalize({
        shape,
        identity: "plain",
        base: `<div>${buttons}</div>`,
        local: `<div>${buttons}LOCAL </div>`,
        remote: `<div>${buttons} </div>`,
        options: { conflicts: "both" },
      }),
    );
    assert.equal(
      obs.raw.liveRoot.body.innerHTML,
      `<div>${buttons}LOCAL  </div>`,
    );
    assert.equal(obs.raw.report.conflicts.length, 0);
    validRecovery(obs, shape);
  });
  test(`equal atom ownership: duplicated identity does not authorize copy deduplication, ${shape}`, async () => {
    const a = button("A");
    const obs = await runCase(
      E,
      normalize({
        shape,
        identity: "plain",
        base: `<p>${a} old ${a}</p>`,
        local: `<p>LOCAL ${a}${a}</p>`,
        remote: `<p>${a}${a} REMOTE</p>`,
        options: { conflicts: "both" },
      }),
    );
    assert.equal(
      obs.raw.liveRoot.body.innerHTML,
      `<p>LOCAL ${button(null).repeat(3)} REMOTE</p>`,
    );
    assert.equal(
      obs.raw.report.conflicts.filter((c) => c.kind === "text").length,
      1,
    );
    assert.equal(
      obs.raw.report.conflicts.filter((c) => c.kind === "structure").length,
      0,
    );
    if (shape === "pure")
      for (const A of [obs.raw.report.L, obs.raw.report.R])
        for (const el of obs.raw.p.base.querySelectorAll("button"))
          assert.equal(A.identityPaired.has(el), false);
    validRecovery(obs, shape);
  });
}
