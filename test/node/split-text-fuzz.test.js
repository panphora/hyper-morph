// Live text nodes split by typing (hash-equal units that are not
// isEqualNode-equal) must keep their live nodes: the clean shape is run twice
// per seed, once as parsed and once with the first text node of every block
// split, in two lanes (the capture as base, and a fresh parse as base). The
// split run keeps every original node the plain run keeps (it may keep more:
// a split local tree can pair an element the plain one rebuilt), and every
// split piece of an unchanged text survives with its original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { lockstepMap, tagNodes } from "./lib/apply-speed-fuzz.js";
import { mergeDocument } from "../../src/index.js";
import { fuzz, setIdMode } from "../lib/structure-fuzz.js";

const SHOW_ALL = 0xffffffff;

/** Split the first text child of every block, half-way, on the same element
 * in both trees; `origins` records each new piece against the text node it
 * was cut from. */
function splitText(d, seed, origins) {
  let i = 0;
  for (const el of d.body.querySelectorAll("p,li,h2,h3,div")) {
    const t = el.firstChild;
    i++;
    if (!t || t.nodeType !== 3 || t.nodeValue.length < 4) continue;
    if ((i + seed) % 2) {
      const piece = t.splitText(Math.floor(t.nodeValue.length / 2));
      if (origins) origins.set(piece, t);
    }
  }
}

/** The ids of the tagged nodes still connected in the live document, sorted,
 * so a run that keeps one node where another rebuilt it cannot compare
 * equal. Tagging happens before any split, so both runs number the original
 * nodes identically and the pieces stay untagged. */
function survivorIds(root, ids) {
  const out = [];
  const w = root.ownerDocument.createTreeWalker(root, SHOW_ALL);
  let node = root;
  do {
    const id = ids.get(node);
    if (id !== undefined && node.isConnected) out.push(id);
  } while ((node = w.nextNode()));
  return out.sort((a, b) => a - b);
}

async function clean(b, r, seed, split, lane) {
  const live = parse(doc(b)),
    cap = parse(doc(b));
  const ids = tagNodes(live.documentElement);
  const origins = new Map();
  if (split) {
    splitText(live, seed, origins);
    splitText(cap, seed, null);
  }
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const pieces = [...origins].map(([piece, orig]) => ({
    piece,
    orig,
    parent: piece.parentNode,
    text: piece.parentNode.textContent,
  }));
  await mergeDocument({
    live,
    base: lane === "parsed-base" ? parse(doc(b)) : cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(r),
  });
  // A piece may legitimately coalesce away when the merge edits its text, so
  // only a piece whose parent element survived with the same text is owed an
  // answer equal to its original's.
  const lost = pieces
    .filter(
      ({ piece, orig, parent, text }) =>
        ids.get(parent) !== undefined &&
        parent.isConnected &&
        parent.textContent === text &&
        piece.isConnected !== orig.isConnected,
    )
    .map(
      ({ piece, orig }) =>
        `piece of #${ids.get(orig)}: piece ${piece.isConnected}, original ${orig.isConnected}`,
    );
  return {
    html: live.body.innerHTML,
    surv: survivorIds(live.documentElement, ids),
    lost,
  };
}

test("unchanged split text retains both existing text nodes", async () => {
  const b = "<p>edit</p><p>hello world</p>";
  const r = "<p>edited</p><p>hello world</p>";
  const live = parse(doc(b));
  const p = live.body.lastElementChild;
  const first = p.firstChild;
  const second = first.splitText(3);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc(r)),
  });
  assert.equal(live.body.innerHTML, r);
  assert.equal(report.conflicts.length, 0);
  assert.equal(live.body.lastElementChild, p);
  assert.equal(p.childNodes.length, 2);
  assert.equal(p.childNodes[0], first);
  assert.equal(p.childNodes[1], second);
});

