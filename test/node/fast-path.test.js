// The fast path (`fastPath: true`) against the full path it narrows, in
// ClayJS's clean shape: every hand case and failure fixture merges twice,
// once each way, and the two runs must agree on everything the gate observes
// (test/lib/fast-path-gate.js). Each row also pins what the fast path did:
// "taken", "off" (not attempted), or the bail's token, so a case that stops
// exercising the path it was written for shows up as a changed row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document, window } from "./lib/dom.js";
import { VARIANTS, observeClean, differences } from "../lib/fast-path-gate.js";
import { HAND, handInput } from "../lib/fast-path-cases.js";
import { lockstepMap } from "../lib/differential-observe.js";
import * as E from "../../src/index.js";
import { emptyStats, FAST_PATH_BAILS } from "../../src/stats.js";

const outcome = (s) =>
  !s.fastPathAttempted ? "off" : s.fastPathTaken ? "taken" : s.fastPathFallback;

const EXPECT = {
  "F1 edit one of 5 identical cards": { authored: "taken", synthetic: "taken" },
  "F1 edit one of 5 identical cards (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F2 reorder within a list (item 5 to front)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F2 reorder within a list (item 5 to front) (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F3 move a card between containers": {
    authored: "taken",
    synthetic: "taken",
  },
  "F3 move a card between containers (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F4 move a card between containers and edit it": {
    authored: "taken",
    synthetic: "taken",
  },
  "F4 move a card between containers and edit it (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F5 swap two cards between containers": {
    authored: "taken",
    synthetic: "taken",
  },
  "F5 swap two cards between containers (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F6 wrap a card in a new div": { authored: "taken", synthetic: "taken" },
  "F6 wrap a card in a new div (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F7 unwrap a card": { authored: "taken", synthetic: "taken" },
  "F7 unwrap a card (body level)": { authored: "taken", synthetic: "taken" },
  "F8 text directly under a container": {
    authored: "taken",
    synthetic: "taken",
  },
  "F8 text directly under a container (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F9 attribute-only change on a container": {
    authored: "taken",
    synthetic: "taken",
  },
  "F9 attribute-only change on a container (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F10 nested identical lists, edit one li": {
    authored: "taken",
    synthetic: "taken",
  },
  "F10 nested identical lists, edit one li (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F11 two edits in different containers": {
    authored: "taken",
    synthetic: "taken",
  },
  "F11 two edits in different containers (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F12 delete a card and edit its neighbour": {
    authored: "taken",
    synthetic: "taken",
  },
  "F12 delete a card and edit its neighbour (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F13 insert a card between identical cards": {
    authored: "taken",
    synthetic: "taken",
  },
  "F13 insert a card between identical cards (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "F14 split a paragraph with Enter": { authored: "taken", synthetic: "taken" },
  "F14 split a paragraph with Enter (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F15 edit the title of one card with inline <b>": {
    authored: "taken",
    synthetic: "taken",
  },
  "F15 edit the title of one card with inline <b> (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "F16 move a card up within its container": {
    authored: "taken",
    synthetic: "taken",
  },
  "F16 move a card up within its container (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X1 attr and text change on the same card": {
    authored: "taken",
    synthetic: "taken",
  },
  "X1 attr and text change on the same card (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X2 class change on one card, text change on a sibling": {
    authored: "taken",
    synthetic: "taken",
  },
  "X2 class change on one card, text change on a sibling (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X3 head title change": { authored: "not-in-body", synthetic: "not-in-body" },
  "X3 head title change (body level)": {
    authored: "not-in-body",
    synthetic: "not-in-body",
  },
  "X3b head title change and a card edit": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X3b head title change and a card edit (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X4 template inside the changed card": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X4 template inside the changed card (body level)": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X5 template outside, edit elsewhere": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X5 template outside, edit elsewhere (body level)": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X5b template content alone changes": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X5b template content alone changes (body level)": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "X6 script inside the changed card": {
    authored: "taken",
    synthetic: "taken",
  },
  "X6 script inside the changed card (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X7 edit deep inside nested divs": { authored: "taken", synthetic: "taken" },
  "X8 insert a text node after a card": {
    authored: "taken",
    synthetic: "taken",
  },
  "X8 insert a text node after a card (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X9 delete the only child of a container": {
    authored: "taken",
    synthetic: "taken",
  },
  "X9 delete the only child of a container (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X10 change tag of a card's h3 to h2": {
    authored: "taken",
    synthetic: "taken",
  },
  "X10 change tag of a card's h3 to h2 (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X11 form input outside the scope keeps its attributes": {
    authored: "taken",
    synthetic: "taken",
  },
  "X11 form input outside the scope keeps its attributes (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X12 form input inside the scope changes value attr": {
    authored: "taken",
    synthetic: "taken",
  },
  "X12 form input inside the scope changes value attr (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "X13 comment node change beside cards": {
    authored: "taken",
    synthetic: "taken",
  },
  "X13 comment node change beside cards (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "X14 whitespace-only text change between cards": {
    authored: "taken",
    synthetic: "taken",
  },
  "X14 whitespace-only text change between cards (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "Y1 swapped synthetic ids on identical cards, first edited": {
    y1: "outside-id-changed",
  },
  "Y2 sender has fresh ids everywhere, edits one card": { fresh: "root-level" },
  "Y3 sender has fresh ids everywhere, nothing changed": { fresh: "equal" },
  "Z1 ignored ancestor of the change": {
    authored: "ignored-ancestor",
    synthetic: "ignored-ancestor",
  },
  "Z1 ignored ancestor of the change (body level)": {
    authored: "ignored-ancestor",
    synthetic: "ignored-ancestor",
  },
  "Z2 ignored sibling differs and a card changes": {
    authored: "taken",
    synthetic: "taken",
  },
  "Z2 ignored sibling differs and a card changes (body level)": {
    authored: "root-level",
    synthetic: "root-level",
  },
  "Z3 ignored sibling unchanged, a card changes": {
    authored: "taken",
    synthetic: "taken",
  },
  "Z3 ignored sibling unchanged, a card changes (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "Z4 remoteWins ancestor of the change": {
    authored: "remote-wins-ancestor",
    synthetic: "remote-wins-ancestor",
  },
  "Z4 remoteWins ancestor of the change (body level)": {
    authored: "remote-wins-ancestor",
    synthetic: "remote-wins-ancestor",
  },
  "Z5 per-node morph hook present": { authored: "off", synthetic: "off" },
  "Z5 per-node morph hook present (body level)": {
    authored: "off",
    synthetic: "off",
  },
  "Z6 beforeAttributeUpdated veto on class": {
    authored: "taken",
    synthetic: "taken",
  },
  "Z6 beforeAttributeUpdated veto on class (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "A1 html[data-theme] and one paragraph": {
    authored: "root-attrs",
    synthetic: "root-attrs",
  },
  "A1 html[data-theme] and one paragraph (body level)": {
    authored: "root-attrs",
    synthetic: "root-attrs",
  },
  "A2a copy left in A, original moved to B": { moved: "outside-id-changed" },
  "A2b same, moved card edited": { moved: "outside-id-changed" },
  "A3 two equal paragraphs exchange ids, h3 edited": {
    swapped: "outside-id-changed",
  },
  "A4 beforeNodeMorphed hook, h1 edit": { authored: "off", synthetic: "off" },
  "A5 input.value RUNTIME, heading edit": {
    authored: "taken",
    synthetic: "taken",
  },
  "A5c input inside a card, sibling card edited": {
    authored: "taken",
    synthetic: "taken",
  },
  "G1 an id used outside and in the branch is no identity": {
    authored: "taken",
  },
  "G2 a chain element the alignment moves into a copy": {
    deep: "chain-unpaired",
  },
  "G3 a duplicated merge key outside the branch": {
    authored: "taken",
    synthetic: "taken",
  },
  "G4 a form control on the chain": {
    authored: "form-ancestor",
    synthetic: "form-ancestor",
  },
  "G5 a change in the head only": {
    authored: "not-in-body",
    synthetic: "not-in-body",
  },
  "G6 a JSON merge script is the branch": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "G7 a script inside the branch": {
    authored: "script-or-template",
    synthetic: "script-or-template",
  },
  "D1 an id used twice inside the branch is no identity": {
    authored: "taken",
    synthetic: "taken",
  },
  "H1 a style only the live head holds": {
    authored: "taken",
    synthetic: "taken",
  },
  "H1 a style only the live head holds (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H2 an attribute only the live head holds": {
    authored: "taken",
    synthetic: "taken",
  },
  "H2 an attribute only the live head holds (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H3 a meta only the capture's head holds": {
    authored: "taken",
    synthetic: "taken",
  },
  "H3 a meta only the capture's head holds (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H4 beforeApply marks the merged head": {
    authored: "taken",
    synthetic: "taken",
  },
  "H4 beforeApply marks the merged head (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H5 the head's id used again outside": {
    authored: "taken",
    synthetic: "taken",
  },
  "H5 the head's id used again outside (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H6 the head's id used again on the chain": {
    authored: "taken",
    synthetic: "taken",
  },
  "H6 the head's id used again on the chain (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
  "H7 a keyed head and a style only the live head holds": {
    authored: "taken",
    synthetic: "taken",
  },
  "H7 a keyed head and a style only the live head holds (body level)": {
    authored: "taken",
    synthetic: "taken",
  },
};

