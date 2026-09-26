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

test("H11 history policy: a no-undo root is morphed, a no-undo descendant is not", async () => {
  const target = document.createElement("div");
  target.setAttribute("no-undo", "");
  target.innerHTML = `<p>current text</p><span no-undo>keep</span>`;
  document.body.appendChild(target);
  const source = target.cloneNode(false);
  source.innerHTML = `<p>undo target text</p><span no-undo>changed</span>`;
  await m.morph(target, Array.from(source.childNodes), {
    morphStyle: "innerHTML",
    policy: "history",
    restoreFocus: false,
    scripts: { handle: false, merge: false },
  });
  assert.equal(
    target.innerHTML,
    `<p>undo target text</p><span no-undo="">keep</span>`,
  );
  const sync = target.cloneNode(true);
  sync.setAttribute("no-save", "");
  sync.innerHTML = `<p>a</p><span no-save>keep</span>`;
  document.body.appendChild(sync);
  await m.morph(sync, `<p>b</p><span no-save>changed</span>`, {
    morphStyle: "innerHTML",
    policy: "history",
  });
  assert.equal(sync.innerHTML, `<p>b</p><span no-save="">changed</span>`);
  target.remove();
  sync.remove();
});

test("H12 hypercms morphForm options: ignoreActiveValue keeps the focused subtree, restoreFocus false is honoured", async () => {
  const form = document.createElement("form");
  form.innerHTML = `<input id="n" value="v"><div id="ed" contenteditable="true"><p>mine</p></div><p>hi</p>`;
  document.body.appendChild(form);
  const input = form.querySelector("#n");
  input.focus();
  input.value = "typed";
  const frag = document.createDocumentFragment();
  const i = document.createElement("input");
  i.id = "n";
  i.value = "v2";
  const ed = document.createElement("div");
  ed.id = "ed";
  ed.setAttribute("contenteditable", "true");
  ed.innerHTML = "<p>theirs</p>";
  const p = document.createElement("p");
  p.textContent = "hello";
  frag.append(i, ed, p);
  const opts = {
    morphStyle: "innerHTML",
    ignoreActiveValue: true,
    restoreFocus: true,
    formStateSync: "property",
    policy: "raw",
  };
  await m.morph(form, frag, opts);
  assert.equal(input.value, "typed");
  assert.equal(form.children[2].textContent, "hello");
  assert.equal(form.querySelector("#ed").innerHTML, "<p>theirs</p>");
  assert.equal(document.activeElement, input);
  const editor = form.querySelector("#ed");
  editor.focus();
  await m.morph(
    form,
    `<input id="n" value="v3"><div id="ed" contenteditable="true"><p>again</p></div><p>hello</p>`,
    opts,
  );
  assert.equal(editor.innerHTML, "<p>theirs</p>");
  assert.equal(input.value, "v3");
  const host = document.createElement("div");
  host.innerHTML = `<input id="f" value="1"><p>x</p>`;
  document.body.appendChild(host);
  host.querySelector("#f").focus();
  await m.morph(host, `<textarea id="f">1</textarea><p>x</p>`, {
    morphStyle: "innerHTML",
    restoreFocus: false,
  });
  assert.notEqual(document.activeElement, host.querySelector("#f"));
  form.remove();
  host.remove();
});
