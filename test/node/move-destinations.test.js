import assert from "node:assert/strict";
import { test } from "node:test";
import { createMoveDestinations } from "../../src/move-destinations.js";
import { flatten, mergeInline, prepareInline } from "../../src/inline-merge.js";
import { mergeDocument, merge3 } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

const original =
  '<main id="root"><section id="source"><i id="before">before</i><p id="move">payload</p><i id="after">after</i></section><aside id="dest"><em id="anchor">anchor</em></aside></main>';
const moved =
  '<main id="root"><section id="source"><i id="before">before</i><i id="after">after</i></section><aside id="dest"><em id="anchor">anchor</em><p id="move">payload</p></aside></main>';
const omitted =
  '<main id="root"><section id="source"><i id="before">before</i><i id="after">after</i></section><aside id="dest"><em id="anchor">anchor</em></aside></main>';

function fixture({
  b = original,
  l = moved,
  r = original,
  output = omitted,
} = {}) {
  const docs = {
    base: parse(doc(b)),
    local: parse(doc(l)),
    remote: parse(doc(r)),
  };
  const out = parse(doc(output));
  const provenance = new WeakMap();
  const owners = new WeakMap();
  const ids = {};
  const walk = (root, fn) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      fn(node);
      const target = node.tagName === "TEMPLATE" ? node.content : node;
      if (target !== node) owners.set(target, node);
      for (const child of target.childNodes) stack.push(child);
    }
  };
  for (const [side, tree] of Object.entries(docs)) {
    const index = new Map();
    walk(tree.documentElement, (node) => {
      if (node.nodeType === 1 && node.id) index.set(node.id, node);
    });
    ids[side] = index;
  }
  const find = (side, id) => ids[side].get(id) || null;
  const annotate = (node) => {
    if (node.nodeType === 1 && node.id)
      provenance.set(node, {
        base: find("base", node.id),
        local: find("local", node.id),
        remote: find("remote", node.id),
      });
  };
  walk(out.documentElement, annotate);
  let builds = 0;
  const discards = [];
  const registry = createMoveDestinations({
    provenance,
    parentOf: (node) =>
      owners.get(node?.parentNode) || node?.parentNode || null,
    twins: (node) => ({
      local: find("local", node.id),
      remote: find("remote", node.id),
    }),
    baseOf: (node) => (node ? find("base", node.id) : null),
    build: (node) => {
      builds++;
      const copy = out.importNode(find("remote", node.id) || node, true);
      walk(copy, annotate);
      registry.produced(node, copy);
      return copy;
    },
    ignored: (node) => !!node?.closest?.("[data-ignore]"),
    remoteWins: (node) => !!node?.closest?.("[data-remote]"),
    discarded: (node) => discards.push(node),
  });
  const base = find("base", "move");
  const local = find("local", "move");
  const record = registry.plan(base, "local", local);
  return {
    out,
    root: out.getElementById("root"),
    registry,
    provenance,
    base,
    local,
    record,
    find,
    discards,
    builds: () => builds,
  };
}

test("a built output in a detached fragment completes only after the final drain", () => {
  const f = fixture();
  const node = f.out.importNode(f.base, true);
  f.provenance.set(node, {
    base: f.base,
    local: f.local,
    remote: f.find("remote", "move"),
  });
  const fragment = f.out.createDocumentFragment();
  fragment.append(node);
  f.registry.produced(f.base, node);
  assert.equal(f.record.state, "built");
  assert.equal(f.root.querySelectorAll("#move").length, 0);
  f.registry.drain(f.root);
  assert.equal(f.record.state, "attached");
  assert.equal(f.record.disposition, "node");
  assert.equal(f.root.querySelectorAll("#move").length, 1);
  assert.equal(f.out.getElementById("dest").lastElementChild, node);
  assert.equal(fragment.childNodes.length, 0);
  assert.equal(f.builds(), 0);
});

test("an unbuilt missing destination falls back at the original source port", () => {
  const f = fixture({ output: omitted.replace(/<aside.*<\/aside>/, "") });
  assert.equal(f.record.state, "planned");
  f.registry.drain(f.root);
  assert.equal(f.builds(), 1);
  assert.deepEqual(
    [...f.out.getElementById("source").children].map((node) => node.id),
    ["before", "move", "after"],
  );
  assert.equal(f.record.state, "attached");
});

test("an absent source parent falls back to the nearest surviving ancestor", () => {
  const f = fixture({
    output: '<main id="root"><footer>retained</footer></main>',
  });
  f.registry.drain(f.root);
  assert.equal(f.out.getElementById("move").parentNode, f.root);
  assert.equal(f.root.querySelectorAll("#move").length, 1);
  assert.equal(f.builds(), 1);
});

