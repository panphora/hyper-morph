import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { createAnalyzer } from "../../src/similarity.js";
import { createCrossParentOrigins } from "../../src/cross-parent-origins.js";
import { occurrenceBudget } from "../../src/occurrence-map.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";

const original = {
  base: '<div><div><p sid="A"> beta</p> delta</div></div>',
  local:
    '<div><div><p sid="A"> beta delta</p></div></div><div><div><p sid="B"> beta</p></div></div>',
  remote:
    '<div><div><p sid="B"> beta</p> delta </div></div><div><div><p sid="A"> beta</p></div></div>',
};

async function fixture(input = original, options = {}) {
  const obs = await runCase(
    E,
    normalize({ ...input, shape: "pure", identity: "clay" }),
  );
  const { p, report } = obs.raw;
  const docs = [p.base, p.cap, p.remote];
  const before = docs.map((doc) => doc.documentElement.outerHTML);
  const A = [...p.sidB].find(([, id]) => id === "A")[0];
  const canonical = new WeakMap();
  for (const alignment of [report.L, report.R])
    for (const pair of alignment.map)
      for (const unit of pair)
        if (unit.kind && unit.nodes.length) canonical.set(unit.nodes[0], unit);
  const ignored = () => false;
  const analyzer = createAnalyzer({ ignored });
  const unitsOf = (parent) =>
    analyzer
      .unitsOf(parent)
      .map((unit) =>
        unit.nodeType === 1 ? unit : canonical.get(unit.nodes[0]) || unit,
      );
  const templateParents = new WeakMap();
  for (const doc of docs)
    for (const node of doc.querySelectorAll("template"))
      templateParents.set(node.content, node);
  const parentOf = (node) =>
    templateParents.get(node.parentNode) || node.parentNode;
  let reads = 0;
  const describe = (parent) => {
    reads++;
    const views = [report.L, report.R].map((alignment) => {
      const el = alignment.map.get(parent);
      return {
        A: alignment,
        V: {
          el,
          asBase: !el,
          units: el ? unitsOf(el) : [],
          twin: (unit) => alignment.map.get(unit) || null,
          baseOf: (unit) => alignment.reverse.get(unit) || null,
          here: (unit) => {
            const actual = unit.nodeType === 1 ? unit.parentNode : unit.parent;
            return (
              actual === el ||
              (el?.tagName === "TEMPLATE" && actual === el.content)
            );
          },
        },
      };
    });
    return { base: unitsOf(parent), views };
  };
  const registry = createCrossParentOrigins({
    describe,
    parentOf,
    eligible: (node) => node?.tagName === "P",
    ignored,
    remoteWins: ignored,
    ...options,
  });
  return {
    registry,
    owner: A,
    parent: parentOf(A),
    p,
    report,
    reads: () => reads,
    unchanged: () =>
      assert.deepEqual(
        docs.map((doc) => doc.documentElement.outerHTML),
        before,
      ),
  };
}

function assertOriginal(record, f, remoteText = " delta ") {
  const local = f.report.L.map.get(f.owner),
    remote = f.report.R.map.get(f.owner);
  assert.equal(record.side, 0);
  assert.equal(record.owner, f.owner);
  assert.deepEqual(record.owners, [f.owner, local, remote]);
  assert.equal(record.source.kind, "text");
  assert.equal(record.target, local);
  assert.equal(record.runs.length, 1);
  assert.deepEqual(record.runs[0], {
    source: record.source,
    target: local,
    from: 0,
    to: 6,
    targetFrom: 5,
  });
  assert.equal(record.proof.status, "ready");
  assert.equal(record.proof.runs.length, 1);
  assert.equal(record.proof.runs[0].kind, "transfer");
  assert.equal(record.proof.bTo[1], 6);
  assert.deepEqual(
    record.native.map((slice) => [slice.from, slice.to]),
    [
      [0, 6],
      [5, 11],
      [0, remoteText.length],
    ],
  );
  assert.deepEqual(
    record.native.map((slice) => slice.model.flat.text),
    [" delta", " beta delta", remoteText],
  );
  assert.deepEqual(
    record.ownerModels.map((model) => model.flat.text),
    [" beta", " beta delta", " beta"],
  );
  assert.equal(record.native[0].model.nodes[0], f.owner.nextSibling);
  assert.equal(record.native[1].model.nodes[0], local.firstChild);
  assert.equal(record.ownerModels[2].nodes[0], remote.firstChild);
  assert.notEqual(
    record.native[2].model.nodes[0].parentNode,
    remote.parentNode,
  );
  for (const model of record.models.values()) {
    if (!model) continue;
    for (const range of model.flat.nodes) {
      assert.ok(model.nodes.includes(range.node));
      assert.equal(model.flat.text.slice(range.s, range.e), range.node.data);
    }
  }
  assert.equal("resolved" in record, false);
  assert.equal("output" in record, false);
  assert.equal("state" in record, false);
  f.unchanged();
}

