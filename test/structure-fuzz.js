// The echo-aware structural fuzz (Opus 18) in a real browser, through
// mergeDocument with the live document as the local side.
import { fuzz } from "./lib/structure-fuzz.js";

describe("structural fuzz", function () {
  setup();

  const page = (body) =>
    `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

  it("O18 echoes, nested slots and cross-block moves never duplicate or lose shared content", async function () {
    const fails = await fuzz(1, 300, async (base, local, remote) => {
      const live = parseHTML(page(local));
      await HyperMorph.mergeDocument({
        live,
        base: page(base),
        remote: page(remote),
      });
      return live.body.innerHTML;
    });
    fails.should.eql([]);
  });
});
