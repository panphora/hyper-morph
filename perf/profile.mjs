// CPU profile of one morph in Chromium: `node perf/profile.mjs [clean|dirty]`.
// Serves the repo over http, runs warm-ups, then samples one run and prints
// the functions with the most self time.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const kind = process.argv[2] || "clean";
const port = 5699;
const server = spawn("npx", ["http-server", ".", "-p", String(port), "-s"], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/perf/page.html`);
  await page.waitForFunction(() => window.benchReady);
  const warm = [];
  for (let i = 0; i < 5; i++)
    warm.push(await page.evaluate((k) => window.bench[k](), kind));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  const timed = [];
  for (let i = 0; i < 10; i++)
    timed.push(await page.evaluate((k) => window.bench[k](), kind));
  const { profile } = await cdp.send("Profiler.stop");
  await browser.close();
  timed.sort((a, b) => a - b);
  console.log(
    `${kind}: median ${timed[5].toFixed(1)} ms over 10 runs (warm-ups: ${warm.map((t) => t.toFixed(0)).join(",")})`,
  );
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const f = n.callFrame;
    const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-1)[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0));
  }
  const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  for (const [k, us] of rows)
    console.log(
      `${(us / 1000).toFixed(1).padStart(7)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`,
    );
} finally {
  server.kill();
}
