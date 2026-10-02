import assert from "node:assert/strict";
import { test } from "node:test";
import { flatten, mergeInline, prepareInline } from "../../src/inline-merge.js";
import { steps } from "../../src/text-merge.js";
import { parse, doc } from "./lib/dom.js";

const fixtures = [
  {
    name: "disjoint words",
    base: "alpha beta gamma delta epsilon",
    local: "alpha BETA gamma delta epsilon",
    remote: "alpha beta gamma DELTA epsilon",
  },
  {
    name: "formatting and words",
    base: "alpha beta gamma",
    local: "alpha <b>beta</b> gamma",
    remote: "alpha beta GAMMA",
  },
  {
    name: "overlapping replacement",
    base: "alpha beta gamma",
    local: "alpha LOCAL gamma",
    remote: "alpha REMOTE gamma",
    conflict: true,
  },
  {
    name: "split and tail edit",
    base: "<p>alpha beta gamma</p>",
    local: "<p>alpha</p><p>beta gamma</p>",
    remote: "<p>alpha beta GAMMA</p>",
    blocks: true,
  },
];

function render(fixture, policy, preparedPath) {
  const inputs = Object.fromEntries(
    ["base", "local", "remote"].map((side) => [
      side,
      [...parse(doc(fixture[side])).body.childNodes],
    ]),
  );
  const blocks = fixture.blocks
    ? new Set(
        Object.values(inputs)
          .flat()
          .filter((node) => node.nodeType === 1),
      )
    : undefined;
  const out = parse(doc(""));
  const conflicts = [];
  const options = { ...inputs, out, blocks, policy, conflicts };
  if (preparedPath)
    options.prepared = prepareInline(
      flatten(inputs.base, { blocks }),
      flatten(inputs.local, { blocks }),
      flatten(inputs.remote, { blocks }),
    );
  const before = steps.diff;
  const result = mergeInline(options);
  const diffWork = steps.diff - before;
  assert.ok(result.nodes.length > 0);
  out.body.append(...result.nodes);
  return {
    html: out.body.innerHTML,
    count: result.nodes.length,
    diffWork,
    conflicts: conflicts.map(
      ({
        kind,
        base,
        local,
        remote,
        resolved,
        range,
        bs,
        be,
        lss,
        lse,
        rss,
        rse,
      }) => ({
        kind,
        base,
        local,
        remote,
        resolved,
        range,
        bs,
        be,
        lss,
        lse,
        rss,
        rse,
      }),
    ),
  };
}

for (const fixture of fixtures)
  for (const policy of ["local", "remote", "both"])
    test(`prepared inline: ${fixture.name}, ${policy}`, () => {
      const ordinary = render(fixture, policy, false);
      const prepared = render(fixture, policy, true);
      assert.equal(prepared.html, ordinary.html);
      assert.equal(prepared.count, ordinary.count);
      assert.deepEqual(prepared.conflicts, ordinary.conflicts);
      assert.equal(prepared.diffWork, 0);
      if (fixture.conflict) assert.ok(prepared.conflicts.length > 0);
    });
