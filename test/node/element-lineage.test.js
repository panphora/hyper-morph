// Element lineage: where each watched live element's region went in one
// apply. Every positive case names the exact live objects, so a producer
// that reports nothing, or only unknown, fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, doc, window } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import {
  mergeDocument,
  morphDocument,
  morphElement,
  merge3,
} from "../../src/index.js";
import { planLineage, createLineageRecorder } from "../../src/lineage.js";

// form "clean": base and local one captured tree with the fast path, as a
// clean ClayJS tab merges; "dirty": a separate base and a captured local;
// "plain": no capture, the live document is local.
async function run({
  form = "clean",
  base,
  local,
  remote,
  watch,
  hooks,
  beforeApply,
  lineage = true,
}) {
  const live = parse(doc(local));
  const watched = watch ? watch(live) : [];
  const opts = {
    live,
    remote: parse(doc(remote)),
    scripts: { execute: false },
  };
  if (hooks) opts.hooks = hooks;
  if (beforeApply) opts.beforeApply = beforeApply;
  let result = null,
    calls = 0;
  if (lineage)
    opts.lineage = {
      elements: watched,
      onResult: (r) => {
        calls++;
        result = r;
      },
    };
  if (form === "plain") opts.base = parse(doc(base ?? local));
  else {
    const cap = parse(doc(local));
    const map = lockstepMap(cap.documentElement, live.documentElement);
    opts.local = {
      root: cap.documentElement,
      toLive: (n) => map.get(n) || null,
    };
    if (form === "clean") {
      opts.base = cap;
      opts.fastPath = true;
    } else opts.base = parse(doc(base));
  }
  const pending = mergeDocument(opts);
  const callsBeforeAwait = calls;
  const report = await pending;
  const of = (el) => result.entries.find((e) => e.from === el);
  return { live, watched, result, report, calls, callsBeforeAwait, of };
}

const P2 = "<p>One fast fox.</p><p>Two wild dogs.</p>";
const H3 = "<p>One fast fox.</p><h3>Two wild dogs.</h3>";

test("clean retag: the removed paragraph's region is the new heading", async () => {
  const r = await run({
    local: P2,
    remote: H3,
    watch: (l) => [...l.body.children],
  });
  const [p1, p2] = r.watched;
  const h3 = r.live.querySelector("h3");
  assert.equal(r.callsBeforeAwait, 1, "delivered before the resource wait");
  assert.equal(r.calls, 1);
  assert.equal(r.report.lineage, r.result);
  assert.equal(r.result.status, "complete");
  assert.deepEqual(r.of(p2), {
    from: p2,
    to: [h3],
    kind: "replaced",
    complete: true,
  });
  assert.deepEqual(r.of(p1), {
    from: p1,
    to: [p1],
    kind: "retained",
    complete: true,
  });
  assert.equal(p2.isConnected, false);
});

test("clean retag with an unrelated edit in the same frame", async () => {
  const r = await run({
    local: P2,
    remote: "<p>One fast fox changed.</p><h3>Two wild dogs.</h3>",
    watch: (l) => [...l.body.children],
  });
  const [p1, p2] = r.watched;
  assert.deepEqual(r.of(p2).to, [r.live.querySelector("h3")]);
  assert.equal(r.of(p2).kind, "replaced");
  assert.deepEqual(r.of(p1), {
    from: p1,
    to: [p1],
    kind: "retained",
    complete: true,
  });
});

test("duplicate sibling text: the removed paragraph links, the kept one stays", async () => {
  const r = await run({
    local: "<p>Two wild dogs.</p><p>Two wild dogs.</p>",
    remote: "<p>Two wild dogs.</p><h3>Two wild dogs.</h3>",
    watch: (l) => [...l.body.children],
  });
  const kept = r.watched.find((p) => p.isConnected);
  const gone = r.watched.find((p) => !p.isConnected);
  assert.ok(kept && gone);
  assert.deepEqual(r.of(gone).to, [r.live.querySelector("h3")]);
  assert.equal(r.of(gone).kind, "replaced");
  assert.deepEqual(r.of(kept), {
    from: kept,
    to: [kept],
    kind: "retained",
    complete: true,
  });
});

test("wrapper retag: children move into the new wrapper", async () => {
  const r = await run({
    local: "<main><div><p>A one.</p><p>B two.</p></div></main>",
    remote: "<main><section><p>A one.</p><p>B two.</p></section></main>",
    watch: (l) => [l.querySelector("div"), ...l.querySelectorAll("p")],
  });
  const [div, pa, pb] = r.watched;
  const section = r.live.querySelector("section");
  assert.equal(r.report.stats.fastPathTaken, 1);
  assert.deepEqual(r.of(div), {
    from: div,
    to: [section],
    kind: "replaced",
    complete: true,
  });
  assert.deepEqual(r.of(pa).to, [pa]);
  assert.deepEqual(r.of(pb).to, [pb]);
  assert.ok(section.contains(pa) && section.contains(pb));
});