test("the original join produces a nonzero native transfer certificate", async () => {
  const f = await fixture();
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  assert.equal(plan.records.length, 1);
  assertOriginal(plan.records[0], f);
  assert.equal(f.registry.forOwner(f.owner)[0], plan.records[0]);
  assert.equal(f.registry.get(f.parent), plan);
  assert.equal(f.reads(), 1);
});

test("destination-first discovery memoizes the same native parent plan", async () => {
  const input = {
    base: '<section sid="S"><p sid="A"> beta</p> delta</section>',
    local: '<section sid="S"><p sid="A"> beta delta</p></section>',
    remote:
      '<aside sid="D"><p sid="A"> beta</p></aside><section sid="S"> delta </section>',
  };
  const f = await fixture(input);
  const incoming = f.registry.forOwner(f.owner);
  assert.equal(incoming.length, 1);
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  assert.equal(incoming[0], plan.records[0]);
  assert.equal(f.registry.forOwner(f.owner), incoming);
  assert.equal(f.reads(), 1);
  assertOriginal(incoming[0], f);
  assert.equal(
    f.report.R.map.get(f.owner).parentNode,
    f.p.remote.body.firstElementChild,
  );
});

test("a remote hard replacement remains a complete separate native source", async () => {
  const f = await fixture({
    ...original,
    remote: original.remote.replace(" delta ", " DELTA edited "),
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  assert.equal(plan.records.length, 1);
  assertOriginal(plan.records[0], f, " DELTA edited ");
});

test("native owner offsets retain every captured text node", async () => {
  const f = await fixture();
  const local = f.report.L.map.get(f.owner);
  const first = local.firstChild,
    second = first.splitText(7);
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  const model = plan.records[0].native[1].model;
  assert.deepEqual(model.nodes, [first, second]);
  assert.deepEqual(model.flat.nodes, [
    { node: first, s: 0, e: 7 },
    { node: second, s: 7, e: 11 },
  ]);
  assert.equal(plan.records[0].native[1].from, 5);
  assert.equal(plan.records[0].native[1].to, 11);
  f.unchanged();
});

test("destination-first discovery uses a template's logical source parent", async () => {
  const f = await fixture({
    base: '<template sid="S"><p sid="A"> beta</p> delta</template>',
    local: '<template sid="S"><p sid="A"> beta delta</p></template>',
    remote:
      '<template sid="S"> delta </template><aside><p sid="A"> beta</p></aside>',
  });
  assert.equal(f.parent.tagName, "TEMPLATE");
  const incoming = f.registry.forOwner(f.owner);
  assert.equal(incoming.length, 1);
  assertOriginal(incoming[0], f);
  assert.equal(f.registry.get(f.parent).records[0], incoming[0]);
  assert.equal(f.reads(), 1);
});

test("prepend transport retains full owner offsets", async () => {
  const f = await fixture({
    base: '<section sid="S">delta <p sid="A">beta </p></section>',
    local: '<section sid="S"><p sid="A">delta beta </p></section>',
    remote:
      '<section sid="S">DELTA </section><aside sid="D"><p sid="A">beta </p></aside>',
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].native[1].model.flat.text, "delta beta ");
  assert.deepEqual(
    plan.records[0].native.map((slice) => [slice.from, slice.to]),
    [
      [0, 6],
      [0, 6],
      [0, 6],
    ],
  );
  assert.equal(plan.records[0].retained[0].targetFrom, 6);
  f.unchanged();
});

test("the symmetric remote join records the local source edit", async () => {
  const f = await fixture({
    base: original.base,
    local: original.remote,
    remote: original.local,
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "ready");
  assert.equal(plan.records.length, 1);
  const record = plan.records[0];
  assert.equal(record.side, 1);
  assert.deepEqual(
    record.native.map((slice) => slice.model.flat.text),
    [" delta", " delta ", " beta delta"],
  );
  assert.deepEqual(
    record.native.map((slice) => [slice.from, slice.to]),
    [
      [0, 6],
      [0, 7],
      [5, 11],
    ],
  );
  f.unchanged();
});

test("equal orphan source runs refuse the whole parent plan", async () => {
  const f = await fixture({
    base: '<section sid="S"><p sid="A"> beta</p> delta<hr> delta</section>',
    local: '<section sid="S"><p sid="A"> beta delta</p><hr></section>',
    remote:
      '<section sid="S"><p sid="B"> beta</p> delta<hr> delta</section><aside><p sid="A"> beta</p></aside>',
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "fallback");
  assert.equal(plan.reason, "ambiguous-origin");
  assert.deepEqual(plan.records, []);
  assert.equal(f.registry.forOwner(f.owner), null);
  f.unchanged();
});

test("two adjacent gaining owners refuse the whole parent plan", async () => {
  const f = await fixture({
    base: '<section sid="S"><p sid="A"> beta</p> delta <p sid="C">gamma </p></section>',
    local:
      '<section sid="S"><p sid="A"> beta delta </p><p sid="C"> delta gamma </p></section>',
    remote:
      '<section sid="S"> delta </section><aside><p sid="A"> beta</p><p sid="C">gamma </p></aside>',
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "fallback");
  assert.equal(plan.reason, "ambiguous-origin");
  assert.deepEqual(plan.records, []);
  f.unchanged();
});

for (const [name, options, reason] of [
  ["unit", { maxUnits: 1 }, "unit-limit"],
  ["work", { budget: occurrenceBudget(1) }, "work-limit"],
  ["character", { maxCharacters: 5 }, "work-limit"],
]) {
  test(`${name} exhaustion returns a memoized fallback with no claims`, async () => {
    const f = await fixture(original, options);
    assert.equal(f.registry.forOwner(f.owner), null);
    const plan = f.registry.get(f.parent);
    assert.equal(plan.status, "fallback");
    assert.equal(plan.reason, reason);
    assert.deepEqual(plan.records, []);
    assert.equal(f.registry.get(f.parent), plan);
    assert.equal(f.reads(), 1);
    f.unchanged();
  });
}

test("a retained loose source is a copy, not a transfer certificate", async () => {
  const f = await fixture({
    ...original,
    local: original.local.replace("</p></div></div>", "</p> delta</div></div>"),
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "none");
  assert.deepEqual(plan.records, []);
  f.unchanged();
});

test("a later cap refusal discards all partial parent certificates", async () => {
  const input = {
    base: '<section sid="S"><p sid="A"> beta</p> delta<hr><p sid="C"> gamma</p> theta</section>',
    local:
      '<section sid="S"><p sid="A"> beta delta</p><hr><p sid="C"> gamma theta</p></section>',
    remote:
      '<section sid="S"> delta <hr> theta </section><aside><p sid="A"> beta</p><p sid="C"> gamma</p></aside>',
  };
  const complete = await fixture(input);
  assert.equal(complete.registry.get(complete.parent).records.length, 2);
  const limited = await fixture(input, { maxCharacters: 60 });
  const plan = limited.registry.get(limited.parent);
  assert.equal(plan.status, "fallback");
  assert.equal(plan.reason, "work-limit");
  assert.deepEqual(plan.records, []);
  assert.equal(limited.registry.forOwner(limited.owner), null);
  limited.unchanged();
});

test("a source and destination separated by a structural child are not adjacent", async () => {
  const f = await fixture({
    base: '<section sid="S"><p sid="A"> beta</p><hr> delta</section>',
    local: '<section sid="S"><p sid="A"> beta delta</p><hr></section>',
    remote:
      '<section sid="S"><hr> delta </section><aside><p sid="A"> beta</p></aside>',
  });
  const plan = f.registry.get(f.parent);
  assert.equal(plan.status, "none");
  assert.deepEqual(plan.records, []);
  f.unchanged();
});
