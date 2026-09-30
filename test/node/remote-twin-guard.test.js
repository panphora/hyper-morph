import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";

test("a remote similarity move is not taken as the twin of an element remote deleted", async () => {
  const base = `<div id="C"><div id="X"><p>a one</p><p>b one</p></div><p id="Y">y one</p></div><div id="D"><p>d one</p></div>`;
  const local = `<div id="C"><div id="X"><p>a one</p><p>b one LMARK</p></div><p id="Y">y one LMARK2</p></div><div id="D"><p>d one</p></div>`;
  const remote = `<div id="D"><p>d one</p><div id="X"><p>a one RMARK</p><p>b one</p></div></div>`;
  const live = parse(doc(local));
  await E.mergeDocument({
    live,
    base: doc(base),
    remote: doc(remote),
    scripts: { execute: false },
  });
  const body = live.body.innerHTML;
  assert.equal(live.getElementById("Y")?.textContent, "y one LMARK2", body);
  assert.equal(body.split("RMARK").length - 1, 1, body);
});
