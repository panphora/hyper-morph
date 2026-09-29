import { doc } from "../node/lib/dom.js";
import { clayIdentity, syntheticWith } from "./fast-path-gate.js";

// The fast path's hand cases: each merges in ClayJS's clean shape with the
// fast path off and on, and the two runs must agree on everything the gate
// observes. `expect` names what the fast path does with the case, per
// identity variant: "taken", "off" (not attempted), or the bail's token.
// The F, X, Y and Z series come from the prototype's hand cases, the A series
// are Astra's nine failure fixtures, and the G series pins the guards the
// equivalence argument rests on.

const card = (
  i,
  t = `Title ${i}`,
  p = `Body text for card number ${i} goes here.`,
) =>
  `<div class="card"><h3>${t}</h3><p>${p}</p><ul><li>one</li><li>two</li></ul></div>`;
const same = (n) =>
  Array.from(
    { length: n },
    () =>
      `<div class="card"><h3>Title</h3><p>Body text here for the card.</p></div>`,
  );
const five = same(5);
const list = `<ul>${[1, 2, 3, 4, 5, 6].map((i) => `<li>Item ${i} with some words</li>`).join("")}</ul>`;
const secs = (a, b) =>
  `<section class="a">${a.join("")}</section><section class="b">${b.join("")}</section>`;
const c = [0, 1, 2, 3, 4].map((i) => card(i));
const cards = c.join("");
const main = (body) => `<main>${body}</main>`;
const fullDoc = (attrs, body, head = "") =>
  `<!DOCTYPE html><html${attrs ? " " + attrs : ""}><head>${head}</head><body>${body}</body></html>`;

const swapIds = (map, capMap) => {
  const a = "1.0.0.0",
    b = "1.0.1.0";
  for (const k of Object.keys(capMap)) {
    if (k === a || k.startsWith(a + "."))
      map[b + k.slice(a.length)] = capMap[k];
    if (k === b || k.startsWith(b + "."))
      map[a + k.slice(b.length)] = capMap[k];
  }
};
const moveSurgery = (from, to) => (map, capMap) => {
  map[to] = capMap[from];
  map[from] = "t:copy";
  for (const k of Object.keys(map))
    if (k.startsWith(from + ".")) map[k] = "t:copy" + k.slice(from.length);
  for (const k of Object.keys(capMap))
    if (k.startsWith(from + ".")) map[to + k.slice(from.length)] = capMap[k];
};
const swapSurgery = (a, b) => (map, capMap) => {
  map[a] = capMap[b];
  map[b] = capMap[a];
};

/** A sender whose ids share nothing with this tab's. */
export const freshIds = (E, { cap, remote, toLive }) => {
  const store = E.createIdentityStore("t");
  store.exportMap(cap.documentElement, toLive);
  const map = E.createIdentityStore("fresh").exportMap(
    remote.documentElement,
    (n) => n,
  );
  return clayIdentity(store, toLive, map);
};

const pathOf = (el) => {
  const p = [];
  for (; el.parentElement; el = el.parentElement)
    p.unshift(Array.prototype.indexOf.call(el.parentElement.children, el));
  return p.join(".");
};
/** Ids by element path, the same on both sides, on the listed tags only. */
const pathIds = (tags, ids) => () => {
  const f = (el) => (tags.includes(el.tagName) && ids[pathOf(el)]) || null;
  return { base: f, local: f, remote: f };
};

const ignoreOpts = () => ({
  ignore: (el) => el.hasAttribute("data-ignore"),
});
const winsOpts = () => ({ remoteWins: (el) => el.hasAttribute("data-wins") });
const morphHook = (calls) => ({
  hooks: {
    beforeNodeMorphed: (el) => {
      calls.push(["morph", el]);
    },
  },
});
const classVeto = (calls) => ({
  hooks: {
    beforeAttributeUpdated: (name, el, action) => {
      calls.push(["attr", el, name, action]);
      return name === "class" ? false : undefined;
    },
  },
});
const runtimeValue = (live) => {
  for (const i of live.querySelectorAll("input")) i.value = "RUNTIME";
};

