import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc, document } from "./lib/dom.js";
import { mergeBodies } from "./lib/merge.js";
import { mergeDocument, morphElement, morph } from "../../src/index.js";
import { merge3Text } from "../../src/text-merge.js";

const kinds = (res, k) =>
  res.conflicts.filter((c) =>
    c.kind === "structure" ? c.detail === k : c.kind === k,
  );

const ignore = (el) => el.hasAttribute("data-ignore");

async function merge(base, local, remote, opts = {}) {
  const live = parse(doc(local));
  const report = await mergeDocument({
    live,
    base: doc(base),
    remote: doc(remote),
    ...opts,
  });
  return { live, html: live.body.innerHTML, report };
}

const detail = (report) =>
  report.conflicts.map((c) => c.kind + ":" + (c.detail || "")).join(",");

// Group E: an ignored element the live side injected mid-text is not a
// local divergence, and the text around it still merges as one run.
test("HG-E an ignored element injected mid-text does not split the run", async () => {
  const same = await merge(
    `<p>one two three</p>`,
    `<p>one <span data-ignore>UI</span>two three</p>`,
    `<p>one two three</p>`,
    { ignore },
  );
  assert.equal(same.report.localDiverged, false);
  assert.equal(same.html, `<p>one <span data-ignore="">UI</span>two three</p>`);

  const edited = await merge(
    `<p>one two three</p><p>x</p>`,
    `<p>one <span data-ignore>UI</span>two three</p><p>x</p>`,
    `<p>one two four</p><p>y</p>`,
    { ignore },
  );
  assert.equal(
    edited.html,
    `<p>one <span data-ignore="">UI</span>two four</p><p>y</p>`,
  );
  assert.equal(edited.report.localDiverged, false);
  assert.equal(edited.report.conflicts.length, 0);
});

// Group B: a deleted subtree that a local edit resurrects keeps that edit at
// any depth, not only when the edited node is a direct child.
test("HG-B edit-beats-delete keeps the local edit two levels down", () => {
  const cases = [
    [
      `<section><h2>Groceries</h2><ul><li>buy some milk today</li><li>eggs</li></ul></section><p>tail</p>`,
      `<section><h2>Groceries</h2><ul><li>buy some oat milk today</li><li>eggs</li></ul></section><p>tail</p>`,
    ],
    [
      `<div><p>keep</p><table><tbody><tr><td>old</td><td>x</td></tr></tbody></table></div><p>tail</p>`,
      `<div><p>keep</p><table><tbody><tr><td>new</td><td>x</td></tr></tbody></table></div><p>tail</p>`,
    ],
    [
      `<div><p>keep</p><div><p>old</p><p>x</p></div></div><p>tail</p>`,
      `<div><p>keep</p><div><p>new</p><p>x</p></div></div><p>tail</p>`,
    ],
  ];
  for (const [base, local] of cases) {
    const { html, res } = mergeBodies(base, local, `<p>tail</p>`);
    assert.equal(html, local);
    assert.equal(detail(res), "structure:edit-beats-delete");
  }
});

