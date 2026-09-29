import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { loadavg } from "node:os";
import * as E from "../../src/index.js";
import { parse, doc } from "../node/lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { compareCase, runOne } from "./gate.mjs";

const rows = [];
const base =
  '<h1>old</h1><aside><input value="original"><textarea>text</textarea><select><option selected>A</option><option>B</option></select></aside>';
for (const mode of ["attribute", "property"]) {
  const prepare = ({ live, remote }) => {
    live.querySelector("input").value = "RUNTIME";
    live.querySelector("textarea").value = "RUNTIME";
    if (mode === "property") {
      remote.querySelector("input").value = "REMOTE";
      remote.querySelector("textarea").value = "REMOTE";
      remote.querySelectorAll("option")[1].selected = true;
    }
  };
  rows.push(
    await compareCase(
      `forms ${mode}`,
      base,
      base.replace("old", "new"),
      "synthetic",
      {
        prepare,
        opts: { formState: mode },
      },
      Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
    ),
  );
}
const templ =
  "<h1>title</h1><template><template><p>OLD</p></template></template>";
rows.push(
  await compareCase(
    "nested template actual content change",
    templ,
    templ.replace("OLD", "NEW"),
    "authored",
    {},
    Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
  ),
);
const json =
  '<h1>title</h1><script type="application/json" merge="data">{"keep":1,"drop":2}</script>';
rows.push(
  await compareCase(
    "explicit-base JSON delete",
    json,
    json.replace(',"drop":2', ""),
    "synthetic",
    {},
    Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
  ),
);
rows.push(
  await compareCase(
    "beforeApply sees full document",
    "<main inert><h1>old</h1></main><aside>x</aside>",
    "<main inert><h1>new</h1></main><aside>x</aside>",
    "authored",
    {
      opts: {
        beforeApply(d) {
          assert.equal(d.documentElement.tagName, "HTML");
          assert.ok(d.head && d.body && d.querySelector("aside"));
          d.querySelector("main").removeAttribute("inert");
        },
      },
    },
    Boolean(process.env.HM_FAST_REFERENCE_ENTRY),
  ),
);

for (const fastPath of [false, true]) {
  const dom = new JSDOM(doc(base), { pretendToBeVisual: true });
  const live = dom.window.document;
  const cap = live.cloneNode(true),
    remote = parse(doc(base.replace("old", "new")));
  const mapping = lockstepMap(cap.documentElement, live.documentElement);
  const input = live.querySelector("input");
  input.value = "TYPING";
  input.focus();
  const report = await E.mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => mapping.get(n) },
    remote,
    scripts: { execute: false },
    fastPath,
  });
  assert.equal(input.value, "TYPING");
  assert.equal(live.activeElement, input);
  assert.equal(report.stats.fastPathTaken, fastPath ? 1 : 0);
  dom.window.close();
}

const cap = parse(doc("<h1>old</h1>")),
  live = parse(doc("<h1>old</h1>"));
const remote = parse(doc("<h1>new</h1>"));
remote.replaceChild(
  remote.implementation.createDocumentType("html", "public-new", "system-new"),
  remote.doctype,
);
const mapping = lockstepMap(cap.documentElement, live.documentElement);
let observedBefore = false;
const id = () => {
  observedBefore = true;
  return null;
};
await E.mergeDocument({
  live,
  base: cap,
  local: { root: cap.documentElement, toLive: (n) => mapping.get(n) },
  remote,
  identity: { base: id, local: id, remote: id },
  scripts: { execute: false },
  fastPath: true,
});
assert.equal(observedBefore, true);
assert.equal(live.doctype.publicId, "public-new");
assert.ok(rows.every((r) => r.fields.length === 0));

const cards = Array.from(
  { length: 300 },
  (_, i) =>
    `<article><h3>Title ${i}</h3><p>Body <b>bold</b> words</p><ul><li>one</li><li>two</li><li>three</li></ul><input value="seed"><footer>end</footer></article>`,
).join("");
const times = { full: [], fast: [] },
  identityCounts = {},
  hits = { full: 0, fast: 0 };
const load = loadavg();
for (let round = 0; round < 25; round++)
  for (const fastPath of round % 2 ? [true, false] : [false, true]) {
    const live = parse(doc(cards)),
      cap = parse(doc(cards)),
      remote = parse(doc(cards.replace("Title 150", "Title REMOTE")));
    const mapping = lockstepMap(cap.documentElement, live.documentElement);
    const store = E.createIdentityStore("t"),
      map = store.exportMap(cap.documentElement, (n) => n);
    const id = (n) => store.idOf(n);
    const identity = { base: id, local: id, remote: { map, then: () => null } };
    const start = performance.now();
    const report = await E.mergeDocument({
      live,
      base: cap,
      local: { root: cap.documentElement, toLive: (n) => mapping.get(n) },
      remote,
      identity,
      scripts: { execute: false },
      restoreFocus: false,
      fastPath,
    });
    const ms = performance.now() - start;
    assert.equal(
      live.documentElement.outerHTML,
      remote.documentElement.outerHTML,
    );
    assert.equal(report.localDiverged, false);
    const key = fastPath ? "fast" : "full";
    identityCounts[key] = report.identities.length;
    if (round >= 5) {
      times[key].push(ms);
      hits[key] += report.stats.fastPathTaken;
    }
  }
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: (sorted[9] + sorted[10]) / 2,
    p90: sorted[17],
    max: sorted[19],
  };
};
assert.equal(identityCounts.full, identityCounts.fast);
assert.equal(hits.fast, 20);
const result = {
  rows,
  focused: 2,
  doctype: "passed",
  timing: {
    elements: 3003,
    load,
    identityCounts,
    hits,
    full: summarize(times.full),
    fast: summarize(times.fast),
  },
};
if (process.env.FAST_EXTRA_OUTPUT)
  writeFileSync(process.env.FAST_EXTRA_OUTPUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
