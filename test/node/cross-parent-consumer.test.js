import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { createAnalyzer } from "../../src/similarity.js";
import {
  createCrossParentConsumer,
  prepareCrossParentPayload,
} from "../../src/cross-parent-consumer.js";
import { planCrossParentOrigins } from "../../src/cross-parent-origins.js";
import { occurrenceBudget } from "../../src/occurrence-map.js";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";
import { judge } from "../counterexamples/lib/oracle.js";

const original = {
  title:
    "Local joins two paragraphs while remote exchanges their identical neighbors and edits the joined-away paragraph",
  base: '<div><div><p sid="A"> beta</p> delta</div></div>',
  local:
    '<div><div><p sid="A"> beta delta</p></div></div><div><div><p sid="B"> beta</p></div></div>',
  remote:
    '<div><div><p sid="B"> beta</p> delta </div></div><div><div><p sid="A"> beta</p></div></div>',
  identity: "clay",
  options: {},
  requires: ["localChanged", "remoteChanged", "idsDiffer"],
};
const ordinary = {
  base: '<section id="s"><p id="a">alpha beta</p> gamma</section><aside id="d"></aside>',
  local:
    '<section id="s"><p id="a">alpha beta gamma</p></section><aside id="d"></aside>',
  remote:
    '<section id="s"> GAMMA</section><aside id="d"><p id="a">alpha beta</p></aside>',
};
const repeated = {
  base: '<section id="s"><p id="a">echo </p>echo tail</section><aside id="d"></aside>',
  local:
    '<section id="s"><p id="a">echo echo tail</p></section><aside id="d"></aside>',
  remote:
    '<section id="s">echo tail</section><aside id="d"><p id="a"></p></aside>',
};
function pure(input, options = {}) {
  const documents = [input.base, input.local, input.remote].map((html) =>
    parse(doc(html)),
  );
  const result = E.merge3(...documents, {
    ...options,
    hooks: { beforeNodeMorphed() {} },
  });
  return { ...result, documents };
}
async function dirty(input, text) {
  const live = parse(doc(input.local)),
    captured = parse(doc(input.local));
  const map = lockstepMap(captured.documentElement, live.documentElement);
  const owner = live.getElementById("a"),
    node = owner.firstChild;
  if (text !== undefined) node.data = text;
  const result = await E.mergeDocument({
    live,
    base: doc(input.base),
    remote: doc(input.remote),
    local: {
      root: captured.documentElement,
      toLive: (n) => map.get(n) || null,
    },
    scripts: { execute: false },
  });
  assert.equal(live.getElementById("a"), owner);
  assert.equal(owner.firstChild, node);
  assert.equal(live.querySelectorAll("#a").length, 1);
  return { result, live, captured, owner, node };
}

for (const shape of ["dirty", "pure"]) {
  test(`the actual join-swapped original clears its oracle in ${shape} mode`, async () => {
    const result = await judge(E, { ...original, shape }, { parity: false });
    assert.deepEqual(result.violations, []);
    assert.equal(
      result.obs.raw.liveRoot.body.innerHTML,
      "<div><div><p> beta</p></div></div><div><div><p> beta delta </p></div></div>",
    );
    if (shape === "dirty") {
      const { p, liveRoot } = result.obs.raw;
      for (const id of ["A", "B"]) {
        const owner = [...p.sidL].find(([, sid]) => sid === id)[0];
        assert.equal(liveRoot.contains(owner), true);
      }
    }
  });
}

test("source-first transport preserves native hard source edits and complete local ranges", () => {
  const result = pure(ordinary);
  assert.equal(
    result.doc.body.innerHTML,
    '<section id="s"></section><aside id="d"><p id="a">alpha beta GAMMA</p></aside>',
  );
  assert.equal(result.conflicts.length, 0);
  const local = result.documents[1].getElementById("a").firstChild;
  const segments = result.segments.filter((segment) =>
    segment.localNodes.some(({ node }) => node === local),
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0].flatLocal, "alpha beta gamma");
  assert.deepEqual(segments[0].localNodes, [{ node: local, s: 0, e: 16 }]);
  assert.equal(segments[0].lToM.length, 17);
  assert.deepEqual(
    [...segments[0].lToM].slice(0, 10),
    Array.from({ length: 10 }, (_, i) => i),
  );
});

for (const first of [false, true]) {
  test(`destination-${first ? "first" : "last"} preserves one live owner and hard edits`, async () => {
    const input = {
      ...ordinary,
      remote: first
        ? '<aside id="d"><p id="a">ALPHA beta</p></aside><section id="s"> GAMMA</section>'
        : ordinary.remote.replace("alpha beta", "ALPHA beta"),
    };
    const result = await dirty(input);
    assert.equal(result.owner.parentNode.id, "d");
    assert.equal(result.owner.textContent, "ALPHA beta GAMMA");
    assert.equal(result.live.getElementById("s").textContent, "");
    assert.equal(result.result.conflicts.length, 0);
  });
}

