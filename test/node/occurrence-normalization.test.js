import assert from "node:assert/strict";
import { test } from "node:test";
import { flatten, prepareInline } from "../../src/inline-merge.js";
import { boundaryOccurrences } from "../../src/occurrence-map.js";
import { BREAK } from "../../src/text-merge.js";
import { parse, doc } from "./lib/dom.js";

for (const [base, local] of [
  [
    '<p id="a">alpha beta gamma</p>',
    '<p id="a">alpha</p><p id="b">beta gamma</p>',
  ],
  [
    '<p id="a">alpha</p><p id="b">beta gamma</p>',
    '<p id="a">alpha beta gamma</p>',
  ],
  ['<p id="a">alphabeta</p>', '<p id="a">alpha</p><p id="b">beta</p>'],
]) {
  test(`normalized origins retain every hard character: ${local}`, () => {
    const b = parse(doc(base)).body,
      l = parse(doc(local)).body;
    const blocks = new Set([...b.children, ...l.children]);
    const fb = flatten([...b.childNodes], { blocks });
    const fl = flatten([...l.childNodes], { blocks });
    const mapped = boundaryOccurrences({
      base: fb,
      side: fl,
      baseOf: (el) => b.querySelector(`[id="${el.id}"]`),
    });
    assert.equal(mapped.status, "ready");
    const prepared = prepareInline(fb, fl, fb, {}, { local: mapped });
    let checked = 0;
    for (const run of mapped.runs)
      for (let i = run.from; i < run.to; i++) {
        if (fb.text[i] === BREAK || /\s/.test(fb.text[i])) continue;
        const target = run.target + i - run.from;
        assert.equal(prepared.localMap.bTo[i], target);
        assert.equal(prepared.localMap.toB[target], i);
        checked++;
      }
    assert.ok(checked > 0);
  });
}