test("E5 every hand case agrees with the full path, and takes the path its row names", async () => {
  const seen = {};
  for (const h of HAND) {
    seen[h.name] = {};
    for (const v of h.variants) {
      const variant = h.identity || VARIANTS[v];
      const ref = await observeClean(E, handInput(h), variant, false);
      const got = await observeClean(E, handInput(h), variant, true);
      assert.deepEqual(differences(ref, got), [], `${h.name} (${v})`);
      assert.equal(outcome(ref.fast), "off", `${h.name} (${v}) reference`);
      seen[h.name][v] = outcome(got.fast);
    }
  }
  assert.deepEqual(seen, EXPECT);
});

test("E5 the guards: an id used outside the branch, a moved chain element, a duplicated merge key", async () => {
  const byName = (n) => HAND.find((h) => h.name.startsWith(n));
  const g1 = byName("G1");
  const ref1 = await observeClean(E, handInput(g1), null, false);
  assert.deepEqual(
    ref1.replaced,
    ["@1/1/1"],
    "k is used outside the branch: no identity pair inside it",
  );
  const g2 = byName("G2");
  const ref2 = await observeClean(E, handInput(g2), g2.identity, false);
  assert.ok(
    ref2.moved.length === 2 && ref2.html === handInput(g2).r,
    "the full path preserves the chain and deep identity moves, and the copy keeps its content",
  );
  const g3 = byName("G3");
  const ref3 = await observeClean(E, handInput(g3), null, false);
  const got3 = await observeClean(E, handInput(g3), null, true);
  assert.equal(ref3.warnings.length, 2);
  assert.deepEqual(got3.warnings, ref3.warnings);
});