test("the complete local mapper replays disjoint postcapture owner typing", async () => {
  const result = await dirty(ordinary, "alpha TYPED beta gamma");
  assert.equal(result.owner.textContent, "alpha TYPED beta GAMMA");
  assert.equal(result.owner.parentNode.id, "d");
  assert.equal(result.live.getElementById("s").textContent, "");
  assert.equal(result.result.localDiverged, true);
});

test("repeated owner and source text retain separate remote origins", () => {
  const result = pure(repeated);
  assert.equal(result.doc.getElementById("a").textContent, "echo tail");
  const local = result.documents[1].getElementById("a").firstChild;
  const segment = result.segments.find((s) =>
    s.localNodes.some(({ node }) => node === local),
  );
  assert.equal(segment.flatLocal, "echo echo tail");
  assert.deepEqual(
    [...segment.lToM],
    [-1, -1, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, -1],
  );
});

test("remote owner deletion cannot steal a repeated source occurrence or its later typing", async () => {
  const result = await dirty(repeated, "echo echo TYPED tail");
  assert.equal(result.owner.textContent, "echo TYPED tail");
  assert.equal(result.owner.parentNode.id, "d");
  assert.equal(result.live.getElementById("s").textContent, "");
});

test("a prepend transport retains the complete native owner mapper", async () => {
  const input = {
    base: '<section id="s">alpha <p id="a">beta gamma</p></section><aside id="d"></aside>',
    local:
      '<section id="s"><p id="a">alpha beta gamma</p></section><aside id="d"></aside>',
    remote:
      '<aside id="d"><p id="a">beta gamma</p></aside><section id="s">ALPHA </section>',
  };
  const result = await dirty(input, "alpha beta TYPED gamma");
  assert.equal(result.owner.textContent, "ALPHA beta TYPED gamma");
  assert.equal(result.owner.parentNode.id, "d");
});

test("logical template parents carry native payloads into template content", () => {
  const input = {
    base: '<template id="s"><p id="a">alpha beta</p> gamma</template><template id="d"></template>',
    local:
      '<template id="s"><p id="a">alpha beta gamma</p></template><template id="d"></template>',
    remote:
      '<template id="s"> GAMMA</template><template id="d"><p id="a">alpha beta</p></template>',
  };
  const result = pure(input);
  assert.equal(result.doc.getElementById("s").innerHTML, "");
  assert.equal(
    result.doc.getElementById("d").innerHTML,
    '<p id="a">alpha beta GAMMA</p>',
  );
});

async function lifecycle(input = ordinary, options = {}) {
  const obs = await runCase(
    E,
    normalize({ ...input, shape: "pure", identity: "default" }),
  );
  const { p, report } = obs.raw;
  const canonical = new WeakMap();
  for (const A of [report.L, report.R])
    for (const pair of A.map)
      for (const unit of pair)
        if (unit.kind && unit.nodes.length) canonical.set(unit.nodes[0], unit);
  const ignored = options.ignored || (() => false);
  const remoteWins = options.remoteWins || (() => false);
  const analyzer = createAnalyzer({ ignored });
  const unitsOf = (parent) =>
    analyzer
      .unitsOf(parent)
      .map((unit) =>
        unit.nodeType === 1 ? unit : canonical.get(unit.nodes[0]) || unit,
      );
  const twinIn = (A, unit) => A.map.get(unit) || null;
  const view = (A, el) => ({
    el,
    asBase: !el,
    units: el ? unitsOf(el) : [],
    twin: (unit) => twinIn(A, unit),
    baseOf: (unit) => A.reverse.get(unit) || null,
    here: (unit) =>
      (unit.nodeType === 1 ? unit.parentNode : unit.parent) === el,
  });
  const owner = p.base.getElementById("a"),
    parent = owner.parentNode;
  const local = report.L.map.get(owner),
    remote = report.R.map.get(owner);
  const sources = unitsOf(parent).filter((unit) => unit.kind === "text");
  assert.equal(sources.length, 1);
  const source = sources[0],
    remoteSource = report.R.map.get(source);
  assert.ok(remoteSource?.nodes.length > 0);
  const out = parse(doc('<section id="s"></section>'));
  const provenance = new WeakMap(),
    textMappers = new WeakMap();
  const segments = [],
    conflicts = [],
    decisions = [];
  provenance.set(out.body, {
    base: p.base.body,
    local: p.cap.body,
    remote: p.remote.body,
  });
  provenance.set(out.getElementById("s"), {
    base: parent,
    local: report.L.map.get(parent),
    remote: report.R.map.get(parent),
  });
  const plan = planCrossParentOrigins({
    parent,
    base: unitsOf(parent),
    views: [report.L, report.R].map((A) => ({
      A,
      V: view(A, twinIn(A, parent)),
    })),
    eligible: (node) => node?.tagName === "P",
    ignored,
    remoteWins,
  });
  let builds = 0,
    consumer;
  const makeOwner = () => {
    const element = out.createElement("p");
    element.id = "a";
    provenance.set(element, { base: owner, local, remote });
    return element;
  };
  consumer = createCrossParentConsumer({
    L: report.L,
    R: report.R,
    twinIn,
    unitsOf,
    view,
    parentOf: (node) => node.parentNode,
    ignored,
    remoteWins,
    eligible: (node) => node?.tagName === "P",
    build() {
      builds++;
      const element = makeOwner();
      consumer.render(owner, element);
      return element;
    },
    out,
    provenance,
    textMappers,
    segments,
    conflicts,
    decisions,
    conflict(c) {
      conflicts.push(c);
    },
  });
  return {
    consumer,
    out,
    owner,
    parent,
    source,
    remoteSource,
    segments,
    conflicts,
    makeOwner,
    builds: () => builds,
    provenance,
    decisions,
    plan,
  };
}

