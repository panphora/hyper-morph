// An identical pair owns both subtrees: the merge keeps it as it is, so a
// unit inside it paired with anything but its counterpart is moved out of it
// and the copy left behind loses it. These fixtures copy a container on the
// remote and point an identity, a move, or a pair left by an unpair at the
// copy's content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import * as E from "../../src/index.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { clayIdentity } from "../lib/fast-path-gate.js";

const all = (d) => [
  d.documentElement,
  ...d.documentElement.querySelectorAll("*"),
];

/**
 * A clean-shape merge of a sender's DOM edit, with ClayJS identity: the
 * elements `converged` keeps carry the same id on both tabs, an element the
 * sender moved keeps its id, and a clone gets a fresh one.
 */
async function sent(body, edit, { converged = () => true, fastPath } = {}) {
  const b = doc(body);
  const live = parse(b),
    cap = parse(b),
    sender = parse(b);
  const lock = lockstepMap(cap.documentElement, live.documentElement);
  const toLive = (n) => lock.get(n) || null;
  const origin = lockstepMap(sender.documentElement, cap.documentElement);
  const store = E.createIdentityStore("t"),
    out = E.createIdentityStore("s");
  let n = 0;
  for (const el of all(cap))
    if (converged(el)) store.adopt(toLive(el), `c:${++n}`);
  edit(sender.body);
  for (const el of all(sender)) {
    const o = origin.get(el);
    if (o && converged(o)) out.adopt(el, store.idOf(toLive(o)));
  }
  const map = out.exportMap(sender.documentElement, (x) => x);
  const identity = clayIdentity(store, toLive, map);
  const remote = "<!DOCTYPE html>" + sender.documentElement.outerHTML;
  const report = await E.mergeDocument({
    live,
    base: cap,
    local: { root: cap.documentElement, toLive },
    remote,
    identity,
    scripts: { execute: false },
    ...(fastPath === undefined ? {} : { fastPath }),
  });
  const pure = () => E.merge3(cap, cap, parse(remote), { identity });
  return {
    html: live.body.innerHTML,
    want: sender.body.innerHTML,
    report,
    pure,
  };
}

const column = (id = "") =>
  `<main><section class="col"${id}><h2>Todo</h2><ul><li><b>Card one words here</b></li><li><b>Card two words here</b></li></ul></section><p>tail</p></main>`;