/** A clean-shape merge with a custom `toLive` and a custom remote. */
async function cleanWith(fastPath, mapTo, fixRemote) {
  const B = doc(
    `<header><p>top</p></header><main><div><p>one</p></div><p>two</p></main>`,
  );
  const R = doc(
    `<header><p>top</p></header><main><div><p>ONE</p></div><p>two</p></main>`,
  );
  const base = parse(B),
    live = parse(B),
    remote = parse(R);
  if (fixRemote) fixRemote(remote);
  const lock = lockstepMap(base.documentElement, live.documentElement);
  const toLive = (n) => {
    const m = mapTo(n, live);
    return m === undefined ? lock.get(n) || null : m;
  };
  const report = await E.mergeDocument({
    live,
    base,
    local: { root: base.documentElement, toLive },
    remote,
    fastPath,
  });
  return { html: live.documentElement.outerHTML, report };
}

const one = (n) => n.tagName === "P" && n.textContent === "one";
const BAILS = {
  control: [() => undefined, null],
  "no-live-twin": [(n) => (one(n) ? null : undefined), null],
  "live-detached": [
    (n, live) => (one(n) ? live.createElement("p") : undefined),
    null,
  ],
  "ancestor-live": [(n) => (n.tagName === "MAIN" ? null : undefined), null],
  "sibling-live": [(n) => (n.tagName === "HEADER" ? null : undefined), null],
  "root-tag": [
    () => undefined,
    (remote) => {
      const d = remote.createElement("div");
      d.innerHTML = "<p>x</p>";
      remote.replaceChild(d, remote.documentElement);
    },
  ],
};

