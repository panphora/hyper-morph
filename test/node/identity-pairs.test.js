// Identity pairs stay authoritative. When content says two containers are
// equal and an identity pair below them says a part of one went elsewhere,
// the containers pair without being identical and their children align, so
// an unsaved edit follows the element that carries it. A copy still keeps
// its content (owned-pairs.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import * as E from "../../src/index.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { uniqueAuthored } from "../lib/fast-path-gate.js";

const all = (d) => [
  d.documentElement,
  ...d.documentElement.querySelectorAll("*"),
];
const mark = (el, word) => (el.firstChild.nodeValue += word);
const unmark = (el, word) =>
  (el.firstChild.nodeValue = el.firstChild.nodeValue.slice(0, -word.length));

/**
 * A ClayJS merge where every element carries a converged synthetic id. One
 * side copies part of the page with `copy` (a clone gets a fresh id), the
 * other appends a word to the first card, and the receiver does not save.
 * The page both intend is the copier's, with the word on the card that
 * carries the edited card's identity.
 */
async function concurrent(body, copy, copier) {
  const base = parse(doc(body)),
    live = parse(doc(body)),
    sender = parse(doc(body));
  const store = E.createIdentityStore("t");
  const fromBase = lockstepMap(base.documentElement, live.documentElement);
  const origin = lockstepMap(sender.documentElement, live.documentElement);
  for (const el of all(live)) store.ensure(el);
  for (const el of all(base)) store.adopt(el, store.idOf(fromBase.get(el)));
  const card = live.body.querySelector("section b");
  const twin = () => all(sender).find((el) => origin.get(el) === card);
  if (copier === "sender") copy(sender.body);
  else mark(twin(), " REMOTE");
  const out = E.createIdentityStore("s");
  for (const el of all(sender)) {
    const o = origin.get(el);
    if (o) out.adopt(el, store.idOf(o));
  }
  const map = out.exportMap(sender.documentElement, (x) => x);
  const remote = "<!DOCTYPE html>" + sender.documentElement.outerHTML;
  let want;
  if (copier === "sender") {
    mark(twin(), " LOCAL");
    want = sender.body.innerHTML;
    mark(card, " LOCAL");
  } else {
    copy(live.body);
    mark(card, " REMOTE");
    want = live.body.innerHTML;
    unmark(card, " REMOTE");
  }
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const fromCap = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (x) => fromCap.get(x) || null;
  const authored = uniqueAuthored();
  const report = await E.mergeDocument({
    live,
    base,
    local: { root: cap.documentElement, toLive },
    remote,
    identity: {
      base: (el) => authored(el) || store.idOf(el) || null,
      local: (el) => authored(el) || store.idOf(toLive(el) || el) || null,
      remote: { first: authored, map, then: authored },
    },
    scripts: { execute: false },
  });
  return { html: live.body.innerHTML, want, report, card };
}

const column = (id) =>
  `<main><section class="col"${id}><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>`;
const authoredId = ' data-id="col-1"';
const copyAbove = (body) => {
  const s = body.querySelector("section");
  s.before(s.cloneNode(true));
};
const copyBelowRetitled = (body) => {
  const s = body.querySelector("section");
  s.after(s.cloneNode(true));
  s.querySelector("h2").textContent = "Todo (old)";
};
const copyBelowTrimmed = (body) => {
  const s = body.querySelector("section");
  s.after(s.cloneNode(true));
  s.querySelectorAll("li")[1].remove();
};

for (const [name, body, copy] of [
  ["copied above", column(authoredId), copyAbove],
  ["copied above, no authored id", column(""), copyAbove],
  [
    "copied below, the original retitled",
    column(authoredId),
    copyBelowRetitled,
  ],
  [
    "copied below, the original retitled, no authored id",
    column(""),
    copyBelowRetitled,
  ],
  [
    "copied below, a card removed from the original",
    column(authoredId),
    copyBelowTrimmed,
  ],
])
  test(`F1 a column the sender ${name}, an unsaved edit to a card in the original: the edit stays with its card`, async () => {
    const { html, want, report } = await concurrent(body, copy, "sender");
    assert.equal(html, want);
    assert.deepEqual(report.conflicts, []);
  });

