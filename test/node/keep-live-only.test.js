import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

const page = (text, cls = "block") =>
  doc(
    `<main><div id="ed"${cls === null ? "" : ` class="${cls}"`}><p>${text}</p></div><p id="other">other</p></main>`,
  );

async function peer(remote, options) {
  const live = parse(page("hello"));
  const cap = parse(page("hello"));
  const map = lockstepMap(cap.documentElement, live.documentElement);
  const ed = live.getElementById("ed");
  ed.setAttribute("contenteditable", "true");
  ed.setAttribute("role", "textbox");
  ed.classList.add("richclay-active");
  const report = await E.mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    remote,
    scripts: { execute: false },
    ...options,
  });
  return { live, ed, report };
}

for (const fastPath of [false, true])
  test(`keepLiveOnly keeps attributes and class tokens the capture lacks (fastPath ${fastPath})`, async () => {
    const { live, ed, report } = await peer(page("hello REMOTE"), {
      keepLiveOnly: true,
      fastPath,
    });
    assert.equal(live.getElementById("ed"), ed);
    assert.equal(ed.textContent, "hello REMOTE");
    assert.equal(ed.getAttribute("contenteditable"), "true");
    assert.equal(ed.getAttribute("role"), "textbox");
    assert.equal(ed.getAttribute("class"), "block richclay-active");
    assert.deepEqual(report.conflicts, []);
  });

test("keepLiveOnly applies a remote class change and keeps the live-only token", async () => {
  const { ed } = await peer(page("hello", "block wide"), {
    keepLiveOnly: true,
  });
  assert.equal(ed.getAttribute("class"), "block wide richclay-active");
  assert.equal(ed.getAttribute("contenteditable"), "true");
});

test("without keepLiveOnly the apply still makes live attributes equal the merge", async () => {
  const { ed } = await peer(page("hello REMOTE"), {});
  assert.equal(ed.textContent, "hello REMOTE");
  assert.equal(ed.hasAttribute("contenteditable"), false);
  assert.equal(ed.getAttribute("class"), "block");
});

test("keepLiveOnly must be a boolean", async () => {
  await assert.rejects(
    () => peer(page("hello"), { keepLiveOnly: "yes" }),
    /keepLiveOnly must be a boolean/,
  );
});

test("keepLiveOnly keeps live-only class tokens when the merge drops the class attribute", async () => {
  const { ed } = await peer(page("hello", null), { keepLiveOnly: true });
  assert.equal(ed.getAttribute("class"), "richclay-active");
  assert.equal(ed.getAttribute("contenteditable"), "true");
});

test("keepLiveOnly writes the merged class unchanged when no live-only token remains", async () => {
  const live = parse(page("hello"));
  const cap = parse(page("hello"));
  const map = lockstepMap(cap.documentElement, live.documentElement);
  await E.mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    remote: page("hello", "a  b\u00a0c "),
    scripts: { execute: false },
    keepLiveOnly: true,
  });
  assert.equal(live.getElementById("ed").getAttribute("class"), "a  b\u00a0c ");
});
