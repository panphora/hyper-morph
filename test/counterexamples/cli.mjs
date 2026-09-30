// The counterexample loop's checks, one process, no test runner:
//
//   check  <case.json...> [--engines cur,66dcba5] [--ref ref]   verdicts
//   shrink <case.json> [--engine cur] [--out file]               minimal case
//   prove  [cases dir]                                           each case fails on meta.failsOn.engine
//   corpus [cases dir] [--engine cur]                            every case passes
//   sweep  <from> <to> [--engine cur] [--out dir]                identity generator through the oracle
//   selftest [cases dir]                                         planted faults turn cases red
//   confirm <candidates dir> --out f --pending dir --tag t      verdict, shrink, stage
//   fence --pre <engine> <case.json...> [--corpus dir]           a fix: cases (and the unshrunk
//                                                                originals) pass, cases failed
//                                                                before, the corpus stays green
//
// Engines: `cur` (this tree), `ref` (HM_REFERENCE_ENTRY or 66dcba5), a git
// revision, a directory name under HM_ENGINES, or a path to an index.js.
// Every command prints one JSON line per result and exits 1 when a check
// that must hold did not.
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { engine } from "./lib/engines.js";
import { verdict } from "./lib/oracle.js";
import { shrink } from "./lib/shrink.js";
import { MUTANTS } from "./lib/mutants.js";
import { identityCase } from "./lib/gen-identity.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = (o) => console.log(JSON.stringify(o));
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const defaultDir = fileURLToPath(new URL("./cases/", import.meta.url));
const listCases = (dir = defaultDir) =>
  (existsSync(dir) ? readdirSync(dir) : [])
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
const propsOf = (v) =>
  [...new Set((v.violations || []).map((x) => x.prop))].sort();
let failed = 0;

