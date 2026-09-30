// Shared acceptance bench for oracle v2. Each row: a case, an optional damage
// applied to the real engine's output, and the statuses that count as right.
// OK_PASS: a correct output. It may be undecidable (David, 2026-09-30) but never a counterexample.
// MUST_FAIL: a provably wrong output. MAY_DEFER: wrong, but only provable with extra evidence.
export const OK_PASS = ["passes", "undecidable"];
export const MUST_FAIL = ["counterexample"];
export const MAY_DEFER = ["counterexample", "undecidable"];

const W1b = {
  shape: "dirty",
  identity: "clay",
  base: '<div class="col"><h3>Todo</h3><div class="card" sid="X">Write report</div></div><div class="col" sid="D"><h3>Done</h3></div>',
  local:
    '<div class="col"><h3>Todo</h3><div class="card">Write report</div></div><div class="col" sid="D"><h3>Done</h3><div class="card" sid="X">Write report</div></div>',
  remote:
    '<div class="col"><h3>Todo</h3><div class="card" sid="X">Write report</div></div><div class="col"><h3>Todo</h3><div class="card">Write report</div></div><div class="col" sid="D"><h3>Done</h3></div>',
};
const T2 = {
  shape: "dirty",
  identity: "clay",
  base: '<div class="box"><p sid="P1">Note</p></div><div class="box"><p sid="P2">Note</p></div><p>end</p>',
  local: '<p>end</p><div class="box"><p sid="P1">Note</p></div>',
  remote:
    '<div class="box"></div><div class="box"><p sid="P2">Note</p></div><p>end</p>',
};
const A4 = {
  shape: "element",
  identity: "clay",
  base: '<main><p sid="A">Same</p><p sid="B">Same</p></main>',
  local: '<main><p sid="A">Same LOCAL</p><p sid="B">Same</p></main>',
  remote: '<main><p sid="B">Same</p><p sid="A">Same</p></main>',
};
const DEL2 = (identity) => ({
  shape: "dirty",
  identity,
  base: '<div id="a">Same</div><div id="b">Same</div>',
  local: '<div id="a">Same</div>',
  remote: '<div id="b">Same</div>',
});
const NEUTRAL = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p class="a">Same</p><p class="b">Same</p></main>',
  local: '<main id="M"><p class="b">Same</p><p class="c">Same</p></main>',
  remote: '<main id="M"><p class="b">Same</p></main>',
};
const CLASS = (identity, sid) => ({
  shape: "dirty",
  identity,
  base: `<div${sid} class="a">hi</div>`,
  local: `<div${sid} class="a b">hi</div>`,
  remote: `<div${sid} class="a c">hi</div>`,
});
const STYLE = {
  shape: "dirty",
  identity: "plain",
  base: '<div sid="X" style="color: red">hi</div>',
  local: '<div sid="X" style="color: red; margin: 0">hi</div>',
  remote: '<div sid="X" style="color: blue">hi</div>',
};

const q = (sel) => (doc) => doc.querySelector(sel);
const T2fix = (doc) => {
  const body = doc.body;
  for (const b of [...body.querySelectorAll(".box")]) b.remove();
  for (const p of [...body.querySelectorAll("p")])
    if (p.textContent !== "end") p.remove();
  const box = doc.createElement("div");
  box.className = "box";
  body.append(box);
  return { identities: [], conflicts: [], moved: [], replaced: [] };
};
const T2relabel = (doc) => {
  const body = doc.body;
  const notes = [...body.querySelectorAll("p")].filter(
    (p) => p.textContent === "Note",
  );
  const p1 = notes[0];
  for (const n of notes.slice(1)) n.remove();
  for (const b of [...body.querySelectorAll(".box")])
    if (!b.contains(p1)) b.remove();
  body.append(p1.parentNode);
  return { identities: [[p1, "P2"]], conflicts: [], moved: [], replaced: [] };
};

