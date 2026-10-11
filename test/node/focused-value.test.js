// A focused form field keeps its value through a merge only while it holds
// typing the merge did not see. In a three-way merge the merged value already
// holds the local side's text, so a field whose live value is what the local
// capture serialized takes the merged value, with its caret kept in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { mergeDocument, morphDocument } from "../../src/index.js";

// The local side as ClayJS captures it: a clone of the live document, each clone node mapped to its live twin.
function capture(live) {
  const cap = live.cloneNode(true);
  const toLive = new Map();
  const walk = (c, l) => {
    toLive.set(c, l);
    for (let i = 0; i < c.childNodes.length; i++)
      walk(c.childNodes[i], l.childNodes[i]);
  };
  walk(cap.documentElement, live.documentElement);
  return {
    cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
  };
}

async function mergeInto(live, base, remote) {
  const { local } = capture(live);
  return mergeDocument({
    live,
    base,
    local,
    remote,
    protectFocusedValue: true,
  });
}

test("a focused, untouched textarea takes the merged text", async () => {
  document.body.innerHTML = `<textarea id="t">old text</textarea>`;
  const t = document.getElementById("t");
  t.focus();
  assert.equal(document.activeElement, t);
  const base = parse(doc(`<textarea id="t">old text</textarea>`));
  const remote = parse(doc(`<textarea id="t">new text from peer</textarea>`));
  await mergeInto(document, base, remote);
  assert.equal(t.value, "new text from peer");
  assert.equal(document.activeElement, t);
  t.blur();
});

test("a focused textarea holding unserialized typing keeps it", async () => {
  document.body.innerHTML = `<textarea id="t">old text</textarea>`;
  const t = document.getElementById("t");
  t.value = "typing in progress";
  t.focus();
  assert.equal(document.activeElement, t);
  const base = parse(doc(`<textarea id="t">old text</textarea>`));
  const remote = parse(doc(`<textarea id="t">peer text</textarea>`));
  await mergeInto(document, base, remote);
  assert.equal(t.value, "typing in progress");
  t.blur();
});

test("a focused, untouched text input takes the merged value", async () => {
  document.body.innerHTML = `<input id="i" value="a">`;
  const i = document.getElementById("i");
  i.focus();
  assert.equal(document.activeElement, i);
  const base = parse(doc(`<input id="i" value="a">`));
  const remote = parse(doc(`<input id="i" value="b">`));
  await mergeInto(document, base, remote);
  assert.equal(i.value, "b");
  i.blur();
});

test("a focused checkbox keeps its checked state", async () => {
  document.body.innerHTML = `<input id="c" type="checkbox" value="x">`;
  const c = document.getElementById("c");
  c.focus();
  assert.equal(document.activeElement, c);
  const base = parse(doc(`<input id="c" type="checkbox" value="x">`));
  const remote = parse(doc(`<input id="c" type="checkbox" value="x" checked>`));
  await mergeInto(document, base, remote);
  assert.equal(c.checked, false);
  c.blur();
});

test("the caret keeps its place", async () => {
  document.body.innerHTML = `<textarea id="t">hello world</textarea>`;
  const t = document.getElementById("t");
  t.value = "hello world";
  t.focus();
  t.setSelectionRange(11, 11);
  await mergeInto(
    document,
    parse(doc(`<textarea id="t">hello world</textarea>`)),
    parse(doc(`<textarea id="t">oh hello world</textarea>`)),
  );
  assert.equal(t.value, "oh hello world");
  assert.equal(t.selectionStart, 14);

  document.body.innerHTML = `<textarea id="t">hello world</textarea>`;
  const t2 = document.getElementById("t");
  t2.value = "hello world";
  t2.focus();
  t2.setSelectionRange(2, 2);
  await mergeInto(
    document,
    parse(doc(`<textarea id="t">hello world</textarea>`)),
    parse(doc(`<textarea id="t">hello world!</textarea>`)),
  );
  assert.equal(t2.value, "hello world!");
  assert.equal(t2.selectionStart, 2);
  t2.blur();
});

test("two-way keeps protecting", async () => {
  document.body.innerHTML = `<textarea id="t">old text</textarea>`;
  const t = document.getElementById("t");
  t.focus();
  assert.equal(document.activeElement, t);
  await morphDocument(document, doc(`<textarea id="t">peer text</textarea>`), {
    protectFocusedValue: true,
  });
  assert.equal(t.value, "old text");
  t.blur();
});

test("the caret keeps its place in a textarea nobody has typed in", async () => {
  const { window } = await import("./lib/dom.js");
  const document = window.document;
  document.body.innerHTML = `<textarea id="u">hello world</textarea>`;
  const t = document.getElementById("u");
  t.focus();
  t.setSelectionRange(11, 11);
  const live = document;
  const base = live.documentElement.outerHTML;
  const remote = base.replace(">hello world<", ">oh hello world<");
  const cap = live.cloneNode(true);
  const map = new Map();
  const walk = (c, l) => {
    map.set(c, l);
    for (let i = 0; i < c.childNodes.length; i++)
      walk(c.childNodes[i], l.childNodes[i]);
  };
  walk(cap.documentElement, live.documentElement);
  const { mergeDocument } = await import("../../src/index.js");
  await mergeDocument({
    live,
    base,
    remote,
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    protectFocusedValue: true,
  });
  const after = document.getElementById("u");
  assert.equal(after.value, "oh hello world");
  assert.equal(after.selectionStart, 14);
  document.body.innerHTML = "";
});
