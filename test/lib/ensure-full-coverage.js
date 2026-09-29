import fs from "node:fs";
import lcovParse from "lcov-parse";

const SUITES = [
  {
    file: "coverage/lcov.info",
    run: "npm run test:chrome",
    floor: { lines: 86, functions: 85, branches: 99 },
  },
  {
    file: "coverage/node.lcov.info",
    run: "npm run test:node:coverage",
    floor: { lines: 89, functions: 93, branches: 93 },
  },
];

const parse = (file) =>
  new Promise((resolve, reject) =>
    lcovParse(file, (err, records) => (err ? reject(err) : resolve(records))),
  );

let failed = false;
for (const suite of SUITES) {
  if (!fs.existsSync(suite.file)) {
    console.error(`${suite.file} is missing; run ${suite.run} first`);
    process.exit(1);
  }
  const records = (await parse(suite.file)).filter((r) =>
    r.file.startsWith("src/"),
  );
  if (!records.length) {
    console.error(`${suite.file} has no records under src/`);
    process.exit(1);
  }
  for (const type of Object.keys(suite.floor)) {
    let hit = 0;
    let found = 0;
    for (const record of records) {
      hit += record[type].hit;
      found += record[type].found;
    }
    const pct = found ? (100 * hit) / found : 100;
    const ok = pct >= suite.floor[type];
    if (!ok) failed = true;
    console.log(
      `${suite.file} ${type} ${pct.toFixed(2)}% (floor ${suite.floor[type]}%)${ok ? "" : " FAIL"}`,
    );
  }
}
process.exit(failed ? 1 : 0);