if (cmd === "check") {
  const names = flag("--engines", "cur").split(",");
  const refName = flag("--ref", "ref");
  const ref = await engine(refName);
  for (const file of args) {
    const c = read(file);
    for (const name of names) {
      const t = performance.now();
      const v = await verdict(
        await engine(name),
        name === refName ? null : ref,
        c,
      );
      out({
        file: path.basename(file),
        engine: name,
        ms: +(performance.now() - t).toFixed(1),
        status: v.status,
        reason: v.reason,
        signature: v.signature,
        props: propsOf(v),
        refSame: v.reference?.same,
        fast: v.fast,
        violations: (v.violations || []).slice(0, 4),
      });
    }
  }
} else if (cmd === "shrink") {
  const E = await engine(flag("--engine", "cur"));
  const ref = await engine(flag("--ref", "ref"));
  const target = flag("--out", null);
  const budget = Number(flag("--budget", 20000));
  const c = read(args[0]);
  const first = await verdict(E, ref, c);
  if (first.status !== "counterexample") {
    out({
      file: args[0],
      status: first.status,
      reason: first.reason,
      shrunk: false,
    });
    process.exit(1);
  }
  const want = propsOf(first);
  const holds = async (x) => {
    const v = await verdict(E, ref, x);
    return (
      v.status === "counterexample" && want.every((p) => propsOf(v).includes(p))
    );
  };
  const t = performance.now();
  const r = await shrink(c, holds, { budget });
  const size = (x) =>
    ["base", "local", "remote"].reduce(
      (n, k) => n + (x[k] ?? x.base).length,
      0,
    );
  out({
    file: args[0],
    props: want,
    trials: r.trials,
    stopped: r.stopped,
    ms: Math.round(performance.now() - t),
    bytes: [size(c), size(r.case)],
  });
  if (target) writeFileSync(target, JSON.stringify(r.case, null, 2) + "\n");
} else if (cmd === "prove") {
  for (const file of listCases(args[0])) {
    const c = read(file);
    const f = c.meta?.failsOn;
    if (!f?.engine) {
      out({
        file: path.basename(file),
        ok: false,
        why: "no meta.failsOn.engine",
      });
      failed++;
      continue;
    }
    const v = await verdict(await engine(f.engine), null, c);
    const ok =
      v.status === "counterexample" &&
      (f.violations || []).every((p) => propsOf(v).includes(p));
    if (!ok) failed++;
    out({
      file: path.basename(file),
      engine: f.engine,
      ok,
      status: v.status,
      props: propsOf(v),
      want: f.violations,
    });
  }
} else if (cmd === "corpus") {
  const E = await engine(flag("--engine", "cur"));
  for (const file of listCases(args[0])) {
    const v = await verdict(E, null, read(file));
    if (v.status !== "passes" && v.status !== "undecidable") failed++;
    out({
      file: path.basename(file),
      status: v.status,
      props: propsOf(v),
      reason: v.reason,
    });
  }
} else if (cmd === "sweep") {
  const name = flag("--engine", "cur");
  const E = await engine(name);
  const ref = await engine(flag("--ref", "ref"));
  const dir = flag("--out", null);
  if (dir) mkdirSync(dir, { recursive: true });
  const [from, to] = [Number(args[0] || 1), Number(args[1] || 100)];
  const tally = {};
  const t = performance.now();
  for (let seed = from; seed <= to; seed++)
    for (const mode of ["full", "leaves"])
      for (const dirty of [false, true]) {
        const c = identityCase(E, seed, mode, dirty);
        if (!c) continue;
        const v = await verdict(E, ref, c);
        const key = v.status + (v.signature ? " " + v.signature : "");
        tally[key] = (tally[key] || 0) + 1;
        if (v.status === "counterexample" && dir) {
          const id = `sweep-${seed}-${mode}-${dirty ? "dirty" : "clean"}`;
          writeFileSync(
            path.join(dir, id + ".json"),
            JSON.stringify(
              {
                ...c,
                meta: {
                  ...c.meta,
                  foundBy: "sweep:identity",
                  signature: v.signature,
                  violations: v.violations.slice(0, 6),
                },
              },
              null,
              2,
            ) + "\n",
          );
        }
      }
  out({ engine: name, from, to, ms: Math.round(performance.now() - t), tally });
} else if (cmd === "confirm") {
  const dir = args[0];
  const outFile = flag("--out", null);
  const pendingDir = flag("--pending", null);
  const tag = flag("--tag", "p");
  const budget = Number(flag("--budget", 20000));
  const E = await engine("cur");
  const ref = await engine(flag("--ref", "ref"));
  const rows = [];
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    const row = { file: f };
    let c;
    try {
      c = read(path.join(dir, f));
      if (!c || typeof c.base !== "string" || typeof c.remote !== "string")
        throw new Error("not a case: base and remote must be strings");
    } catch (e) {
      rows.push({
        ...row,
        status: "rejected",
        reason: String(e.message).slice(0, 200),
      });
      continue;
    }
    let v;
    try {
      v = await verdict(E, ref, c);
    } catch (e) {
      rows.push({
        ...row,
        status: "rejected",
        reason: "oracle error: " + String(e.message).slice(0, 200),
      });
      continue;
    }
    Object.assign(row, {
      status: v.status,
      reason: v.reason,
      signature: v.signature,
      props: propsOf(v),
    });
    if (v.status === "counterexample") {
      const want = propsOf(v);
      const refStatus = (await verdict(ref, null, c)).status;
      const holds = async (x) => {
        const w = await verdict(E, ref, x);
        if (
          w.status !== "counterexample" ||
          !want.every((p) => propsOf(w).includes(p))
        )
          return false;
        return (await verdict(ref, null, x)).status === refStatus;
      };
      const small = structuredClone((await shrink(c, holds, { budget })).case);
      const v2 = await verdict(E, ref, small);
      const key = `${v2.signature}`;
      const id = `${tag}-${f.replace(/\.json$/, "")}`;
      small.meta = {
        ...(c.meta || {}),
        ...(small.meta || {}),
        id,
        candidate: f,
        dedupeKey: key,
        violations: propsOf(v2),
        beyondReference: v2.beyondReference,
        original: { ...c, meta: { ...(c.meta || {}), original: undefined } },
      };
      if (pendingDir) {
        mkdirSync(pendingDir, { recursive: true });
        writeFileSync(
          path.join(pendingDir, id + ".json.partial"),
          JSON.stringify(small, null, 2) + "\n",
        );
        renameSync(
          path.join(pendingDir, id + ".json.partial"),
          path.join(pendingDir, id + ".json"),
        );
      }
      Object.assign(row, { pending: id, dedupeKey: key });
    }
    rows.push(row);
  }
  const text = JSON.stringify(rows, null, 2) + "\n";
  if (outFile) {
    writeFileSync(outFile + ".partial", text);
    renameSync(outFile + ".partial", outFile);
  }
  out({
    candidates: rows.length,
    counterexamples: rows.filter((r) => r.pending).length,
  });
} else if (cmd === "fence") {
  const pre = flag("--pre", null);
  const casesDir = flag("--corpus", defaultDir);
  const E = await engine("cur");
  const P = pre ? await engine(pre) : null;
  const rows = [];
  for (const file of args) {
    const c = read(file);
    const now = await verdict(E, null, c);
    const before = P ? await verdict(P, null, c) : null;
    const orig = c.meta?.original
      ? await verdict(E, null, c.meta.original)
      : null;
    const origSlipped =
      orig?.status === "undecidable" &&
      !!P &&
      (await verdict(P, null, c.meta.original)).status === "passes";
    const ok =
      now.status === "passes" &&
      (!P || before.status === "counterexample") &&
      (!orig || orig.status !== "counterexample") &&
      !origSlipped;
    rows.push({
      file: path.basename(file),
      ok,
      now: now.status,
      nowProps: propsOf(now),
      before: before?.status,
      original: orig?.status,
      originalSlipped: origSlipped,
    });
  }
  const corpus = [];
  for (const file of listCases(casesDir)) {
    const v = await verdict(E, null, read(file));
    // A case that passed before the fix must not slip to undecidable.
    const slipped =
      v.status === "undecidable" &&
      !!P &&
      (await verdict(P, null, read(file))).status === "passes";
    if ((v.status !== "passes" && v.status !== "undecidable") || slipped)
      corpus.push({
        file: path.basename(file),
        status: slipped ? "passes-became-undecidable" : v.status,
        props: propsOf(v),
      });
    const o = read(file).meta?.original;
    if (o) {
      const ov = await verdict(E, null, o);
      const oSlipped =
        ov.status === "undecidable" &&
        !!P &&
        (await verdict(P, null, o)).status === "passes";
      if (ov.status === "counterexample" || oSlipped)
        corpus.push({
          file: path.basename(file),
          status: oSlipped
            ? "original-passes-became-undecidable"
            : "original-counterexample",
          props: propsOf(ov),
        });
    }
  }
  const ok = rows.every((r) => r.ok) && !corpus.length;
  if (!ok) failed++;
  out({ ok, cases: rows, corpusRed: corpus });
} else if (cmd === "selftest") {
  const E = await engine("cur");
  const pool = listCases(args[0]).map(read);
  for (let seed = 1; seed <= 25; seed++)
    for (const dirty of [false, true]) {
      const c = identityCase(E, seed, "full", dirty);
      if (c) pool.push(c);
    }
  for (const [kind, mutate] of Object.entries(MUTANTS)) {
    const bad = mutate(E);
    let green = 0;
    let red = 0;
    for (const c of pool) {
      if ((await verdict(E, null, c)).status !== "passes") continue;
      green++;
      if ((await verdict(bad, null, c)).status === "counterexample") red++;
    }
    if (!red) failed++;
    out({ mutant: kind, cases: pool.length, green, redUnderMutant: red });
  }
} else {
  console.error("usage: cli.mjs check|shrink|prove|corpus|sweep|selftest ...");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