for (const [name, body, copy] of [
  ["copied above", column(authoredId), copyAbove],
  [
    "copied below, the original retitled",
    column(authoredId),
    copyBelowRetitled,
  ],
  [
    "copied below, the original retitled, no authored id",
    column(""),
    copyBelowRetitled,
  ],
])
  test(`F1 a column the receiver ${name}, unsaved, and a remote edit to a card in the original: the edit lands in the original`, async () => {
    const { html, want, report, card } = await concurrent(
      body,
      copy,
      "receiver",
    );
    assert.equal(html, want);
    assert.ok(card.isConnected && card.textContent.endsWith(" REMOTE"));
    assert.deepEqual(report.conflicts, []);
  });

/**
 * A ClayJS merge with synthetic ids given per body element in document
 * order (0 for none): `ids` on the base and the receiver, `remoteIds` on
 * the sender. The receiver applies `localEdit` and does not save.
 */
async function withIds({ body, remoteBody, ids, remoteIds, localEdit }) {
  const base = parse(doc(body)),
    live = parse(doc(body)),
    remote = parse(doc(remoteBody));
  const idOf = new WeakMap();
  const tag = (d, list) =>
    [...d.body.querySelectorAll("*")].forEach(
      (el, i) => list[i] && idOf.set(el, list[i]),
    );
  tag(base, ids);
  tag(live, ids);
  tag(remote, remoteIds);
  if (localEdit) localEdit(live.body);
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const fromCap = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (x) => fromCap.get(x) || null;
  const sender = E.createIdentityStore("s");
  for (const el of all(remote))
    if (idOf.get(el)) sender.adopt(el, idOf.get(el));
  const map = sender.exportMap(remote.documentElement, (x) => x);
  const authored = uniqueAuthored();
  const report = await E.mergeDocument({
    live,
    base,
    local: { root: cap.documentElement, toLive },
    remote: "<!DOCTYPE html>" + remote.documentElement.outerHTML,
    identity: {
      base: (el) => authored(el) || idOf.get(el) || null,
      local: (el) => authored(el) || idOf.get(toLive(el) || el) || null,
      remote: { first: authored, map, then: authored },
    },
    scripts: { execute: false },
  });
  return { live, report };
}

test("F1 two equal cards swapped on the remote, the first edited locally: the edit follows its card", async () => {
  const { live, report } = await withIds({
    body: `<ul><li>Same card</li><li>Same card</li></ul><p>x</p>`,
    remoteBody: `<ul><li>Same card</li><li>Same card</li></ul><p>x changed</p>`,
    ids: [0, "A", "B", "P"],
    remoteIds: [0, "B", "A", "P"],
    localEdit: (b) => (b.querySelector("li").textContent += " LOCAL"),
  });
  assert.equal(
    live.body.innerHTML,
    `<ul><li>Same card</li><li>Same card LOCAL</li></ul><p>x changed</p>`,
  );
  assert.deepEqual(report.conflicts, []);
});

test("F1 two equal cards swapped across columns, one edited locally: the edit follows its card", async () => {
  const { live, report } = await withIds({
    body: `<section><ul><li>Same card</li></ul></section><section><ul><li>Same card</li></ul></section><p>x</p>`,
    remoteBody: `<section><ul><li>Same card</li></ul></section><section><ul><li>Same card</li></ul></section><p>x changed</p>`,
    ids: ["S1", "U1", "A", "S2", "U2", "B", "P"],
    remoteIds: ["S1", "U1", "B", "S2", "U2", "A", "P"],
    localEdit: (b) => (b.querySelector("li").textContent += " LOCAL"),
  });
  assert.equal(
    live.body.innerHTML,
    `<section><ul><li>Same card</li></ul></section><section><ul><li>Same card LOCAL</li></ul></section><p>x changed</p>`,
  );
  assert.deepEqual(report.conflicts, []);
});