test("wrapper retag while one child moves elsewhere: refused", async () => {
  const r = await run({
    local: "<main><div><p>A one.</p><p>B two.</p></div><aside></aside></main>",
    remote:
      "<main><section><p>A one.</p></section><aside><p>B two.</p></aside></main>",
    watch: (l) => [l.querySelector("div"), ...l.querySelectorAll("p")],
  });
  const [div, , pb] = r.watched;
  assert.deepEqual(r.of(div), {
    from: div,
    to: [],
    kind: "unknown",
    complete: false,
  });
  assert.deepEqual(r.of(pb).to, [pb]);
});

test("indented markup: whitespace runs between blocks", async () => {
  const r = await run({
    local:
      "<header>Top</header><main>\n  <p>One fast fox.</p>\n  <p>Two wild dogs.</p>\n</main>",
    remote:
      "<header>Top</header><main>\n  <p>One fast fox.</p>\n  <h3>Two wild dogs.</h3>\n</main>",
    watch: (l) => [...l.querySelectorAll("main p")],
  });
  const [p1, p2] = r.watched;
  assert.deepEqual(r.of(p2).to, [r.live.querySelector("h3")]);
  assert.equal(r.of(p2).kind, "replaced");
  assert.deepEqual(r.of(p1).to, [p1]);
});

test("dirty frame retag with an unrelated local edit", async () => {
  const r = await run({
    form: "dirty",
    base: P2,
    local: "<p>One quick fox.</p><p>Two wild dogs.</p>",
    remote: H3,
    watch: (l) => [...l.body.children],
  });
  const [p1, p2] = r.watched;
  assert.deepEqual(r.of(p2), {
    from: p2,
    to: [r.live.querySelector("h3")],
    kind: "replaced",
    complete: true,
  });
  assert.deepEqual(r.of(p1).to, [p1]);
});

test("not a retag: changed text, another element in the gap, two removals", async () => {
  for (const remote of [
    "<p>One fast fox.</p><h3>Two wild cats.</h3>",
    "<p>One fast fox.</p><h3>Two wild dogs.</h3><hr><p>Three.</p>",
  ]) {
    const local = remote.includes("Three") ? P2 + "<p>Three.</p>" : P2;
    const r = await run({ local, remote, watch: (l) => [l.body.children[1]] });
    assert.equal(r.of(r.watched[0]).kind, "removed", remote);
  }
  const r = await run({
    local:
      "<p>One fast fox.</p><p>Two wild dogs.</p><p>Extra words here.</p><p>Four.</p>",
    remote: "<p>One fast fox.</p><h3>Two wild dogs.</h3><p>Four.</p>",
    watch: (l) => [l.body.children[1]],
  });
  assert.equal(r.of(r.watched[0]).kind, "removed");
});

test("local edit of the retagged paragraph: not claimed as a retag", async () => {
  const r = await run({
    form: "dirty",
    base: P2,
    local: "<p>One fast fox.</p><p>Two tame dogs.</p>",
    remote: H3,
    watch: (l) => [l.body.children[1]],
  });
  assert.equal(r.of(r.watched[0]).kind, "unknown");
});

test("split and combination are never a complete single region", async () => {
  const split = await run({
    form: "dirty",
    base: "<p>One fast fox.</p><p>Two wild dogs ran far away.</p>",
    local: "<p>One quick fox.</p><p>Two wild dogs ran far away.</p>",
    remote: "<p>One fast fox.</p><p>Two wild dogs</p><p>ran far away.</p>",
    watch: (l) => [l.body.children[1]],
  });
  assert.equal(split.live.body.children.length, 3);
  assert.equal(split.of(split.watched[0]).kind, "unknown");
  const joined = await run({
    form: "dirty",
    base: "<p>One fast fox.</p><p>Two wild dogs.</p><p>Three.</p>",
    local: "<p>One fast fox.</p><p>Two wild dogs.</p><p>Three!</p>",
    remote: "<p>One fast fox. Two wild dogs.</p><p>Three.</p>",
    watch: (l) => [...l.body.children],
  });
  const [p1, p2] = joined.watched;
  assert.equal(joined.of(p2).kind, "unknown");
  assert.deepEqual(joined.of(p1).to, [p1]);
});

test("confirmed removal", async () => {
  const r = await run({
    local: P2,
    remote: "<p>One fast fox.</p>",
    watch: (l) => [l.body.children[1]],
  });
  assert.deepEqual(r.of(r.watched[0]), {
    from: r.watched[0],
    to: [],
    kind: "removed",
    complete: true,
  });
});

test("hook escapes and vetoes downgrade to unknown", async () => {
  let moved = false;
  const a = await run({
    local: "<p>One <b>bold</b> fox.</p><p>Other.</p>",
    remote: "<p>One <b>bold</b> fox!</p><p>Other.</p>",
    watch: (l) => [l.querySelector("p")],
    hooks: {
      afterNodeMorphed: (el) => {
        if (!moved && el.tagName === "P" && el.querySelector("b")) {
          moved = true;
          el.ownerDocument.body.lastChild.appendChild(el.querySelector("b"));
        }
      },
    },
  });
  assert.ok(moved);
  assert.equal(a.of(a.watched[0]).kind, "unknown");
  const b = await run({
    local: P2,
    remote: H3,
    watch: (l) => [l.body.children[1]],
    hooks: {
      afterNodeAdded: (n) => {
        if (n.nodeType === 1 && n.tagName === "H3")
          n.ownerDocument.body.firstChild.appendChild(n.firstChild);
      },
    },
  });
  assert.equal(b.of(b.watched[0]).kind, "unknown");
  const c = await run({
    local: P2,
    remote: H3,
    watch: (l) => [l.body.children[1]],
    hooks: {
      beforeNodeRemoved: (n) =>
        n.nodeType === 1 && n.tagName === "P" ? false : undefined,
    },
  });
  assert.equal(c.of(c.watched[0]).kind, "unknown");
});

