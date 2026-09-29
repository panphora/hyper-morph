// What the differential observer must see, independent of any engine: the
// node it names for a live node after a merge has to tell apart two new
// wrappers with the retained children swapped, identities adopted onto the
// wrong new element, one moved node from another, and it has to reach into
// template content, where a content fragment has no parentNode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import {
  labelTree,
  finalTree,
  destinations,
  lockstepMap,
  identityList,
  nodeList,
} from "../lib/differential-observe.js";

test("template content: nodes inside a template are named where the walk enters it", () => {
  const live = parse(doc(`<template><p>alpha words here</p></template>`));
  const template = live.querySelector("template");
  const p = template.content.querySelector("p");
  const label = labelTree(live.documentElement);
  const final = finalTree(live.documentElement);
  assert.ok(final.seen.has(p), "template content not reached");
  const dest = destinations(label, final);
  assert.deepEqual(dest[label.ids.get(p)], [
    label.ids.get(p),
    1,
    label.ids.get(template.content),
    0,
  ]);
});

test("template content: lockstep pairs a content node with its twin", () => {
  const html = doc(`<template><p>alpha words here</p></template>`);
  const a = parse(html);
  const b = parse(html);
  const map = lockstepMap(a.documentElement, b.documentElement);
  assert.equal(
    map.get(a.querySelector("template").content.querySelector("p")),
    b.querySelector("template").content.querySelector("p"),
  );
});

test("new parents: the destination names the wrapper a retained node landed in", () => {
  const live = parse(doc(`<p>same words here</p><p>same words here</p>`));
  const label = labelTree(live.documentElement);
  const [p1, p2] = Array.from(live.body.children);
  const section = live.createElement("section");
  const article = live.createElement("article");
  const dest = () => destinations(label, finalTree(live.documentElement));

  section.appendChild(p1);
  article.appendChild(p2);
  live.body.append(section, article);
  const before = dest();

  article.appendChild(p1);
  section.appendChild(p2);
  const after = dest();

  const i = label.ids.get(p1),
    j = label.ids.get(p2);
  assert.notEqual(before[i][2], before[j][2]);
  assert.notEqual(before[i][2], after[i][2]);
  assert.notDeepEqual(before, after);
});

test("identity recipients: swapping which new element got which id is visible", () => {
  const live = parse(doc(`<p>alpha words here</p>`));
  const label = labelTree(live.documentElement);
  const x = live.createElement("div"),
    y = live.createElement("div");
  live.body.append(x, y);
  const final = finalTree(live.documentElement);
  assert.notDeepEqual(
    identityList(
      [
        [x, "a"],
        [y, "b"],
      ],
      label,
      final,
    ),
    identityList(
      [
        [y, "a"],
        [x, "b"],
      ],
      label,
      final,
    ),
  );
});

test("moved list: one moved node is not another, and a detached one has no address", () => {
  const live = parse(doc(`<p>one words here</p><p>two words here</p>`));
  const label = labelTree(live.documentElement);
  const [p1, p2] = Array.from(live.body.children);
  const final = finalTree(live.documentElement);
  assert.notDeepEqual(
    nodeList([p1], label, final),
    nodeList([p2], label, final),
  );
  p2.remove();
  assert.deepEqual(nodeList([p1, p2], label, finalTree(live.documentElement)), [
    JSON.stringify(label.ids.get(p1)),
    JSON.stringify(label.ids.get(p2)),
  ]);
  const stray = live.createElement("div");
  assert.deepEqual(nodeList([stray], label, final), [
    JSON.stringify("detached"),
  ]);
});
