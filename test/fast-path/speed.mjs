import assert from "node:assert/strict";
import { loadavg } from "node:os";
import * as E from "../../src/index.js";
import { parse, doc } from "../node/lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

// The fast path must not be slower than the full path on the shapes the E5
// review measured in jsdom: a wide page with ClayJS's synthetic ids, a chain
// of 600 nested elements (also with a sibling after the chain at every
// level), a card moved within a 300-card list (the scope is the whole list),
// and the wide page with the default identity. Each shape alternates the
// two paths, drops three warm-up rounds, and compares medians. A shape's
// limit is where it sits (faster, or even where the fast path does the full
// path's work) plus the ratio's run-to-run spread, which stayed under 0.12.

const ROUNDS = Number(process.env.HM_SPEED_ROUNDS) || 15;

const card = (i) =>
  `<article><h3>Title ${i}</h3><p>Body <b>bold</b> words</p><ul><li>one</li><li>two</li><li>three</li></ul><input value="seed"><footer>end</footer></article>`;
const cards = Array.from({ length: 300 }, (_, i) => card(i)).join("");
const moved = Array.from({ length: 300 }, (_, i) => i);
moved.splice(20, 0, ...moved.splice(100, 1));
const deep = (text, after = "") =>
  `<main>${"<div>".repeat(600)}<p>${text}</p>${`</div>${after}`.repeat(600)}</main><aside><p>side</p></aside>`;
const synthetic = (cap) => {
  const store = E.createIdentityStore("t"),
    map = store.exportMap(cap.documentElement, (n) => n);
  const id = (n) => store.idOf(n);
  return { base: id, local: id, remote: { map, then: () => null } };
};
const SHAPES = [
  ["wide", 1, cards, cards.replace("Title 150", "Title REMOTE"), synthetic],
  ["deep", 1.1, deep("old"), deep("NEW"), synthetic],
  [
    "deep, a sibling after the chain",
    1.1,
    deep("old", "<span>x</span>"),
    deep("NEW", "<span>x</span>"),
    synthetic,
  ],
  [
    "list move",
    1.1,
    `<main>${cards}</main>`,
    `<main>${moved.map(card).join("")}</main>`,
  ],
  [
    "wide, default identity",
    1,
    cards,
    cards.replace("Title 150", "Title REMOTE"),
  ],
];

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const worst = (text, width) =>
  "<main>" +
  Array.from({ length: 600 }, (_, i) => `<div id="d${i}">`).join("") +
  `<p>${text}</p>` +
  ("</div><aside>" + "<i></i>".repeat(width) + "</aside>").repeat(600) +
  "</main>";
const opusWorst = (text) =>
  `<main>${"<div>".repeat(400)}<p>${text}</p>${"<ul><li>a</li><li>b</li></ul></div><ul><li>a</li><li>b</li></ul>".repeat(400)}</main>`;
const additional = [
  [
    "Opus wider sibling, synthetic",
    1.1,
    opusWorst("old"),
    opusWorst("NEW"),
    synthetic,
  ],
  ["Opus wider sibling, default", 1.1, opusWorst("old"), opusWorst("NEW")],
  [
    "late root-level bail, synthetic",
    1.1,
    cards,
    cards
      .replace("Title 298", "Title REMOTE")
      .replace("Title 299", "Title REMOTE"),
    synthetic,
    "root-level",
  ],
  ["equal-width authored siblings", 1.1, worst("old", 2), worst("NEW", 2)],
  ["wider authored siblings", 1.1, worst("old", 3), worst("NEW", 3)],
  [
    "late root-level bail",
    1.1,
    cards,
    cards
      .replace("Title 298", "Title REMOTE")
      .replace("Title 299", "Title REMOTE"),
    undefined,
    "root-level",
  ],
];
for (const row of additional) {
  row[6] = 1;
  SHAPES.push(row);
}
const rows = [];
for (const [name, limit, b, r, identityOf, bail, margin = 0] of SHAPES) {
  const times = { full: [], fast: [] };
  let taken = 0;
  for (let round = 0; round < ROUNDS + 3; round++)
    for (const fastPath of round % 2 ? [true, false] : [false, true]) {
      const live = parse(doc(b)),
        cap = parse(doc(b)),
        remote = parse(doc(r));
      const mapping = lockstepMap(cap.documentElement, live.documentElement);
      const identity = identityOf ? identityOf(cap) : undefined;
      const start = performance.now();
      const report = await E.mergeDocument({
        live,
        base: cap,
        local: {
          root: cap.documentElement,
          toLive: (n) => mapping.get(n) || null,
        },
        remote,
        ...(identity ? { identity } : {}),
        scripts: { execute: false },
        restoreFocus: false,
        fastPath,
      });
      const ms = performance.now() - start;
      assert.equal(
        live.documentElement.outerHTML,
        remote.documentElement.outerHTML,
      );
      if (fastPath && bail) assert.equal(report.stats.fastPathFallback, bail);
      if (round < 3) continue;
      times[fastPath ? "fast" : "full"].push(ms);
      if (fastPath) taken += report.stats.fastPathTaken;
    }
  const full = median(times.full),
    fast = median(times.fast);
  rows.push({
    name,
    limit,
    full: +full.toFixed(2),
    fast: +fast.toFixed(2),
    ratio: +(fast / full).toFixed(3),
    taken,
    expectedTaken: bail ? 0 : ROUNDS,
    margin,
  });
}
console.log(JSON.stringify({ load: loadavg(), rows }, null, 2));
for (const row of rows) {
  assert.equal(
    row.taken,
    row.expectedTaken,
    `${row.name}: the fast path was not taken`,
  );
  assert.ok(
    row.margin
      ? row.fast <= row.full * row.limit + row.margin
      : row.ratio <= row.limit,
    `${row.name}: fast ${row.fast} ms against full ${row.full} ms`,
  );
}
