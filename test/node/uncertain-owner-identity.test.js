import assert from "node:assert/strict";
import { test } from "node:test";
import { merge3, mergeDocument, createIdentityStore } from "../../src/index.js";
import { indexByIdentity } from "../../src/identity.js";
import { parse, doc } from "./lib/dom.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const base = "<p>alpha beta</p><p>gamma delta</p>";
const moved = "<p>alpha beta gamma delta</p><p>gamma new</p>";
const edited = "<p>alpha beta</p><p>gamma DELTA</p>";
const spec = (source) => ({
  map: {
    "1.0": "session:owner",
    1.1: source,
    "~": "2,0,2,0,0",
    "^": "html,head,body,p,p",
  },
});

for (const [name, ids] of [
  ["shared across all inputs", ["source:one", "source:one", "source:one"]],
  ["shared only between sides", ["source:base", "source:one", "source:one"]],
  [
    "independent side identities",
    ["source:base", "source:local", "source:remote"],
  ],
])
  for (const mirror of [false, true])
    test(`uncertain owner identities: ${name}, mirror ${mirror}`, async () => {
      const local = mirror ? edited : moved;
      const remote = mirror ? moved : edited;
      const identity = {
        base: spec(ids[0]),
        local: spec(ids[1]),
        remote: spec(ids[2]),
      };
      const shared = ids[1] === ids[2];
      const expected =
        "<p>alpha beta gamma delta</p>" +
        (shared
          ? mirror
            ? "<p>gamma new</p>"
            : "<p>gamma DELTA</p>"
          : mirror
            ? "<p>gamma DELTA</p><p>gamma new</p>"
            : "<p>gamma new</p><p>gamma DELTA</p>");
      const b = parse(doc(base));
      const l = parse(doc(local));
      const r = parse(doc(remote));
      const pure = merge3(b, l, r, { identity });
      assert.equal(pure.doc.body.innerHTML, expected);
      assert.deepEqual(
        recoveryProblems(
          pure.conflicts,
          finalTree(pure.doc.documentElement),
          true,
          {
            base: b.documentElement,
            local: l.documentElement,
            remote: r.documentElement,
            merged: pure.doc.documentElement,
          },
        ),
        [],
      );
      const live = parse(doc(local));
      const owners = Array.from(live.body.children);
      const texts = owners.map((node) => node.firstChild);
      const store = createIdentityStore("fresh");
      store.adopt(owners[0], "session:owner");
      store.adopt(owners[1], ids[1]);
      const report = await mergeDocument({
        live,
        base: doc(base),
        remote: doc(remote),
        identity,
        fastPath: false,
        scripts: { execute: false },
      });
      for (const [node, id] of report.identities) store.adopt(node, id);
      assert.equal(live.body.innerHTML, expected);
      assert.equal(live.body.children[0], owners[0]);
      assert.equal(live.body.children[1], owners[1]);
      assert.equal(owners[0].firstChild, texts[0]);
      assert.equal(owners[1].firstChild, texts[1]);
      const exported = store.exportMap(live.documentElement, (node) => node);
      const outputIds = Array.from(live.body.children, store.idOf);
      assert.equal(outputIds.length, shared ? 2 : 3);
      assert.equal(new Set(outputIds).size, outputIds.length);
      assert.equal(outputIds[1], ids[1]);
      if (!shared) assert.equal(outputIds[2], ids[2]);
      assert.equal(exported["1.1"], ids[1]);
      if (!shared) assert.equal(exported["1.2"], ids[2]);
      const dropped = new Set();
      const index = indexByIdentity(
        live.documentElement,
        store.idOf,
        () => false,
        null,
        dropped,
      );
      assert.equal(index.get(ids[1]), owners[1]);
      if (!shared) assert.equal(index.get(ids[2]), live.body.children[2]);
      assert.deepEqual([...dropped], []);
      assert.deepEqual(
        recoveryProblems(
          report.conflicts,
          finalTree(live.documentElement),
          false,
        ),
        [],
      );
    });
