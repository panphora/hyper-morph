import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as E from "../../src/index.js";
import { observe } from "../lib/differential-observe.js";
const reference = process.env.HM_FAST_REFERENCE_ENTRY
  ? await import(
      pathToFileURL(resolve(process.env.HM_FAST_REFERENCE_ENTRY)).href
    )
  : null;
const fixtures = [
  {
    b: '<p id="p">old</p>',
    l: '<p id="p">mine</p>',
    r: '<p id="p">theirs</p>',
  },
  {
    b: '<p id="p" title="base">text</p>',
    l: '<p id="p" title="mine">text</p>',
    r: '<p id="p" title="theirs">text</p>',
  },
  { b: '<p id="p">base words</p>', l: '<p id="p">mine words</p>', r: "" },
];
const engine = (fastPath) => ({
  ...E,
  merge3: (b, l, r, o) => E.merge3(b, l, r, { ...o, fastPath }),
  mergeDocument: (o) => E.mergeDocument({ ...o, fastPath }),
  morphElement: (el, content, o) =>
    E.morphElement(el, content, { ...o, fastPath }),
});
const strip = (r) => {
  delete r.stats;
  return r;
};
const rows = [];
for (const shape of ["pure", "dirty", "element"])
  for (const [i, fixture] of fixtures.entries()) {
    const full = await observe(engine(false), shape, fixture);
    const fast = await observe(engine(true), shape, fixture);
    assert.equal(fast.stats.fastPathAttempted, 0);
    assert.equal(fast.recoveryProblems.length, 0);
    assert.equal(fast.recovery.length, 1);
    assert.deepEqual(strip(fast), strip(full), `${shape}:${i} recovery`);
    if (reference)
      assert.deepEqual(
        strip(full),
        strip(await observe(reference, shape, fixture)),
        `${shape}:${i} frozen recovery`,
      );
    rows.push({ shape, fixture: i, recoveries: full.recovery.length });
  }
console.log(JSON.stringify(rows, null, 2));
