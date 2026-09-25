import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import {
  mergeDocument,
  morphDocument,
  morphElement,
  morph,
} from "../../src/index.js";

test("H1 a mark inserted around a live text node does not strand the cursor", async () => {
  const live = parse(doc(`<p>hello world</p>`));
  const text = live.querySelector("p").firstChild;
  await morphDocument(live, doc(`<p><b>hello</b> world</p>`));
  assert.equal(live.body.innerHTML, `<p><b>hello</b> world</p>`);
  assert.equal(live.querySelector("b").firstChild, text);
});

test("H1 three-way: remote wraps the first block in a new element", async () => {
  const live = parse(doc(`<p id="a">a</p><p id="b">b</p>`));
  const pa = live.getElementById("a"),
    pb = live.getElementById("b");
  await mergeDocument({
    live,
    base: doc(`<p id="a">a</p><p id="b">b</p>`),
    remote: doc(`<div class="w"><p id="a">a</p></div><p id="b">b</p>`),
  });
  assert.equal(
    live.body.innerHTML,
    `<div class="w"><p id="a">a</p></div><p id="b">b</p>`,
  );
  assert.equal(live.getElementById("a"), pa);
  assert.equal(live.getElementById("b"), pb);
});

test("H8 unchanged subtree: split live text nodes do not shift form state", async () => {
  const html = `<div>first<input id="a" value="1"><input id="b" value="2"></div><div>second</div><p>x</p>`;
  const live = parse(doc(html));
  for (const d of live.querySelectorAll("div")) d.firstChild.splitText(2);
  await mergeDocument({
    live,
    base: doc(html),
    remote: doc(html.replace("<p>x</p>", "<p>y</p>")),
  });
  const [a, b] = live.querySelectorAll("input");
  assert.equal(a.value, "1");
  assert.equal(b.value, "2");
});

test("H8 unchanged subtree: ignored live elements do not shift form state or identities", async () => {
  const html = `<div><input id="a" value="1"><input id="b" value="2"></div><div>second</div><p>x</p>`;
  const live = parse(doc(html));
  for (const d of live.querySelectorAll("div")) {
    const ui = live.createElement("span");
    ui.setAttribute("data-ignore", "");
    ui.textContent = "ui";
    d.prepend(ui);
  }
  const rep = await mergeDocument({
    live,
    base: doc(html),
    remote: doc(html.replace("<p>x</p>", "<p>y</p>")),
    ignore: (el) => el.hasAttribute("data-ignore"),
    identity: { remote: (el) => (el.id ? "r-" + el.id : null) },
  });
  const [a, b] = live.querySelectorAll("input");
  assert.equal(a.value, "1");
  assert.equal(b.value, "2");
  assert.deepEqual(rep.identities.map(([el, id]) => el.id + "->" + id).sort(), [
    "a->r-a",
    "b->r-b",
  ]);
});

test("H10 a DocumentFragment is accepted as children content", async () => {
  const form = document.createElement("form");
  form.innerHTML = `<input id="n" value="v"><p>hi</p>`;
  document.body.appendChild(form);
  const input = form.querySelector("input");
  const frag = document.createDocumentFragment();
  const i = document.createElement("input");
  i.id = "n";
  i.setAttribute("value", "v2");
  const p = document.createElement("p");
  p.textContent = "hello";
  frag.append(i, p);
  await morphElement(form, frag, { children: true });
  assert.equal(form.innerHTML, `<input id="n" value="v2"><p>hello</p>`);
  assert.equal(form.querySelector("input"), input);
  form.remove();
});

test("H10 compat morph with a DocumentFragment and innerHTML style", async () => {
  const form = document.createElement("form");
  form.innerHTML = `<input id="n" value="v"><p>hi</p>`;
  document.body.appendChild(form);
  const frag = document.createDocumentFragment();
  const p = document.createElement("p");
  p.textContent = "hello";
  const i = document.createElement("input");
  i.id = "n";
  i.setAttribute("value", "v");
  frag.append(i, p);
  await morph(form, frag, {
    morphStyle: "innerHTML",
    ignoreActiveValue: true,
    restoreFocus: true,
    formStateSync: "property",
    policy: "raw",
  });
  assert.equal(form.innerHTML, `<input id="n" value="v"><p>hello</p>`);
  form.remove();
});

test("H7 an ignored element keeps its place when the text around it changes", async () => {
  const ig = { ignore: (el) => el.hasAttribute("data-ignore") };
  const cases = [
    [
      `<p>one <span data-ignore="">X</span> two</p>`,
      `<p>one <span data-ignore="">X</span> two</p>`,
      `<p>one <span data-ignore="">X</span> three</p>`,
      `<p>one <span data-ignore="">X</span> three</p>`,
    ],
    [
      `<p><b>one <span data-ignore="">X</span> two</b> end</p>`,
      `<p><b>one <span data-ignore="">X</span> two</b> end</p>`,
      `<p><b>one <span data-ignore="">X</span> two</b> fin</p>`,
      `<p><b>one <span data-ignore="">X</span> two</b> fin</p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p>one <span data-ignore="">UI</span>two three</p>`,
      `<p>one two four</p>`,
      `<p>one <span data-ignore="">UI</span>two four</p>`,
    ],
    [
      `<div>one two<p>x</p></div>`,
      `<div>one <span data-ignore="">UI</span>two<p>x</p></div>`,
      `<div>one two<p>y</p></div>`,
      `<div>one <span data-ignore="">UI</span>two<p>y</p></div>`,
    ],
  ];
  for (const [base, local, remote, expected] of cases) {
    const live = parse(doc(local));
    const ui = live.querySelector("[data-ignore]");
    await mergeDocument({ live, base: doc(base), remote: doc(remote), ...ig });
    assert.equal(live.body.innerHTML, expected);
    assert.equal(live.querySelector("[data-ignore]"), ui);
  }
});