const TWO = ["authored", "synthetic"];

const HEAD = `<meta charset="utf-8"><title>t</title><link rel="stylesheet" href="/a.css">`;
const titled = (body) => body.replace("Title 2", "Title TWO");
const keyedHead = (attrs, body) =>
  `<!DOCTYPE html><html><head${attrs}><title>t</title></head><body>${body}</body></html>`;
const seeHead = (calls) => ({
  beforeApply: (d) => {
    calls.push(["beforeApply", d.head.outerHTML]);
  },
});
const liveStyle = (live) => {
  const s = live.createElement("style");
  s.textContent = "body{color:red}";
  live.head.appendChild(s);
};

/**
 * @type {Array<{ name: string, b: string, r: string, variants?: string[],
 *   identity?: Function, options?: Function, prepare?: Function,
 *   expect: Record<string, string> }>}
 */
export const HAND = [
  {
    name: "F1 edit one of 5 identical cards",
    b: doc(main(five.join(""))),
    r: doc(
      main(
        [
          ...five.slice(0, 3),
          five[3].replace("Body text here", "Body text EDITED here"),
          five[4],
        ].join(""),
      ),
    ),
  },
  {
    name: "F2 reorder within a list (item 5 to front)",
    b: doc(main(list)),
    r: doc(
      main(
        list
          .replace("<li>Item 5 with some words</li>", "")
          .replace("<ul>", "<ul><li>Item 5 with some words</li>"),
      ),
    ),
  },
  {
    name: "F3 move a card between containers",
    b: doc(main(secs([c[0], c[1], c[2]], [c[3], c[4]]))),
    r: doc(main(secs([c[0], c[2]], [c[3], c[4], c[1]]))),
  },
  {
    name: "F4 move a card between containers and edit it",
    b: doc(main(secs([c[0], c[1], c[2]], [c[3], c[4]]))),
    r: doc(
      main(
        secs([c[0], c[2]], [c[3], c[4], c[1].replace("Title 1", "Title ONE")]),
      ),
    ),
  },
  {
    name: "F5 swap two cards between containers",
    b: doc(main(secs([c[0], c[1]], [c[2], c[3]]))),
    r: doc(main(secs([c[0], c[3]], [c[2], c[1]]))),
  },
  {
    name: "F6 wrap a card in a new div",
    b: doc(main(cards)),
    r: doc(
      main(
        [c[0], `<div class="wrap">${c[1]}</div>`, c[2], c[3], c[4]].join(""),
      ),
    ),
  },
  {
    name: "F7 unwrap a card",
    b: doc(main([c[0], `<div class="wrap">${c[1]}</div>`, c[2]].join(""))),
    r: doc(main([c[0], c[1], c[2]].join(""))),
  },
  {
    name: "F8 text directly under a container",
    b: doc(main(`<div>hello <p>inner para</p> world</div>`)),
    r: doc(main(`<div>hello <p>inner para</p> there</div>`)),
  },
  {
    name: "F9 attribute-only change on a container",
    b: doc(main(`<section class="a">${c[0]}${c[1]}</section>`)),
    r: doc(main(`<section class="a open">${c[0]}${c[1]}</section>`)),
  },
  {
    name: "F10 nested identical lists, edit one li",
    b: doc(
      main(
        `<ul><li>x y</li><li>x y</li></ul><ul><li>x y</li><li>x y</li></ul>`,
      ),
    ),
    r: doc(
      main(
        `<ul><li>x y</li><li>x y</li></ul><ul><li>x y</li><li>x z</li></ul>`,
      ),
    ),
  },
  {
    name: "F11 two edits in different containers",
    b: doc(main(secs([c[0], c[1]], [c[2], c[3]]))),
    r: doc(
      main(
        secs(
          [c[0].replace("Title 0", "Title Zero"), c[1]],
          [c[2], c[3].replace("Title 3", "Title Three")],
        ),
      ),
    ),
  },
  {
    name: "F12 delete a card and edit its neighbour",
    b: doc(main(cards)),
    r: doc(
      main([c[0], c[2].replace("Title 2", "Title Two"), c[3], c[4]].join("")),
    ),
  },
  {
    name: "F13 insert a card between identical cards",
    b: doc(main(five.join(""))),
    r: doc(main([...five.slice(0, 2), card(9), ...five.slice(2)].join(""))),
  },
  {
    name: "F14 split a paragraph with Enter",
    b: doc(main(cards)),
    r: doc(
      main(
        cards.replace(
          "Body text for card number 2 goes here.",
          "Body text for card</p><p>number 2 goes here.",
        ),
      ),
    ),
  },
  {
    name: "F15 edit the title of one card with inline <b>",
    b: doc(main(cards.replace("Title 2", "Title <b>two</b> here"))),
    r: doc(main(cards.replace("Title 2", "Title <b>two</b> HERE"))),
  },
  {
    name: "F16 move a card up within its container",
    b: doc(main(cards)),
    r: doc(main([c[0], c[3], c[1], c[2], c[4]].join(""))),
  },
  {
    name: "X1 attr and text change on the same card",
    b: doc(main(cards)),
    r: doc(
      main(
        cards.replace(
          '<div class="card"><h3>Title 2</h3>',
          '<div class="card hot"><h3>Title TWO</h3>',
        ),
      ),
    ),
  },
  {
    name: "X2 class change on one card, text change on a sibling",
    b: doc(main(cards)),
    r: doc(
      main(
        cards
          .replace(
            '<div class="card"><h3>Title 1</h3>',
            '<div class="card hot"><h3>Title 1</h3>',
          )
          .replace("Title 3", "Title Three"),
      ),
    ),
  },
  {
    name: "X3 head title change",
    b: doc(main(cards), "<title>a</title>"),
    r: doc(main(cards), "<title>b</title>"),
  },
  {
    name: "X3b head title change and a card edit",
    b: doc(main(cards), "<title>a</title>"),
    r: doc(main(cards.replace("Title 2", "Title TWO")), "<title>b</title>"),
  },
  {
    name: "X4 template inside the changed card",
    b: doc(
      main(
        cards.replace(
          "<li>two</li></ul></div>",
          "<li>two</li></ul><template><p>t</p></template></div>",
        ),
      ),
    ),
    r: doc(
      main(
        cards
          .replace(
            "<li>two</li></ul></div>",
            "<li>two</li></ul><template><p>t</p></template></div>",
          )
          .replace("Title 2", "Title TWO"),
      ),
    ),
  },
  {
    name: "X5 template outside, edit elsewhere",
    b: doc(main(cards + "<template><p>t</p></template>")),
    r: doc(
      main(
        cards.replace("Title 2", "Title TWO") + "<template><p>t</p></template>",
      ),
    ),
  },
  {
    name: "X5b template content alone changes",
    b: doc(main(cards + "<template><p>OLD</p></template>")),
    r: doc(main(cards + "<template><p>NEW</p></template>")),
  },
  {
    name: "X6 script inside the changed card",
    b: doc(
      main(cards.replace("Title 2</h3>", "Title 2</h3><script>1</script>")),
    ),
    r: doc(
      main(cards.replace("Title 2</h3>", "Title TWO</h3><script>1</script>")),
    ),
  },
  {
    name: "X7 edit deep inside nested divs",
    b: doc(
      `<div class="a"><div class="b"><div class="c">${cards}</div></div></div>`,
    ),
    r: doc(
      `<div class="a"><div class="b"><div class="c">${cards.replace("Title 4", "Title Four")}</div></div></div>`,
    ),
  },
  {
    name: "X8 insert a text node after a card",
    b: doc(main(cards)),
    r: doc(main(c.slice(0, 2).join("") + "tail" + c.slice(2).join(""))),
  },
  {
    name: "X9 delete the only child of a container",
    b: doc(main(`<section>${c[0]}</section>${c[1]}`)),
    r: doc(main(`<section></section>${c[1]}`)),
  },
  {
    name: "X10 change tag of a card's h3 to h2",
    b: doc(main(cards)),
    r: doc(main(cards.replace("<h3>Title 2</h3>", "<h2>Title 2</h2>"))),
  },
  {
    name: "X11 form input outside the scope keeps its attributes",
    b: doc(main(`<input value="a"><input value="b">` + cards)),
    r: doc(
      main(
        `<input value="a"><input value="b">` +
          cards.replace("Title 2", "Title TWO"),
      ),
    ),
    prepare: runtimeValue,
  },
  {
    name: "X12 form input inside the scope changes value attr",
    b: doc(main(`<div class="f"><input value="a"><p>x</p></div>` + cards)),
    r: doc(main(`<div class="f"><input value="Z"><p>x</p></div>` + cards)),
    prepare: runtimeValue,
  },
  {
    name: "X13 comment node change beside cards",
    b: doc(main(cards + "<!-- a -->")),
    r: doc(main(cards + "<!-- b -->")),
  },
  {
    name: "X14 whitespace-only text change between cards",
    b: doc(main(c.join("\n"))),
    r: doc(main(c.join("\n\n"))),
  },
  {
    name: "Y1 swapped synthetic ids on identical cards, first edited",
    b: doc(main(secs([five[0]], [five[0]]))),
    r: doc(
      main(
        secs(
          [five[0].replace("Body text here", "Body EDITED here")],
          [five[0]],
        ),
      ),
    ),
    variants: ["y1"],
    identity: syntheticWith(swapIds),
  },
  {
    name: "Y2 sender has fresh ids everywhere, edits one card",
    b: doc(main(cards)),
    r: doc(main(cards.replace("Title 2", "Title TWO"))),
    variants: ["fresh"],
    identity: freshIds,
  },
  {
    name: "Y3 sender has fresh ids everywhere, nothing changed",
    b: doc(main(cards)),
    r: doc(main(cards)),
    variants: ["fresh"],
    identity: freshIds,
  },
  {
    name: "Z1 ignored ancestor of the change",
    b: doc(main(`<div data-ignore>${c[0]}</div>${c[1]}`)),
    r: doc(
      main(
        `<div data-ignore>${c[0].replace("Title 0", "Title ZERO")}</div>${c[1]}`,
      ),
    ),
    options: ignoreOpts,
  },
  {
    name: "Z2 ignored sibling differs and a card changes",
    b: doc(main(`<div data-ignore>x</div>${cards}`)),
    r: doc(
      main(`<div data-ignore>y</div>${cards.replace("Title 2", "Title TWO")}`),
    ),
    options: ignoreOpts,
  },
  {
    name: "Z3 ignored sibling unchanged, a card changes",
    b: doc(main(`<div data-ignore>x</div>${cards}`)),
    r: doc(
      main(`<div data-ignore>x</div>${cards.replace("Title 2", "Title TWO")}`),
    ),
    options: ignoreOpts,
  },
  {
    name: "Z4 remoteWins ancestor of the change",
    b: doc(main(`<div data-wins>${c[0]}</div>${c[1]}`)),
    r: doc(
      main(
        `<div data-wins>${c[0].replace("Title 0", "Title ZERO")}</div>${c[1]}`,
      ),
    ),
    options: winsOpts,
  },
  {
    name: "Z5 per-node morph hook present",
    b: doc(main(cards)),
    r: doc(main(cards.replace("Title 2", "Title TWO"))),
    options: morphHook,
  },
  {
    name: "Z6 beforeAttributeUpdated veto on class",
    b: doc(main(cards)),
    r: doc(
      main(
        cards.replace(
          '<div class="card"><h3>Title 2</h3>',
          '<div class="card hot"><h3>Title TWO</h3>',
        ),
      ),
    ),
    options: classVeto,
  },
  {
    name: "A1 html[data-theme] and one paragraph",
    b: fullDoc('data-theme="old"', "<main><p>one</p><p>two</p></main>"),
    r: fullDoc('data-theme="new"', "<main><p>one</p><p>two changed</p></main>"),
  },
  {
    name: "A2a copy left in A, original moved to B",
    b: doc(secs([card("One") + card("Two")], [""])),
    r: doc(secs([card("One") + card("Two")], [card("One")])),
    variants: ["moved"],
    identity: syntheticWith(moveSurgery("1.0.0", "1.1.0")),
  },
  {
    name: "A2b same, moved card edited",
    b: doc(secs([card("One") + card("Two")], [""])),
    r: doc(secs([card("One") + card("Two")], [card("One edited")])),
    variants: ["moved"],
    identity: syntheticWith(moveSurgery("1.0.0", "1.1.0")),
  },
  {
    name: "A3 two equal paragraphs exchange ids, h3 edited",
    b: doc(
      `<section class="a"><p>same</p></section><section class="b"><p>same</p></section><div><h3>Title old</h3></div>`,
    ),
    r: doc(
      `<section class="a"><p>same</p></section><section class="b"><p>same</p></section><div><h3>Title new</h3></div>`,
    ),
    variants: ["swapped"],
    identity: syntheticWith(swapSurgery("1.0.0", "1.1.0")),
  },
  {
    name: "A4 beforeNodeMorphed hook, h1 edit",
    b: doc(
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><div><h1>Title</h1></div>`,
    ),
    r: doc(
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><div><h1>Title edited</h1></div>`,
    ),
    options: morphHook,
  },
  {
    name: "A5 input.value RUNTIME, heading edit",
    b: doc(`<div><h3>Title</h3></div><input value="original">`),
    r: doc(`<div><h3>Title changed</h3></div><input value="original">`),
    prepare: runtimeValue,
  },
  {
    name: "A5c input inside a card, sibling card edited",
    b: doc(
      `<div class="card"><h3>A</h3><input value="original"></div><div class="card"><h3>B</h3></div>`,
    ),
    r: doc(
      `<div class="card"><h3>A</h3><input value="original"></div><div class="card"><h3>B edited</h3></div>`,
    ),
    prepare: runtimeValue,
  },
  {
    name: "G1 an id used outside and in the branch is no identity",
    b: doc(
      `<p data-id="k">outside words here</p><div><p data-id="k">alpha one two</p><p>beta three four</p></div>`,
    ),
    r: doc(
      `<p data-id="k">outside words here</p><div><p>beta three four</p><p data-id="k">gamma five six</p><p>alpha one two</p></div>`,
    ),
    variants: ["authored"],
  },
  {
    name: "G2 a chain element the alignment moves into a copy",
    b: doc(
      `<div><p><em><b>x words</b></em></p><span>old</span></div><p>tail</p>`,
    ),
    r: doc(
      `<div><p><em><b>x words</b></em></p><span><div><p><em><b>x words</b></em></p><span>old</span></div></span></div><p>tail</p>`,
    ),
    variants: ["deep"],
    identity: pathIds(["B"], { "1.0.0.0.0": "s1" }),
  },
  {
    name: "G3 a duplicated merge key outside the branch",
    b: doc(
      `<script type="application/json" merge="cfg">{"a":1}</script><script type="application/json" merge="cfg">{"a":2}</script><div><p>one</p></div>`,
    ),
    r: doc(
      `<script type="application/json" merge="cfg">{"a":1}</script><script type="application/json" merge="cfg">{"a":2}</script><div><p>two</p></div>`,
    ),
  },
  {
    name: "G4 a form control on the chain",
    b: doc(`<div><select><option>a</option><option>b</option></select></div>`),
    r: doc(`<div><select><option>a</option><option>c</option></select></div>`),
  },
  {
    name: "G5 a change in the head only",
    b: doc(`<div><p>one</p></div>`, `<meta name="x" content="1">`),
    r: doc(`<div><p>one</p></div>`, `<meta name="x" content="2">`),
  },
  {
    name: "G6 a JSON merge script is the branch",
    b: doc(
      `<div><script type="application/json" merge="cfg">{"a":1}</script></div>`,
    ),
    r: doc(
      `<div><script type="application/json" merge="cfg">{"a":2}</script></div>`,
    ),
  },
  {
    name: "G7 a script inside the branch",
    b: doc(`<div class="w"><script>1</script><p>a</p><p>b</p></div>`),
    r: doc(`<div class="w"><script>1</script><p>A</p><p>B</p></div>`),
  },
  {
    name: "D1 an id used twice inside the branch is no identity",
    b: doc(
      `<p>outside</p><div><p data-id="k">alpha one two</p><p>gamma</p><p data-id="k">beta three four</p></div>`,
    ),
    r: doc(
      `<p>outside</p><div><p data-id="k">beta three four</p><p>gamma</p><p data-id="k">alpha one two</p><p>new</p></div>`,
    ),
  },
  {
    name: "H1 a style only the live head holds",
    b: doc(main(cards), HEAD),
    r: doc(main(titled(cards)), HEAD),
    options: seeHead,
    prepare: liveStyle,
  },
  {
    name: "H2 an attribute only the live head holds",
    b: doc(main(cards), HEAD),
    r: doc(main(titled(cards)), HEAD),
    options: seeHead,
    prepare: (live) => live.head.setAttribute("data-runtime", "1"),
  },
  {
    name: "H3 a meta only the capture's head holds",
    b: doc(
      main(cards),
      `<title>t</title><meta name="generator" content="clay">`,
    ),
    r: doc(
      main(titled(cards)),
      `<title>t</title><meta name="generator" content="clay">`,
    ),
    options: seeHead,
    prepare: (live) => live.head.querySelector("meta").remove(),
  },
  {
    name: "H4 beforeApply marks the merged head",
    b: doc(main(cards), HEAD),
    r: doc(main(titled(cards)), HEAD),
    options: (calls) => ({
      beforeApply: (d) => {
        calls.push(["beforeApply", d.head.outerHTML]);
        d.head.setAttribute("data-activated", "yes");
      },
    }),
  },
  {
    name: "H5 the head's id used again outside",
    b: keyedHead(' id="h"', main(cards) + `<footer id="h">f</footer>`),
    r: keyedHead(' id="h"', main(titled(cards)) + `<footer id="h">f</footer>`),
    options: seeHead,
    prepare: liveStyle,
  },
  {
    name: "H6 the head's id used again on the chain",
    b: keyedHead(
      ' id="h"',
      main(
        cards.replace(
          'class="card"><h3>Title 2',
          'class="card" id="h"><h3>Title 2',
        ),
      ),
    ),
    r: keyedHead(
      ' id="h"',
      main(
        titled(
          cards.replace(
            'class="card"><h3>Title 2',
            'class="card" id="h"><h3>Title 2',
          ),
        ),
      ),
    ),
    options: seeHead,
    prepare: liveStyle,
  },
  {
    name: "H7 a keyed head and a style only the live head holds",
    b: keyedHead(' id="h"', main(cards)),
    r: keyedHead(' id="h"', main(titled(cards))),
    options: seeHead,
    prepare: liveStyle,
  },
];

for (const h of HAND.splice(0)) {
  h.variants = h.variants || TWO;
  HAND.push(h);
  if (!h.identity && h.b.includes("<main>") && h.r.includes("<main>"))
    HAND.push({
      ...h,
      name: h.name + " (body level)",
      b: h.b.replace("<main>", "").replace("</main>", ""),
      r: h.r.replace("<main>", "").replace("</main>", ""),
    });
}

/** The gate input for a hand case. */
export const handInput = (h) => ({
  name: h.name,
  b: h.b,
  r: h.r,
  bAll: h.b,
  rAll: h.r,
  seed: 1,
  options: (calls) => ({
    scripts: { execute: false },
    ...(h.options ? h.options(calls) : {}),
  }),
  prepare: h.prepare,
});

export { card, cards, fullDoc, pathIds };