test("review region evidence: a beforeApply child move cannot certify the wrapper", async () => {
  const html =
    "<section><p>Important content</p></section><aside>outside</aside><footer>old</footer>";
  const remote = html.replace("old</footer>", "new</footer>");
  for (const form of ["plain", "clean"]) {
    let aside = null,
      p = null,
      called = false;
    const r = await run({
      form,
      local: html,
      remote,
      watch: (l) => {
        aside = l.querySelector("aside");
        p = l.querySelector("p");
        return [l.querySelector("section"), p];
      },
      beforeApply: () => {
        called = true;
        aside.append(p);
      },
    });
    const [section] = r.watched;
    assert.equal(called, true, form);
    assert.equal(p.isConnected, true, form);
    assert.equal(section.contains(p), false, form);
    assert.deepEqual(
      r.of(section),
      { from: section, to: [], kind: "unknown", complete: false },
      form,
    );
    const control = await run({
      form,
      local: html,
      remote,
      watch: (l) => [l.querySelector("section"), l.querySelector("p")],
    });
    const [kept] = control.watched;
    assert.deepEqual(
      control.of(kept),
      { from: kept, to: [kept], kind: "retained", complete: true },
      form,
    );
  }
});

test("review region evidence: an escape after a proven transfer leaves the target unknown", async () => {
  const html = "<p>One fast fox.</p><p>Two wild dogs.</p><aside>Other.</aside>";
  const retag =
    "<p>One fast fox.</p><h3>Two wild dogs.</h3><aside>Other.</aside>";
  const live = parse(doc(html));
  const p2 = live.body.children[1];
  let first = null;
  await mergeDocument({
    live,
    base: parse(doc(html)),
    remote: parse(doc(retag)),
    scripts: { execute: false },
    lineage: { elements: [p2], onResult: (r) => (first = r) },
  });
  const h3 = live.querySelector("h3");
  assert.deepEqual(first.entries, [
    { from: p2, to: [h3], kind: "replaced", complete: true },
  ]);
  const text = h3.firstChild;
  const after = doc(live.body.innerHTML);
  let second = null,
    called = false;
  await mergeDocument({
    live,
    base: parse(after),
    remote: parse(after),
    scripts: { execute: false },
    beforeApply: () => {
      called = true;
      live.querySelector("aside").append(text);
    },
    lineage: { elements: [h3], onResult: (r) => (second = r) },
  });
  assert.equal(called, true);
  assert.equal(text.parentNode, live.querySelector("aside"));
  assert.equal(h3.contains(text), false);
  assert.deepEqual(second.entries, [
    { from: h3, to: [], kind: "unknown", complete: false },
  ]);
});

test("review region evidence: a morphElement hook escape is not certified", async () => {
  const live = parse(
    doc('<div id="x"><p>A one.</p></div><aside>Other.</aside>'),
  );
  const old = live.getElementById("x");
  const p = old.firstChild;
  let called = false,
    res = null;
  await morphElement(old, '<section id="x"><p>A one.</p></section>', {
    scripts: { execute: false },
    hooks: {
      beforeNodeMorphed: () => {
        called = true;
        live.querySelector("aside").append(p);
      },
    },
    lineage: { elements: [old, p], onResult: (r) => (res = r) },
  });
  const section = live.querySelector("section");
  assert.equal(called, true);
  assert.equal(p.parentNode, live.querySelector("aside"));
  assert.equal(section.contains(p), false);
  assert.equal(res.root, section);
  assert.deepEqual(res.entries, [
    { from: old, to: [], kind: "unknown", complete: false },
    { from: p, to: [], kind: "unknown", complete: false },
  ]);

  const two = parse(
    doc('<div id="x"><p>A one.</p></div><aside>Other.</aside>'),
  );
  const div = two.getElementById("x");
  const q = div.firstChild;
  let moved = false,
    same = null;
  await morphElement(div, '<div id="x"><p>A one.</p></div>', {
    scripts: { execute: false },
    beforeApply: () => {
      moved = true;
      two.querySelector("aside").append(q);
    },
    lineage: { elements: [div, q], onResult: (r) => (same = r) },
  });
  assert.equal(moved, true);
  assert.equal(q.parentNode, two.querySelector("aside"));
  assert.equal(q.isConnected, true);
  assert.equal(same.root, div);
  assert.deepEqual(same.entries, [
    { from: div, to: [], kind: "unknown", complete: false },
    { from: q, to: [], kind: "unknown", complete: false },
  ]);
});