test("E5 the live-side bails fire before anything is applied, and the full path runs instead", async () => {
  for (const [name, [mapTo, fixRemote]] of Object.entries(BAILS)) {
    const off = await cleanWith(false, mapTo, fixRemote);
    const on = await cleanWith(true, mapTo, fixRemote);
    assert.equal(on.html, off.html, name);
    assert.equal(outcome(on.report.stats), name === "control" ? "taken" : name);
  }
});

test("E5 every bail has a fixture that fires it", async () => {
  const fired = new Set(Object.keys(BAILS));
  for (const row of Object.values(EXPECT))
    for (const t of Object.values(row)) fired.add(t);
  for (const bail of FAST_PATH_BAILS) assert.ok(fired.has(bail), bail);
});

test("E5 stats: the fast-path keys on every entry point", async () => {
  assert.deepEqual(
    Object.keys(emptyStats()).filter((k) => k.startsWith("fastPath")),
    ["fastPathAttempted", "fastPathTaken", "fastPathFallback"],
  );
  const on = await cleanWith(true, () => undefined);
  assert.deepEqual(
    [
      on.report.stats.fastPathAttempted,
      on.report.stats.fastPathTaken,
      on.report.stats.fastPathFallback,
    ],
    [1, 1, null],
  );
  const off = await cleanWith(false, () => undefined);
  assert.deepEqual(
    [
      off.report.stats.fastPathAttempted,
      off.report.stats.fastPathTaken,
      off.report.stats.fastPathFallback,
    ],
    [0, 0, null],
  );
  const dirty = await E.mergeDocument({
    live: parse(doc(`<main><p>one</p><p>mine</p></main>`)),
    base: doc(`<main><p>one</p><p>two</p></main>`),
    remote: doc(`<main><p>ONE</p><p>two</p></main>`),
    fastPath: true,
  });
  assert.equal(dirty.stats.fastPathAttempted, 0);
  const el = parse(doc(`<main><p>one</p></main>`)).querySelector("main");
  const children = await E.morphElement(el, `<main><p>two</p></main>`, {
    children: true,
    fastPath: true,
  });
  assert.equal(children.stats.fastPathAttempted, 0);
  assert.throws(
    () =>
      E.mergeDocument({ live: parse(doc("")), remote: doc(""), fastPath: 1 }),
    /fastPath must be a boolean/,
  );
});

test("E5 explicit-base JSON deletion is a dirty merge: the fast path is not attempted and nothing changes", async () => {
  const cfg = (json) =>
    `<script type="application/json" merge="cfg">${json}</script>`;
  const run = async (fastPath) => {
    const live = parse(doc(`${cfg('{"a":1}')}<main><p>one</p></main>`));
    const report = await E.mergeDocument({
      live,
      base: doc(`${cfg('{"a":1,"b":2}')}<main><p>one</p></main>`),
      remote: doc(`${cfg('{"a":1,"b":2}')}<main><p>ONE</p></main>`),
      scripts: { execute: false },
      fastPath,
    });
    return { html: live.documentElement.outerHTML, report };
  };
  const off = await run(false);
  const on = await run(true);
  assert.equal(on.html, off.html);
  assert.ok(!on.html.includes('"b"'), "the local deletion of b survives");
  assert.equal(on.report.stats.fastPathAttempted, 0);
});