for (const [name, card, ids, remoteIds, edited] of [
  [
    "a paragraph",
    (t) => `<p>${t}</p>`,
    [0, "Z", 0, "X", "T"],
    [0, "W", 0, "Z", "T"],
    0,
  ],
  [
    "a card",
    (t) => `<div><p>${t}</p><p>two three four</p></div>`,
    [0, "Z", "Z1", "Z2", 0, "X", "X1", "X2", "T"],
    [0, "W", "W1", "W2", 0, "Z", "Z1", "Z2", "T"],
    1,
  ],
])
  test(`F1 ${name} whose id moved to the next section, edited locally: the edit follows its id`, async () => {
    const page = (first) =>
      `<section>${card(first)}</section><section>${card("alpha beta gamma")}</section><p>tail</p>`;
    const { live, report } = await withIds({
      body: page("alpha beta gamma"),
      remoteBody: page("alpha beta gamma delta"),
      ids,
      remoteIds,
      localEdit: (b) =>
        (b.querySelectorAll("p")[edited].firstChild.nodeValue += " LOCAL"),
    });
    const want = parse(doc(page("alpha beta gamma delta")));
    want.querySelectorAll("section")[1].querySelectorAll("p")[
      edited
    ].firstChild.nodeValue += " LOCAL";
    assert.equal(live.body.innerHTML, want.body.innerHTML);
    assert.deepEqual(report.conflicts, []);
    assert.equal(report.localDiverged, true);
  });

test("F1 identity wins over a 200-deep content match in a chain of containers", async () => {
  const chain = "<div>".repeat(200) + "<p>same</p>" + "</div>".repeat(200);
  const body = (x) =>
    `<section>${chain}</section><section>${chain}</section><p>${x}</p>`;
  const b = parse(doc(body("old"))),
    l = parse(doc(body("old"))),
    r = parse(doc(body("NEW")));
  const ids = new WeakMap();
  for (const d of [b, l, r])
    [...d.querySelectorAll("section p")].forEach((p, i) =>
      ids.set(p, `p${d === r ? 1 - i : i}`),
    );
  const id = (n) => ids.get(n) || null;
  const lock = lockstepMap(b.documentElement, l.documentElement);
  const first = l.querySelector("section p");
  await E.mergeDocument({
    live: l,
    base: b,
    local: { root: b.documentElement, toLive: (n) => lock.get(n) || null },
    remote: r,
    identity: { base: id, local: id, remote: id },
    scripts: { execute: false },
  });
  assert.equal(l.documentElement.outerHTML, r.documentElement.outerHTML);
  assert.equal(first.closest("section"), l.querySelectorAll("section")[1]);
});

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const fits = (into, el) =>
  el.tagName === "LI"
    ? into.tagName === "UL"
    : /^(SECTION|DIV|ARTICLE|LI)$/.test(into.tagName);

function page(r) {
  let w = 0,
    aid = 0;
  const words = (n) => Array.from({ length: n }, () => "w" + w++).join(" ");
  const authored = () => (r() < 0.25 ? ` data-id="a${aid++}"` : "");
  const leaf = () => {
    const k = r();
    if (k < 0.2) return `<h2${authored()}>${words(2)}</h2>`;
    if (k < 0.35) return `<p${authored()}><em>${words(2)}</em> ${words(2)}</p>`;
    return `<p${authored()}>${words(3)}</p>`;
  };
  const box = (d) => {
    const tag = ["section", "div", "ul", "article"][Math.floor(r() * 4)];
    const n = 1 + Math.floor(r() * 3);
    let inner = "";
    for (let i = 0; i < n; i++)
      inner +=
        tag === "ul"
          ? `<li${authored()}>${leaf()}</li>`
          : d > 0 && r() < 0.5
            ? box(d - 1)
            : leaf();
    return `<${tag} class="c${Math.floor(r() * 3)}"${authored()}>${inner}</${tag}>`;
  };
  let body = "";
  for (let i = 1 + Math.floor(r() * 3); i > 0; i--) body += box(2);
  return body + `<p>tail ${words(2)}</p>`;
}