// Group C: slots pair under parents that only become paired through a slot
// round of their own, however deep.
test("HG-C nested slots pair at every depth", async () => {
  const nested = await merge(
    `<section><p>a0</p><p>b0</p></section><section><p>c0</p><p>d0</p></section>`,
    `<section><p>a1</p><p>b0</p></section><section><p>c0</p><p>d0</p></section>`,
    `<section><p>a1</p><p>b1</p></section><section><p>c1</p><p>d1</p></section>`,
  );
  assert.equal(
    nested.html,
    `<section><p>a1</p><p>b1</p></section><section><p>c1</p><p>d1</p></section>`,
  );
  assert.equal(nested.report.conflicts.length, 0);

  // Differing edits (no echo to re-pair on), so only the repeated slot
  // rounds pair the inner paragraphs: one conflict, remote wins, no copy.
  const clash = await merge(
    `<div><p>a0</p><p>b0</p></div><div><p>c0</p><p>d0</p></div>`,
    `<div><p>a8</p><p>b0</p></div><div><p>c0</p><p>d0</p></div>`,
    `<div><p>a1</p><p>b1</p></div><div><p>c1</p><p>d1</p></div>`,
  );
  assert.equal(
    clash.html,
    `<div><p>a1</p><p>b1</p></div><div><p>c1</p><p>d1</p></div>`,
  );
  assert.equal(clash.report.conflicts.length, 1);

  const t = (rows) =>
    `<table><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const table = await merge(
    t([
      ["3", "5"],
      ["7", "9"],
    ]),
    t([
      ["4", "5"],
      ["7", "9"],
    ]),
    t([
      ["4", "6"],
      ["8", "10"],
    ]),
  );
  assert.equal(
    table.html,
    t([
      ["4", "6"],
      ["8", "10"],
    ]),
  );
  assert.equal(table.report.conflicts.length, 0);
});

// Group H: a formatting wrapper grafted around live content keeps the
// ignored live element the inline merge pinned inside it.
test("HG-H grafting a new mark keeps a pinned ignored element", async () => {
  const { live, html } = await merge(
    `<p>one two</p>`,
    `<p>one <span data-ignore>UI</span>two</p>`,
    `<p><b>one two</b></p>`,
    { ignore },
  );
  assert.equal(html, `<p><b>one <span data-ignore="">UI</span>two</b></p>`);
  assert.equal(live.querySelectorAll("span").length, 1);
});

// Group I: the same text inserted on both sides keeps the marks one side
// put on it.
test("HG-I an identical insertion keeps the remote formatting", async () => {
  const { html, report } = await merge(
    `<p>one two</p>`,
    `<p>one wow two</p>`,
    `<p>one <b>wow</b> two</p>`,
  );
  assert.equal(html, `<p>one <b>wow</b> two</p>`);
  assert.equal(report.conflicts.length, 0);

  const local = await merge(
    `<p>one two</p>`,
    `<p>one <i>wow</i> two</p>`,
    `<p>one wow two</p>`,
  );
  assert.equal(local.html, `<p>one <i>wow</i> two</p>`);
  assert.equal(local.report.conflicts.length, 0);
});

// Group L: a focused checkbox or select keeps its state under
// protectFocusedValue, as a focused text input does.
test("HG-L a focused checkbox or select keeps its state", async () => {
  for (const formState of ["property", "attribute"]) {
    const host = document.createElement("div");
    host.innerHTML = `<input id="c" type="checkbox"><select id="s"><option value="a">A</option><option value="b">B</option></select>`;
    document.body.appendChild(host);
    const box = host.querySelector("#c");
    box.checked = true;
    box.indeterminate = true;
    box.focus();
    assert.equal(document.activeElement, box);
    const tpl = document.createElement("template");
    tpl.innerHTML = host.innerHTML;
    await morphElement(host, tpl.content, {
      children: true,
      protectFocusedValue: true,
      formState,
    });
    assert.equal(box.checked, true, formState + " checked");
    assert.equal(box.indeterminate, true, formState + " indeterminate");

    const sel = host.querySelector("#s");
    sel.value = "b";
    sel.focus();
    assert.equal(document.activeElement, sel);
    const tpl2 = document.createElement("template");
    tpl2.innerHTML = host.innerHTML;
    tpl2.content.querySelector("#s").value = "a";
    await morphElement(host, tpl2.content, {
      children: true,
      protectFocusedValue: true,
      formState,
    });
    assert.equal(sel.value, "b", formState + " select");
    host.remove();
  }
});

// Group A: string and fragment content in children mode is a template
// whose content is the children, not an element with none.
test("HG-A a children morph with a string base merges three ways", async () => {
  const live = parse(doc(`<div id="r"><p>a</p><p>b</p><p>local</p></div>`));
  const el = live.getElementById("r");
  const pa = el.firstElementChild;
  const report = await morphElement(el, `<p>a</p><p>b2</p>`, {
    children: true,
    base: `<p>a</p><p>b</p>`,
  });
  assert.equal(el.innerHTML, `<p>a</p><p>b2</p><p>local</p>`);
  assert.equal(el.firstElementChild, pa);
  assert.equal(report.localDiverged, true);

  const two = parse(doc(`<div id="r"><p>a</p><p>b</p></div>`));
  const same = await morphElement(two.getElementById("r"), `<p>a</p><p>b</p>`, {
    children: true,
  });
  assert.equal(same.localDiverged, false);
  assert.deepEqual(same.applied, []);
});

test("HG-A a string that is a body or html element keeps its wrapper", async () => {
  const live = parse(
    doc(`<div class="a"><p>x</p></div><div class="b"><p>y</p></div>`),
  );
  const body = live.body;
  await morph(
    body,
    `<body><div class="a"><p>x</p></div><div class="b"><p>y2</p></div></body>`,
    {
      policy: "raw",
    },
  );
  assert.equal(live.body, body);
  assert.equal(
    body.innerHTML,
    `<div class="a"><p>x</p></div><div class="b"><p>y2</p></div>`,
  );
  await morph(body, `<body><p>only</p></body>`, {
    policy: "raw",
    morphStyle: "innerHTML",
  });
  assert.equal(body.innerHTML, `<p>only</p>`);
});

test("HG-A compat mergeBase resolves to the element that corresponds to the target", async () => {
  const inner = `<header>H</header><main><p>one</p><p>two</p></main><footer>F</footer>`;
  const remote = `<header>H</header><main><p>one</p><p>two, edited</p></main><footer>F</footer>`;
  const cases = [
    ["body outerHTML string", (live) => live.body.outerHTML],
    ["Document", (live) => parse(live.documentElement.outerHTML)],
    [
      "body element of another document",
      (live) => parse(live.documentElement.outerHTML).body,
    ],
    [
      "element that corresponds to nothing",
      (live) => live.createElement("script"),
    ],
  ];
  for (const [label, baseOf] of cases) {
    const live = parse(doc(inner));
    const base = baseOf(live);
    live.querySelector("header").textContent = "H local";
    const candidate = parse(doc(remote)).body;
    await morph(live.body, candidate, {
      morphStyle: "outerHTML",
      policy: "raw",
      scripts: { mergeBase: base },
    });
    const want =
      label === "element that corresponds to nothing"
        ? remote
        : remote.replace("<header>H</header>", "<header>H local</header>");
    assert.equal(live.body.innerHTML, want, label);
  }
  const live = parse(doc(`<div id="r"><p>a</p><p>b</p><p>local</p></div>`));
  const el = live.getElementById("r");
  const base = el.cloneNode(true);
  base.lastElementChild.remove();
  await morph(el, `<p>a</p><p>b2</p>`, {
    morphStyle: "innerHTML",
    policy: "raw",
    scripts: { mergeBase: base },
  });
  assert.equal(
    el.innerHTML,
    `<p>a</p><p>b2</p><p>local</p>`,
    "element base, innerHTML",
  );
});

// Group M: a hook that throws under head.block rejects the returned Promise
// (0.5.4 ran the hooks after the wait); without head.block it throws as it
// did. Nothing removed by the failing hook is gone.
// Group A: a mergeBase that is a lone script tag (0.5.4 used mergeBase for
// script merges only) still merges that script three-way; everything else
// morphs two-way.
test("HG-A a lone script mergeBase merges the script three-way", async () => {
  const tag = (json) =>
    `<script type="application/json" merge="store">${json}</script>`;
  const live = parse(
    doc(`<div id="r">${tag('{"a": 2, "b": 1}')}<p>x</p></div>`),
  );
  const el = live.getElementById("r");
  const baseScript = parse(doc(tag('{"a": 1, "b": 1}'))).querySelector(
    "script",
  );
  await morph(el, `<div id="r">${tag('{"a": 1, "b": 2}')}<p>y</p></div>`, {
    policy: "raw",
    scripts: { mergeBase: baseScript, handle: false },
  });
  assert.deepEqual(JSON.parse(el.querySelector("script").textContent), {
    a: 2,
    b: 2,
  });
  assert.equal(el.querySelector("p").textContent, "y");
});

test("HG-M compat head.block turns a hook error into a rejection", async () => {
  const saved = {
    head: document.head.innerHTML,
    body: document.body.innerHTML,
  };
  try {
    document.head.innerHTML = "";
    document.body.innerHTML = `<main><section id="discard"><span id="keep">keep</span></section><article id="destination"></article></main>`;
    const main = document.querySelector("main");
    const discarded = document.querySelector("#discard");
    const boom = new Error("hook failed");
    const pending = morph(
      document.documentElement,
      `<html><head><link rel="stylesheet" href="/r2.css"></head><body><main><article id="destination"><span id="keep">keep</span></article></main></body></html>`,
      {
        head: { block: true },
        callbacks: {
          beforeNodeRemoved(node) {
            if (node === discarded) throw boom;
          },
        },
      },
    );
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, (e) => e === boom);
    assert.equal(discarded.parentNode, main);

    document.body.innerHTML = `<main><section id="discard"><span id="keep">keep</span></section><article id="destination"></article></main>`;
    const d2 = document.querySelector("#discard");
    assert.throws(
      () =>
        morph(
          document.querySelector("main"),
          `<article id="destination"><span id="keep">keep</span></article>`,
          {
            morphStyle: "innerHTML",
            callbacks: {
              beforeNodeRemoved(node) {
                if (node === d2) throw boom;
              },
            },
          },
        ),
      (e) => e === boom,
    );
    assert.equal(d2.parentNode, document.querySelector("main"));
  } finally {
    document.head.innerHTML = saved.head;
    document.body.innerHTML = saved.body;
  }
});

// Group J: a node the remote moved out of the focused editor is moved, not
// copied, whichever parent is applied first.
test("HG-J a node moved out of the focused subtree is not duplicated", async () => {
  const shapes = [
    [
      `<div id="ed" contenteditable="true"><span id="x">A</span><p>stay</p></div><div id="other"></div>`,
      `<div id="ed" contenteditable="true"><p>stay</p></div><div id="other"><span id="x">A</span></div>`,
    ],
    [
      `<div id="other"></div><div id="ed" contenteditable="true"><span id="x">A</span><p>stay</p></div>`,
      `<div id="other"><span id="x">A</span></div><div id="ed" contenteditable="true"><p>stay</p></div>`,
    ],
  ];
  for (const [before, after] of shapes) {
    const host = document.createElement("div");
    host.innerHTML = before;
    document.body.appendChild(host);
    const ed = host.querySelector("#ed");
    const x = host.querySelector("#x");
    ed.focus();
    assert.equal(document.activeElement, ed);
    await morph(host, after, {
      morphStyle: "innerHTML",
      policy: "raw",
      ignoreActiveValue: true,
    });
    assert.equal(host.innerHTML, after);
    assert.equal(host.querySelector("#x"), x);
    host.remove();
  }
});

// Group K: similar elements pair by the best score across the parent, so
// dragging the last item out of one list into another moves the item.
test("HG-K dragging the last item into another list moves it", () => {
  const base = `<h3>Mon</h3><ul sortable><li>Buy milk</li></ul><h3>Tue</h3><ul sortable><li>Call Bob</li><li>Pay rent</li></ul>`;
  const drag = `<h3>Mon</h3><ul sortable></ul><h3>Tue</h3><ul sortable><li>Buy milk</li><li>Call Bob</li><li>Pay rent</li></ul>`;
  const cases = [
    [
      base.replace("Pay rent", "Pay rent today"),
      drag,
      drag.replace("Pay rent", "Pay rent today"),
    ],
    [
      base.replace("<li>Pay rent</li>", "<li>Pay rent</li><li>Gym</li>"),
      drag,
      drag.replace("<li>Pay rent</li>", "<li>Pay rent</li><li>Gym</li>"),
    ],
    [
      drag,
      base.replace("Pay rent", "Pay rent today"),
      drag.replace("Pay rent", "Pay rent today"),
    ],
  ];
  for (const [local, remote, want] of cases) {
    const { html, res } = mergeBodies(base, local, remote);
    assert.equal(html, want.replace(/sortable>/g, 'sortable="">'));
    assert.equal(res.conflicts.length, 0);
  }
});

// Group N: a region read as base (remoteWins) or ignored keeps its live
// nodes on a dirty-tab merge; provenance names the real local twin.
test("HG-N an unchanged remoteWins or ignored region keeps its live nodes", async () => {
  const body = `<div no-dirty><h4>Filters</h4><p>a</p><button>x</button><!-- c --></div><div data-ignore><p>ui</p></div><p id="t">t</p>`;
  const live = parse(doc(body.replace("t</p>", "t local</p>")));
  const region = live.querySelector("[no-dirty]");
  const ignored = live.querySelector("[data-ignore]");
  const before = [...region.childNodes, ...ignored.childNodes, region, ignored];
  const report = await mergeDocument({
    live,
    base: doc(body),
    remote: doc(body.replace("t</p>", "t remote</p>")),
    remoteWins: (el) => el.hasAttribute("no-dirty"),
    ignore: (el) => el.hasAttribute("data-ignore"),
  });
  const after = [...region.childNodes, ...ignored.childNodes, region, ignored];
  assert.equal(after.length, before.length);
  after.forEach((n, i) => assert.equal(n, before[i], "node " + i));
  assert.equal(live.contains(region), true);
  assert.equal(
    region.outerHTML,
    `<div no-dirty=""><h4>Filters</h4><p>a</p><button>x</button><!-- c --></div>`,
  );
  assert.deepEqual(
    report.applied.filter((a) => a.kind === "insert" || a.kind === "remove"),
    [],
  );
  assert.equal(live.getElementById("t").textContent, "t local remote");
});

// Group D: an insertion both sides carry is one element. Identical copies
// merge silently; copies that differ collide and the policy picks one;
// a weak pair with a base element gives way to the echo.
test("HG-D echoed inserts with differing copies collide instead of duplicating", () => {
  const collision = (res) => kinds(res, "insert-collision").length;
  const d1 = mergeBodies(
    `<p>alpha</p><p>charlie</p>`,
    `<p>alpha</p><p>xray yank</p><p>charlie</p>`,
    `<p>alpha</p><p>xray yank</p>`,
  );
  assert.equal(d1.html, `<p>alpha</p><p>xray yank</p>`);
  assert.equal(d1.res.conflicts.length, 0);

  const d2 = mergeBodies(
    `<p>one</p><p>two</p>`,
    `<p>one</p><p>new para</p><p>two</p>`,
    `<p>one</p><p>new para plus</p><p>two</p>`,
  );
  assert.equal(d2.html, `<p>one</p><p>new para plus</p><p>two</p>`);
  assert.equal(d2.res.conflicts.length, 0);

  const d3 = mergeBodies(
    `<p>one</p>`,
    `<p>one</p><p><b>new</b> para</p>`,
    `<p>one</p><p>new para</p>`,
  );
  assert.equal(d3.html, `<p>one</p><p><b>new</b> para</p>`);
  assert.equal(d3.res.conflicts.length, 0);

  const d4 = mergeBodies(
    `<div><p>inner</p></div><p>moved</p>`,
    `<div><p>inner</p></div><p>moved</p><p>fresh text</p>`,
    `<div><p>moved</p><p>inner</p></div><p>fresh text</p>`,
  );
  assert.equal(d4.html, `<div><p>moved</p><p>inner</p></div><p>fresh text</p>`);

  const e1 = mergeBodies(
    `<p>one</p><p>two</p>`,
    `<p>one</p><p data-id="x">new para</p><p>two</p>`,
    `<p>one</p><p data-id="x">new para plus</p><p>two</p>`,
  );
  assert.equal(e1.html, `<p>one</p><p data-id="x">new para plus</p><p>two</p>`);
  assert.equal(e1.res.conflicts.length, 0);
  const e2 = mergeBodies(
    `<p>one</p>`,
    `<p>one</p><p data-id="x">new para local</p>`,
    `<p>one</p><p data-id="x">new para remote</p>`,
  );
  assert.equal(e2.html, `<p>one</p><p data-id="x">new para remote</p>`);
  assert.equal(e2.res.conflicts.length, 1);
  const e2l = mergeBodies(
    `<p>one</p>`,
    `<p>one</p><p data-id="x">new para local</p>`,
    `<p>one</p><p data-id="x">new para remote</p>`,
    { conflicts: "local" },
  );
  assert.equal(e2l.html, `<p>one</p><p data-id="x">new para local</p>`);
  const blocks = mergeBodies(
    `<p>one</p>`,
    `<p>one</p><div data-id="x"><p>a</p><p>local</p></div>`,
    `<p>one</p><div data-id="x"><p>a</p><p>remote</p></div>`,
  );
  assert.equal(
    blocks.html,
    `<p>one</p><div data-id="x"><p>a</p><p>remote</p></div>`,
  );
  assert.equal(collision(blocks.res), 1);
  const text = mergeBodies(
    `<div><p>a</p></div>`,
    `<div><p>a</p>hello there</div>`,
    `<div><p>a</p>hello there friend</div>`,
  );
  assert.equal(text.html, `<div><p>a</p>hello there friend</div>`);
  assert.equal(text.res.conflicts.length, 0);
});

// Group D: the similarity fallback never pairs two inserts whose authored
// ids differ, however alike their text (Fable doc-fuzz #192).
test("HG-D alike inserts with different ids at one anchor both land", () => {
  const { html, res } = mergeBodies(
    `<p data-id="p1">one two</p><p data-id="p2">three four</p>`,
    `<p data-id="p1">one two</p><p data-id="n0">delta muP</p><p data-id="p2">three four</p>`,
    `<p data-id="p1">one two</p><p data-id="n2">eta muP</p><p data-id="p2">three four</p>`,
  );
  assert.ok(html.includes(`data-id="n0"`), html);
  assert.ok(html.includes(`data-id="n2"`), html);
  assert.equal(kinds(res, "insert-collision").length, 0);
});

test("HG-D an echoed word beside a one-sided edit is not a conflict", () => {
  const cases = [
    ["the cat sat", "the dog ran", "the dog sat", "the dog ran"],
    ["a b c", "x y c", "x b c", "x y c"],
    [
      "Hello wrold today",
      "Hello world todya",
      "Hello world today",
      "Hello world todya",
    ],
    [
      "The quick brown fox",
      "The slow red fox",
      "The slow brown fox",
      "The slow red fox",
    ],
  ];
  for (const [b, l, r, want] of cases) {
    const res = merge3Text(b, l, r);
    assert.equal(res.text, want, b);
    assert.equal(res.conflicts.length, 0, b);
    const dom = mergeBodies(`<p>${b}</p>`, `<p>${l}</p>`, `<p>${r}</p>`);
    assert.equal(dom.html, `<p>${want}</p>`, b);
    assert.equal(dom.res.conflicts.length, 0, b);
  }
  const both = merge3Text("the cat sat", "the dog sat", "the dog sat");
  assert.equal(both.text, "the dog sat");
  const real = merge3Text("the cat sat", "the dog ran", "the fox sat");
  assert.equal(real.conflicts.length, 1);
});

// Group G: typing that landed after the local snapshot survives a remote
// change that split or re-wrapped the node it went into.
test("HG-G typing after the snapshot survives a re-wrap of its node", async () => {
  const cases = [
    [
      `<p>one two three</p>`,
      `<p>one <b>two</b> three</p>`,
      "end",
      " later",
      `<p>one <b>two</b> three later</p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p><b>one</b> two three</p>`,
      "end",
      " later",
      `<p><b>one</b> two three later</p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p>one two <b>three</b></p>`,
      "start",
      "X",
      `<p>Xone two <b>three</b></p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p>one two <b>three</b></p>`,
      "end",
      " later",
      `<p>one two <b>three</b> later</p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p><b>one two three</b></p>`,
      "end",
      " later",
      `<p><b>one two three</b> later</p>`,
    ],
    [
      `<p>see docs now</p>`,
      `<p>see <a href="/d">docs</a> now</p>`,
      "mid",
      "X",
      `<p>see <a href="/d">docs</a>X now</p>`,
    ],
    [
      `<p>one two three</p>`,
      `<p>one two</p>`,
      "end",
      " later",
      `<p>one two</p>`,
    ],
  ];
  for (const [base, remote, where, typing, want] of cases) {
    const live = parse(doc(base));
    const clone = live.documentElement.cloneNode(true);
    const map = new Map();
    (function pair(l, c) {
      map.set(c, l);
      for (let i = 0; i < l.childNodes.length; i++)
        pair(l.childNodes[i], c.childNodes[i]);
    })(live.documentElement, clone);
    const text = live.querySelector("p").firstChild;
    if (where === "end") text.nodeValue += typing;
    else if (where === "start") text.nodeValue = typing + text.nodeValue;
    else text.nodeValue = text.nodeValue.replace("docs", "docs" + typing);
    await mergeDocument({
      live,
      base: doc(base),
      remote: doc(remote),
      local: { root: clone, toLive: (n) => map.get(n) || null },
    });
    assert.equal(live.body.innerHTML, want, remote + " " + where);
  }
});

test("HG-F8 property mode still moves the value attribute", async () => {
  const host = document.createElement("div");
  host.innerHTML = `<input id="v" value="attr-old">`;
  document.body.appendChild(host);
  host.querySelector("input").value = "live-typed";
  const next = document.createElement("div");
  const i = document.createElement("input");
  i.id = "v";
  i.setAttribute("value", "attr-new");
  i.value = "prop-new";
  next.appendChild(i);
  await morph(host, next, {
    morphStyle: "innerHTML",
    formStateSync: "property",
    policy: "raw",
  });
  const got = host.querySelector("input");
  assert.equal(got.value, "prop-new");
  assert.equal(got.getAttribute("value"), "attr-new");
  host.remove();
});

test("HG-D2 an echoed word lands once beside an edit only one side made", () => {
  const cases = [
    // [base, local, remote, merged]
    ["w4 w5 w6 w7", "w10 w5 w6 w9 w7", "w4 w5 w6 w9 w7", "w10 w5 w6 w9 w7"],
    ["a b c d", "a b c Y d", "X b c Y d", "X b c Y d"],
    // Glued to the other side's replacement of the word before it.
    ["w0 w1 w2", "w0 w7 w1 w2", "w10 w7 w1 w2", "w10 w7 w1 w2"],
    ["w0 w1 w2", "w10 w7 w1 w2", "w0 w7 w1 w2", "w10 w7 w1 w2"],
    // One side typed on after, or before, the echoed text.
    ["a b", "a foo b", "a foo bar b", "a foo bar b"],
    ["a b", "a foo bar b", "a foo b", "a foo bar b"],
    ["a b", "a foo b", "a bar foo b", "a bar foo b"],
    ["a b", "a bar foo b", "a foo b", "a bar foo b"],
    // Both sides rewrote the same word alike; one typed on after or before.
    ["a wrold b", "a world tuday b", "a world b", "a world tuday b"],
    ["a wrold b", "a world b", "a tuday world b", "a tuday world b"],
  ];
  for (const [b, l, r, want] of cases) {
    const m = merge3Text(b, l, r);
    assert.equal(m.text, want, `${l} / ${r}`);
    assert.equal(m.conflicts.length, 0, `${l} / ${r}`);
    const { html, res } = mergeBodies(
      `<p>${b}</p>`,
      `<p>${l}</p>`,
      `<p>${r}</p>`,
    );
    assert.equal(html, `<p>${want}</p>`, `inline ${l} / ${r}`);
    assert.equal(res.conflicts.length, 0, `inline ${l} / ${r}`);
  }
  // Two different insertions at one point still both land, local first.
  assert.equal(merge3Text("a b", "a x b", "a y b").text, "a x y b");
  // Each side typed something different beside the same word: two whole
  // insertions, never a fused word from their two rests.
  for (const [l, r, want] of [
    ["a x foo b", "a y foo b", "a x foo y foo b"],
    ["a foo x b", "a foo y b", "a foo x foo y b"],
  ]) {
    assert.equal(merge3Text("a b", l, r).text, want);
    assert.equal(
      mergeBodies(`<p>a b</p>`, `<p>${l}</p>`, `<p>${r}</p>`).html,
      `<p>${want}</p>`,
    );
  }
});