test("review region evidence: a removed leaf still connected outside the root is unknown", async () => {
  const live = parse(doc("<div><p></p></div><aside></aside>"));
  const root = live.querySelector("div");
  const watched = root.querySelector("p");
  const aside = live.querySelector("aside");
  let moved = false,
    result = null;
  await morphElement(root, "<div></div>", {
    scripts: { execute: false },
    hooks: {
      beforeNodeRemoved(node) {
        if (node === watched) {
          moved = true;
          aside.append(node);
          return false;
        }
      },
    },
    lineage: { elements: [watched], onResult: (r) => (result = r) },
  });
  assert.equal(moved, true);
  assert.equal(watched.parentNode, aside);
  assert.equal(watched.isConnected, true);
  assert.equal(root.childNodes.length, 0);
  assert.deepEqual(result.entries, [
    { from: watched, to: [], kind: "unknown", complete: false },
  ]);
});

test("morphElement root swap reports the fresh element", async () => {
  const live = parse(doc("<div id=x><p>A one.</p></div>"));
  const old = live.getElementById("x");
  const p = old.firstChild;
  let res = null;
  await morphElement(old, "<section id=x><p>A one.</p></section>", {
    scripts: { execute: false },
    lineage: { elements: [old, p], onResult: (r) => (res = r) },
  });
  const section = live.querySelector("section");
  assert.equal(res.root, section);
  assert.deepEqual(res.entries.find((e) => e.from === old).to, [section]);
  assert.equal(res.entries.find((e) => e.from === old).kind, "replaced");
  assert.deepEqual(res.entries.find((e) => e.from === p).to, [p]);
});

test("a throw after mutation delivers one incomplete result", () => {
  const live = parse(doc(P2));
  const got = [];
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(doc(P2)),
        remote: parse(doc(H3)),
        scripts: { execute: false },
        hooks: {
          afterNodeAdded: () => {
            throw new Error("boom");
          },
        },
        lineage: {
          elements: [live.body.children[1]],
          onResult: (r, rep) => got.push([r.status, rep]),
        },
      }),
    /boom/,
  );
  assert.deepEqual(got, [["incomplete", null]]);
});

test("a pure merge3 result carries no lineage property", () => {
  const result = merge3(
    parse(doc("<p>a</p>")),
    parse(doc("<p>a</p>")),
    parse(doc("<p>b</p>")),
  );
  assert.equal(Object.hasOwn(result, "lineage"), false);
});

test("an outer tag swap that throws after mutation delivers one incomplete result", () => {
  for (const hook of ["afterNodeRemoved", "afterNodeAdded"]) {
    const live = parse(doc('<div id="x"><p>A one.</p></div>'));
    const old = live.getElementById("x");
    const boom = new Error(`${hook}-boom`);
    const got = [];
    assert.throws(
      () =>
        morphElement(old, '<section id="x"><p>A one.</p></section>', {
          scripts: { execute: false },
          hooks: {
            [hook]: () => {
              throw boom;
            },
          },
          lineage: {
            elements: [old, old.firstChild],
            onResult: (r, rep) => got.push([r.status, rep]),
          },
        }),
      (e) => e === boom,
      hook,
    );
    assert.deepEqual(got, [["incomplete", null]], hook);
    assert.equal(
      live.body.innerHTML,
      '<section id="x"><p>A one.</p></section>',
      hook,
    );
  }
});

test("a removal that throws after mutation delivers one incomplete result", () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const boom = new Error("remove-boom");
  const got = [];
  assert.throws(
    () =>
      morphElement(old, "", {
        scripts: { execute: false },
        hooks: {
          afterNodeRemoved: () => {
            throw boom;
          },
        },
        lineage: {
          elements: [old],
          onResult: (r, rep) => got.push([r.status, rep]),
        },
      }),
    (e) => e === boom,
  );
  assert.deepEqual(got, [["incomplete", null]]);
  assert.equal(old.isConnected, false);
  assert.equal(live.body.innerHTML, "");
});

test("a doctype change before a throwing beforeApply delivers one incomplete result", () => {
  const live = parse(frame(HTML4, "<p>a</p>"));
  const watched = [live.documentElement, live.body.firstChild];
  const boom = new Error("beforeApply-boom");
  const got = [];
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(frame(HTML4, "<p>a</p>")),
        remote: parse(frame(PUB, "<p>b</p>")),
        scripts: { execute: false },
        beforeApply: () => {
          throw boom;
        },
        lineage: {
          elements: watched,
          onResult: (r, rep) => got.push([r, rep]),
        },
      }),
    (e) => e === boom,
  );
  assert.equal(got.length, 1);
  const [result, report] = got[0];
  assert.equal(result.status, "incomplete");
  assert.equal(report, null);
  assert.deepEqual(
    result.entries,
    watched.map((el) => ({
      from: el,
      to: [],
      kind: "unknown",
      complete: false,
    })),
  );
  assert.equal(live.doctype.publicId, "example");
});

