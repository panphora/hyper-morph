import { parentPort, workerData } from "node:worker_threads";
import { setIdMode } from "./structure-fuzz.js";
import {
  cases,
  VARIANTS,
  observeClean,
  differences,
} from "./fast-path-gate.js";
import * as E from "../../src/index.js";

// One id mode of the fast-path gate, in its own thread.
const { mode, seeds } = workerData;
setIdMode(mode);
const tally = {};
const diffs = [];
let runs = 0;
for (let seed = 1; seed <= seeds; seed++)
  for (const input of cases(seed))
    for (const [name, variant] of Object.entries(VARIANTS)) {
      const ref = await observeClean(E, input, variant, false);
      const got = await observeClean(E, input, variant, true);
      runs++;
      const key = `${input.name}/${name}`;
      const t = (tally[key] ||= { taken: 0, fallback: {} });
      const s = got.fast;
      if (s.fastPathTaken) t.taken++;
      else {
        const why = s.fastPathAttempted ? s.fastPathFallback : "off";
        t.fallback[why] = (t.fallback[why] || 0) + 1;
      }
      const d = differences(ref, got);
      if (d.length) diffs.push({ mode, seed, key, fields: d });
    }
parentPort.postMessage({ mode, runs, tally, diffs });
