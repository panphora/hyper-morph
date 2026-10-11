// An opaque element (ClayJS's `clay="freeze"`) merges like any other: it
// pairs, moves, is inserted and removed, and its attributes sync. Its live
// children are never touched. ClayJS passes base, local capture and remote
// frame with every opaque element already empty, so the merge sees a
// childless element; only the live document holds contents in them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { mergeDocument } from "../../src/index.js";

const opaque = (el) => el.hasAttribute("data-scratch");

// The local side as ClayJS captures it: a clone of the live document, each
// clone node mapped to its live twin, and every scratchpad emptied.
function capture(live) {
  const cap = live.cloneNode(true);
  const toLive = new Map();
  const walk = (c, l) => {
    toLive.set(c, l);
    for (let i = 0; i < c.childNodes.length; i++)
      walk(c.childNodes[i], l.childNodes[i]);
  };
  walk(cap.documentElement, live.documentElement);
  for (const el of cap.querySelectorAll("[data-scratch]")) el.replaceChildren();
  return {
    cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
  };
}

async function mergeInto(live, base, remote, options = {}) {
  const { local } = capture(live);
  return mergeDocument({
    live,
    base: parse(doc(base)),
    local,
    remote: parse(doc(remote)),
    ...options,
  });
}

const LIVE_ONE = `<ul><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="c1">overdue <b>!</b></span></li></ul>`;
const EMPTY_ONE = `<ul><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="c1"></span></li></ul>`;
const REMOTE_ONE = `<ul><li id="c1"><h3>Uno</h3><span id="s1" data-scratch data-for="changed"></span></li></ul>`;

test("live children survive while attributes merge", async () => {
  document.body.innerHTML = LIVE_ONE;
  const b = document.querySelector("#s1 b");
  await mergeInto(document, EMPTY_ONE, REMOTE_ONE, { opaque });
  assert.equal(document.querySelector("h3").textContent, "Uno");
  const s1 = document.getElementById("s1");
  assert.equal(s1.getAttribute("data-for"), "changed");
  assert.equal(s1.innerHTML, "overdue <b>!</b>");
  assert.equal(s1.querySelector("b"), b);
});

test("a new opaque element arrives empty", async () => {
  document.body.innerHTML = LIVE_ONE;
  await mergeInto(
    document,
    EMPTY_ONE,
    `<ul><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="c1"></span></li><li id="c2"><h3>Two</h3><span id="s2" data-scratch></span></li></ul>`,
    { opaque },
  );
  const s2 = document.getElementById("s2");
  assert.ok(s2);
  assert.equal(s2.innerHTML, "");
});

test("a removed record takes its scratchpad with it", async () => {
  document.body.innerHTML = LIVE_ONE;
  await mergeInto(document, EMPTY_ONE, `<ul></ul>`, { opaque });
  assert.equal(document.getElementById("c1"), null);
  assert.equal(document.getElementById("s1"), null);
});

test("a moved record keeps its scratch", async () => {
  document.body.innerHTML = `<ul><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="c1">overdue</span></li><li id="c3"><h3>Three</h3></li></ul>`;
  await mergeInto(
    document,
    `<ul><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="c1"></span></li><li id="c3"><h3>Three</h3></li></ul>`,
    `<ul><li id="c3"><h3>Three</h3></li><li id="c1"><h3>One</h3><span id="s1" data-scratch data-for="changed"></span></li></ul>`,
    { opaque },
  );
  assert.deepEqual(
    Array.from(document.querySelectorAll("ul > li")).map((li) => li.id),
    ["c3", "c1"],
  );
  const s1 = document.getElementById("s1");
  assert.equal(s1.getAttribute("data-for"), "changed");
  assert.equal(s1.textContent, "overdue");
});

test("without the option, children are replaced (control)", async () => {
  document.body.innerHTML = LIVE_ONE;
  await mergeInto(document, EMPTY_ONE, REMOTE_ONE);
  const s1 = document.getElementById("s1");
  assert.equal(s1.getAttribute("data-for"), "changed");
  assert.equal(s1.innerHTML, "");
});