test("an outer tag hook that mutates then throws delivers one incomplete result", () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const child = old.firstChild;
  const boom = new Error("tag-hook-boom");
  const got = [];
  assert.throws(
    () =>
      morphElement(old, '<section id="x"><p>A one.</p></section>', {
        scripts: { execute: false },
        hooks: {
          beforeNodeMorphed: (el) => {
            el.setAttribute("data-changed", "yes");
            throw boom;
          },
        },
        lineage: {
          elements: [old, child],
          onResult: (r, rep) => got.push([r, rep]),
        },
      }),
    (e) => e === boom,
  );
  assert.equal(got.length, 1);
  const [result, report] = got[0];
  assert.equal(result.status, "incomplete");
  assert.equal(report, null);
  assert.deepEqual(
    result.entries,
    [old, child].map((el) => ({
      from: el,
      to: [],
      kind: "unknown",
      complete: false,
    })),
  );
  assert.equal(old.getAttribute("data-changed"), "yes");
  assert.ok(old.isConnected);
});

test("an ignored root whose ignore function mutates then throws delivers one incomplete result", () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const boom = new Error("ignore-boom");
  const got = [];
  assert.throws(
    () =>
      morphElement(old, '<section id="x"><p>A one.</p></section>', {
        scripts: { execute: false },
        ignore: (el) => {
          el.setAttribute("data-touched", "yes");
          throw boom;
        },
        lineage: {
          elements: [old],
          onResult: (r, rep) => got.push([r, rep]),
        },
      }),
    (e) => e === boom,
  );
  assert.equal(got.length, 1);
  const [result, report] = got[0];
  assert.equal(result.status, "incomplete");
  assert.equal(report, null);
  assert.deepEqual(result.entries, [
    { from: old, to: [], kind: "unknown", complete: false },
  ]);
  assert.equal(old.getAttribute("data-touched"), "yes");
});

test("a successful callback that throws propagates once, with no second callback", () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const boom = new Error("callback-boom");
  let calls = 0;
  assert.throws(
    () =>
      morphElement(old, '<section id="x"><p>A one.</p></section>', {
        scripts: { execute: false },
        lineage: {
          elements: [old],
          onResult: () => {
            calls++;
            throw boom;
          },
        },
      }),
    (e) => e === boom,
  );
  assert.equal(calls, 1);
  assert.equal(live.body.innerHTML, '<section id="x"><p>A one.</p></section>');
});

test("an apply hook's error wins over a throwing incomplete callback", () => {
  const live = parse(doc(P2));
  const a = new Error("A-boom");
  const b = new Error("B-boom");
  let calls = 0;
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(doc(P2)),
        remote: parse(doc(H3)),
        scripts: { execute: false },
        hooks: {
          afterNodeAdded: () => {
            throw a;
          },
        },
        lineage: {
          elements: [live.body.children[1]],
          onResult: () => {
            calls++;
            throw b;
          },
        },
      }),
    (e) => e === a,
  );
  assert.equal(calls, 1);
});

test("no watched locals: the callback still runs once", async () => {
  const empty = await run({ local: P2, remote: H3 });
  assert.equal(empty.calls, 1);
  assert.equal(empty.result.status, "complete");
  assert.deepEqual(empty.result.entries, []);
  assert.ok(empty.live.querySelector("h3"));
  const detached = await run({
    local: P2,
    remote: H3,
    watch: (l) => [l.createElement("p")],
  });
  const [ghost] = detached.watched;
  assert.equal(detached.calls, 1);
  assert.deepEqual(detached.of(ghost), {
    from: ghost,
    to: [],
    kind: "unknown",
    complete: false,
  });
});

test("validation: merge3 refuses lineage; a foreign element throws before any callback", () => {
  assert.throws(
    () =>
      merge3(
        parse(doc("<p>a</p>")),
        parse(doc("<p>a</p>")),
        parse(doc("<p>b</p>")),
        { lineage: { elements: [], onResult() {} } },
      ),
    TypeError,
  );
  const live = parse(doc("<p>a</p>"));
  let calls = 0;
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(doc("<p>a</p>")),
        remote: parse(doc("<p>b</p>")),
        scripts: { execute: false },
        lineage: {
          elements: [parse(doc("<p>x</p>")).body.firstChild],
          onResult: () => calls++,
        },
      }),
    TypeError,
  );
  assert.equal(calls, 0);
  assert.equal(live.body.innerHTML, "<p>a</p>");
});

const PUB = '<!DOCTYPE html PUBLIC "example">';
const HTML4 =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">';
const frame = (doctype, body) =>
  `${doctype}<html><head></head><body>${body}</body></html>`;
const snapshot = (d) => ({
  name: d.doctype.name,
  publicId: d.doctype.publicId,
  systemId: d.doctype.systemId,
  html: d.documentElement.outerHTML,
});

test("a foreign watched element throws before the doctype changes", () => {
  const live = parse(frame(HTML4, "<p>a</p>"));
  const before = snapshot(live);
  let calls = 0;
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(frame(HTML4, "<p>a</p>")),
        remote: parse(frame(PUB, "<p>b</p>")),
        scripts: { execute: false },
        lineage: {
          elements: [parse(frame(HTML4, "<p>x</p>")).body.firstChild],
          onResult: () => calls++,
        },
      }),
    TypeError,
  );
  assert.equal(calls, 0);
  assert.deepEqual(snapshot(live), before);
});