/** A twin in the base itself: a copy of a subtree, without authored ids. */
function twin(r, body) {
  const els = [...body.querySelectorAll("*")];
  const e = pick(r, els);
  const c = e.cloneNode(true);
  for (const x of [c, ...c.querySelectorAll("[data-id]")])
    x.removeAttribute("data-id");
  if (r() < 0.5) e.after(c);
  else {
    const into = pick(
      r,
      els.filter((x) => fits(x, e) && !e.contains(x) && x !== e),
    );
    if (into) into.appendChild(c);
    else e.after(c);
  }
}

/** The sender's edits: copies, wraps, moves, swaps, text edits, deletes. */
function operate(r, body) {
  for (let i = 1 + Math.floor(r() * 2); i > 0; i--) {
    const all = [...body.querySelectorAll("*")];
    if (!all.length) break;
    const e = pick(r, all);
    const k = r();
    if (k < 0.15) {
      const c = e.cloneNode(true);
      if (r() < 0.5) e.before(c);
      else e.after(c);
    } else if (k < 0.25) {
      const into = pick(
        r,
        all.filter((x) => fits(x, e) && !e.contains(x)),
      );
      if (into) into.appendChild(e.cloneNode(true));
    } else if (k < 0.35) {
      const rep = e.cloneNode(true);
      const slot = pick(
        r,
        [rep, ...rep.querySelectorAll("*")].filter((x) => fits(x, e)),
      );
      if (!slot) continue;
      slot.appendChild(e.cloneNode(true));
      const od = [...e.querySelectorAll("*")];
      if (od.length) {
        const d = pick(r, od);
        const t = [...rep.querySelectorAll("*")].find(
          (x) => x.outerHTML === d.outerHTML && !x.contains(d),
        );
        if (t) t.replaceWith(d);
      }
      e.replaceWith(rep);
    } else if (k < 0.45) {
      const c = e.cloneNode(true);
      e.after(c);
      const od = [...e.querySelectorAll("*")];
      if (od.length) {
        const j = Math.floor(r() * od.length);
        const cd = c.querySelectorAll("*");
        if (cd[j]) cd[j].replaceWith(od[j]);
      }
    } else if (k < 0.6) {
      const into = pick(
        r,
        all.filter((x) => fits(x, e) && !e.contains(x)),
      );
      if (into) {
        if (r() < 0.5) into.appendChild(e);
        else into.prepend(e);
      }
    } else if (k < 0.72) {
      const o = pick(
        r,
        all.filter(
          (x) =>
            x !== e &&
            x.tagName === e.tagName &&
            !x.contains(e) &&
            !e.contains(x),
        ),
      );
      if (o) {
        const m = body.ownerDocument.createComment("");
        e.before(m);
        o.before(e);
        m.replaceWith(o);
      }
    } else if (k < 0.87) {
      const t = [e, ...e.querySelectorAll("*")].find(
        (x) => x.firstChild && x.firstChild.nodeType === 3,
      );
      if (t) t.firstChild.nodeValue += " redit";
    } else if (e.parentNode !== body || body.children.length > 2) e.remove();
  }
}

/**
 * One dirty ClayJS merge: synthetic ids on every element ("full", authored
 * ids kept; "synth", none authored) or only on leaves and headings
 * ("leaves", partly converged); the sender's edits, and one unsaved word
 * the receiver added. The oracle is the sender's page with that word added
 * where its text node went; null when the text went nowhere.
 */