test("discovery-only source-first and destination-first claims are memoized without building", async () => {
  const f = await lifecycle();
  f.consumer.ensureOwner(f.owner);
  f.consumer.ensureParent(f.parent);
  assert.equal(f.consumer.consumes(f.source), true);
  assert.equal(f.consumer.consumes(f.remoteSource), true);
  assert.equal(f.builds(), 0);
  assert.equal(f.segments.length, 0);
  assert.equal(f.conflicts.length, 0);
});

for (const state of ["planned", "built", "owner-only"]) {
  test(`payload drain rescues ${state} content when no destination is attached`, async () => {
    const f = await lifecycle();
    f.consumer.ensureParent(f.parent);
    const element = state === "planned" ? null : f.makeOwner();
    if (state === "built")
      assert.equal(f.consumer.render(f.owner, element), true);
    if (state === "owner-only") {
      element.textContent = "alpha beta";
      f.out.getElementById("s").appendChild(element);
    }
    f.consumer.drain(f.out.body);
    const owner = f.out.getElementById("a");
    if (element) assert.equal(owner, element);
    assert.equal(owner.textContent, "alpha beta GAMMA");
    assert.equal(owner.parentNode.id, "s");
    assert.equal(f.builds(), state === "planned" ? 1 : 0);
    assert.equal(f.segments.length, 1);
    f.consumer.drain(f.out.body);
    assert.equal(f.out.querySelectorAll("#a").length, 1);
    assert.equal(f.segments.length, 1);
    assert.equal(owner.textContent, "alpha beta GAMMA");
  });
}

for (const rule of ["ignored", "remoteWins"]) {
  test(`${rule} destination ancestry refuses payload claims`, async () => {
    const f = await lifecycle(ordinary, { [rule]: (node) => node.id === "d" });
    f.consumer.ensureOwner(f.owner);
    assert.equal(f.consumer.consumes(f.source), false);
    assert.equal(f.consumer.consumes(f.remoteSource), false);
    assert.equal(f.consumer.render(f.owner, f.makeOwner()), false);
    f.consumer.drain(f.out.body);
    assert.equal(f.out.getElementById("a"), null);
    assert.equal(f.segments.length, 0);
  });
}

test("an additional physical sibling refuses consumption without losing its source", async () => {
  const input = Object.fromEntries(
    Object.entries(ordinary).map(([side, html]) => [
      side,
      html.replace("</section>", '<hr id="extra"></section>'),
    ]),
  );
  const f = await lifecycle(input);
  assert.equal(f.parent.childNodes.length, 3);
  assert.equal(f.plan.records.length, 1);
  f.consumer.ensureParent(f.parent);
  assert.equal(f.consumer.consumes(f.source), false);
  assert.equal(f.consumer.consumes(f.remoteSource), false);
  const result = pure(input);
  assert.equal(result.doc.getElementById("s").textContent, " GAMMA");
  assert.ok(result.doc.getElementById("extra"));
  assert.equal(result.doc.getElementById("a").textContent, "alpha beta gamma");
});

test("remote authority keeps the ordinary source fallback intact", () => {
  const result = pure(ordinary, { remoteWins: (node) => node.id === "d" });
  assert.equal(result.doc.getElementById("s").textContent, " GAMMA");
  assert.equal(result.doc.getElementById("a").textContent, "alpha beta");
});