test("malformed lineage throws before the doctype changes", () => {
  const malformed = [
    null,
    { elements: [] },
    { elements: { length: -1 }, onResult() {} },
    { elements: { length: 0.5 }, onResult() {} },
  ];
  for (const lineage of malformed) {
    const live = parse(frame(HTML4, "<p>a</p>"));
    const before = snapshot(live);
    assert.throws(
      () =>
        mergeDocument({
          live,
          base: parse(frame(HTML4, "<p>a</p>")),
          remote: parse(frame(PUB, "<p>b</p>")),
          scripts: { execute: false },
          lineage,
        }),
      TypeError,
      JSON.stringify(lineage),
    );
    assert.deepEqual(snapshot(live), before, JSON.stringify(lineage));
  }
});

test("morphElement: a foreign watched element throws before the tag-swap hook", () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const before = live.documentElement.outerHTML;
  let hooks = 0;
  let calls = 0;
  assert.throws(
    () =>
      morphElement(old, '<section id="x"><p>A one.</p></section>', {
        scripts: { execute: false },
        hooks: {
          beforeNodeMorphed: (el) => {
            hooks++;
            el.setAttribute("data-morphed", "");
          },
        },
        lineage: {
          elements: [parse(doc("<p>x</p>")).body.firstChild],
          onResult: () => calls++,
        },
      }),
    TypeError,
  );
  assert.equal(hooks, 0);
  assert.equal(calls, 0);
  assert.equal(live.documentElement.outerHTML, before);
});

