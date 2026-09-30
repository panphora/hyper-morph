// The oracle's own checks: hand-written rows (a case, an optional damage to the
// real engine's output, and the statuses that count as right) and the
// regression scripts written while choosing it (oracle v2, 2026-09-30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { engine } from "../lib/engines.js";
import { verdict } from "../lib/oracle.js";
import { ROWS as BENCH } from "./bench-cases.mjs";
import { ROWS as HOLDOUT } from "./holdout-cases.mjs";
import { ROWS as REVIEW } from "./review-cases.mjs";

// The oracle is judged against a frozen engine, never the live src/, so an
// engine fix the loop accepts cannot turn these checks red.
const E = await engine(process.env.HM_ORACLE_ENGINE || "282339c");

const TODO = new Set();

const damaged = (damage, before) => ({
  ...E,
  async mergeDocument(o) {
    const pre = before?.(o.live, o);
    const r = await E.mergeDocument(o);
    const x = damage(o.live, r, pre);
    return x ? { ...r, ...x } : r;
  },
  async morphElement(el, content, o) {
    const r = await E.morphElement(el, content, o);
    const x = damage(el.ownerDocument, r);
    return x ? { ...r, ...x } : r;
  },
});

for (const [name, c, damage, want, before] of [...BENCH, ...HOLDOUT, ...REVIEW])
  test(name, { todo: TODO.has(name) || undefined }, async () => {
    const v = await verdict(
      damage ? damaged(damage, before) : E,
      null,
      structuredClone(c),
    );
    assert.ok(
      want.includes(v.status),
      `${v.status}, want ${want.join(" or ")}: ${JSON.stringify(v.violations || v.reason || "").slice(0, 300)}`,
    );
  });

const SCRIPTS = [
  "survival",
  "occurrences",
  "policies",
  "identities",
  "frames",
  "modes",
  "leaf-occurrences",
];
for (const name of SCRIPTS)
  test(`oracle regressions: ${name}`, {}, () => {
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))],
      { encoding: "utf8", env: process.env },
    );
    assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
  });
