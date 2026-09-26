import fs from "node:fs";
import lcovParse from "lcov-parse";

const FLOOR = { lines: 86, functions: 87, branches: 99 };
const file = "coverage/lcov.info";

if (!fs.existsSync(file)) {
  console.error(`${file} is missing; run npm run test:chrome first`);
  process.exit(1);
}

lcovParse(file, (err, records) => {
  if (err) {
    console.error("Error parsing lcov file:", err);
    process.exit(1);
  }
  if (!records.length) {
    console.error(`${file} has no records`);
    process.exit(1);
  }
  let failed = false;
  for (const type of Object.keys(FLOOR)) {
    let hit = 0;
    let found = 0;
    for (const record of records) {
      hit += record[type].hit;
      found += record[type].found;
    }
    const pct = found ? (100 * hit) / found : 100;
    const ok = pct >= FLOOR[type];
    if (!ok) failed = true;
    console.log(
      `${type} ${pct.toFixed(2)}% (floor ${FLOOR[type]}%)${ok ? "" : " FAIL"}`,
    );
  }
  process.exit(failed ? 1 : 0);
});