test("a repeated watch is one entry per distinct object", async () => {
  const live = parse(doc(P2));
  const p2 = live.body.children[1];
  let result = null;
  let calls = 0;
  await mergeDocument({
    live,
    base: parse(doc(P2)),
    remote: parse(doc(H3)),
    scripts: { execute: false },
    lineage: {
      elements: [p2, p2, p2],
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.entries, [
    {
      from: p2,
      to: [live.querySelector("h3")],
      kind: "replaced",
      complete: true,
    },
  ]);
});

test("an array-like elements list works", async () => {
  const live = parse(doc(P2));
  const p2 = live.body.children[1];
  let result = null;
  let calls = 0;
  await mergeDocument({
    live,
    base: parse(doc(P2)),
    remote: parse(doc(H3)),
    scripts: { execute: false },
    lineage: {
      elements: { 0: p2, length: 1 },
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.entries, [
    {
      from: p2,
      to: [live.querySelector("h3")],
      kind: "replaced",
      complete: true,
    },
  ]);
});

test("a template's contents: the watch is accepted and stays unknown", async () => {
  const live = parse(doc("<template><p>Hi</p></template>"));
  const p = live.querySelector("template").content.querySelector("p");
  let calls = 0,
    result = null;
  const report = await mergeDocument({
    live,
    base: parse(doc("<template><p>Hi</p></template>")),
    remote: parse(doc("<template><p>Hi changed</p></template>")),
    scripts: { execute: false },
    lineage: {
      elements: [p],
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.lineage, result);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.entries, [
    { from: p, to: [], kind: "unknown", complete: false },
  ]);
});

test("a nested template's contents: the watch is accepted and stays unknown", async () => {
  const html = "<template><div><template><p>Hi</p></template></div></template>";
  const live = parse(doc(html));
  const p = live
    .querySelector("template")
    .content.querySelector("template")
    .content.querySelector("p");
  let calls = 0,
    result = null;
  await mergeDocument({
    live,
    base: parse(doc(html)),
    remote: parse(doc(html)),
    scripts: { execute: false },
    lineage: {
      elements: [p],
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.entries, [
    { from: p, to: [], kind: "unknown", complete: false },
  ]);
});

test("review region evidence: template content escaping an unchanged ancestor", async () => {
  const html =
    "<article>Other.</article><section><template><p>Protected words.</p></template></section>";
  let escaped = null,
    article = null,
    called = false;
  const r = await run({
    form: "dirty",
    base: html,
    local: html,
    remote: html + "<hr>",
    watch: (l) => {
      escaped = l.querySelector("template").content.firstChild;
      article = l.querySelector("article");
      return [
        l.querySelector("section"),
        l.querySelector("template"),
        escaped,
        article,
      ];
    },
    hooks: {
      afterNodeAdded: (n) => {
        if (n.nodeType === 1 && n.tagName === "HR") {
          called = true;
          article.append(escaped);
        }
      },
    },
  });
  const [section, template] = r.watched;
  assert.equal(called, true);
  assert.equal(escaped.parentNode, article);
  assert.equal(section.contains(escaped), false);
  assert.deepEqual(r.of(section), {
    from: section,
    to: [],
    kind: "unknown",
    complete: false,
  });
  assert.deepEqual(r.of(template), {
    from: template,
    to: [],
    kind: "unknown",
    complete: false,
  });
  assert.deepEqual(r.of(escaped), {
    from: escaped,
    to: [],
    kind: "unknown",
    complete: false,
  });
  assert.deepEqual(r.of(article), {
    from: article,
    to: [article],
    kind: "retained",
    complete: true,
  });

  const nested =
    "<article>Other.</article><section><div><template><p>Deep words.</p></template></div></section>";
  let inert = null,
    holder = null;
  const n = await run({
    form: "dirty",
    base: nested,
    local: nested,
    remote: nested + "<hr>",
    watch: (l) => {
      inert = l.querySelector("template").content.firstChild;
      holder = l.querySelector("article");
      return [
        l.querySelector("section"),
        l.querySelector("div"),
        l.querySelector("template"),
        inert,
        holder,
      ];
    },
    hooks: {
      afterNodeAdded: (node) => {
        if (node.nodeType === 1 && node.tagName === "HR") holder.append(inert);
      },
    },
  });
  const [outer, inner, nestedTemplate] = n.watched;
  assert.equal(inert.parentNode, holder);
  for (const [el, name] of [
    [outer, "outer element"],
    [inner, "inner element"],
    [nestedTemplate, "nested template"],
    [inert, "inert paragraph"],
  ])
    assert.deepEqual(
      n.of(el),
      { from: el, to: [], kind: "unknown", complete: false },
      name,
    );
  assert.deepEqual(n.of(holder), {
    from: holder,
    to: [holder],
    kind: "retained",
    complete: true,
  });
});

test("a foreign document's template element still throws before the callback", () => {
  const live = parse(doc("<template><p>Hi</p></template>"));
  const before = live.documentElement.outerHTML;
  const foreign = parse(doc("<template><p>x</p></template>"));
  const foreignP = foreign.querySelector("template").content.querySelector("p");
  let calls = 0;
  assert.throws(
    () =>
      mergeDocument({
        live,
        base: parse(doc("<template><p>Hi</p></template>")),
        remote: parse(doc("<template><p>Hi changed</p></template>")),
        scripts: { execute: false },
        lineage: { elements: [foreignP], onResult: () => calls++ },
      }),
    TypeError,
  );
  assert.equal(calls, 0);
  assert.equal(live.documentElement.outerHTML, before);
});

test("morphElement on an ignored root: once complete, all unknown, no change", async () => {
  const live = parse(doc('<div id="x"><p>A one.</p></div>'));
  const old = live.getElementById("x");
  const before = live.documentElement.outerHTML;
  let calls = 0,
    result = null;
  const report = await morphElement(
    old,
    '<section id="x"><p>B two.</p></section>',
    {
      scripts: { execute: false },
      ignore: (el) => el.id === "x",
      lineage: {
        elements: [old],
        onResult: (r) => {
          calls++;
          result = r;
        },
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "complete");
  assert.equal(report.lineage, result);
  assert.deepEqual(result.entries, [
    { from: old, to: [], kind: "unknown", complete: false },
  ]);
  assert.equal(live.documentElement.outerHTML, before);
});

test("morphDocument: same callback contract and a positive retag target", async () => {
  const live = parse(doc(P2));
  const p2 = live.body.children[1];
  let calls = 0,
    result = null;
  const pending = morphDocument(live, parse(doc(H3)), {
    scripts: { execute: false },
    lineage: {
      elements: [p2],
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1, "delivered before the caller awaits");
  const report = await pending;
  assert.equal(calls, 1);
  assert.equal(report.lineage, result);
  assert.deepEqual(result.entries, [
    {
      from: p2,
      to: [live.querySelector("h3")],
      kind: "replaced",
      complete: true,
    },
  ]);
});

test("the callback runs before the returned promise waits for a script load", async () => {
  const live = parse(doc(P2));
  const p2 = live.body.children[1];
  let calls = 0,
    result = null;
  const pending = mergeDocument({
    live,
    base: parse(doc(P2)),
    remote: parse(
      doc(
        '<p>One fast fox.</p><h3>Two wild dogs.</h3><script src="/lineage-fixture.js"></script>',
      ),
    ),
    lineage: {
      elements: [p2],
      onResult: (r) => {
        calls++;
        result = r;
      },
    },
  });
  assert.equal(calls, 1);
  const h3 = live.querySelector("h3");
  assert.deepEqual(result.entries, [
    { from: p2, to: [h3], kind: "replaced", complete: true },
  ]);
  let settled = false;
  const done = pending.then((report) => {
    settled = true;
    return report;
  });
  await Promise.resolve();
  assert.equal(settled, false, "still waiting on the script");
  const script = live.querySelector("script[src='/lineage-fixture.js']");
  assert.ok(script);
  script.dispatchEvent(new window.Event("load"));
  const report = await done;
  assert.equal(calls, 1);
  assert.equal(report.lineage, result);
});

// planLineage on hand-built merge results: each guard on its own.
const plan = (
  locals,
  root,
  provenance,
  rec = createLineageRecorder(),
  segments = [],
) =>
  planLineage({
    locals,
    rec,
    root,
    provenance,
    segments,
    ignored: () => false,
  });

test("plan: missing mapping is unknown, a confirmed removal is removed", () => {
  const L = parse(doc("<div><p>x</p></div>")).body,
    M = parse(doc("<div></div>")).body;
  const p = L.querySelector("p");
  const provenance = new WeakMap([[M.firstChild, { local: L.firstChild }]]);
  const rec = createLineageRecorder();
  assert.deepEqual(plan([p], M, provenance, rec).get(p), {
    kind: "unknown",
    reason: "unmapped",
  });
  rec.remove(p);
  assert.equal(plan([p], M, provenance, rec).get(p).kind, "removed");
});

test("plan: a child output outside the watched output escapes", () => {
  const L = parse(doc("<div><p>a</p><p>b</p></div>")).body,
    M = parse(doc("<div><p>a</p></div><aside><p>b</p></aside>")).body;
  const [div] = L.children,
    [pa, pb] = div.children;
  const provenance = new WeakMap([
    [M.firstChild, { local: div }],
    [M.firstChild.firstChild, { local: pa }],
    [M.firstChild.firstChild.firstChild, { local: [pa.firstChild] }],
    [M.querySelector("aside p"), { local: pb }],
    [M.querySelector("aside p").firstChild, { local: [pb.firstChild] }],
  ]);
  assert.deepEqual(plan([div], M, provenance).get(div), {
    kind: "unknown",
    reason: "escaped",
  });
});

test("plan: inline text ownership reads exact character origins", () => {
  const L = parse(doc("<p>abc</p><p>xyz</p>")).body,
    M = parse(doc("<p>q</p><p>xyz</p>")).body;
  const [p1, p2] = L.children,
    [m1, m2] = M.children;
  const provenance = new WeakMap([
    [m1, { local: p1 }],
    [m2, { local: p2 }],
    [m1.firstChild, { local: [] }],
    [m2.firstChild, { local: [p1.firstChild, p2.firstChild] }],
  ]);
  const seg = (lToM) => ({
    localNodes: [
      { node: p1.firstChild, s: 0, e: 3 },
      { node: p2.firstChild, s: 3, e: 6 },
    ],
    textNodes: [
      { node: m1.firstChild, ms: 0, me: 1 },
      { node: m2.firstChild, ms: 1, me: 4 },
    ],
    lToM: Int32Array.from(lToM),
  });
  const deleted = plan([p1], M, provenance, undefined, [
    seg([-1, -1, -1, 1, 2, 3, 4]),
  ]).get(p1);
  assert.equal(deleted.kind, "single");
  assert.equal(deleted.output, m1);
  const moved = plan([p1], M, provenance, undefined, [
    seg([1, 2, 3, -1, -1, -1, 4]),
  ]).get(p1);
  assert.deepEqual(moved, { kind: "unknown", reason: "escaped" });
});

test("plan: an unchanged ancestor covers a watched descendant", () => {
  const L = parse(doc("<div><p><em>x</em></p></div>")).body,
    M = parse(doc("<div></div>")).body;
  const em = L.querySelector("em");
  const provenance = new WeakMap([
    [M.firstChild, { local: L.firstChild, unchanged: true }],
  ]);
  assert.deepEqual(plan([em], M, provenance).get(em), { kind: "untouched" });
});

test("corpus: lineage changes no DOM and no report field, and complete entries hold", async () => {
  const dir = fileURLToPath(
    new URL("../counterexamples/cases/", import.meta.url),
  );
  const ser = (rep) =>
    JSON.stringify({ ...rep, lineage: undefined }, (k, v) =>
      v && typeof v === "object" && v.nodeType
        ? (v.outerHTML ?? `#${v.nodeType}:${v.nodeValue}`)
        : v,
    );
  let entries = 0;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    const c = JSON.parse(readFileSync(dir + f, "utf8"));
    for (const form of ["dirty", "clean", "plain"]) {
      const go = async (watch) => {
        const live = parse(c.local);
        const opts = {
          live,
          remote: parse(c.remote),
          scripts: { execute: false },
        };
        if (form === "plain") opts.base = parse(c.base);
        else {
          const cap = parse(c.local);
          const map = lockstepMap(cap.documentElement, live.documentElement);
          opts.local = {
            root: cap.documentElement,
            toLive: (n) => map.get(n) || null,
          };
          if (form === "clean") {
            opts.base = cap;
            opts.fastPath = true;
          } else opts.base = parse(c.base);
        }
        let res = null,
          before = null;
        if (watch) {
          const els = [...live.body.querySelectorAll("*")];
          before = new Map(els.map((w) => [w, [...w.querySelectorAll("*")]]));
          opts.lineage = { elements: els, onResult: (r) => (res = r) };
        }
        const report = await mergeDocument(opts);
        return { live, report, res, before };
      };
      const off = await go(false),
        on = await go(true);
      const where = `${f} ${form}`;
      assert.equal(
        on.live.documentElement.outerHTML,
        off.live.documentElement.outerHTML,
        where,
      );
      assert.equal(ser(on.report), ser(off.report), where);
      assert.equal("lineage" in off.report, false, where);
      const root = on.live.documentElement;
      for (const e of on.res.entries) {
        entries++;
        if (!e.complete) continue;
        if (e.kind === "removed")
          assert.ok(!root.contains(e.from) && e.to.length === 0, where);
        else {
          const [t] = e.to;
          assert.ok(e.to.length === 1 && root.contains(t), where);
          assert.equal(e.kind === "retained", t === e.from, where);
          for (const d of on.before.get(e.from))
            assert.ok(
              !root.contains(d) || t.contains(d),
              `${where}: a descendant left ${e.kind}`,
            );
        }
      }
    }
  }
  assert.ok(entries > 500, `entries checked: ${entries}`);
});
