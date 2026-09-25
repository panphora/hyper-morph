import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { toDocument, syncDoctype, createParseCache } from "../../src/parse.js";
import { makeIgnore } from "../../src/ignore.js";
import {
  createIdentityStore,
  importMap,
  indexByIdentity,
  defaultIdentity,
} from "../../src/identity.js";

test("T-P4 a fragment string becomes body content", () => {
  const d = toDocument("<p>x</p>", document);
  assert.equal(d.body.innerHTML, "<p>x</p>");
  assert.equal(d.head.children.length, 0);
});

test("T-P5 non-string non-Document throws", () => {
  assert.throws(() => toDocument(document.body, document), TypeError);
});

test("T-P1..3 doctype sync", () => {
  const live = parse("<html><body></body></html>");
  assert.equal(live.doctype, null);
  assert.equal(syncDoctype(live, parse(doc(""))), true);
  assert.equal(live.doctype.name, "html");
  assert.equal(syncDoctype(live, parse("<html></html>")), false); // never removed
  assert.equal(syncDoctype(live, parse(doc(""))), false); // unchanged
  const legacy = parse(
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "x"><html></html>',
  );
  assert.equal(syncDoctype(live, legacy), true);
  assert.equal(live.doctype.publicId, "-//W3C//DTD XHTML 1.0 Strict//EN");
});

test("parse cache reuses the document for an identical string per lane", () => {
  const cached = createParseCache(document);
  const a = cached("peer", "<p>a</p>");
  assert.equal(cached("peer", "<p>a</p>"), a);
  assert.notEqual(cached("disk", "<p>a</p>"), a);
  assert.notEqual(cached("peer", "<p>b</p>"), a);
});

test("T-I1 ignore predicate called at most once per element and is ancestor-aware", () => {
  const d = parse(
    doc("<div><section no-save><p><b>x</b></p></section><p>y</p></div>"),
  );
  let calls = 0;
  const ignored = makeIgnore((el) => {
    calls++;
    return el.hasAttribute("no-save");
  });
  const b = d.querySelector("b"),
    sec = d.querySelector("section"),
    py = d.querySelectorAll("p")[1];
  assert.equal(ignored(b), true);
  assert.equal(ignored(sec), true);
  assert.equal(ignored(py), false);
  assert.equal(ignored(d.body), false);
  assert.equal(ignored(b.firstChild), false); // text node
  const before = calls;
  ignored(b);
  ignored(sec);
  ignored(py);
  ignored(d.querySelector("p"));
  assert.equal(calls, before);
  assert.ok(calls <= 7); // b, p, section, p, div, body, html: one call each
});

test("identity store mints, exports by path, imports by path, adopts", () => {
  const store = createIdentityStore("tab1");
  const live = parse(doc("<main><p>a</p><p>b</p></main>")).documentElement;
  const clone = live.cloneNode(true);
  const pairs = new Map();
  (function pair(l, c) {
    pairs.set(c, l);
    for (let i = 0; i < l.children.length; i++)
      pair(l.children[i], c.children[i]);
  })(live, clone);
  const map = store.exportMap(clone, (n) => pairs.get(n) || null);
  assert.equal(map[""], "tab1:1");
  assert.equal(map["1.0.0"], store.idOf(live.querySelector("p")));
  assert.equal(
    store.exportMap(clone, (n) => pairs.get(n) || null)[""],
    "tab1:1",
  ); // stable
  const remote = parse(doc("<main><p>a</p><p>b</p></main>")).documentElement;
  const imported = importMap(remote, map);
  assert.equal(imported.get(remote.querySelector("p")), map["1.0.0"]);
  const fresh = parse(doc("<p></p>")).querySelector("p");
  store.adopt(fresh, "tab2:9");
  assert.equal(store.idOf(fresh), "tab2:9");
});

test("T-A2 duplicate ids on a side are dropped from the index; ignored subtrees skipped", () => {
  const d = parse(
    doc(
      '<div id="a"></div><div id="a"></div><div id="b"></div><section no-save><div id="c"></div></section>',
    ),
  );
  const idx = indexByIdentity(
    d.body,
    defaultIdentity,
    makeIgnore((el) => el.hasAttribute("no-save")),
  );
  assert.equal(idx.has("a"), false);
  assert.equal(idx.get("b").id, "b");
  assert.equal(idx.has("c"), false);
});
