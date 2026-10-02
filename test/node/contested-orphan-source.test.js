import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateGroups } from "../../src/certificate-groups.js";
import { mergeDocument } from "../../src/index.js";
import { mergeBodies } from "./lib/merge.js";
import { parse, doc } from "./lib/dom.js";
import {
  lockstepMap,
  finalTree,
  recoveryProblems,
} from "../lib/differential-observe.js";

const base = "<p>alpha beta gamma delta</p>";
const edit = "<p>alpha beta gamma DELTA</p>";
const split = (tail) => `<p>alpha beta</p><p>gamma new</p><p>${tail}</p>`;
const expected = (tail) => `${edit}<p>gamma new</p><p>${tail}</p>`;

function planning(b, l, r, options = {}) {
  const x = mergeBodies(b, l, r, options);
  const units = [x.b, x.l, x.r].map((d) => Array.from(d.body.children));
  const views = [x.res.L, x.res.R].map((A, side) => ({
    A,
    V: {
      units: units[side + 1],
      asBase: false,
      twin: (u) => A.map.get(u),
      baseOf: (u) => A.reverse.get(u),
      here: (u) => units[side + 1].includes(u),
    },
    idOf: (u) => u.id || null,
  }));
  const ignored = options.ignore || (() => false),
    remoteWins = options.remoteWins || (() => false),
    records = [];
  const result = certificateGroups({
    base: units[0],
    views,
    eligible: (u) => u.tagName === "P" && !ignored(u) && !remoteWins(u),
    ignored,
    remoteWins,
    baseId: (u) => u.id || null,
    atomKey: (u) => u.outerHTML,
    onUncertainSource: (record) => records.push(record),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return { ...x, result, records, units };
}

for (const tail of ["Gamma delta", "gamma delta END"]) {
  for (const mirror of [false, true]) {
    test(`contested orphan source: ${tail}, mirror ${mirror}, native refusal`, () => {
      const l = mirror ? edit : split(tail),
        r = mirror ? split(tail) : edit;
      const x = planning(base, l, r);
      assert.equal(x.result, null);
      assert.equal(x.records.length, 1);
      const record = x.records[0];
      assert.equal(record.source, x.b.body.firstChild);
      assert.equal(record.side, mirror ? 1 : 0);
      assert.deepEqual([record.from, record.to], [10, 22]);
      assert.equal(record.flat.text, "alpha beta gamma delta");
      assert.deepEqual(record.flat.nodes, [
        { node: record.source.firstChild, s: 0, e: 22 },
      ]);
      assert.equal(x.html, expected(tail));
      const roots = {
        base: x.b.documentElement,
        local: x.l.documentElement,
        remote: x.r.documentElement,
        merged: x.res.doc.documentElement,
      };
      assert.deepEqual(
        recoveryProblems(x.res.conflicts, finalTree(roots.merged), true, roots),
        [],
      );
      assert.equal(x.res.conflicts.length, 1);
      const conflict = x.res.conflicts[0];
      assert.equal(conflict.base, " gamma delta");
      assert.equal(conflict.local, mirror ? " gamma DELTA" : "");
      assert.equal(conflict.remote, mirror ? "" : " gamma DELTA");
      assert.equal(conflict.resolved, " gamma DELTA");
      assert.equal(conflict.recovery.localLost, !mirror);
      assert.deepEqual(
        [conflict.recovery.text.base.start, conflict.recovery.text.base.end],
        [10, 22],
      );
      for (let i = 0; i < x.l.body.children.length; i++)
        assert.equal(
          x.res.provenance.get(x.res.doc.body.children[i]).local,
          x.l.body.children[i],
        );
      if (mirror)
        for (let i = 1; i < 3; i++)
          assert.equal(
            x.res.provenance.get(x.res.doc.body.children[i]).remote,
            x.r.body.children[i],
          );
    });
    test(`contested orphan source: ${tail}, mirror ${mirror}, live identity and typing`, async () => {
      const l = mirror ? edit : split(tail),
        r = mirror ? split(tail) : edit;
      const live = parse(doc(l)),
        captured = parse(doc(l));
      const owners = Array.from(live.body.children),
        texts = owners.map((n) => n.firstChild);
      const map = lockstepMap(captured.documentElement, live.documentElement);
      texts[0].data = texts[0].data.replace("alpha beta", "alpha TYPED beta");
      if (!mirror) {
        texts[1].data = "gamma TYPED-NEW new";
        texts[2].data += " TYPED-TAIL";
      }
      const report = await mergeDocument({
        live,
        base: doc(base),
        remote: doc(r),
        local: {
          root: captured.documentElement,
          toLive: (n) => map.get(n) || null,
        },
        scripts: { execute: false },
        fastPath: false,
      });
      assert.equal(
        live.body.innerHTML,
        expected(tail)
          .replace("alpha beta", "alpha TYPED beta")
          .replace("gamma new", mirror ? "gamma new" : "gamma TYPED-NEW new")
          .replace(
            `<p>${tail}</p>`,
            mirror ? `<p>${tail}</p>` : `<p>${tail} TYPED-TAIL</p>`,
          ),
      );
      for (let i = 0; i < owners.length; i++) {
        assert.equal(live.body.children[i], owners[i]);
        assert.equal(owners[i].firstChild, texts[i]);
      }
      assert.deepEqual(
        recoveryProblems(
          report.conflicts,
          finalTree(live.documentElement),
          false,
        ),
        [],
      );
      assert.equal(report.conflicts[0].recovery.localLost, !mirror);
    });
  }
}

test("contested orphan source: exact whole residual takes precedence", () => {
  for (const mirror of [false, true]) {
    const x = planning(
      base,
      mirror ? edit : split("gamma delta"),
      mirror ? split("gamma delta") : edit,
    );
    assert.ok(x.result.certificates.length > 0);
    assert.deepEqual(x.records, []);
    assert.equal(x.html, "<p>alpha beta</p><p>gamma new</p><p>gamma DELTA</p>");
    const tail = mirror ? x.r.body.children[2] : x.l.body.children[2];
    assert.ok(x.result.certificates.some((c) => c.target === tail));
  }
});

test("contested orphan source: conserved multiway split keeps its certificates", () => {
  const l = "<p>alpha beta</p><p>gamma</p><p>delta</p>";
  const x = planning(base, l, edit);
  assert.ok(x.result.certificates.length >= 2);
  assert.deepEqual(x.records, []);
  assert.equal(x.html, "<p>alpha beta</p><p>gamma</p><p>DELTA</p>");
});

test("contested orphan source: incomplete lost source coverage supplies no retention", () => {
  const x = planning(
    "<p>alpha beta gamma delta epsilon</p>",
    split("Gamma delta"),
    "<p>alpha beta gamma DELTA epsilon</p>",
  );
  assert.equal(x.result, null);
  assert.deepEqual(x.records, []);
  assert.ok(x.html.includes("<p>gamma new</p>"));
  assert.ok(x.html.includes("<p>Gamma delta</p>"));
});

test("contested orphan source: caps make no origin or retention claim", () => {
  for (const limit of [0, 1, 64]) {
    const x = planning(base, split("Gamma delta"), edit, { limit });
    assert.equal(x.result, null);
    assert.deepEqual(x.records, []);
  }
});

test("contested orphan source: unchanged opposite and authority do not acquire retention", () => {
  for (const options of [
    {},
    { ignore: (n) => n.tagName === "P" },
    { remoteWins: (n) => n.tagName === "P" },
  ]) {
    const x = planning(base, split("Gamma delta"), base, options);
    assert.deepEqual(x.records, []);
  }
});

test("contested orphan source: source atoms prevent native text retention", () => {
  const x = planning(
    "<p>alpha beta gamma <img id='x'>delta</p>",
    split("Gamma delta"),
    "<p>alpha beta gamma <img id='x'>DELTA</p>",
  );
  assert.deepEqual(x.records, []);
});

test("contested orphan source: later refusal removes earlier partial window membership", () => {
  const x = planning(
    "<p>pre alpha beta gamma delta</p>",
    "<p>pre</p><p>alpha beta</p><p>gamma new</p><p>Gamma delta</p>",
    "<p>pre alpha beta gamma DELTA</p>",
  );
  assert.equal(x.res.L.map.get(x.b.body.firstChild), x.l.body.children[1]);
  assert.equal(x.result, null);
  assert.deepEqual(x.records, []);
  assert.equal(
    x.html,
    "<p>pre</p><p>alpha beta gamma DELTA</p><p>gamma new</p><p>Gamma delta</p>",
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      x.res.provenance.get(x.res.doc.body.children[i]).local,
      x.l.body.children[i],
    );
});

test("contested orphan source: a genuine whole copy remains independent", () => {
  const x = planning(base, base + "<p>gamma new</p>" + base, edit);
  assert.deepEqual(x.records, []);
  assert.equal(x.html, edit + "<p>gamma new</p>" + base);
  for (let i = 0; i < 3; i++)
    assert.equal(
      x.res.provenance.get(x.res.doc.body.children[i]).local,
      x.l.body.children[i],
    );
});
