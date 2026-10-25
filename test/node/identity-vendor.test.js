import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as identity from "hyper-morph/identity";
import * as full from "../../src/index.js";
import { parse } from "./lib/dom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorPath = path.resolve(
  __dirname,
  "../../../clayjs/src/vendor/hyper-morph-identity.vendor.js",
);
const vendorText = fs.readFileSync(vendorPath, "utf8");
const vendor = await import(
  `data:text/javascript;base64,${Buffer.from(vendorText).toString("base64")}`
);

const HTML =
  '<!DOCTYPE html><html><head></head><body><div id="board"><article data-id="a"><h2>One</h2></article><article data-id="b"><h2>Two</h2></article></div></body></html>';

function collect(root) {
  const out = [];
  const visit = (el) => {
    out.push(el);
    for (const kid of el.children) visit(kid);
  };
  visit(root);
  return out;
}

function roundTrip(mod) {
  const liveRoot = parse(HTML).body;
  const cloneRoot = parse(HTML).body;
  const liveEls = collect(liveRoot);
  const cloneEls = collect(cloneRoot);
  const liveByClone = new WeakMap();
  cloneEls.forEach((clone, i) => liveByClone.set(clone, liveEls[i]));

  const store = mod.createIdentityStore("tab");
  liveEls.forEach((el) => store.ensure(el));

  const map = store.exportMap(cloneRoot, (clone) => liveByClone.get(clone));
  const receivedEls = collect(parse(HTML).body);
  const imported = mod.importMap(receivedEls[0], map);

  return {
    map,
    ids: receivedEls.map((el) => imported.get(el) ?? null),
    liveIds: liveEls.map((el) => store.idOf(el)),
  };
}

test("the identity subpath exports the identity module", () => {
  assert.equal(typeof identity.createIdentityStore, "function");
  assert.equal(typeof identity.importMap, "function");
  assert.equal(typeof identity.tieredIdentity, "function");
});

test("the generated identity vendor exports the identity module", () => {
  assert.equal(typeof vendor.createIdentityStore, "function");
  assert.equal(typeof vendor.importMap, "function");
  assert.equal(typeof vendor.tieredIdentity, "function");
});

test("an ensure/exportMap/importMap round trip matches the full bundle", () => {
  const fromSubpath = roundTrip(identity);
  const fromBundle = roundTrip(full);

  assert.deepEqual(fromSubpath.map, fromBundle.map);
  assert.deepEqual(fromSubpath.ids, fromSubpath.liveIds);
  assert.deepEqual(fromSubpath.ids, fromBundle.ids);
  assert.ok(fromSubpath.ids.every((id) => typeof id === "string" && id));
});

test("an ensure/exportMap/importMap round trip matches the generated vendor", () => {
  const fromSubpath = roundTrip(identity);
  const fromVendor = roundTrip(vendor);

  assert.deepEqual(fromVendor.map, fromSubpath.map);
  assert.deepEqual(fromVendor.ids, fromSubpath.liveIds);
});
