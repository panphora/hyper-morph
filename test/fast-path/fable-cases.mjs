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
const F = {
  "F1 edit one of 5 identical cards": [
    five.join(""),
    [
      ...five.slice(0, 3),
      five[3].replace("Body text here", "Body text EDITED here"),
      five[4],
    ].join(""),
  ],
  "F2 reorder within a list (item 5 to front)": [
    list,
    list
      .replace("<li>Item 5 with some words</li>", "")
      .replace("<ul>", "<ul><li>Item 5 with some words</li>"),
  ],
  "F3 move a card between containers": [
    secs([c[0], c[1], c[2]], [c[3], c[4]]),
    secs([c[0], c[2]], [c[3], c[4], c[1]]),
  ],
  "F4 move a card between containers and edit it": [
    secs([c[0], c[1], c[2]], [c[3], c[4]]),
    secs([c[0], c[2]], [c[3], c[4], c[1].replace("Title 1", "Title ONE")]),
  ],
  "F5 swap two cards between containers": [
    secs([c[0], c[1]], [c[2], c[3]]),
    secs([c[0], c[3]], [c[2], c[1]]),
  ],
  "F6 wrap a card in a new div": [
    c.join(""),
    [c[0], `<div class="wrap">${c[1]}</div>`, c[2], c[3], c[4]].join(""),
  ],
  "F7 unwrap a card": [
    [c[0], `<div class="wrap">${c[1]}</div>`, c[2]].join(""),
    [c[0], c[1], c[2]].join(""),
  ],
  "F8 text directly under a container": [
    `<div>hello <p>inner para</p> world</div>`,
    `<div>hello <p>inner para</p> there</div>`,
  ],
  "F9 attribute-only change on a container": [
    `<section class="a">${c[0]}${c[1]}</section>`,
    `<section class="a open">${c[0]}${c[1]}</section>`,
  ],
  "F10 nested identical lists, edit one li": [
    `<ul><li>x y</li><li>x y</li></ul><ul><li>x y</li><li>x y</li></ul>`,
    `<ul><li>x y</li><li>x y</li></ul><ul><li>x y</li><li>x z</li></ul>`,
  ],
  "F11 two edits in different containers": [
    secs([c[0], c[1]], [c[2], c[3]]),
    secs(
      [c[0].replace("Title 0", "Title Zero"), c[1]],
      [c[2], c[3].replace("Title 3", "Title Three")],
    ),
  ],
  "F12 delete a card and edit its neighbour": [
    c.join(""),
    [c[0], c[2].replace("Title 2", "Title Two"), c[3], c[4]].join(""),
  ],
  "F13 insert a card between identical cards": [
    five.join(""),
    [...five.slice(0, 2), card(9), ...five.slice(2)].join(""),
  ],
  "F14 split a paragraph with Enter": [
    c.join(""),
    c
      .join("")
      .replace(
        "Body text for card number 2 goes here.",
        "Body text for card</p><p>number 2 goes here.",
      ),
  ],
  "F15 edit the title of one card with inline <b>": [
    c.join("").replace("Title 2", "Title <b>two</b> here"),
    c.join("").replace("Title 2", "Title <b>two</b> HERE"),
  ],
  "F16 move a card up within its container": [
    c.join(""),
    [c[0], c[3], c[1], c[2], c[4]].join(""),
  ],
  "X1 attr and text change on the same card": [
    c.join(""),
    c
      .join("")
      .replace(
        '<div class="card"><h3>Title 2</h3>',
        '<div class="card hot"><h3>Title TWO</h3>',
      ),
  ],
  "X2 class change on one card, text change on a sibling": [
    c.join(""),
    c
      .join("")
      .replace(
        '<div class="card"><h3>Title 1</h3>',
        '<div class="card hot"><h3>Title 1</h3>',
      )
      .replace("Title 3", "Title Three"),
  ],
  "X3 head title change": [c.join(""), c.join("")],
  "X4 template inside the changed card": [
    c
      .join("")
      .replace(
        "<li>two</li></ul></div>",
        "<li>two</li></ul><template><p>t</p></template></div>",
      ),
    c
      .join("")
      .replace(
        "<li>two</li></ul></div>",
        "<li>two</li></ul><template><p>t</p></template></div>",
      )
      .replace("Title 2", "Title TWO"),
  ],
  "X5 template outside, edit elsewhere": [
    c.join("") + "<template><p>t</p></template>",
    c.join("").replace("Title 2", "Title TWO") +
      "<template><p>t</p></template>",
  ],
  "X6 script inside the changed card": [
    c.join("").replace("Title 2</h3>", "Title 2</h3><script>1</script>"),
    c.join("").replace("Title 2</h3>", "Title TWO</h3><script>1</script>"),
  ],
  "X7 edit deep inside nested divs": [
    `<div class="a"><div class="b"><div class="c">${c.join("")}</div></div></div>`,
    `<div class="a"><div class="b"><div class="c">${c.join("").replace("Title 4", "Title Four")}</div></div></div>`,
  ],
  "X8 insert a text node after a card": [
    c.join(""),
    c.slice(0, 2).join("") + "tail" + c.slice(2).join(""),
  ],
  "X9 delete the only child of a container": [
    `<section>${c[0]}</section>${c[1]}`,
    `<section></section>${c[1]}`,
  ],
  "X10 change tag of a card's h3 to h2": [
    c.join(""),
    c.join("").replace("<h3>Title 2</h3>", "<h2>Title 2</h2>"),
  ],
  "X11 form input outside the scope keeps its attributes": [
    `<input value="a"><input value="b">` + c.join(""),
    `<input value="a"><input value="b">` +
      c.join("").replace("Title 2", "Title TWO"),
  ],
  "X12 form input inside the scope changes value attr": [
    `<div class="f"><input value="a"><p>x</p></div>` + c.join(""),
    `<div class="f"><input value="Z"><p>x</p></div>` + c.join(""),
  ],
  "X13 comment node change beside cards": [
    c.join("") + "<!-- a -->",
    c.join("") + "<!-- b -->",
  ],
  "X14 whitespace-only text change between cards": [
    c.join("\n"),
    c.join("\n\n"),
  ],
};
// X3 has a head change: build through opts.
const heads = {
  "X3 head title change": ["<title>a</title>", "<title>b</title>"],
};

