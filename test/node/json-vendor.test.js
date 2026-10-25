import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as jsonParse from "hyper-morph/json-parse";
import * as full from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorPath = path.resolve(
  __dirname,
  "../../../clayjs/src/vendor/hyper-morph-json.vendor.js",
);
const vendorText = fs.readFileSync(vendorPath, "utf8");
const vendor = await import(
  `data:text/javascript;base64,${Buffer.from(vendorText).toString("base64")}`
);

const RELAXED_JSON = [
  '{"a": 1}',
  "{a: 1, _b: 2, $c: 3, d1: 4}",
  "{a: 'x'}",
  "{a: 'don\\'t'}",
  "{a: 'say \"hi\"'}",
  "{a: 1,}",
  "[1, 2,]",
  "{a: 1, /* end */ }",
  "{\n  // count of things\n  a: 1\n}",
  "{a: 1} // done",
  "{a /* key */ : 1}",
  "{a: 2e3, b: 1.5E-2, c: -0.5, d: 0}",
  "{a: true, b: false, c: null}",
  "{todos: [{id: 1, text: 'buy milk',}, {id: 2, text: 'call'}], done: false}",
];

const RELAXED_RULES = [
  '{"Title": "#hero"}',
  "{Title: h2}",
  "{a: #t:first .x, b: .item:last-child}",
  "{a: @attr}",
  "{a: [data-role]}",
  "{Books: {selector: .book, fields: {Title: h2, Price: .price}}}",
  "{a: [1, 2,]}",
  "{a: -1.5, b: true, c: false, d: null}",
  "{a: 'don\\'t', b: 1,}",
];

test("the json-parse subpath exports both parsers", () => {
  assert.equal(typeof jsonParse.parseJsonRelaxed, "function");
  assert.equal(typeof jsonParse.parseRulesRelaxed, "function");
});

test("the generated json vendor exports both parsers", () => {
  assert.equal(typeof vendor.parseJsonRelaxed, "function");
  assert.equal(typeof vendor.parseRulesRelaxed, "function");
});

test("relaxed JSON parses the same as the full bundle", () => {
  for (const input of RELAXED_JSON) {
    const expected = full.parseJsonRelaxed(input);
    assert.deepEqual(vendor.parseJsonRelaxed(input), expected, input);
    assert.deepEqual(jsonParse.parseJsonRelaxed(input), expected, input);
  }
});

test("relaxed rules parse the same as the full bundle", () => {
  for (const input of RELAXED_RULES) {
    const expected = full.parseRulesRelaxed(input);
    assert.deepEqual(vendor.parseRulesRelaxed(input), expected, input);
    assert.deepEqual(jsonParse.parseRulesRelaxed(input), expected, input);
  }
});

test("both parsers reject the same invalid input", () => {
  for (const input of ["{a: hello}", "{a: 1, b:", "// nothing"]) {
    assert.throws(() => vendor.parseJsonRelaxed(input), input);
    assert.throws(() => full.parseJsonRelaxed(input), input);
  }
  assert.throws(() => vendor.parseRulesRelaxed("{a: #t:foo}"));
  assert.throws(() => full.parseRulesRelaxed("{a: #t:foo}"));
});
