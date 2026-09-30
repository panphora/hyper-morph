import { OK_PASS, MUST_FAIL, MAY_DEFER } from "./bench-cases.mjs";
const NEU = {
  shape: "dirty",
  identity: "plain",
  base: '<section sid="S"><p>Word here</p><p>Word there</p></section>',
  local:
    '<section sid="S"><p>Word there</p><blockquote>Word again</blockquote></section>',
  remote: '<section sid="S"><p>Word there</p></section>',
};
const CLS = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="X" class="a b">hi</div>',
  local: '<div sid="X" class="a">hi</div>',
  remote: '<div sid="X" class="a b c">hi</div>',
};
const STY = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="X" style="color: red; margin: 0">hi</div>',
  local: '<div sid="X" style="color: red; margin: 0; padding: 1px">hi</div>',
  remote: '<div sid="X" style="color: red">hi</div>',
};
const DEL3 = {
  shape: "dirty",
  identity: "plain",
  base: '<ul sid="L"><li sid="a">Item</li><li sid="b">Item</li><li sid="c">Item</li></ul>',
  local: '<ul sid="L"><li sid="b">Item</li><li sid="c">Item</li></ul>',
  remote: '<ul sid="L"><li sid="a">Item</li><li sid="b">Item</li></ul>',
};
const AUTH = {
  shape: "dirty",
  identity: "authored",
  base: '<p id="x">Hi</p><p id="y">Hi</p><p>end</p>',
  local: '<p id="x">Hi</p><p>end</p>',
  remote: '<p id="y">Hi</p><p>end</p>',
};
const ELATTR = {
  shape: "element",
  identity: "plain",
  base: '<main sid="M"><span sid="s" data-state="off">x</span><b>y</b></main>',
  local:
    '<main sid="M"><span sid="s" data-state="off">x</span><b>y LOCAL</b></main>',
  remote: '<main sid="M"><span sid="s" data-state="on">x</span><b>y</b></main>',
};
const HR = {
  shape: "dirty",
  identity: "default",
  base: "<p>one</p><p>two</p>",
  local: "<p>one</p><hr><p>two</p>",
  remote: "<p>one</p><p>two REMOTE</p>",
};
const DUP = {
  shape: "dirty",
  identity: "plain",
  base: '<p sid="A">a</p><p sid="B">b</p>',
  local: '<p sid="A">a LOCAL</p><p sid="B">b</p>',
  remote: '<p sid="A">a</p><p sid="B">b</p><p sid="C">fresh remote</p>',
};
const ORD = {
  shape: "dirty",
  identity: "plain",
  base: '<ol sid="A"><li sid="1">1</li><li sid="2">2</li></ol><ol sid="B"><li sid="3">3</li><li sid="4">4</li></ol>',
  local:
    '<ol sid="A"><li sid="2">2</li><li sid="1">1</li></ol><ol sid="B"><li sid="3">3</li><li sid="4">4</li><li sid="5">5</li></ol>',
  remote:
    '<ol sid="A"><li sid="1">1</li><li sid="2">2</li><li sid="9">9</li></ol><ol sid="B"><li sid="3">3</li><li sid="4">4</li></ol>',
};
const COMMON = {
  shape: "dirty",
  identity: "default",
  base: "<p>the cat and the dog</p><p>the end of the day</p><p>the last of the words</p>",
  local:
    "<p>the big cat and the dog</p><p>the end of the day</p><p>the last of the words</p>",
  remote:
    "<p>the cat and the dog</p><p>the end of the day</p><p>the very last of the words</p>",
};
export const ROWS = [
  [
    "H neutral: real engine drops Word there (pre-existing engine bug)",
    NEU,
    null,
    MUST_FAIL,
  ],
  [
    "H neutral: local blockquote dropped",
    NEU,
    (d) => d.querySelector("blockquote")?.remove(),
    MAY_DEFER,
  ],
  ["H class remove+add: real engine", CLS, null, OK_PASS],
  [
    "H class: local's removal of b undone",
    CLS,
    (d) => d.querySelector("div")?.classList.add("b"),
    MUST_FAIL,
  ],
  ["H style remove+add: real engine", STY, null, OK_PASS],
  [
    "H style: remote's removed margin restored",
    STY,
    (d) => d.querySelector("div")?.style.setProperty("margin", "0"),
    MUST_FAIL,
  ],
  ["H three copies, two deleted: real engine", DEL3, null, OK_PASS],
  [
    "H three copies: an anonymous copy added back",
    DEL3,
    (d) => {
      const u = d.querySelector("ul");
      const li = d.createElement("li");
      li.textContent = "Item";
      u?.append(li);
    },
    MUST_FAIL,
  ],
  ["H authored delete-different: real engine", AUTH, null, OK_PASS],
  [
    "H authored: x kept and renamed y",
    AUTH,
    (d) => {
      if (!d.querySelector("#x") && !d.querySelector("#y")) {
        const p = d.createElement("p");
        p.id = "y";
        p.textContent = "Hi";
        d.body.prepend(p);
      }
    },
    MUST_FAIL,
  ],
  ["H element attr: real engine", ELATTR, null, OK_PASS],
  [
    "H element attr: remote data-state lost",
    ELATTR,
    (d) => d.querySelector("span")?.setAttribute("data-state", "off"),
    MUST_FAIL,
  ],
  ["H hr insert: real engine", HR, null, OK_PASS],
  [
    "H hr insert: hr dropped",
    HR,
    (d) => d.querySelector("hr")?.remove(),
    MUST_FAIL,
  ],
  ["H remote paragraph: real engine", DUP, null, OK_PASS],
  [
    "H remote paragraph duplicated (anonymous copy)",
    DUP,
    (d) => {
      const p = d.createElement("p");
      p.textContent = "fresh remote";
      d.body.append(p);
    },
    MUST_FAIL,
  ],
  [
    "H B's local insertion at the end moved first",
    ORD,
    (d) => {
      const b = d.querySelectorAll("ol")[1];
      const five = [...(b?.children || [])].find((x) => x.textContent === "5");
      if (five) b.prepend(five);
    },
    MUST_FAIL,
  ],
  ["H local reorder + remote insert: real engine", ORD, null, OK_PASS],
  ["H common words: real engine", COMMON, null, OK_PASS],
  [
    "H common words: remote's 'very' lost",
    COMMON,
    (d) => {
      const p = d.querySelectorAll("p")[2];
      if (p) p.textContent = p.textContent.replace("very ", "");
    },
    MUST_FAIL,
  ],
];
