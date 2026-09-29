import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as candidate from "../../src/index.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const frozen = process.env.HM_FAST_REFERENCE_ENTRY
  ? await import(
      pathToFileURL(resolve(process.env.HM_FAST_REFERENCE_ENTRY)).href
    )
  : null;
import {
  observe,
  labelTree,
  finalTree,
  nodeList,
} from "../lib/differential-observe.js";
import { parse, doc } from "../node/lib/dom.js";
import { generate, setIdMode } from "../lib/structure-fuzz.js";

const authored = (el) =>
  el.getAttribute("data-id") || el.getAttribute("id") || null;
const forms = (root, label, final) =>
  labelTree(root)
    .nodes.filter(
      (n) =>
        n.nodeType === 1 &&
        ["INPUT", "OPTION", "SELECT", "TEXTAREA"].includes(n.tagName),
    )
    .map((n) => [
      nodeList([n], label, final)[0],
      n.value,
      n.checked,
      n.selected,
      n.selectedIndex,
      n.disabled,
    ]);
function project(value, label, final) {
  if (value && typeof value === "object") {
    if (value.nodeType) return nodeList([value], label, final)[0];
    if (Array.isArray(value)) return value.map((v) => project(v, label, final));
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, project(v, label, final)]),
    );
  }
  return value;
}

export async function runOne(E, fastPath, b, r, kind, extra = {}) {
  let stats, added;
  const wrapped = {
    ...E,
    async mergeDocument(options) {
      const { live, base: cap } = options;
      let remote = parse(options.remote);
      let identity;
      if (kind !== "authored") {
        const receiver = E.createIdentityStore("receiver");
        const capMap = receiver.exportMap(cap.documentElement, (n) => n);
        let map;
        if (kind === "operation") {
          const source = parse(doc(b));
          const origin = E.importMap(source.documentElement, capMap);
          const store = E.createIdentityStore("sender");
          for (const n of labelTree(source.documentElement).nodes)
            if (n.nodeType === 1 && origin.get(n))
              store.adopt(n, origin.get(n));
          const a = source.querySelector("section.a"),
            z = source.querySelector("section.z");
          const first = a.firstElementChild;
          if (extra.operation === 0) {
            a.insertBefore(first.cloneNode(true), first);
            z.appendChild(first);
          } else if (extra.operation === 1) {
            const last = z.firstElementChild;
            a.appendChild(last);
            z.appendChild(first);
          } else if (extra.operation === 2) {
            a.insertBefore(first.cloneNode(true), first);
            z.appendChild(first);
            first.querySelector("p").textContent += " MOVED";
          }
          source.querySelector("h1").textContent += " REMOTE";
          remote = source;
          map = store.exportMap(remote.documentElement, (n) => n);
        } else {
          map = E.createIdentityStore("sender").exportMap(
            remote.documentElement,
            (n) => n,
          );
          for (const key of Object.keys(map))
            if (key !== "~" && key !== "^" && capMap[key])
              map[key] = capMap[key];
        }
        if (extra.mapOf) map = extra.mapOf(E, capMap, remote);
        const id = (el) => authored(el) || receiver.idOf(el);
        identity = {
          base: id,
          local: id,
          remote: { first: authored, map, then: authored },
        };
      }
      extra.prepare?.({ live, cap, remote, options });
      const label = labelTree(live.documentElement);
      const input = {
        ...options,
        remote,
        identity,
        scripts: { execute: false },
        ...extra.opts,
      };
      if (fastPath !== undefined) input.fastPath = fastPath;
      const report = await E.mergeDocument(input);
      const final = finalTree(live.documentElement);
      stats = report.stats;
      added = {
        document: live.documentElement.outerHTML,
        doctype: live.doctype && [
          live.doctype.name,
          live.doctype.publicId,
          live.doctype.systemId,
        ],
        forms: forms(live.documentElement, label, final),
        applied: project(report.applied, label, final),
        decisions: project(report.decisions, label, final),
        probe: extra.inspect
          ? extra.inspect({ live, rep: report, label, stats })
          : null,
      };
      return report;
    },
  };
  const result = await observe(wrapped, "clean", { b, l: b, r });
  delete result.stats;
  return { result: { ...result, ...added }, stats };
}

