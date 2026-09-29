import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, window } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { findScope } from "../../src/fast-path.js";
import * as scopeWork from "../../src/fast-path.js";
import { defaultIdentity } from "../../src/identity.js";

test("scope descent bounds repeated subtree comparisons on a deep chain", () => {
  const b = doc(
    "<main>" +
      "<div>".repeat(600) +
      "<p>old</p>" +
      "</div>".repeat(600) +
      "</main>",
  );
  const cap = parse(b),
    live = parse(b),
    remote = parse(b.replace(">old<", ">NEW<"));
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const original = window.Node.prototype.isEqualNode;
  let comparisons = 0;
  window.Node.prototype.isEqualNode = function (other) {
    comparisons++;
    return original.call(this, other);
  };
  try {
    const result = findScope({
      baseRoot: cap.documentElement,
      remoteRoot: remote.documentElement,
      liveRoot: live.documentElement,
      toLive: (n) => lock.get(n) || null,
      o: {
        ignored: () => false,
        remoteWins: () => false,
        ignoreAttribute: () => false,
        scripts: { merge: false },
      },
      identity: { base: defaultIdentity, remote: defaultIdentity },
      baseURI: live.baseURI,
    });
    assert.ok(result.scope);
    assert.ok(comparisons <= 18, `subtree comparisons: ${comparisons}`);
  } finally {
    window.Node.prototype.isEqualNode = original;
  }
});

for (const width of [2, 3])
  test(`scope descent bounds comparison work with ${width} sibling children`, () => {
    const depth = 600;
    const body =
      "<main>" +
      Array.from({ length: depth }, (_, i) => `<div id="d${i}">`).join("") +
      "<p>old</p>" +
      ("</div><aside>" + "<i></i>".repeat(width) + "</aside>").repeat(depth) +
      "</main>";
    const cap = parse(doc(body)),
      live = parse(doc(body)),
      remote = parse(doc(body.replace(">old<", ">NEW<")));
    const lock = lockstepMap(cap.documentElement, live.documentElement);
    const sizes = new Map();
    const size = (n) => {
      let total = 1;
      for (const c of n.childNodes) total += size(c);
      sizes.set(n, total);
      return total;
    };
    const count = size(cap.documentElement);
    const original = window.Node.prototype.isEqualNode;
    let work = 0;
    window.Node.prototype.isEqualNode = function (other) {
      work += sizes.get(this) || 1;
      return original.call(this, other);
    };
    if (scopeWork.steps) scopeWork.steps.compared = 0;
    try {
      const result = findScope({
        baseRoot: cap.documentElement,
        remoteRoot: remote.documentElement,
        liveRoot: live.documentElement,
        toLive: (n) => lock.get(n) || null,
        o: {
          ignored: () => false,
          remoteWins: () => false,
          ignoreAttribute: () => false,
          scripts: { merge: false },
        },
        identity: { base: defaultIdentity, remote: defaultIdentity },
        baseURI: live.baseURI,
      });
      assert.ok(result.scope);
      assert.ok(
        work <= count * 3,
        `native subtree work ${work}, nodes ${count}`,
      );
      assert.ok(
        scopeWork.steps.compared > 0 && scopeWork.steps.compared <= count,
        `explicit visits ${scopeWork.steps.compared}, nodes ${count}`,
      );
    } finally {
      window.Node.prototype.isEqualNode = original;
    }
  });

test("root-level fallback reuses the descent's article comparisons", async () => {
  const { mergeDocument } = await import("../../src/index.js");
  const body = Array.from(
    { length: 300 },
    (_, i) => `<article><h2>Title ${i}</h2><p>Words ${i}</p></article>`,
  ).join("");
  const cap = parse(doc(body)),
    live = parse(doc(body));
  const remote = parse(
    doc(
      body
        .replace("Title 298", "Title REMOTE")
        .replace("Title 299", "Title REMOTE"),
    ),
  );
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const counts = new Map();
  let rootComparisons = 0;
  const original = window.Node.prototype.isEqualNode;
  window.Node.prototype.isEqualNode = function (other) {
    if (this === cap.documentElement) rootComparisons++;
    if (this.tagName === "ARTICLE")
      counts.set(this, (counts.get(this) || 0) + 1);
    return original.call(this, other);
  };
  try {
    const report = await mergeDocument({
      live,
      base: cap,
      local: { root: cap.documentElement, toLive: (n) => lock.get(n) || null },
      remote,
      fastPath: true,
      scripts: { execute: false },
    });
    assert.equal(report.stats.fastPathFallback, "root-level");
    assert.equal(
      live.documentElement.outerHTML,
      remote.documentElement.outerHTML,
    );
    assert.equal(cap.body.querySelectorAll("article").length, 300);
    assert.equal(
      rootComparisons,
      0,
      "descent compared the whole page before scanning its children",
    );
    assert.equal(counts.size, 300);
    assert.ok(
      [...counts.values()].every((n) => n === 1),
      "alignment repeated the descent's article comparisons",
    );
    assert.ok(scopeWork.steps.compared > 0);
  } finally {
    window.Node.prototype.isEqualNode = original;
  }
});

test("equal pages keep the equal bail when a descendant identity changes", () => {
  const html = doc("<main><p>same</p></main><aside><h2>side</h2></aside>");
  for (const changed of ["BODY", "MAIN", "P"]) {
    const cap = parse(html),
      live = parse(html),
      remote = parse(html);
    const lock = lockstepMap(cap.documentElement, live.documentElement);
    const result = findScope({
      baseRoot: cap.documentElement,
      remoteRoot: remote.documentElement,
      liveRoot: live.documentElement,
      toLive: (n) => lock.get(n) || null,
      o: {
        ignored: () => false,
        remoteWins: () => false,
        ignoreAttribute: () => false,
        scripts: { merge: false },
      },
      identity: {
        base: (n) => n.tagName,
        remote: (n) => (n.tagName === changed ? "different" : n.tagName),
      },
      baseURI: live.baseURI,
    });
    assert.equal(result.bail, "equal", changed);
  }
});