export const ROWS = [
  ["W1b: real engine (three columns)", W1b, null, OK_PASS],
  [
    "W1b: duplicated Todo column dropped",
    W1b,
    (d) => {
      const c = d.body.querySelectorAll(".col");
      if (c.length === 3) c[1].remove();
    },
    MUST_FAIL,
  ],
  ["T2: identity-correct output (both paragraphs deleted)", T2, T2fix, OK_PASS],
  ["T2: live P1 kept and reported as P2", T2, T2relabel, MUST_FAIL],
  [
    "Two sides delete different copies, default mode ids",
    DEL2("default"),
    null,
    OK_PASS,
  ],
  [
    "Two sides delete different copies, authored ids",
    DEL2("authored"),
    null,
    OK_PASS,
  ],
  [
    "Two sides delete different copies: output keeps one",
    DEL2("authored"),
    (d) => {
      if (!d.body.children.length) d.body.innerHTML = '<div id="a">Same</div>';
    },
    MUST_FAIL,
  ],
  ["Element clay: real engine", A4, null, OK_PASS],
  [
    "Element clay: wrong order",
    A4,
    (d) => {
      const m = d.querySelector("main") || d.body.firstElementChild;
      const ps = [...m.children];
      if (ps[0] && ps[0].textContent !== "Same LOCAL") m.prepend(ps[1]);
    },
    MUST_FAIL,
  ],
  [
    "Element children clay: real engine",
    { ...A4, options: { children: true } },
    null,
    OK_PASS,
  ],
  [
    "Element children clay: wrong order",
    { ...A4, options: { children: true } },
    (d) => {
      const m = d.querySelector("main") || d.body.firstElementChild;
      const ps = [...m.children];
      if (ps[0] && ps[0].textContent !== "Same LOCAL") m.prepend(ps[1]);
    },
    MUST_FAIL,
  ],
  ["Neutral count: real engine", NEUTRAL, null, OK_PASS],
  [
    "Neutral count: local's inserted p.c dropped",
    NEUTRAL,
    (d) => q("p.c")(d)?.remove(),
    MAY_DEFER,
  ],
  [
    "Neutral count: p.c emptied",
    NEUTRAL,
    (d) => {
      const p = q("p.c")(d);
      if (p) p.textContent = "";
    },
    MAY_DEFER,
  ],
  [
    "Class tokens merged, identified element",
    CLASS("plain", ' sid="X"'),
    null,
    OK_PASS,
  ],
  [
    "Class tokens merged, anonymous element",
    CLASS("default", ""),
    null,
    OK_PASS,
  ],
  [
    "Class tokens: local's class b lost",
    CLASS("plain", ' sid="X"'),
    (d) => d.querySelector("div")?.classList.remove("b"),
    MUST_FAIL,
  ],
  ["Style declarations merged", STYLE, null, OK_PASS],
  [
    "Style: local's margin lost",
    STYLE,
    (d) => d.querySelector("div")?.style.removeProperty("margin"),
    MUST_FAIL,
  ],
  [
    "Attribute change lost (href)",
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="A">x <a href="/old">link</a></p><p sid="B">y</p>',
      local: '<p sid="A">x <a href="/old">link</a></p><p sid="B">y LOCAL</p>',
      remote: '<p sid="A">x <a href="/new">link</a></p><p sid="B">y</p>',
    },
    (d) => d.querySelector("a")?.setAttribute("href", "/old"),
    MUST_FAIL,
  ],
  [
    "Textless element lost (img)",
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="A">x</p><p sid="B">y</p>',
      local: '<p sid="A">x</p><p sid="B">y LOCAL</p>',
      remote: '<p sid="A">x <img src="i.png"></p><p sid="B">y</p>',
    },
    (d) => d.querySelector("img")?.remove(),
    MUST_FAIL,
  ],
  [
    "Unused vetoAttr; paragraph content dropped",
    {
      shape: "dirty",
      identity: "plain",
      options: { hooks: { vetoAttr: "data-unused" } },
      base: '<p sid="A">one</p><p sid="B">two</p>',
      local: '<p sid="A">one</p><p sid="B">two LOCAL</p>',
      remote: '<p sid="A">one</p><p sid="B">two REMOTE</p>',
    },
    (d) => {
      d.querySelectorAll("p")[1].textContent = "";
    },
    MUST_FAIL,
  ],
  [
    "Conflict word dropped in the other paragraph",
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="A">alpha</p><p sid="B">beta</p>',
      local: '<p sid="A">alpha gamma</p><p sid="B">beta gamma</p>',
      remote: '<p sid="A">alpha delta</p><p sid="B">beta</p>',
    },
    (d) => {
      d.querySelectorAll("p")[1].textContent = "beta";
    },
    MUST_FAIL,
  ],
  [
    "Reorder conflict in list 1; remote swap in list 2 reverted",
    {
      shape: "dirty",
      identity: "plain",
      base: '<ul sid="L1"><li sid="a">a</li><li sid="b">b</li></ul><ul sid="L2"><li sid="c">c</li><li sid="d">d</li></ul><p sid="P">p</p>',
      local:
        '<ul sid="L1"><li sid="b">b</li><li sid="a">a</li></ul><ul sid="L2"><li sid="c">c</li><li sid="d">d</li></ul><p sid="P">p LOCAL</p>',
      remote:
        '<ul sid="L1"><li sid="a">a</li><li sid="b">b</li><li sid="x">x</li></ul><ul sid="L2"><li sid="d">d</li><li sid="c">c</li></ul><p sid="P">p</p>',
    },
    (d) => {
      const l2 = d.querySelectorAll("ul")[1];
      if (l2.firstElementChild.textContent === "d")
        l2.append(l2.firstElementChild);
    },
    MUST_FAIL,
  ],
  [
    "Text node split mid-word (identical page)",
    {
      shape: "dirty",
      identity: "plain",
      base: '<p sid="A">hello world</p>',
      local: '<p sid="A">hello world LOCAL</p>',
      remote: '<p sid="A">hello world REMOTE</p>',
    },
    (d) => d.querySelector("p").firstChild.splitText(3),
    OK_PASS,
  ],
];
