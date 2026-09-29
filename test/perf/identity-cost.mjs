import assert from "node:assert/strict";
import { loadavg } from "node:os";
import { pathToFileURL } from "node:url";
import * as candidate from "../../src/index.js";
import { parse, doc } from "../node/lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

assert.ok(
  process.env.HM_REFERENCE_ENTRY,
  "HM_REFERENCE_ENTRY must name the frozen reference",
);
const reference = await import(
  pathToFileURL(process.env.HM_REFERENCE_ENTRY).href
);
const rounds = Number(process.env.HM_SPEED_ROUNDS) || 21;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
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
const rows = [];
for (const [name, body, synthetic] of [
  ["docs", docs, false],
  ["articles", articles, false],
  ["no ids", grid, false],
  ["synthetic", grid, true],
]) {
  const setup = (E) => {
    const cap = parse(doc(body)),
      live = parse(doc(body)),
      remote = parse(doc(body.replace("TARGET", "REMOTE")));
    assert.equal(cap.body.querySelectorAll("*").length, 3000);
    const map = lockstepMap(cap.documentElement, live.documentElement);
    const walk = cap.createTreeWalker(cap, 4);
    let text;
    while (walk.nextNode())
      if (walk.currentNode.nodeValue === "TARGET") text = walk.currentNode;
    assert.ok(text);
    const target = map.get(text);
    let identity;
    if (synthetic) {
      const store = E.createIdentityStore("t"),
        remoteMap = store.exportMap(cap.documentElement, (n) => n),
        id = (n) => store.idOf(n);
      identity = {
        base: id,
        local: id,
        remote: { map: remoteMap, then: () => null },
      };
    }
    return { cap, live, remote, map, target, identity };
  };
  const states = { reference: setup(reference), candidate: setup(candidate) },
    times = { reference: [], candidate: [] };
  for (let round = 0; round < rounds + 3; round++)
    for (const name of round % 2
      ? ["candidate", "reference"]
      : ["reference", "candidate"]) {
      const E = name === "candidate" ? candidate : reference;
      const { cap, live, remote, map, target, identity } = states[name];
      target.nodeValue = "TARGET";
      assert.equal(
        live.documentElement.outerHTML,
        cap.documentElement.outerHTML,
      );
      const start = performance.now();
      const report = await E.mergeDocument({
        live,
        base: cap,
        local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
        remote,
        identity,
        scripts: { execute: false },
        restoreFocus: false,
      });
      const elapsed = performance.now() - start;
      assert.equal(
        live.documentElement.outerHTML,
        remote.documentElement.outerHTML,
      );
      assert.equal(report.conflicts.length, 0);
      assert.equal(target.nodeValue, "REMOTE");
      assert.ok(live.contains(target));
      if (round >= 3) times[name].push(elapsed);
    }
  const ref = median(times.reference),
    cand = median(times.candidate);
  rows.push({
    name,
    elements: 3000,
    reference: ref,
    candidate: cand,
    ratio: cand / ref,
    samples: times,
  });
  console.log(JSON.stringify({ load: loadavg(), ...rows.at(-1) }));
}
for (const row of rows)
  assert.ok(row.ratio <= 1.1, `${row.name}: ${row.ratio} exceeds 1.1`);
