import { test } from "node:test";
import assert from "node:assert/strict";
import { document } from "./lib/dom.js";
import * as m from "../../src/index.js";

test("compat morph is exported and on the default export", () => {
  assert.equal(typeof m.morph, "function");
  assert.equal(m.default.morph, m.morph);
});

test("compat morph updates an element's children (innerHTML style)", async () => {
  const el = document.createElement("div");
  el.innerHTML = "<p>old</p>";
  document.body.appendChild(el);
  await m.morph(el, "<p>new</p>", { morphStyle: "innerHTML" });
  assert.equal(el.innerHTML, "<p>new</p>");
  el.remove();
});
