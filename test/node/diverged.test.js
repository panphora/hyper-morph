// `report.localDiverged` is true whenever the merged output differs from the
// remote document, including when the only difference is that unchanged
// elements sit in a different order. ClayJS reads it to decide whether the
// page still holds local work the file does not: a false `false` lets it
// advance the saved baseline over a local reorder the file never got. The
// rows below are the seven shapes of the spec's step A table; each runs the
// pure merge and the dirty live merge, and each asserts the independent
// condition `localDiverged === (output body !== remote body)`, so the flag
// cannot agree with the table while disagreeing with the bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument } from "../../src/index.js";

/** A body's innerHTML, optionally with the ignored elements dropped: what the
 * merge ignores is not a divergence, so D5 compares without them. */
const bodyOf = (html, strip) => {
  const d = parse(doc(html));
  if (strip) for (const el of [...d.querySelectorAll(strip)]) el.remove();
  return d.body.innerHTML;
};

const IGNORED = "[data-ignore]";
const isIgnored = (el) => el.hasAttribute("data-ignore");

function keyed(html) {
  const d = parse(doc(html));
  const wm = new WeakMap();
  for (const el of [...d.querySelectorAll("[k]")]) {
    wm.set(el, el.getAttribute("k"));
    el.removeAttribute("k");
  }
  return { d, id: (el) => wm.get(el) || null };
}

/** One row in both shapes: the pure merge's `localDiverged` and the dirty
 * live document's report, each against the merged bytes and the remote. */
async function check(row) {
  const opts = row.ignored ? { ignore: isIgnored } : {};
  const strip = row.ignored ? IGNORED : null;
  const remote = bodyOf(row.r, strip);

  const pure = mergeBodies(row.b, row.l, row.r, opts);
  const pureOut = bodyOf(pure.html, strip);
  assert.equal(pure.res.localDiverged, row.expect, `${row.name} (pure)`);
  assert.equal(
    pure.res.localDiverged,
    pureOut !== remote,
    `${row.name} (pure): the flag disagrees with the merged bytes`,
  );

  const live = parse(doc(row.l));
  const report = await mergeDocument({
    live,
    base: doc(row.b),
    remote: doc(row.r),
    ...opts,
  });
  const dirtyOut = bodyOf(live.body.innerHTML, strip);
  assert.equal(report.localDiverged, row.expect, `${row.name} (dirty)`);
  assert.equal(
    report.localDiverged,
    dirtyOut !== remote,
    `${row.name} (dirty): the flag disagrees with the live bytes`,
  );
}

async function checkKeyed(row) {
  const b = keyed(row.b),
    l = keyed(row.l),
    r = keyed(row.r);
  const report = await mergeDocument({
    live: l.d,
    base: b.d,
    remote: r.d,
    ignore: isIgnored,
    identity: { base: b.id, local: l.id, remote: r.id },
  });
  const remote = bodyOf(r.d.body.innerHTML, IGNORED);
  assert.equal(report.localDiverged, row.expect, `${row.name} (dirty)`);
  assert.equal(
    report.localDiverged,
    bodyOf(l.d.body.innerHTML, IGNORED) !== remote,
    `${row.name} (dirty): the flag disagrees with the live bytes`,
  );
}

const SWAP_B = `<ul><li>A one</li></ul><ul><li>B two</li></ul>`;
const SWAP_L = `<ul><li>B two</li></ul><ul><li>A one</li></ul>`;

const ROWS = [
  {
    name: "I6-D1 id-less swap of two distinct blocks, remote untouched",
    b: SWAP_B,
    l: SWAP_L,
    r: SWAP_B,
    expect: true,
  },
  {
    name: "I6-D2 swap with data-id on the lists only",
    b: `<ul data-id="u1"><li>A one</li></ul><ul data-id="u2"><li>B two</li></ul>`,
    l: `<ul data-id="u2"><li>B two</li></ul><ul data-id="u1"><li>A one</li></ul>`,
    r: `<ul data-id="u1"><li>A one</li></ul><ul data-id="u2"><li>B two</li></ul>`,
    expect: true,
  },
  {
    name: "I6-D3 swap with data-id on every element",
    b: `<ul data-id="u1"><li data-id="a">A one</li></ul><ul data-id="u2"><li data-id="b">B two</li></ul>`,
    l: `<ul data-id="u2"><li data-id="b">B two</li></ul><ul data-id="u1"><li data-id="a">A one</li></ul>`,
    r: `<ul data-id="u1"><li data-id="a">A one</li></ul><ul data-id="u2"><li data-id="b">B two</li></ul>`,
    expect: true,
  },
  {
    name: "I6-D4 two identical blocks swapped, bytes equal remote",
    b: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
    l: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
    r: `<ul><li>same</li></ul><ul><li>same</li></ul>`,
    expect: false,
  },
  {
    name: "I6-D5 identical blocks swapped, each holding an ignored child",
    b: `<ul k="u1"><li k="a">same</li><li data-ignore>x</li></ul><ul k="u2"><li k="b">same</li><li data-ignore>x</li></ul>`,
    l: `<ul k="u2"><li k="b">same</li><li data-ignore>x</li></ul><ul k="u1"><li k="a">same</li><li data-ignore>x</li></ul>`,
    r: `<ul k="u1"><li k="a">same</li><li data-ignore>x</li></ul><ul k="u2"><li k="b">same</li><li data-ignore>x</li></ul>`,
    ignored: true,
    keyed: true,
    expect: false,
  },
  {
    name: "I6-D6 local edit elsewhere, unchanged block moved by remote",
    b: `<section><p>a b</p></section><aside></aside><p>c d</p>`,
    l: `<section><p>a b</p></section><aside></aside><p>c D</p>`,
    r: `<section></section><aside><p>a b</p></aside><p>c d</p>`,
    expect: true,
  },
  {
    name: "I6-D7 remote-only change",
    b: `<p>alpha beta</p><p>gamma delta</p>`,
    l: `<p>alpha beta</p><p>gamma delta</p>`,
    r: `<p>alpha BETA</p><p>gamma delta</p>`,
    expect: false,
  },
];

for (const row of ROWS)
  test(row.name, () => (row.keyed ? checkKeyed(row) : check(row)));