test("composed remote origins preserve native channel bounds and retained runs", async () => {
  const f = await lifecycle(repeated);
  assert.equal(f.plan.records.length, 1);
  const record = f.plan.records[0];
  const payload = prepareCrossParentPayload(record, occurrenceBudget());
  assert.ok(payload);
  const { base, local, remote, localMap, remoteMap, remoteEdits } =
    payload.prepared;
  assert.equal(base.text, "echo echo tail");
  assert.equal(local.text, "echo echo tail");
  assert.equal(remote.text, "echo tail");
  assert.deepEqual(
    base.nodes.map(({ node, s, e }) => [node, s, e]),
    [
      [record.ownerModels[0].nodes[0], 0, 5],
      [record.native[0].model.nodes[0], 5, 14],
    ],
  );
  assert.deepEqual(local.nodes, [
    { node: record.ownerModels[1].nodes[0], s: 0, e: 14 },
  ]);
  assert.deepEqual(remote.nodes, [
    { node: record.native[2].model.nodes[0], s: 0, e: 9 },
  ]);
  assert.deepEqual(
    localMap.runs.map((r) => [r.kind, r.from, r.to, r.target]),
    [
      ["retained", 0, 5, 0],
      ["transfer", 5, 14, 5],
    ],
  );
  assert.deepEqual(
    remoteMap.runs.map((r) => [r.kind, r.from, r.to, r.target]),
    [["retained", 5, 14, 0]],
  );
  assert.deepEqual(
    [...remoteMap.bTo],
    [-1, -1, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    remoteEdits.hunks.map(({ bs, be, ss, se }) => [bs, be, ss, se]),
    [[0, 5, 0, 0]],
  );
});

test("native text nodes keep complete offsets across both original channels", () => {
  const documents = [ordinary.base, ordinary.local, ordinary.remote].map(
    (html) => parse(doc(html)),
  );
  documents[0].getElementById("a").firstChild.splitText(5);
  documents[0].getElementById("a").nextSibling.splitText(1);
  const owner = documents[1].getElementById("a");
  const first = owner.firstChild,
    second = first.splitText(6);
  documents[2].getElementById("s").firstChild.splitText(1);
  const result = E.merge3(...documents, { hooks: { beforeNodeMorphed() {} } });
  assert.equal(result.doc.getElementById("a").textContent, "alpha beta GAMMA");
  const segment = result.segments.find((s) =>
    s.localNodes.some(({ node }) => node === first),
  );
  assert.equal(segment.flatLocal, "alpha beta gamma");
  assert.deepEqual(segment.localNodes, [
    { node: first, s: 0, e: 6 },
    { node: second, s: 6, e: 16 },
  ]);
  assert.equal(first.data, "alpha ");
  assert.equal(second.data, "beta gamma");
});

test("a filtered ignored sibling still prevents physical source consumption", async () => {
  const input = Object.fromEntries(
    Object.entries(ordinary).map(([side, html]) => [
      side,
      html.replace("</section>", '<hr id="extra"></section>'),
    ]),
  );
  const f = await lifecycle(input, { ignored: (node) => node.id === "extra" });
  assert.equal(f.parent.childNodes.length, 3);
  assert.equal(f.plan.records.length, 1);
  f.consumer.ensureOwner(f.owner);
  assert.equal(f.consumer.consumes(f.source), false);
  assert.equal(f.consumer.consumes(f.remoteSource), false);
  assert.equal(f.segments.length, 0);
});

test("a real local text edit declines transport and retains ordinary source recovery", () => {
  const result = pure({
    ...ordinary,
    local: ordinary.local.replace("alpha beta gamma", "alpha LOCAL gamma"),
  });
  assert.equal(result.doc.getElementById("s").textContent, " GAMMA");
  assert.equal(result.doc.getElementById("a").textContent, "alpha LOCAL gamma");
  const conflict = result.conflicts.find(
    (c) => c.kind === "text" && c.remote === " GAMMA",
  );
  assert.ok(conflict);
  assert.ok(conflict.recovery);
  assert.equal(conflict.recovery.text.remote.text, " GAMMA");
});

test("channel preparation refuses an exhausted shared budget", async () => {
  const f = await lifecycle();
  assert.equal(f.plan.records.length, 1);
  assert.equal(
    prepareCrossParentPayload(f.plan.records[0], occurrenceBudget(0)),
    null,
  );
});

test("an attached replacement owner receives the existing payload and its decision", async () => {
  const f = await lifecycle();
  f.consumer.ensureOwner(f.owner);
  const detached = f.makeOwner();
  f.consumer.render(f.owner, detached);
  const attached = f.makeOwner();
  attached.textContent = "alpha beta";
  f.out.getElementById("s").appendChild(attached);
  f.consumer.drain(f.out.body);
  assert.equal(f.out.getElementById("a"), attached);
  assert.equal(attached.textContent, "alpha beta GAMMA");
  assert.equal(detached.textContent, "");
  assert.equal(f.segments.length, 1);
  assert.equal(f.builds(), 0);
  assert.equal(
    f.decisions.filter((d) => d.kind === "text").at(-1).node,
    attached,
  );
});
