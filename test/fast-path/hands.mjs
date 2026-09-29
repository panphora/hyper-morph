import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as E from "../../src/index.js";
import { parse } from "../node/lib/dom.js";
import { runOne, compareCase } from "./gate.mjs";
import { F, S, O, heads } from "./fable-cases.mjs";
import { cases } from "./astra-cases.mjs";

const rows = [];
for (const [name, [b, r]] of Object.entries(F)) {
  for (const kind of ["authored", "synthetic"]) {
    const extra = heads[name]
      ? {
          prepare({ live, cap, remote }) {
            live.head.innerHTML = heads[name][0];
            cap.head.innerHTML = heads[name][0];
            remote.head.innerHTML = heads[name][1];
          },
        }
      : {};
    rows.push(
      await compareCase(
        `${name}:${kind}`,
        b,
        r,
        kind,
        extra,
        Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
      ),
    );
  }
}
for (const table of [S, O])
  for (const [name, { b, r, mapOf, opts }] of Object.entries(table))
    for (const kind of ["authored", "synthetic"])
      rows.push(
        await compareCase(
          `${name}:${kind}`,
          b,
          r,
          kind,
          { mapOf, opts },
          Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
        ),
      );

for (const [name, c] of Object.entries(cases)) {
  const source = parse(c.base),
    incoming = parse(c.remote);
  const b = source.body.innerHTML,
    r = incoming.body.innerHTML;
  const kind = c.ident ? "synthetic" : "authored";
  const run = async (fast) => {
    const state = {};
    let pre;
    return runOne(E, fast, b, r, kind, {
      opts: c.extra ? c.extra(state) : {},
      mapOf: c.surgery
        ? (E, capMap, remote) => {
            const map = E.createIdentityStore("sender").exportMap(
              remote.documentElement,
              (n) => n,
            );
            for (const k of Object.keys(map))
              if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
            c.surgery(map, capMap);
            return map;
          }
        : null,
      prepare({ live, cap, remote }) {
        for (const el of [live.documentElement, cap.documentElement])
          for (const a of source.documentElement.attributes)
            el.setAttribute(a.name, a.value);
        for (const a of incoming.documentElement.attributes)
          remote.documentElement.setAttribute(a.name, a.value);
        pre = c.pre ? c.pre({ live }) : {};
      },
      inspect({ live, rep, label }) {
        return c.probe({ live, pre, rep, ids: label.ids, state });
      },
    });
  };
  const full = await run(false),
    fast = await run(true);
  const fields = Object.keys(full.result).filter(
    (k) => JSON.stringify(full.result[k]) !== JSON.stringify(fast.result[k]),
  );
  rows.push({
    name: `Astra ${name}`,
    fields,
    stats: fast.stats,
    probe: fast.result.probe,
    identities: fast.result.adoptedIdentities.length,
    ...(fields.length ? { full: full.result, fast: fast.result } : {}),
  });
}
if (process.env.FAST_HAND_OUTPUT)
  writeFileSync(process.env.FAST_HAND_OUTPUT, JSON.stringify(rows, null, 2));
console.log(
  JSON.stringify(
    rows.map(({ name, fields, stats, probe, identities }) => ({
      name,
      fields,
      taken: stats.fastPathTaken,
      fallback: stats.fastPathFallback,
      probe,
      identities,
    })),
    null,
    2,
  ),
);
assert.equal(rows.length, 87);
assert.equal(rows.filter((r) => r.fields.length).length, 0);
assert.ok(
  rows
    .filter((r) => /^X[45] /.test(r.name))
    .every((r) => r.stats.fastPathTaken === 0),
);
