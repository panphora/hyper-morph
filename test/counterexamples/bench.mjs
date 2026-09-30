// The speed loop's benchmark: a fixed set of pages merged by two engines,
// alternating which goes first each round, timed by the main thread's CPU
// time (process.threadCpuUsage: a loaded machine preempts the process, and
// preemption is not CPU time) with wall time kept beside it. Reports each
// page's median paired ratio (b / a per round), the geometric mean over
// pages, and a bootstrap interval for it.
//
//   node test/counterexamples/bench.mjs <engineA> <engineB> [--rounds 15] [--only name,…] [--json out]
//
// Engines as in cli.mjs (`cur`, a revision, a snapshot name, a path).
import { readFileSync, writeFileSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { parse, doc } from "../node/lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { engine } from "./lib/engines.js";

const args = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const ROUNDS = Number(flag("--rounds", 15));
const only = flag("--only", null)?.split(",");
const jsonOut = flag("--json", null);
const [nameA = "cur", nameB = "cur"] = args;

const card = (i) =>
  `<article><h3>Title ${i}</h3><p>Body <b>bold</b> words</p><ul><li>one</li><li>two</li><li>three</li></ul><input value="seed"><footer>end</footer></article>`;
const cards = Array.from({ length: 300 }, (_, i) => card(i)).join("");
const movedOrder = Array.from({ length: 300 }, (_, i) => i);
movedOrder.splice(20, 0, ...movedOrder.splice(100, 1));
const deep = (text, after = "") =>
  `<main>${"<div>".repeat(600)}<p>${text}</p>${`</div>${after}`.repeat(600)}</main><aside><p>side</p></aside>`;
const worst = (text, width) =>
  "<main>" +
  Array.from({ length: 600 }, (_, i) => `<div id="d${i}">`).join("") +
  `<p>${text}</p>` +
  ("</div><aside>" + "<i></i>".repeat(width) + "</aside>").repeat(600) +
  "</main>";
const opusWorst = (text) =>
  `<main>${"<div>".repeat(400)}<p>${text}</p>${"<ul><li>a</li><li>b</li></ul></div><ul><li>a</li><li>b</li></ul>".repeat(400)}</main>`;
const docs = Array.from(
  { length: 200 },
  (_, i) =>
    `<section><h2 id="h${i}">Heading ${i}</h2><p>one <a>link</a><code>code</code></p><p>${i === 100 ? "TARGET" : "two"}<em>em</em><strong>strong</strong></p><ul><li>a</li><li>b</li><li>c</li></ul><p>end</p><div><span>end</span></div></section>`,
).join("");
const articles = Array.from(
  { length: 100 },
  (_, i) =>
    `<article>${"<div>".repeat(10)}<p data-id="p${i}">${i === 50 ? "TARGET" : "words"}</p>${"</div>".repeat(10)}${"<p><em>extra</em></p>".repeat(9)}</article>`,
).join("");
const grid = Array.from(
  { length: 1000 },
  (_, i) =>
    `<section><div><p>${i === 500 ? "TARGET" : "words"}</p></div></section>`,
).join("");

const real = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./bench-pages/${name}.html`, import.meta.url)),
    "utf8",
  );
/** Replace the k-th of n visible body text nodes' first word. */
function editText(html, at, word) {
  const d = parse(html);
  const walk = d.createTreeWalker(d.body, 4);
  const texts = [];
  for (let t = walk.nextNode(); t; t = walk.nextNode())
    if (
      /\w/.test(t.nodeValue) &&
      !t.parentElement.closest("script,style,template")
    )
      texts.push(t);
  const t = texts[Math.floor(texts.length * at)];
  t.nodeValue = t.nodeValue.replace(/\w+/, word);
  return "<!DOCTYPE html>" + d.documentElement.outerHTML;
}

const synthetic = true;
// name, base html, remote html, { synthetic, fastPath, local (dirty) }
const PAGES = [
  [
    "wide synthetic fast",
    doc(cards),
    doc(cards.replace("Title 150", "Title REMOTE")),
    { synthetic, fastPath: true },
  ],
  [
    "wide default fast",
    doc(cards),
    doc(cards.replace("Title 150", "Title REMOTE")),
    { fastPath: true },
  ],
  [
    "wide default full",
    doc(cards),
    doc(cards.replace("Title 150", "Title REMOTE")),
    {},
  ],
  [
    "deep synthetic fast",
    doc(deep("old")),
    doc(deep("NEW")),
    { synthetic, fastPath: true },
  ],
  [
    "deep sibling synthetic fast",
    doc(deep("old", "<span>x</span>")),
    doc(deep("NEW", "<span>x</span>")),
    { synthetic, fastPath: true },
  ],
  [
    "list move fast",
    doc(`<main>${cards}</main>`),
    doc(`<main>${movedOrder.map(card).join("")}</main>`),
    { fastPath: true },
  ],
  [
    "wider sibling synthetic fast",
    doc(opusWorst("old")),
    doc(opusWorst("NEW")),
    { synthetic, fastPath: true },
  ],
  [
    "late root-level bail synthetic",
    doc(cards),
    doc(
      cards
        .replace("Title 298", "Title REMOTE")
        .replace("Title 299", "Title REMOTE"),
    ),
    { synthetic, fastPath: true },
  ],
  [
    "equal-width authored fast",
    doc(worst("old", 2)),
    doc(worst("NEW", 2)),
    { fastPath: true },
  ],
  ["docs full", doc(docs), doc(docs.replace("TARGET", "REMOTE")), {}],
  [
    "articles full",
    doc(articles),
    doc(articles.replace("TARGET", "REMOTE")),
    {},
  ],
  ["no-id grid full", doc(grid), doc(grid.replace("TARGET", "REMOTE")), {}],
  [
    "synthetic grid full",
    doc(grid),
    doc(grid.replace("TARGET", "REMOTE")),
    { synthetic },
  ],
  [
    "wide dirty",
    doc(cards),
    doc(cards.replace("Title 150", "Title REMOTE")),
    { local: doc(cards.replace("Title 20<", "Title LOCAL<")) },
  ],
  [
    "docs dirty",
    doc(docs),
    doc(docs.replace("TARGET", "REMOTE")),
    { local: doc(docs.replace("Heading 7<", "Heading LOCAL<")) },
  ],
  ...["kanban", "devlog", "landing"].flatMap((n) => {
    const b = real(n);
    return [
      [`${n} clean`, b, editText(b, 0.5, "REMOTE"), { fastPath: true }],
      [
        `${n} dirty`,
        b,
        editText(b, 0.75, "REMOTE"),
        { local: editText(b, 0.25, "LOCAL") },
      ],
    ];
  }),
].filter(([name]) => !only || only.includes(name));

function setup(E, [, b, r, o]) {
  const cap = parse(o.local || b),
    live = parse(o.local || b),
    remote = parse(r);
  const map = lockstepMap(cap.documentElement, live.documentElement);
  let identity;
  if (o.synthetic) {
    const store = E.createIdentityStore("t");
    const remoteMap = store.exportMap(cap.documentElement, (n) => n);
    const id = (n) => store.idOf(n);
    identity = {
      base: id,
      local: id,
      remote: { map: remoteMap, then: () => null },
    };
  }
  return {
    live,
    options: {
      live,
      base: o.local ? parse(b) : cap,
      local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
      remote,
      ...(identity ? { identity } : {}),
      scripts: { execute: false },
      restoreFocus: false,
      ...(o.fastPath && E.__fast !== false ? { fastPath: true } : {}),
    },
  };
}

const cpu = () => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};
async function once(E, page) {
  const { live, options } = setup(E, page);
  const w0 = performance.now(),
    c0 = cpu();
  await E.mergeDocument(options);
  const c1 = cpu(),
    w1 = performance.now();
  return { cpu: c1 - c0, wall: w1 - w0, html: live.documentElement.outerHTML };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const geomean = (xs) =>
  Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
function bootstrap(perPage, n = 2000) {
  let seed = 12345;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = [];
  for (let i = 0; i < n; i++)
    out.push(
      geomean(
        perPage.map((ratios) =>
          median(
            Array.from(
              { length: ratios.length },
              () => ratios[Math.floor(rnd() * ratios.length)],
            ),
          ),
        ),
      ),
    );
  out.sort((a, b) => a - b);
  return [out[Math.floor(n * 0.025)], out[Math.floor(n * 0.975)]];
}

const A = await engine(nameA),
  B = await engine(nameB);
const loadStart = loadavg()[0];
const rows = [];
for (const page of PAGES) {
  const t = { a: [], b: [], ratioCpu: [], ratioWall: [] };
  for (let round = 0; round < ROUNDS + 3; round++) {
    const order = round % 2 ? ["b", "a"] : ["a", "b"];
    const got = {};
    for (const k of order) got[k] = await once(k === "a" ? A : B, page);
    assert.equal(
      got.a.html,
      got.b.html,
      `${page[0]}: the engines disagree on the bytes`,
    );
    if (round < 3) continue;
    t.a.push(got.a.cpu);
    t.b.push(got.b.cpu);
    t.ratioCpu.push(got.b.cpu / got.a.cpu);
    t.ratioWall.push(got.b.wall / got.a.wall);
  }
  rows.push({
    page: page[0],
    aMs: +median(t.a).toFixed(2),
    bMs: +median(t.b).toFixed(2),
    ratio: +median(t.ratioCpu).toFixed(3),
    wallRatio: +median(t.ratioWall).toFixed(3),
    spread: +(Math.max(...t.ratioCpu) / Math.min(...t.ratioCpu)).toFixed(2),
    ratios: t.ratioCpu,
  });
  process.stderr.write(`${page[0]}: ${rows.at(-1).ratio}\n`);
}
const score = geomean(rows.map((r) => r.ratio));
const ci = bootstrap(rows.map((r) => r.ratios));
const result = {
  a: nameA,
  b: nameB,
  rounds: ROUNDS,
  load: [loadStart, loadavg()[0]],
  cpus: cpus().length,
  score: +score.toFixed(4),
  ci: ci.map((x) => +x.toFixed(4)),
  worst: rows.reduce((w, r) => (r.ratio > w.ratio ? r : w)).page,
  rows: rows.map(({ ratios, ...r }) => r),
};
if (jsonOut)
  writeFileSync(jsonOut, JSON.stringify({ ...result, rows }, null, 2));
console.log(JSON.stringify(result, null, 1));