/** The page in the window's own document, so focus is real. */
async function focused(fastPath, body, remoteBody, pick, type) {
  document.head.innerHTML = "";
  document.body.innerHTML = body;
  const input = pick(document);
  input.focus();
  input.value = type;
  input.setSelectionRange(2, 2);
  const base = parse("<!DOCTYPE html>" + document.documentElement.outerHTML);
  const lock = lockstepMap(base.documentElement, document.documentElement);
  const report = await E.mergeDocument({
    live: document,
    base,
    local: { root: base.documentElement, toLive: (n) => lock.get(n) || null },
    remote: doc(remoteBody),
    fastPath,
  });
  return {
    html: document.documentElement.outerHTML,
    value: input.value,
    kept: document.activeElement === input,
    caret: input.selectionStart,
    outcome: outcome(report.stats),
  };
}

test("E5 focused form values: protected inside the branch, synced outside it, the same on both paths", async () => {
  const b = `<form><input name="q" value="v"></form><main><div><h3>Title</h3><input name="in" value="a"></div></main>`;
  for (const [pick, r] of [
    [
      (d) => d.querySelector('[name="q"]'),
      `<form><input name="q" value="v"></form><main><div><h3>Title TWO</h3><input name="in" value="a"></div></main>`,
    ],
    [
      (d) => d.querySelector('[name="in"]'),
      `<form><input name="q" value="v"></form><main><div><h3>Title</h3><input name="in" value="Z"></div></main>`,
    ],
  ]) {
    const off = await focused(false, b, r, pick, "typed");
    const on = await focused(true, b, r, pick, "typed");
    assert.equal(on.outcome, "taken");
    assert.deepEqual({ ...on, outcome: null }, { ...off, outcome: null });
    assert.equal(on.value, "typed");
    assert.equal(on.kept, true);
  }
});

test("E5 beforeApply (disk activation) sees the same merged document on both paths", async () => {
  const b = doc(
    `<header data-act><p>top</p></header><main><div data-act><p>one</p></div><p>two</p></main>`,
  );
  const r = doc(
    `<header data-act><p>top</p></header><main><div data-act><p>ONE</p></div><p>two</p></main>`,
  );
  const run = async (fastPath) => {
    const base = parse(b),
      live = parse(b);
    const lock = lockstepMap(base.documentElement, live.documentElement);
    const seen = [];
    const report = await E.mergeDocument({
      live,
      base,
      local: { root: base.documentElement, toLive: (n) => lock.get(n) || null },
      remote: r,
      beforeApply: (d) => {
        for (const el of d.querySelectorAll("[data-act]")) {
          seen.push(el.tagName);
          el.setAttribute("data-live", "1");
        }
      },
      fastPath,
    });
    return {
      html: live.documentElement.outerHTML,
      seen,
      outcome: outcome(report.stats),
    };
  };
  const off = await run(false);
  const on = await run(true);
  assert.equal(on.outcome, "taken");
  assert.deepEqual(on.seen, off.seen);
  assert.equal(on.html, off.html);
});

test("E5 a stylesheet added to the head with awaitLoads: both paths wait for its load", async () => {
  const run = async (fastPath) => {
    const base = parse(doc(`<main><div><p>one</p></div></main>`));
    const live = parse(doc(`<main><div><p>one</p></div></main>`));
    const lock = lockstepMap(base.documentElement, live.documentElement);
    let settled = false;
    const pending = E.mergeDocument({
      live,
      base,
      local: { root: base.documentElement, toLive: (n) => lock.get(n) || null },
      remote: doc(
        `<main><div><p>ONE</p></div></main>`,
        `<link rel="stylesheet" href="/x.css">`,
      ),
      head: { awaitLoads: true },
      fastPath,
    }).then((report) => {
      settled = true;
      return report;
    });
    await new Promise((r) => setTimeout(r, 20));
    const waited = !settled;
    live.head
      .querySelector('link[href="/x.css"]')
      .dispatchEvent(new window.Event("load"));
    const report = await pending;
    return {
      waited,
      html: live.documentElement.outerHTML,
      applied: report.applied.length,
      outcome: outcome(report.stats),
    };
  };
  const off = await run(false);
  const on = await run(true);
  assert.equal(off.waited, true);
  assert.equal(on.outcome, "root-level");
  assert.deepEqual({ ...on, outcome: null }, { ...off, outcome: null });
});