const copies = [
  [
    "a column copied above itself keeps its authored data-id",
    column(' data-id="col-1"'),
    (body) => {
      const s = body.querySelector("section");
      s.before(s.cloneNode(true));
    },
  ],
  [
    "a column copied below itself, the original retitled, with its authored data-id",
    column(' data-id="col-1"'),
    (body) => {
      const s = body.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
  [
    "a column copied below itself, the original retitled",
    column(),
    (body) => {
      const s = body.querySelector("section");
      s.after(s.cloneNode(true));
      s.querySelector("h2").textContent = "Todo (old)";
    },
  ],
  [
    "a block wrapped in its copy, a second copy nested, an original descendant moved into the wrapper",
    `<div><p><em><b>x words</b></em></p><span>old</span></div><p>tail</p>`,
    (body) => {
      const original = body.firstElementChild;
      const replacement = original.cloneNode(true);
      replacement
        .querySelector("span")
        .replaceChildren(original.cloneNode(true));
      replacement.querySelector("b").replaceWith(original.querySelector("b"));
      original.replaceWith(replacement);
    },
  ],
];

for (const [name, body, edit] of copies)
  test(`F1 ${name}: the copy keeps its content`, async () => {
    for (const fastPath of [undefined, false, true]) {
      const { html, want, report } = await sent(body, edit, { fastPath });
      assert.equal(html, want, `fastPath ${fastPath}`);
      assert.deepEqual(report.conflicts, []);
    }
  });

test("F1 a column copied below itself, only the cards converged: the copy keeps its content", async () => {
  const fresh = new Set(["SECTION", "H2", "UL", "LI"]);
  for (const fastPath of [false, true]) {
    const { html, want } = await sent(
      column(),
      (body) => {
        const s = body.querySelector("section");
        s.after(s.cloneNode(true));
        s.querySelector("h2").textContent = "Todo (old)";
      },
      { converged: (el) => !fresh.has(el.tagName), fastPath },
    );
    assert.equal(html, want, `fastPath ${fastPath}`);
  }
});

/** Default identity; the live page is `l` when given, else the base. */
async function plain(b, r, l = b) {
  const live = parse(doc(l));
  const report = await E.mergeDocument({ live, base: doc(b), remote: doc(r) });
  const kinds = report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`);
  const pure = () => E.merge3(parse(doc(b)), parse(doc(l)), parse(doc(r)));
  return { html: live.body.innerHTML, kinds, pure };
}

test("F1 a paragraph moved into a copy of its container: the copy keeps both paragraphs", async () => {
  const r = `<div><p>gamma five six</p></div><aside><p>alpha one two</p><div><p>alpha one two</p><p>beta three four</p></div></aside><p>tail</p>`;
  const got = await plain(
    `<div><p>alpha one two</p><p>beta three four</p></div><p>tail</p>`,
    r,
  );
  assert.equal(got.html, r);
  assert.deepEqual(got.kinds, []);
});

test("F1 a container moved whole, its old slots refilled: the moved container keeps its content", async () => {
  const r = `<div><p>gamma five six</p><p>delta seven eight</p></div><aside><div><p>alpha one two</p><p>beta three four</p></div></aside><p>tail</p>`;
  const got = await plain(
    `<div><p>alpha one two</p><p>beta three four</p></div><p>tail</p>`,
    r,
  );
  assert.equal(got.html, r);
  assert.deepEqual(got.kinds, []);
});

test("F1 a list copied twice with a copy of its container nested in each: every copy keeps its content", async () => {
  const list = (third, nested = "") =>
    `<ul><li><p>w12 w13 w14</p></li>${third}<li><p>w18 w19 w20</p>${nested}</li></ul>`;
  const full = `<li><p>w15 w16 w17</p></li>`;
  const tail = `<ul><li><p>w27 w28 w29</p></li></ul>`;
  const r = `<article><article>${list(full, `<article>${list("<li></li>")}${tail}</article>`)}${list(full, `<article>${list(full)}${tail}</article>`)}${tail}</article></article>`;
  const got = await plain(
    `<article><article>${list(full)}${tail}</article></article>`,
    r,
  );
  assert.equal(got.html, r);
  assert.deepEqual(got.kinds, []);
});

test("F1 a local edit to a paragraph that a moved copy also matches is a conflict, never dropped", async () => {
  const b = `<div><p>x words here</p><h2>title</h2></div><section><p>x words here</p></section><p>tail</p>`;
  const r = `<div><p>other stuff entirely</p></div><section><p>completely different text</p></section><aside><div><p>x words here</p><h2>title</h2></div></aside><p>tail</p>`;
  const got = await plain(
    b,
    r,
    b.replace("here</p></section>", "here LOCAL</p></section>"),
  );
  assert.equal(got.html, r);
  assert.deepEqual(got.kinds, ["text:"]);
});

test("F1 a locally edited paragraph the remote deleted, whose twin moved inside a copy, stays", async () => {
  const b = `<div><p>x words here</p><h2>title</h2></div><section><p>x words here</p><p>keep me</p></section><p>tail</p>`;
  const r = `<div><p>other stuff entirely</p></div><section><p>keep me</p></section><aside><div><p>x words here</p><h2>title</h2></div></aside><p>tail</p>`;
  const got = await plain(
    b,
    r,
    b.replace("here</p><p>keep", "here LOCAL</p><p>keep"),
  );
  assert.equal(
    got.html,
    `<div><p>other stuff entirely</p></div><section><p>x words here LOCAL</p><p>keep me</p></section><aside><div><p>x words here</p><h2>title</h2></div></aside><p>tail</p>`,
  );
  assert.deepEqual(got.kinds, ["structure:edit-beats-delete"]);
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

function page(r) {
  let w = 0,
    aid = 0;
  const words = (n) => Array.from({ length: n }, () => "w" + w++).join(" ");
  const authored = () => (r() < 0.3 ? ` data-id="a${aid++}"` : "");
  const leaf = () => {
    const k = r();
    if (k < 0.2) return `<h2${authored()}>${words(2)}</h2>`;
    if (k < 0.4)
      return `<p${authored()}><em><b>${words(2)}</b></em> ${words(2)}</p>`;
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

const pick = (r, list) => list[Math.floor(r() * list.length)];

/** Copy subtrees on the sender: duplicate, copy into a container, wrap in
 * a copy (the shape above), or duplicate and move a descendant into the copy. */
function copyEdits(r) {
  return (body) => {
    const fits = (into, el) =>
      el.tagName === "LI"
        ? into.tagName === "UL"
        : /^(SECTION|DIV|ARTICLE|LI)$/.test(into.tagName);
    for (let i = 1 + Math.floor(r() * 2); i > 0; i--) {
      const e = pick(r, [...body.querySelectorAll("*")]);
      const k = r();
      if (k < 0.3) {
        const c = e.cloneNode(true);
        if (r() < 0.5) e.before(c);
        else e.after(c);
        if (r() < 0.4) {
          const t = [e, ...e.querySelectorAll("*")].find(
            (x) => x.firstChild && x.firstChild.nodeType === 3,
          );
          if (t) t.firstChild.nodeValue += " edited";
        }
      } else if (k < 0.5) {
        const into = pick(
          r,
          [...body.querySelectorAll("*")].filter((x) => fits(x, e)),
        );
        if (into && !e.contains(into)) into.appendChild(e.cloneNode(true));
      } else if (k < 0.75) {
        const replacement = e.cloneNode(true);
        const slot = pick(
          r,
          [replacement, ...replacement.querySelectorAll("*")].filter((x) =>
            fits(x, e),
          ),
        );
        if (!slot) continue;
        slot.appendChild(e.cloneNode(true));
        const od = [...e.querySelectorAll("*")];
        if (od.length) {
          const d = od[Math.floor(r() * od.length)];
          const target = [...replacement.querySelectorAll("*")].find(
            (x) => x.outerHTML === d.outerHTML && !x.contains(d),
          );
          if (target) target.replaceWith(d);
        }
        e.replaceWith(replacement);
      } else {
        const c = e.cloneNode(true);
        e.after(c);
        const od = [...e.querySelectorAll("*")];
        if (od.length) {
          const j = Math.floor(r() * od.length);
          const cd = c.querySelectorAll("*");
          if (cd[j]) cd[j].replaceWith(od[j]);
        }
      }
    }
  };
}

/** Pairs inside an identical pair that point anywhere but the counterpart. */
function strayPairs(A) {
  let n = 0;
  for (const [b, s] of A.map) {
    if (!b || b.nodeType !== 1 || !A.identical.has(b)) continue;
    const stack = [[b, s]];
    while (stack.length) {
      const [x, y] = stack.pop();
      const xk = x.children,
        yk = y.children;
      for (let i = 0; i < xk.length && i < yk.length; i++) {
        const t = A.map.get(xk[i]),
          z = A.reverse.get(yk[i]);
        if (
          (t !== undefined && t !== yk[i]) ||
          (z !== undefined && z !== xk[i])
        )
          n++;
        stack.push([xk[i], yk[i]]);
      }
    }
  }
  return n;
}

test("F1 sweep: copies of subtrees keep every word, and no identical pair holds a stray pair", async () => {
  const words = (h) => (h.match(/\bw\d+\b/g) || []).sort().join(" ");
  let cases = 0,
    exact = 0;
  const failures = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let seed = 1; seed <= 200; seed++)
      for (const synthetic of [true, false]) {
        const r = rng(seed * 2654435761);
        const body = page(r);
        const edit = copyEdits(r);
        let sentBody = null;
        const record = (b) => {
          edit(b);
          sentBody = b.innerHTML;
        };
        const got = synthetic
          ? await sent(body, record)
          : await (async () => {
              const s = parse(doc(body));
              record(s.body);
              return plain(body, sentBody);
            })();
        const want = parse(doc(sentBody)).body.innerHTML;
        if (want !== sentBody) continue;
        cases++;
        if (got.html === want) exact++;
        const stray = strayPairs(got.pure().R);
        if (words(got.html) !== words(want) || stray)
          failures.push({ seed, synthetic, stray });
      }
  } finally {
    console.warn = warn;
  }
  assert.ok(
    cases > 380 && exact > cases * 0.95,
    `${cases} cases, ${exact} exact`,
  );
  assert.deepEqual(failures, []);
});