const swapIds = (E, capMap, remote) => {
  // The sender swapped the synthetic ids of two byte-identical cards in two
  // sections (0.0 and 0.1 hold one card each), then edited the first.
  const map = {};
  for (const k of Object.keys(capMap)) map[k] = capMap[k];
  const a = "1.0.0",
    b = "1.1.0";
  for (const k of Object.keys(capMap)) {
    if (k === a || k.startsWith(a + "."))
      map[b + k.slice(a.length)] = capMap[k];
    if (k === b || k.startsWith(b + "."))
      map[a + k.slice(b.length)] = capMap[k];
  }
  return map;
};
const freshIds = (E, capMap, remote) =>
  E.createIdentityStore("fresh").exportMap(remote.documentElement, (n) => n);
const S = {
  "Y1 swapped synthetic ids on identical cards, first edited": {
    b: secs([five[0]], [five[0]]),
    r: secs([five[0].replace("Body text here", "Body EDITED here")], [five[0]]),
    mapOf: swapIds,
  },
  "Y2 sender has fresh ids everywhere, edits one card": {
    b: c.join(""),
    r: c.join("").replace("Title 2", "Title TWO"),
    mapOf: freshIds,
  },
  "Y3 sender has fresh ids everywhere, nothing changed": {
    b: c.join(""),
    r: c.join(""),
    mapOf: freshIds,
  },
};

const ignoreOpts = { ignore: (el) => el.matches("[data-ignore]") };
const winsOpts = { remoteWins: (el) => el.matches("[data-wins]") };
const O = {
  "Z1 ignored ancestor of the change": {
    b: `<div data-ignore>${c[0]}</div>${c[1]}`,
    r: `<div data-ignore>${c[0].replace("Title 0", "Title ZERO")}</div>${c[1]}`,
    opts: ignoreOpts,
  },
  "Z2 ignored sibling differs and a card changes": {
    b: `<div data-ignore>x</div>${c.join("")}`,
    r: `<div data-ignore>y</div>${c.join("").replace("Title 2", "Title TWO")}`,
    opts: ignoreOpts,
  },
  "Z3 ignored sibling unchanged, a card changes": {
    b: `<div data-ignore>x</div>${c.join("")}`,
    r: `<div data-ignore>x</div>${c.join("").replace("Title 2", "Title TWO")}`,
    opts: ignoreOpts,
  },
  "Z4 remoteWins ancestor of the change": {
    b: `<div data-wins>${c[0]}</div>${c[1]}`,
    r: `<div data-wins>${c[0].replace("Title 0", "Title ZERO")}</div>${c[1]}`,
    opts: winsOpts,
  },
  "Z5 per-node morph hook present": {
    b: c.join(""),
    r: c.join("").replace("Title 2", "Title TWO"),
    opts: { hooks: { beforeNodeMorphed: () => {} } },
  },
  "Z6 beforeAttributeUpdated veto on class": {
    b: c.join(""),
    r: c
      .join("")
      .replace(
        '<div class="card"><h3>Title 2</h3>',
        '<div class="card hot"><h3>Title TWO</h3>',
      ),
    opts: {
      hooks: {
        beforeAttributeUpdated: (name) =>
          name === "class" ? false : undefined,
      },
    },
  },
};

export { F, S, O, heads };
