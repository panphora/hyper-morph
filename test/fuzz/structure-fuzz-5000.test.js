// The structural fuzz over seeds 1 to 5000 (`npm run test:fuzz`). The
// committed node suite runs 1 to 1000; this is the wide net for a change to
// the aligner, the echo pairing or the block sequence merge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBodies } from "../node/lib/merge.js";
import { parse, doc } from "../node/lib/dom.js";
import { mergeDocument } from "../../src/index.js";
import { fuzz, setIdMode } from "../lib/structure-fuzz.js";

test("structural fuzz, seeds 1 to 5000", async () => {
  const fails = await fuzz(1, 5000, (b, l, r) => {
    const { html, res } = mergeBodies(b, l, r);
    return { html, conflicts: res.conflicts };
  });
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 5), null, 1));
});

// The same seeds applied to a live page through mergeDocument: apply reuses
// live elements, and a merge whose HTML is right can still land wrong.
test("structural fuzz on a live page, seeds 1 to 5000", async () => {
  const merge = async (b, l, r) => {
    const live = parse(doc(l));
    const { conflicts } = await mergeDocument({
      live,
      base: doc(b),
      remote: doc(r),
    });
    return { html: live.body.innerHTML, conflicts };
  };
  const fails = await fuzz(1, 5000, merge);
  assert.equal(fails.length, 0, JSON.stringify(fails.slice(0, 5), null, 1));
});

// Every id mode over a narrower seed range, in both shapes (pure merge and a
// live page), so the wide net covers authored ids too.
//
// Seeds the oracle fails in a mode, each reporting a conflict, identical on the
// engine before E1 (5702dd0). Pinned, not skipped: a seed that starts passing
// or a new one that fails turns the test red until it is reclassified.
//   695: both sides split one block at different points, each tail with its
//        own new id; an inline <b> lands in both tails (ambiguous split).
//   706: an echoed split gives both sides the same new id, and the merge keeps
//        two blocks with that id, one without its image (real; recheck at E4).
//   860: remote replaces a block with a new id while local edits it: both
//        kept with edit-beats-delete (right under id rules; the oracle cannot
//        model it).
const KNOWN = {
  1: [695, 706, 860],
  3: [],
  4: [695],
  5: [],
  6: [695, 706, 860],
};
const failedSeeds = (fails) => fails.map((f) => f.seed);

for (const mode of [1, 3, 4, 5, 6]) {
  test(`structural fuzz, id mode ${mode}, seeds 1 to 1000`, async () => {
    setIdMode(mode);
    let fails;
    try {
      fails = await fuzz(1, 1000, (b, l, r) => {
        const { html, res } = mergeBodies(b, l, r);
        return { html, conflicts: res.conflicts };
      });
    } finally {
      setIdMode(0);
    }
    assert.deepEqual(
      failedSeeds(fails),
      KNOWN[mode],
      JSON.stringify(fails.slice(0, 5), null, 1),
    );
  });

  test(`structural fuzz on a live page, id mode ${mode}, seeds 1 to 1000`, async () => {
    const merge = async (b, l, r) => {
      const live = parse(doc(l));
      const { conflicts } = await mergeDocument({
        live,
        base: doc(b),
        remote: doc(r),
      });
      return { html: live.body.innerHTML, conflicts };
    };
    setIdMode(mode);
    let fails;
    try {
      fails = await fuzz(1, 1000, merge);
    } finally {
      setIdMode(0);
    }
    assert.deepEqual(
      failedSeeds(fails),
      KNOWN[mode],
      JSON.stringify(fails.slice(0, 5), null, 1),
    );
  });
}