export async function compareCase(
  name,
  b,
  r,
  kind,
  extra = {},
  checkOff = false,
) {
  const a = await runOne(candidate, false, b, r, kind, extra);
  const f = await runOne(candidate, true, b, r, kind, extra);
  const fields = Object.keys(a.result).filter(
    (k) => JSON.stringify(a.result[k]) !== JSON.stringify(f.result[k]),
  );
  if (checkOff) {
    assert.ok(
      frozen,
      "CHECK_OFF=1 requires HM_FAST_REFERENCE_ENTRY pointing to unwrapped frozen src/index.js",
    );
    const before = await runOne(frozen, undefined, b, r, kind, extra);
    assert.deepEqual(
      a.result,
      before.result,
      name + " option-off changed result",
    );
    const oldStats = { ...a.stats };
    delete oldStats.fastPathAttempted;
    delete oldStats.fastPathTaken;
    delete oldStats.fastPathFallback;
    assert.deepEqual(
      oldStats,
      before.stats,
      name + " option-off changed old stats",
    );
  }
  return {
    name,
    fields,
    stats: f.stats,
    recoveryCount: a.result.recovery.length,
    ...(fields.length ? { full: a.result, fast: f.result } : {}),
  };
}

if (process.argv[1].endsWith("gate.mjs")) {
  const N = Number(process.argv[2] || 100);
  const kinds = (process.argv[3] || "authored,synthetic,operation").split(",");
  const totals = [],
    differences = [];
  const started = performance.now();
  for (const kind of kinds)
    for (let mode = 0; mode <= 6; mode++) {
      setIdMode(mode);
      const row = {
        kind,
        mode,
        seeds: N,
        taken: 0,
        recoveries: 0,
        fastRecoveries: 0,
        differences: 0,
        fallbacks: {},
      };
      for (let seed = 1; seed <= N; seed++) {
        let { b, r } = generate(seed);
        if (kind === "operation") {
          const id =
            mode === 0
              ? ""
              : mode === 2
                ? ' data-id="dup"'
                : ` data-id="a${seed}"`;
          const card = `<article${id}><p>same words ${seed}</p><input value="v"></article>`;
          b = `<h1>title</h1><section class="a">${card}</section><section class="z">${card}</section>`;
          r = b;
        }
        const out = await compareCase(
          `${kind}:${mode}:${seed}`,
          b,
          r,
          kind,
          { operation: seed % 4 },
          process.env.CHECK_OFF === "1",
        );
        row.taken += out.stats.fastPathTaken;
        row.recoveries += out.recoveryCount;
        if (out.stats.fastPathTaken) row.fastRecoveries += out.recoveryCount;
        const reason = out.stats.fastPathFallback;
        if (reason) row.fallbacks[reason] = (row.fallbacks[reason] || 0) + 1;
        if (out.fields.length) {
          row.differences++;
          if (differences.length < 30) differences.push(out);
        }
      }
      totals.push(row);
      console.log(JSON.stringify(row));
    }
  const summary = {
    seconds: (performance.now() - started) / 1000,
    totals,
    differences,
  };
  if (process.env.FAST_GATE_OUTPUT)
    writeFileSync(
      process.env.FAST_GATE_OUTPUT,
      JSON.stringify(summary, null, 2),
    );
  assert.equal(
    totals.reduce((n, r) => n + r.differences, 0),
    0,
    "fast-path differences",
  );
  for (const kind of kinds)
    assert.ok(
      totals.filter((r) => r.kind === kind).every((r) => r.taken > 0),
      "nonzero hits in every requested identity kind and mode",
    );
}