test("an attached moved mark with side provenance discharges a duplicate built output", () => {
  const f = fixture({ output: moved });
  const retained = f.out.getElementById("move");
  f.provenance.set(retained, { base: null, local: f.local, remote: null });
  const detached = f.out.importNode(f.base, true);
  f.registry.produced(f.base, detached);
  f.registry.drain(f.root);
  assert.equal(f.record.output, retained);
  assert.equal(f.root.querySelectorAll("#move").length, 1);
  assert.equal(detached.parentNode, null);
  assert.equal(f.builds(), 0);
});

test("a planned parent is attached before its descendant is drained", () => {
  const f = fixture({
    b: '<main id="root"><section id="source"><article id="wrapper"><p id="move">payload</p></article></section><aside id="dest"></aside></main>',
    l: '<main id="root"><section id="source"></section><aside id="dest"><article id="wrapper"><p id="move">payload</p></article></aside></main>',
    r: '<main id="root"><section id="source"><article id="wrapper"><p id="move">payload</p></article></section><aside id="dest"></aside></main>',
    output:
      '<main id="root"><section id="source"></section><aside id="dest"></aside></main>',
  });
  const parent = f.registry.plan(
    f.find("base", "wrapper"),
    "local",
    f.find("local", "wrapper"),
  );
  f.registry.drain(f.root);
  assert.equal(f.builds(), 1);
  assert.equal(parent.state, "attached");
  assert.equal(f.record.state, "attached");
  assert.equal(f.root.querySelectorAll("#move").length, 1);
  assert.equal(f.out.getElementById("move").parentNode.id, "wrapper");
  assert.equal(f.out.getElementById("wrapper").parentNode.id, "dest");
});

for (const kind of ["pinned", "unchanged"])
  test(`a ${kind} local subtree represents its moved descendant without copying it`, () => {
    const f = fixture({
      output: '<main id="root"><aside id="dest"></aside></main>',
    });
    const destination = f.out.getElementById("dest");
    f.provenance.set(destination, {
      base: kind === "unchanged" ? f.find("base", "dest") : null,
      local: f.find("local", "dest"),
      remote: kind === "unchanged" ? f.find("remote", "dest") : null,
      [kind]: true,
    });
    f.registry.drain(f.root);
    assert.equal(f.record.state, "attached");
    assert.equal(
      f.record.disposition,
      kind === "pinned" ? "ignored" : "unchanged",
    );
    assert.equal(f.root.querySelectorAll("#move").length, 0);
    assert.equal(f.record.output, destination);
    assert.equal(f.builds(), 0);
  });

test("a local ignored child retained by apply represents moves even without a pin node", () => {
  const f = fixture({
    l: moved.replace(
      '<p id="move">payload</p>',
      '<nav data-ignore><p id="move">payload</p></nav>',
    ),
  });
  f.registry.drain(f.root);
  assert.equal(f.record.state, "attached");
  assert.equal(f.record.disposition, "ignored");
  assert.equal(f.root.querySelectorAll("#move").length, 0);
  assert.equal(f.builds(), 0);
});

test("template contents are attached through the template's logical parent", () => {
  const convert = (text) =>
    text
      .replaceAll("<aside", "<template")
      .replaceAll("</aside>", "</template>");
  const f = fixture({
    b: convert(original),
    l: convert(moved),
    r: convert(original),
    output: convert(omitted),
  });
  f.registry.drain(f.root);
  const destination = f.out.getElementById("dest");
  assert.equal(destination.content.querySelectorAll("#move").length, 1);
  assert.equal(destination.content.lastElementChild.id, "move");
  assert.equal(f.root.querySelectorAll("#move").length, 0);
  assert.equal(f.record.state, "attached");
});

test("remote authority discards a remotely deleted obligation through the conflict callback", () => {
  const b = original.replace(
    '<section id="source">',
    '<section id="source" data-remote>',
  );
  const f = fixture({ b, r: b.replace('<p id="move">payload</p>', "") });
  f.registry.drain(f.root);
  assert.equal(f.record.disposition, "remote-wins");
  assert.deepEqual(f.discards, [f.base]);
  assert.equal(f.root.querySelectorAll("#move").length, 0);
  assert.equal(f.builds(), 0);
});

test("a local fallback cannot append inside a remote authoritative destination", () => {
  const authoritative = (text) =>
    text.replace('<aside id="dest">', '<aside id="dest" data-remote>');
  const f = fixture({
    b: authoritative(original),
    l: authoritative(moved),
    r: authoritative(original),
    output: authoritative(omitted),
  });
  f.registry.drain(f.root);
  assert.equal(f.out.getElementById("move").parentNode.id, "source");
  assert.equal(
    f.out.getElementById("dest").querySelectorAll("#move").length,
    0,
  );
});