async function sweepCase(seed, mode) {
  const r = rng(seed * 2654435761 + (mode === "leaves" ? 13 : 0));
  const body = page(r);
  const b0 = parse(
    doc(
      mode === "synth" ? body.replace(/ data-id="a\d+"/g, "") : body,
      "<title>t</title>",
    ),
  );
  if (r() < 0.6) twin(r, b0.body);
  if (r() < 0.3) twin(r, b0.body);
  const B = "<!DOCTYPE html>" + b0.documentElement.outerHTML;
  const base = parse(B),
    live = parse(B),
    sender = parse(B);
  const store = E.createIdentityStore("t");
  const fromBase = lockstepMap(base.documentElement, live.documentElement);
  const converged = (el) =>
    mode !== "leaves" ||
    el.children.length === 0 ||
    /^(H2|P|EM|LI)$/.test(el.tagName);
  const origin = lockstepMap(sender.documentElement, live.documentElement);
  for (const el of all(live)) if (converged(el)) store.ensure(el);
  for (const el of all(base)) {
    const id = store.idOf(fromBase.get(el));
    if (id) store.adopt(el, id);
  }
  operate(r, sender.body);
  const out = E.createIdentityStore("s");
  for (const el of all(sender)) {
    const o = origin.get(el);
    if (o && store.idOf(o)) out.adopt(el, store.idOf(o));
  }
  const R = "<!DOCTYPE html>" + sender.documentElement.outerHTML;
  if ("<!DOCTYPE html>" + parse(R).documentElement.outerHTML !== R) return null;
  const toSender = new Map();
  for (const el of all(sender)) {
    const o = origin.get(el);
    if (o && o.nodeType === 1) toSender.set(o, el);
  }
  const map = out.exportMap(sender.documentElement, (x) => x);
  const walk = live.createTreeWalker(live.body, 4),
    texts = [];
  for (let t = walk.nextNode(); t; t = walk.nextNode())
    if (/w\d/.test(t.nodeValue)) texts.push(t);
  const t = texts[Math.floor(r() * texts.length)];
  const before = t.nodeValue;
  t.nodeValue += " LOCAL";
  const i = [...t.parentNode.childNodes].indexOf(t);
  const se = toSender.get(t.parentNode);
  const st = se && se.isConnected && se.childNodes[i];
  if (!st || st.nodeType !== 3 || st.nodeValue !== before) return null;
  st.nodeValue = t.nodeValue;
  const intent = "<!DOCTYPE html>" + sender.documentElement.outerHTML;
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const fromCap = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (x) => fromCap.get(x) || null;
  const authored = uniqueAuthored();
  const warn = console.warn;
  console.warn = () => {};
  try {
    await E.mergeDocument({
      live,
      base,
      local: { root: cap.documentElement, toLive },
      remote: R,
      identity: {
        base: (el) => authored(el) || store.idOf(el) || null,
        local: (el) => authored(el) || store.idOf(toLive(el) || el) || null,
        remote: { first: authored, map, then: authored },
      },
      scripts: { execute: false },
    });
  } finally {
    console.warn = warn;
  }
  return "<!DOCTYPE html>" + live.documentElement.outerHTML === intent;
}

// The merges this sweep still gets wrong. The frozen pre-E5 reference gets
// each of them wrong too, and 29 more (seeds 107 and 133 among them). Fix
// round 1 had turned 12 of the reference's exact merges wrong (seeds 62,
// 73, 84, 122, 123, 159, 170, 352, 437, 463 and 490 partly converged, 400
// fully converged); all 12 are exact again. A fix may make more of them
// exact; the sweep fails only on a seed outside this list.
const STILL_WRONG = {
  full: [31, 93, 100, 104, 257, 317, 318, 340, 484, 513],
  leaves: [17, 135, 210, 227, 235, 252, 260, 286, 393, 419, 426, 525, 566],
  synth: [31, 93, 100, 104, 257, 317, 318, 340, 484],
};

test("F1 sweep, dirty, synthetic ids: no merge the frozen reference got exactly right is wrong", async () => {
  const wrong = { full: [], leaves: [], synth: [] };
  let cases = 0;
  for (let seed = 1; seed <= 600; seed++)
    for (const mode of Object.keys(wrong)) {
      const exact = await sweepCase(seed, mode);
      if (exact === null) continue;
      cases++;
      if (!exact) wrong[mode].push(seed);
    }
  assert.equal(cases, 1652);
  for (const mode of Object.keys(wrong))
    assert.deepEqual(
      wrong[mode].filter((seed) => !STILL_WRONG[mode].includes(seed)),
      [],
      `${mode}: newly wrong`,
    );
});
