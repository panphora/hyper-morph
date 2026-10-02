import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDocument } from "../../src/index.js";
import { doc, parse } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

for (const fastPath of [false, true]) {
  for (const dirty of [false, true]) {
    for (const morphHooks of [false, true]) {
      test(`runtime head capture: fast=${fastPath}, dirty=${dirty}, hooks=${morphHooks}`, async () => {
        const base = doc(
          '<main id="m">base</main>',
          '<title>old</title><meta name="authored" content="delete">',
        );
        const local = dirty ? base.replace(">base<", ">LOCAL<") : base;
        const capture = parse(local);
        const live = parse(local);
        const map = lockstepMap(capture.documentElement, live.documentElement);
        const authored = live.head.querySelector('meta[name="authored"]');
        const runtime = live.createElement("meta");
        runtime.name = "runtime";
        runtime.content = "keep";
        live.head.append(runtime);
        await mergeDocument({
          live,
          base,
          remote: doc('<main id="m">base</main>', "<title>new</title>"),
          local: {
            root: capture.documentElement,
            toLive: (n) => map.get(n) || null,
          },
          fastPath,
          scripts: { execute: false },
          hooks: morphHooks
            ? { beforeNodeMorphed() {}, afterNodeMorphed() {} }
            : undefined,
        });
        assert.equal(live.head.querySelector('meta[name="runtime"]'), runtime);
        assert.equal(runtime.content, "keep");
        assert.equal(authored.isConnected, false);
        assert.equal(live.head.querySelector('meta[name="authored"]'), null);
        assert.equal(live.title, "new");
        assert.equal(
          live.getElementById("m").textContent,
          dirty ? "LOCAL" : "base",
        );
      });
    }
  }
}

test("a live document used as local still removes authored head tags", async () => {
  const base = doc(
    "<main>base</main>",
    '<meta name="authored" content="delete">',
  );
  const live = parse(base);
  await mergeDocument({
    live,
    base,
    remote: doc("<main>base</main>"),
    scripts: { execute: false },
  });
  assert.equal(live.head.querySelector('meta[name="authored"]'), null);
});