test("a prepared moved mark reports its built element without calling moveIn", () => {
  const base = parse(
    doc('<section><b id="move">moved</b></section><p id="target">keep</p>'),
  );
  const local = parse(
    doc('<section></section><p id="target">keep <b id="move">moved</b></p>'),
  );
  const remote = parse(
    doc('<section><b id="move">moved</b></section><p id="target">keep</p>'),
  );
  const b = base.getElementById("move");
  const l = local.getElementById("move");
  const r = remote.getElementById("move");
  const B = [...base.getElementById("target").childNodes];
  const L = [...local.getElementById("target").childNodes];
  const R = [...remote.getElementById("target").childNodes];
  const out = parse(doc(""));
  const reported = [];
  const result = mergeInline({
    base: B,
    local: L,
    remote: R,
    out,
    prepared: prepareInline(flatten(B), flatten(L), flatten(R)),
    L: {
      map: new Map([[b, l]]),
      reverse: new Map([[l, b]]),
      identical: new Set(),
    },
    R: {
      map: new Map([[b, r]]),
      reverse: new Map([[r, b]]),
      identical: new Set(),
    },
    moveIn() {
      assert.fail("the built mark must use the distinct moveBuilt hook");
    },
    moveBuilt(...args) {
      reported.push(args);
    },
  });
  out.body.append(...result.nodes);
  assert.equal(reported.length, 1);
  assert.equal(reported[0][0], b);
  assert.equal(reported[0][1], "local");
  assert.equal(reported[0][2], l);
  assert.equal(reported[0][3], out.getElementById("move"));
  assert.equal(out.body.textContent, "keep moved");
  assert.equal(out.querySelectorAll("#move").length, 1);
});

test("an inline atom registers its destination before the source is suppressed", () => {
  const base = parse(
    doc(
      '<p id="source">before <b id="move">payload</b> after</p><aside></aside>',
    ),
  );
  const local = parse(
    doc(
      '<p id="source">before  after</p><aside><b id="move">payload</b></aside>',
    ),
  );
  const remote = parse(
    doc(
      '<p id="source">before <b id="move">payload</b> after</p><aside></aside>',
    ),
  );
  const b = base.getElementById("move");
  const l = local.getElementById("move");
  const r = remote.getElementById("move");
  const planned = [];
  const result = mergeInline({
    base: [...base.getElementById("source").childNodes],
    local: [...local.getElementById("source").childNodes],
    remote: [...remote.getElementById("source").childNodes],
    out: parse(doc("")),
    L: {
      map: new Map([[b, l]]),
      reverse: new Map([[l, b]]),
      identical: new Set(),
    },
    R: {
      map: new Map([[b, r]]),
      reverse: new Map([[r, b]]),
      identical: new Set(),
    },
    moveIn() {
      assert.fail(
        "the source must plan the move without constructing its destination",
      );
    },
    movePlanned(...args) {
      planned.push(args);
    },
  });
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0], [b, "local", l, null]);
  assert.equal(result.text.includes("payload"), false);
});

test("a native move keeps one live owner and replays post-snapshot typing once", async () => {
  const b =
    '<section id="source"><p id="move">alpha beta gamma</p></section><aside id="dest"></aside>';
  const l =
    '<section id="source"></section><aside id="dest"><p id="move">alpha beta gamma</p></aside>';
  const r = b.replace("alpha beta gamma", "alpha beta GAMMA");
  const live = parse(doc(l));
  const captured = parse(doc(l));
  const map = lockstepMap(captured.documentElement, live.documentElement);
  const paragraph = live.getElementById("move");
  paragraph.firstChild.nodeValue = "alpha TYPED beta gamma";
  const result = await mergeDocument({
    live,
    base: doc(b),
    remote: doc(r),
    local: {
      root: captured.documentElement,
      toLive: (node) => map.get(node) || null,
    },
    scripts: { execute: false },
  });
  assert.equal(live.querySelectorAll("#move").length, 1);
  assert.equal(live.getElementById("move"), paragraph);
  assert.equal(paragraph.parentNode.id, "dest");
  assert.equal(paragraph.textContent, "alpha TYPED beta GAMMA");
  assert.equal(result.localDiverged, true);
});

test("pure merge places a remote edited move inside template content once", () => {
  const b =
    '<section id="source"><p id="move">alpha beta</p></section><template id="dest"></template>';
  const l =
    '<section id="source"></section><template id="dest"><p id="move">alpha beta</p></template>';
  const r = b.replace("alpha beta", "alpha BETA");
  const result = merge3(parse(doc(b)), parse(doc(l)), parse(doc(r)), {
    hooks: { beforeNodeMorphed() {} },
  });
  const destination = result.doc.getElementById("dest").content;
  assert.equal(destination.querySelectorAll("#move").length, 1);
  assert.equal(destination.querySelector("#move").textContent, "alpha BETA");
  assert.equal(result.doc.body.querySelectorAll("#move").length, 0);
});
