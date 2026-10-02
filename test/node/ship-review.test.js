import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";

test("named echo is emitted once", async () => {
  const base = "<main><section>Old paragraph</section></main>";
  const local = '<main><section id="new">New text</section></main>';
  const remote =
    '<main><section>Old paragraph</section><section id="new">New text</section></main>';
  const expected = '<main><section id="new">New text</section></main>';
  const pure = C.merge3(
    parse(doc(base)),
    parse(doc(local)),
    parse(doc(remote)),
  );
  assert.equal(pure.doc.body.innerHTML, expected);

  const live = parse(doc(local));
  await C.mergeDocument({
    live,
    base: parse(doc(base)),
    remote: parse(doc(remote)),
    scripts: { execute: false },
  });
  assert.equal(live.body.innerHTML, expected);
});

test("named echo, paragraphs", () => {
  const base = "<h1>t</h1><p>a b c</p><h2>u</h2>";
  const local = '<h1>t</h1><p id="x">new words here</p><h2>u</h2>';
  const remote = '<h1>t</h1><p>a b c</p><p id="x">new words here</p><h2>u</h2>';
  const result = C.merge3(
    parse(doc(base)),
    parse(doc(local)),
    parse(doc(remote)),
    { hooks: { beforeNodeMorphed() {} } },
  );
  assert.equal(
    result.doc.body.innerHTML,
    '<h1>t</h1><p id="x">new words here</p><h2>u</h2>',
  );
});

test("mirror keeps the local edit", () => {
  const base = "<h1>t</h1><p>a b c</p><h2>u</h2>";
  const local =
    '<h1>t</h1><p>a b c LOCAL</p><p id="x">new words here</p><h2>u</h2>';
  const remote = '<h1>t</h1><p id="x">new words here</p><h2>u</h2>';
  const result = C.merge3(
    parse(doc(base)),
    parse(doc(local)),
    parse(doc(remote)),
  );
  const output = result.doc.body.innerHTML;
  assert.match(output, /a b c LOCAL/);
  assert.equal(output.match(/new words here/g)?.length, 1);
});

test("remote-wins with a hook does not throw and carries recovery", async () => {
  const base =
    '<main><aside>base</aside><p id="p" title="base">text</p></main>';
  const local =
    '<main><aside>local</aside><p id="p" title="local">text</p></main>';
  const remote =
    '<main><aside>remote</aside><p id="p" title="remote">text</p></main>';
  const live = parse(doc(local));
  const report = await C.mergeDocument({
    live,
    base: parse(doc(base)),
    remote: parse(doc(remote)),
    remoteWins: (el) => el.tagName === "ASIDE",
    hooks: { beforeNodeMorphed() {} },
    scripts: { execute: false },
  });
  assert.equal(live.body.innerHTML, remote);
  const conflicts = report.conflicts.filter(
    (conflict) => conflict.detail === "remote-wins",
  );
  assert.ok(conflicts.length > 0);
  assert.ok(
    conflicts.every((conflict) => conflict.recovery?.localLost === true),
  );
});

test("identical change inside a remote-wins region is not a conflict", () => {
  const base = "<div no-watch><span>count 5</span></div><p>x y z</p>";
  const local = "<div no-watch><span>count 6</span></div><p>x y z</p>";
  const options = { remoteWins: (el) => el.hasAttribute("no-watch") };
  const same = C.merge3(
    parse(doc(base)),
    parse(doc(local)),
    parse(doc(local)),
    options,
  );
  assert.deepEqual(same.conflicts, []);

  const different = C.merge3(
    parse(doc(base)),
    parse(doc(local)),
    parse(doc("<div no-watch><span>count 7</span></div><p>x y z</p>")),
    options,
  );
  assert.equal(different.conflicts.length, 1);
  assert.equal(different.conflicts[0].detail, "remote-wins");
});
