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

test("HE2 compat: an ignored root under sync or history policy is a no-op", async () => {
  for (const [attrs, policy] of [
    [["no-save"], "sync"],
    [["no-undo", "editor-ui"], "history"],
    [["editor-ui"], "history"],
  ]) {
    const t = document.createElement("div");
    for (const a of attrs) t.setAttribute(a, "");
    t.innerHTML = "<p>current</p>";
    document.body.appendChild(t);
    const before = t.outerHTML;
    const report = await m.morph(t, "<p>next</p>", {
      morphStyle: "innerHTML",
      policy,
    });
    assert.equal(t.outerHTML, before, attrs.join(" "));
    assert.deepEqual(report.applied, []);
    assert.equal(report.localDiverged, false);
    const whole = await m.morph(t, t.outerHTML.replace("current", "next"), {
      policy,
    });
    assert.equal(t.outerHTML, before, attrs.join(" ") + " whole");
    assert.deepEqual(whole.applied, []);
    t.remove();
  }
});

test("HF1 an <html> element handed as new content is the remote, not the live document", async () => {
  document.body.innerHTML = `<h1 id="hero" contenteditable="true" data-bound="rich">Hello <em>you</em></h1><p id="sub">Plain</p>`;
  const title = document.querySelector("#hero");
  const incoming = document.documentElement.cloneNode(true);
  const h = incoming.querySelector("#hero");
  h.removeAttribute("contenteditable");
  h.removeAttribute("data-bound");
  h.innerHTML = "Theirs";
  const report = await m.morph(document.documentElement, incoming, {
    morphStyle: "outerHTML",
    key: (el) => el.getAttribute("data-id") || el.getAttribute("id") || null,
  });
  assert.equal(document.querySelector("#hero"), title);
  assert.equal(title.hasAttribute("contenteditable"), false);
  assert.equal(title.hasAttribute("data-bound"), false);
  assert.equal(title.innerHTML, "Theirs");
  assert.ok(report.applied.length > 0);
  const again = document.documentElement.cloneNode(true);
  again.querySelector("#sub").textContent = "Changed";
  await m.morph(document, again, { morphStyle: "outerHTML" });
  assert.equal(document.querySelector("#sub").textContent, "Changed");
  document.body.innerHTML = "";
});

test("HF2 compat: a keyed element never morphs into one with another key", async () => {
  document.body.innerHTML = `<h1 class="title" id="hero" contenteditable="true">Mine</h1><p id="sub">Plain</p>`;
  const title = document.querySelector(".title");
  title.focus();
  const incoming = document.documentElement.cloneNode(true);
  const h = incoming.querySelector(".title");
  h.setAttribute("id", "hero-2");
  h.removeAttribute("contenteditable");
  h.innerHTML = "Theirs";
  await m.morph(document.documentElement, incoming, {
    morphStyle: "outerHTML",
    ignoreActiveValue: true,
    key: (el) => el.getAttribute("data-id") || el.getAttribute("id") || null,
  });
  assert.equal(document.contains(title), false, "the old node was replaced");
  assert.equal(document.querySelector(".title").id, "hero-2");
  assert.equal(document.querySelector(".title").innerHTML, "Theirs");
  document.body.innerHTML = "";
});