test("an unchanged split run keeps both nodes when the paragraph pairs weakly", async () => {
  const live = parse(doc("<p>hello world</p>"));
  const p = live.body.firstElementChild;
  const first = p.firstChild;
  const second = first.splitText(3);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc("<p>hello world</p>")),
  });
  assert.equal(live.body.innerHTML, "<p>hello world</p>");
  assert.equal(report.conflicts.length, 0);
  assert.equal(live.body.firstElementChild, p);
  assert.deepEqual(Array.from(p.childNodes), [first, second]);
});

test("a caret in the second piece of an unchanged split run stays put", async () => {
  // The focused document must be the one with a window: focus() and
  // getSelection() do nothing on a DOMParser document.
  const b = `<p contenteditable="true">hello world</p><p>edit</p>`;
  document.body.innerHTML = b;
  const live = document;
  const p = live.body.firstElementChild;
  const first = p.firstChild;
  const second = first.splitText(3);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  p.focus();
  const r = live.createRange();
  r.setStart(second, 2);
  r.collapse(true);
  const sel = live.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(
      doc(`<p contenteditable="true" class="x">hello world</p><p>edited</p>`),
    ),
  });
  assert.equal(
    live.body.innerHTML,
    `<p contenteditable="true" class="x">hello world</p><p>edited</p>`,
  );
  assert.equal(report.conflicts.length, 0);
  const s = live.getSelection();
  assert.equal(s.anchorNode, second);
  assert.equal(s.anchorOffset, 2);
  document.body.innerHTML = "";
});

test("an edited split run still folds and keeps the typed text", async () => {
  const live = parse(doc("<p>hello world</p>"));
  const p = live.body.firstElementChild;
  const first = p.firstChild;
  first.splitText(3);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc("<p>hello brave world</p>")),
  });
  assert.equal(live.body.innerHTML, "<p>hello brave world</p>");
  assert.equal(report.conflicts.length, 0);
});

test("split LOCAL is unchanged when a parsed REMOTE deletes the paragraph", async () => {
  const b = "<p>hello world</p>";
  const live = parse(doc(b));
  live.body.firstElementChild.firstChild.splitText(3);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: parse(doc(b)),
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: parse(doc("")),
  });
  assert.equal(live.body.innerHTML, "");
  assert.equal(report.conflicts.length, 0);
});

test("I1-E2 dirty lane: split local text is not a local edit, a remote delete lands", async () => {
  const b = `<p>alpha beta gamma</p><p>delta epsilon</p>`;
  const r = `<p>delta epsilon</p>`;
  const live = parse(doc(b)),
    cap = parse(doc(b));
  for (const d of [live, cap]) d.querySelector("p").firstChild.splitText(6);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const report = await mergeDocument({
    live,
    base: doc(b),
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(r),
  });
  assert.equal(live.body.innerHTML, parse(doc(r)).body.innerHTML);
  assert.equal(report.conflicts.length, 0);
});

for (const mode of [0, 1]) {
  test(`split live text keeps its nodes, clean shape${mode ? `, id mode ${mode}` : ""}, fuzz seeds 1-300`, async () => {
    const bad = [];
    let seed = 0;
    setIdMode(mode);
    try {
      await fuzz(1, 300, async (b, _local, r) => {
        seed++;
        const frame = parse(doc(r)).body.innerHTML;
        for (const lane of ["same-capture", "parsed-base"]) {
          const plain = await clean(b, r, seed, false, lane);
          const split = await clean(b, r, seed, true, lane);
          if (plain.html !== frame)
            bad.push({ seed, lane, run: "plain", frame, got: plain.html });
          if (split.html !== frame)
            bad.push({ seed, lane, run: "split", frame, got: split.html });
          const kept = new Set(split.surv);
          if (!plain.surv.every((id) => kept.has(id)))
            bad.push({
              seed,
              lane,
              why: "survivors",
              frame,
              plain: plain.surv.join(","),
              split: split.surv.join(","),
            });
          if (split.lost.length)
            bad.push({ seed, lane, why: "pieces", frame, lost: split.lost });
        }
        return r;
      });
    } finally {
      setIdMode(0);
    }
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 1), null, 1));
  });
}
