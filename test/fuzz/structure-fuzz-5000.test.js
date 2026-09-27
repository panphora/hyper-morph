// The structural fuzz over seeds 1 to 5000 (`npm run test:fuzz`). The
// committed node suite runs 1 to 1000; this is the wide net for a change to
// the aligner, the echo pairing or the block sequence merge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "../node/lib/merge.js";
import { parse, doc } from "../node/lib/dom.js";
import { mergeDocument } from "../../src/index.js";
import { fuzz } from "../lib/structure-fuzz.js";

test("structural fuzz, seeds 1 to 5000", async () => {
  const fails = await fuzz(1, 5000, (b, l, r) => mergeBodies(b, l, r).html);
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 5), null, 1));
});

// The same seeds applied to a live page through mergeDocument: apply reuses
// live elements, and a merge whose HTML is right can still land wrong.
test("structural fuzz on a live page, seeds 1 to 5000", async () => {
  const merge = async (b, l, r) => {
    const live = parse(doc(l));
    await mergeDocument({ live, base: doc(b), remote: doc(r) });
    return live.body.innerHTML;
  };
  const fails = await fuzz(1, 5000, merge);
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 5), null, 1));
});
