import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import { mergeDocument, morphElement, merge3 } from "../../src/index.js";
import {
  lockstepMap,
  recoveryProblems,
  finalTree,
  observe,
} from "../lib/differential-observe.js";

async function merge(b, l, r, options = {}, mutate = null) {
  const live = parse(doc(l));
  const cap = parse(doc(l));
  const map = lockstepMap(cap.documentElement, live.documentElement);
  if (mutate) mutate(live);
  const report = await mergeDocument({
    live,
    base: parse(doc(b)),
    remote: parse(doc(r)),
    local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
    scripts: { execute: false },
    ...options,
  });
  return { live, report, recoveries: report.conflicts.map((c) => c.recovery) };
}

test("F2: an unrelated conflict never fills a legacy insertion decision", async () => {
  const b = '<p id="p">old</p>';
  const r = '<p id="p">theirs</p><aside id="new">x</aside>';
  for (const l of [b, '<p id="p">mine</p>']) {
    const { live, report } = await merge(b, l, r);
    assert.equal(live.body.innerHTML, r);
    const d = report.decisions.find((x) => x.kind === "insert");
    assert.ok(d);
    assert.equal(d.el, null);
    assert.equal(d.node, null);
    assert.equal(d.applied, false);
  }
});

for (const [kind, b, l, r, field] of [
  [
    "text",
    '<p id="p">One quick fox</p>',
    '<p id="p">One slow fox</p>',
    '<p id="p">One fast fox</p>',
    "node",
  ],
  [
    "attr",
    '<a id="p" href="/a">Go</a>',
    '<a id="p" href="/mine">Go</a>',
    '<a id="p" href="/theirs">Go</a>',
    "el",
  ],
]) {
  test(`F2: ${kind} legacy pointer stays null after capture replacement`, async () => {
    const { report, recoveries } = await merge(b, l, r, {}, (live) => {
      const p = live.getElementById("p");
      p.replaceWith(p.cloneNode(true));
    });
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.conflicts[0][field], null);
    assert.equal(recoveries[0].subject.live.length, 1);
    assert.equal(recoveries[0].applied, true);
  });
}

test("F2: differential observes decision order, pointers, applied and stats", async () => {
  const engine = { mergeDocument, morphElement, merge3 };
  const b = '<p id="p">old</p>';
  const r = '<p id="p">theirs</p><aside id="new">x</aside>';
  const o = await observe(engine, "dirty", { b, l: '<p id="p">mine</p>', r });
  assert.deepEqual(
    o.decisions.map((d) => d.kind),
    ["text", "insert"],
  );
  assert.equal(o.decisions[1].source, "remote");
  assert.equal(o.decisions[1].applied, false);
  assert.equal(o.decisions[1].el, null);
  assert.ok(Object.keys(o.stats).length > 0);
  assert.ok(Object.values(o.stats).every((v) => typeof v === "number"));
});

test("F6: structural conflicts retain every ordered fallback anchor", () => {
  const body = (word) =>
    Array.from(
      { length: 12 },
      (_, i) => `<section id="s${i}"><p>${word} words ${i}</p></section>`,
    ).join("");
  const res = merge3(
    parse(doc(body("old"))),
    parse(doc("")),
    parse(doc(body("new"))),
  );
  assert.equal(res.conflicts.length, 12);
  for (let i = 0; i < 12; i++) {
    const r = res.conflicts[i].recovery;
    assert.equal(r.subject.key, `b:[1,${i}]`);
    assert.equal(r.structure.mergedPlacement.before.length, 11 - i);
    assert.equal(r.structure.mergedPlacement.after.length, i);
    assert.deepEqual(
      r.structure.mergedPlacement.before.map((x) => x.key),
      Array.from({ length: 11 - i }, (_, k) => `b:[1,${i + k + 1}]`),
    );
    assert.deepEqual(
      r.structure.mergedPlacement.after.map((x) => x.key),
      Array.from({ length: i }, (_, k) => `b:[1,${i - k - 1}]`),
    );
  }
});

const emptyCases = [
  [
    "after br",
    '<p id="p">Hello world<br>old tail</p>',
    '<p id="p">Hello world<br>new tail</p>',
    '<p id="p">Hello world<br></p>',
    12,
  ],
  [
    "before atom",
    '<p id="p">old <img src="a.png"> tail words</p>',
    '<p id="p">new <img src="a.png"> tail words</p>',
    '<p id="p"><img src="a.png"> tail words</p>',
    0,
  ],
  [
    "text mark boundary",
    '<p id="p">A quick <i>Z</i></p>',
    '<p id="p">A fast <i>Z</i></p>',
    '<p id="p">A <i>Z</i></p>',
    2,
  ],
  [
    "emptied middle segment",
    "<p>keep one</p><p>a b c d</p><p>tail end</p>",
    "<p>keep one</p><p>a b</p><p>c d</p><p>tail end</p>",
    "<p>keep one</p><p>tail end</p>",
    0,
  ],
  [
    "bare middle segment",
    '<div id="d"><p>keep one</p>alpha beta<p>tail end</p></div>',
    '<div id="d"><p>keep one</p>alpha gamma<p>tail end</p></div>',
    '<div id="d"><p>keep one</p><p>tail end</p></div>',
    0,
  ],
  [
    "source after br",
    '<p id="p">one <br> fox</p>',
    '<p id="p">one <br></p>',
    '<p id="p"><br> aR</p>',
    null,
  ],
];
for (const [name, b, l, r, offset] of emptyCases) {
  test(`F1: ${name}`, async () => {
    const { recoveries } = await merge(b, l, r);
    const texts = recoveries.filter((x) => x.text);
    assert.ok(texts.length > 0);
    if (offset !== null) assert.equal(texts[0].text.merged.fragment, "");
    let checked = 0;
    for (const rv of texts) {
      for (const side of ["base", "local", "remote", "merged"]) {
        const s = rv.text[side];
        if (!s) continue;
        if (s.start === s.end) {
          assert.deepEqual(
            s.span.start,
            s.span.end,
            `${side}: collapsed empty span`,
          );
          checked++;
        }
        if (!s.text.length)
          assert.deepEqual(
            s.scope.start,
            s.scope.end,
            `${side}: collapsed empty scope`,
          );
      }
      assert.equal(rv.applied, true);
      if (offset !== null && rv.text.merged.fragment === "") {
        assert.deepEqual(
          [rv.text.merged.start, rv.text.merged.end],
          [offset, offset],
        );
        assert.equal(
          rv.text.liveSpan.startContainer,
          rv.text.liveSpan.endContainer,
        );
        assert.equal(rv.text.liveSpan.startOffset, rv.text.liveSpan.endOffset);
      }
    }
    assert.ok(checked > 0);
  });
}

test("F1: restoring an emptied segment preserves the surviving paragraph", async () => {
  const b = '<div id="s"><p>alpha bravo</p> charlie delta</div>';
  const l = '<div id="s"><p>alpha</p><p>BRAVE charlie delta</p></div>';
  const r = '<div id="s"><p>alpha BRAVO<br>charlie delta</p></div>';
  const { live, recoveries } = await merge(b, l, r);
  assert.equal(recoveries.length, 2);
  assert.equal(live.body.innerHTML, r);
  const t = recoveries[0].text;
  assert.equal(t.merged.text, "");
  assert.deepEqual(t.merged.span, {
    start: { path: [1, 0], offset: 1 },
    end: { path: [1, 0], offset: 1 },
  });
  const range = live.createRange();
  range.setStart(t.liveSpan.startContainer, t.liveSpan.startOffset);
  range.setEnd(t.liveSpan.endContainer, t.liveSpan.endOffset);
  assert.equal(range.collapsed, true);
  range.deleteContents();
  range.insertNode(range.createContextualFragment(t.local.fragment));
  assert.equal(
    live.body.innerHTML,
    '<div id="s"><p>alpha BRAVO<br>charlie delta</p><p>BRAVE charlie delta</p></div>',
  );
});

test("F1: collapsed mark boundary remains usable inside live template content", async () => {
  const wrap = (s) =>
    `<template id="t"><p id="p">${s}<b>bold</b> end</p></template>`;
  const { recoveries } = await merge(
    wrap("keep old "),
    wrap("keep new "),
    wrap("keep "),
  );
  assert.equal(recoveries.length, 1);
  const r = recoveries[0];
  assert.equal(r.applied, true);
  assert.deepEqual(r.text.merged.span.start, r.text.merged.span.end);
  assert.equal(r.text.liveSpan.startContainer, r.text.liveSpan.endContainer);
  assert.equal(r.text.liveSpan.startOffset, r.text.liveSpan.endOffset);
});

for (const policy of ["local", "remote"]) {
  for (const deleted of ["local", "remote"]) {
    test(`F7: ${deleted} comment deletion, ${policy} policy, one shared recovery`, async () => {
      const b = '<div id="d"><!--old--></div>';
      const edit = '<div id="d"><!--edited--></div>';
      const absent = '<div id="d"></div>';
      const l = deleted === "local" ? absent : edit;
      const r = deleted === "remote" ? absent : edit;
      const { report, recoveries, live } = await merge(b, l, r, {
        conflicts: policy,
      });
      assert.equal(report.conflicts.length, 2);
      assert.deepEqual(
        report.conflicts.map((c) => c.kind),
        ["text", "structure"],
      );
      assert.equal(recoveries[0], recoveries[1]);
      assert.equal(
        recoveries[0].key,
        "structure:b:[1,0,0]:run:edit-beats-delete",
      );
      const text = report.conflicts[0];
      assert.equal(recoveries[0].localLost, text.resolved !== text.local);
      assert.equal(
        live.querySelector("#d").firstChild.nodeValue,
        text.resolved,
      );
      assert.ok(recoveries[0].text);
      assert.ok(recoveries[0].structure);
    });
  }
}

const moveBodies = [
  '<div id="a"><p id="p">P</p></div><div id="b"></div><div id="c"></div>',
  '<div id="a"></div><div id="b"><p id="p">P</p></div><div id="c"></div>',
  '<div id="a"></div><div id="b"></div><div id="c"><p id="p">P</p></div>',
];
for (const prefix of ["ABCDfast ", "ZZZZfast "]) {
  test(`F4: repeated prefix ${prefix} invalidates stale replay offsets`, async () => {
    const { live, recoveries } = await merge(
      '<p id="p">One quick fox.</p>',
      '<p id="p">One slow fox.</p>',
      '<p id="p">One fast fox.</p>',
      {},
      (d) => {
        d.querySelector("p").firstChild.nodeValue = prefix + "One slow fox.";
      },
    );
    assert.equal(live.body.innerHTML, `<p id="p">${prefix}One fast fox.</p>`);
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].unavailable, "missing-output");
    assert.equal(recoveries[0].localLost, true);
    assert.equal(recoveries[0].text.liveSpan, null);
    assert.equal(recoveries[0].text.liveScope, null);
  });
}
for (const [name, b, l, r, rewrite] of [
  [
    "comment",
    '<div id="d"><!--old--></div>',
    '<div id="d"><!--mine--></div>',
    '<div id="d"><!--theirs--></div>',
    (d) => {
      d.querySelector("#d").firstChild.nodeValue = "X";
    },
  ],
  [
    "atom",
    '<p id="p">a old z</p>',
    '<p id="p">a mine z</p>',
    '<p id="p">a <img src="r">theirs z</p>',
    (d) => {
      d.querySelector("#p").lastChild.nodeValue = "X";
    },
  ],
  [
    "empty",
    '<p id="p">old</p>',
    '<p id="p">mine</p>',
    '<p id="p"></p>',
    (d) => {
      d.querySelector("#p").textContent = "X";
    },
  ],
  [
    "repeated scope",
    '<p id="p">One quick fox.</p>',
    '<p id="p">One slow fox.</p>',
    '<p id="p">One fast fox.</p>',
    (d) => {
      d.querySelector("#p").firstChild.nodeValue = "ABCDfast One fast fox.";
    },
  ],
]) {
  test(`F4: beforeApply ${name} rewrite cannot claim the old output`, async () => {
    const { recoveries } = await merge(b, l, r, { beforeApply: rewrite });
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].applied, false);
    assert.equal(recoveries[0].unavailable, "missing-output");
    assert.equal(recoveries[0].localLost, true);
    assert.equal(recoveries[0].text.liveSpan, null);
    assert.equal(recoveries[0].text.liveScope, null);
  });
}
test("F4: beforeApply moving the subject to a different parent invalidates placement", async () => {
  const { live, recoveries } = await merge(...moveBodies, {
    beforeApply: (d) =>
      d.querySelector("#b").appendChild(d.querySelector("#p")),
  });
  assert.equal(live.querySelector("#p").parentElement.id, "b");
  assert.equal(recoveries.length, 2);
  for (const rv of recoveries) {
    assert.equal(rv.applied, false);
    assert.equal(rv.unavailable, "missing-output");
    assert.equal(rv.localLost, true);
  }
});
for (const hook of ["beforeNodeAdded", "beforeNodeRemoved"]) {
  test(`F5: differing-tag ${hook} veto never advertises detached spans`, async () => {
    const live = parse(doc('<div id="s">One slow fox.</div>'));
    const old = live.querySelector("#s");
    const report = await morphElement(
      old,
      '<section id="s">One fast fox.</section>',
      {
        base: '<div id="s">One quick fox.</div>',
        scripts: { execute: false },
        hooks: { [hook]: () => false },
      },
    );
    assert.equal(report.conflicts.length, 1);
    const rv = report.conflicts[0].recovery;
    assert.equal(rv.applied, false);
    assert.equal(rv.unavailable, "missing-output");
    assert.equal(rv.localLost, true);
    assert.equal(rv.text.liveSpan, null);
    assert.ok(rv.subject.live.every((n) => old === n || old.contains(n)));
  });
}
test("F5: differing-tag script spans point at the replacement text", async () => {
  const live = parse(doc('<div id="s">One slow fox.</div>'));
  const old = live.querySelector("#s");
  const report = await morphElement(
    old,
    '<script id="s" type="application/json">One fast fox.</script>',
    { base: '<div id="s">One quick fox.</div>', scripts: { execute: false } },
  );
  assert.equal(report.conflicts.length, 1);
  const rv = report.conflicts[0].recovery,
    script = live.querySelector("script");
  assert.equal(rv.applied, true);
  assert.deepEqual(rv.subject.live, [script]);
  assert.equal(rv.text.liveSpan.startContainer, script.firstChild);
  assert.equal(rv.text.liveSpan.endContainer, script.firstChild);
  assert.equal(
    script.firstChild.nodeValue.slice(
      rv.text.liveSpan.startOffset,
      rv.text.liveSpan.endOffset,
    ),
    "fast",
  );
});
test("F3: a content morph veto cannot hide an already completed move", async () => {
  const { live, recoveries } = await merge(...moveBodies, {
    hooks: { beforeNodeMorphed: (n) => n.id !== "p" },
  });
  assert.equal(live.querySelector("#p").parentElement.id, "c");
  assert.equal(recoveries.length, 2);
  for (const rv of recoveries) {
    assert.equal(rv.applied, true);
    assert.equal(rv.unavailable, null);
    assert.equal(rv.localLost, true);
  }
});
test("F3: a parent veto that loses the subject is missing-output and keeps the loss", async () => {
  const { live, recoveries } = await merge(...moveBodies, {
    hooks: { beforeNodeMorphed: (n) => n.id !== "c" },
  });
  assert.equal(live.querySelector("#p"), null);
  assert.equal(recoveries.length, 2);
  for (const rv of recoveries) {
    assert.equal(rv.applied, false);
    assert.equal(rv.unavailable, "missing-output");
    assert.equal(rv.localLost, true);
    assert.deepEqual(rv.subject.live, []);
  }
});
for (const tag of ["input", "textarea"]) {
  test(`F3: ${tag} value hook veto preserves the local operation`, async () => {
    const body = (v) =>
      tag === "input"
        ? `<input id="t" value="${v}">`
        : `<textarea id="t">${v}</textarea>`;
    const { live, recoveries } = await merge(
      body("old"),
      body("mine"),
      body("theirs"),
      { hooks: { beforeAttributeUpdated: (name) => name !== "value" } },
    );
    assert.equal(live.querySelector("#t").value, "mine");
    assert.equal(recoveries.length, 1);
    const rv = recoveries[0];
    assert.equal(rv.applied, false);
    assert.equal(rv.unavailable, "hook-veto");
    assert.equal(rv.localLost, false);
    if (rv.text) assert.equal(rv.text.liveSpan, null);
  });
}
for (const bare of [false, true]) {
  test(`F3: removal veto preserves ${bare ? "bare" : "inline"} local text`, async () => {
    const body = (v) =>
      bare
        ? `<div id="d"><p>keep one</p>${v}<p>tail end</p></div>`
        : `<p id="p">Hello world<br>${v}</p>`;
    const { live, recoveries } = await merge(
      body("old tail"),
      body("new tail"),
      body(""),
      { hooks: { beforeNodeRemoved: (n) => n.nodeType !== 3 } },
    );
    assert.ok(live.body.textContent.includes("new tail"));
    const texts = recoveries.filter((r) => r.text);
    assert.ok(texts.length > 0);
    for (const rv of texts) {
      assert.equal(rv.applied, false);
      assert.equal(rv.unavailable, "hook-veto");
      assert.equal(rv.localLost, false);
      assert.equal(rv.text.liveSpan, null);
    }
  });
}
test("F3: ordinary attribute veto does not cancel its sibling text operation", async () => {
  const body = (title, text) => `<p id="p" title="${title}">${text}</p>`;
  const { recoveries } = await merge(
    body("old", "old"),
    body("mine", "mine"),
    body("theirs", "theirs"),
    { hooks: { beforeAttributeUpdated: (name) => name !== "title" } },
  );
  assert.equal(recoveries.length, 2);
  const attr = recoveries.find((r) => r.attribute),
    text = recoveries.find((r) => r.text);
  assert.equal(attr.unavailable, "hook-veto");
  assert.equal(attr.localLost, false);
  assert.equal(text.applied, true);
  assert.equal(text.localLost, true);
});
test("certification: rejects noncollapsed empty source spans and all live projection mismatches", async () => {
  const { live, report, recoveries } = await merge(
    '<p id="p">A quick <i>Z</i></p>',
    '<p id="p">A fast <i>Z</i></p>',
    '<p id="p">A <i>Z</i></p>',
  );
  const final = finalTree(live.documentElement);
  assert.deepEqual(recoveryProblems(report.conflicts, final, false), []);
  const t = recoveries[0].text;
  const old = t.local.span;
  t.local.span = {
    start: { path: [1, 0], offset: 0 },
    end: { path: [1, 0], offset: 1 },
  };
  const start = t.local.start,
    end = t.local.end;
  t.local.start = t.local.end = 0;
  assert.ok(
    recoveryProblems(report.conflicts, final, false).some((x) =>
      x.includes("empty span not collapsed"),
    ),
  );
  t.local.span = old;
  t.local.start = start;
  t.local.end = end;
  t.liveScope.endOffset--;
  assert.ok(
    recoveryProblems(report.conflicts, final, false).some((x) =>
      x.includes("projection differs"),
    ),
  );
});
test("certification: atom, break and comment spans are projected against their immutable roots", () => {
  const triples = [
    [
      '<p id="p">a old z</p>',
      '<p id="p">a mine z</p>',
      '<p id="p">a <img src="r">theirs z</p>',
    ],
    [
      "<p>alpha bravo charlie delta</p>",
      "<p>alpha bravo</p><p>charlie delta</p>",
      "<p>alpha BRAVO CHARLIE delta</p>",
    ],
    [
      "<div><!--old--></div>",
      "<div><!--mine--></div>",
      "<div><!--theirs--></div>",
    ],
  ];
  for (const [b, l, r] of triples) {
    const roots = {
      base: parse(doc(b)).documentElement,
      local: parse(doc(l)).documentElement,
      remote: parse(doc(r)).documentElement,
    };
    const res = merge3(roots.base, roots.local, roots.remote, {
      hooks: { beforeNodeMorphed: () => {} },
    });
    assert.ok(res.conflicts.length > 0);
    roots.merged = res.doc.documentElement;
    const final = finalTree(roots.merged);
    assert.deepEqual(recoveryProblems(res.conflicts, final, true, roots), []);
    const text = res.conflicts.find((c) => c.recovery.text).recovery.text;
    text.remote.text += "WRONG";
    assert.ok(
      recoveryProblems(res.conflicts, final, true, roots).some((x) =>
        x.includes("projection differs"),
      ),
    );
  }
});

test("F4: Opus repeated first word cannot impersonate the shifted clash", async () => {
  const { live, recoveries } = await merge(
    '<p id="p">fast X quick Y</p>',
    '<p id="p">fast X slow Y</p>',
    '<p id="p">fast X fast Y</p>',
    {},
    (d) => {
      d.querySelector("p").firstChild.nodeValue = "typed! fast X slow Y";
    },
  );
  assert.equal(live.body.textContent, "typed! fast X fast Y");
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].applied, false);
  assert.equal(recoveries[0].unavailable, "missing-output");
  assert.equal(recoveries[0].text.liveSpan, null);
});
test("F4: a rewritten participant order cannot claim the planned reorder", async () => {
  const wrap = (ids) =>
    `<div id="s">${ids.map((id) => `<p id="${id}">${id.toUpperCase()}</p>`).join("")}</div>`;
  const { recoveries } = await merge(
    wrap(["a", "b", "c"]),
    wrap(["b", "a", "c"]),
    wrap(["a", "c", "b"]),
    {
      beforeApply: (d) =>
        d.querySelector("#s").appendChild(d.querySelector("#a")),
    },
  );
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].applied, false);
  assert.equal(recoveries[0].unavailable, "missing-output");
  assert.equal(recoveries[0].localLost, true);
});
for (const node of ["p", "BODY", "text"]) {
  test(`F3: vetoing ${node} preserves the local T1 operation`, async () => {
    const veto = (n) =>
      node === "text"
        ? n.nodeType !== 3
        : node === "BODY"
          ? n.tagName !== "BODY"
          : n.id !== "p";
    const { live, recoveries } = await merge(
      '<p id="p">One quick fox</p>',
      '<p id="p">One slow fox</p>',
      '<p id="p">One fast fox</p>',
      { hooks: { beforeNodeMorphed: veto } },
    );
    assert.equal(live.body.textContent, "One slow fox");
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].unavailable, "hook-veto");
    assert.equal(recoveries[0].localLost, false);
    assert.equal(recoveries[0].text.liveSpan, null);
  });
}
for (const textOnly of [false, true]) {
  test(`F3: S6 ${textOnly ? "text" : "element"} hook reports the operation that actually happened`, async () => {
    const { live, recoveries } = await merge(
      '<div id="s"></div>',
      '<div id="s"><p id="p">LOCAL</p></div>',
      '<div id="s"><p id="p">REMOTE</p></div>',
      {
        hooks: {
          beforeNodeMorphed: (n) =>
            textOnly ? n.nodeType !== 3 : n.id !== "p",
        },
      },
    );
    assert.equal(live.body.textContent, textOnly ? "REMOTE" : "LOCAL");
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].applied, textOnly);
    assert.equal(recoveries[0].unavailable, textOnly ? null : "hook-veto");
    assert.equal(recoveries[0].localLost, textOnly);
  });
}

test("certification: moved formatting atoms project completely and reject changed scope text", () => {
  const b = "<p>w0 <b>w6</b> w1 w2 w3 w4 w5</p><p>w7 w8 w9 w10 w11</p>";
  const l = "<p>w13 w14 w15 w16</p><p>w12 w8 w9 w10 w11</p>";
  const r =
    "<p>w0 w1 w2 w3 w4 w5</p><p>w17 w18 w19 w20 w21</p><p>w7 w8 w9 w10 w11 <b>w6</b></p>";
  const roots = {
    base: parse(doc(b)).documentElement,
    local: parse(doc(l)).documentElement,
    remote: parse(doc(r)).documentElement,
  };
  const res = merge3(roots.base, roots.local, roots.remote, {
    hooks: { beforeNodeMorphed: () => {} },
  });
  roots.merged = res.root;
  const final = finalTree(res.root);
  assert.ok(
    res.conflicts.some((c) => c.recovery.text?.base.text.includes("\ufffc")),
  );
  assert.deepEqual(recoveryProblems(res.conflicts, final, true, roots), []);
  const t = res.conflicts.find((c) => c.recovery.text).recovery.text;
  t.base.text = t.base.text.replace("w0", "ZZ");
  assert.ok(
    recoveryProblems(res.conflicts, final, true, roots).some((x) =>
      x.includes("projection differs"),
    ),
  );
});

test("F2: differing-tag ordinary text retains the legacy original-root pointer", async () => {
  const live = parse(doc('<div id="s">One slow fox.</div>'));
  const old = live.querySelector("#s");
  const report = await morphElement(
    old,
    '<section id="s">One fast fox.</section>',
    { base: '<div id="s">One quick fox.</div>', scripts: { execute: false } },
  );
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].node, old);
  assert.equal(old.isConnected, false);
  assert.equal(
    report.conflicts[0].recovery.subject.live[0],
    live.querySelector("section"),
  );
});

for (const [name, b, l, r] of [
  [
    "paragraph",
    '<p>w0 w1 w2 <img src="i6.png"> w3 w4 w5</p><p><img src="i13.png"> w7 w8 w9 w10 w11 w12</p>',
    '<p>w0</p><p>w16 w17 w18 w19</p><p>w1 w2 <img src="i6.png"> w3 w4 w5</p><p><img src="i13.png"> w15 w14 w8 w9 w10 w11 w12</p>',
    '<p>w0</p><p>w1 w2 <img src="i6.png"> w3 w4 w5</p><p><img src="i13.png"> w20 w14 w8 w9 w10 w11 w12</p>',
  ],
  [
    "list",
    "<ul><li>w0 w1 w2 w3 w4 <b>w6</b> w5</li><li>w7 w8 w9 w10 w11 w12</li></ul><ul><li>w13 w14 w15 <b>w17</b> w16</li></ul>",
    "<p>w25 w26 w27 w28</p><ul><li>w0 w1 w2 w3 w4 <b>w6</b></li><li>w5</li><li>w7 w8 w9 w10 w11 w12</li></ul><ul><li>w18 w19 <b>w24</b> w20 w21 w22 w23</li><li>w13 w14 w15 <b>w17</b> w16</li></ul>",
    '<ul><li>w0 w1 w2 w3 w4 <b>w6</b></li><li><img src="i32.png"> w29</li><li>w30 w31</li><li>w5</li><li>w7 w8 w9 w10 w11 w12</li></ul><ul><li>w18 w19 <b>w24</b> w20 w21 w22 w23</li><li>w13 w14 w15 <b>w17</b> w16</li></ul>',
  ],
]) {
  test(`certification: opaque inserted blocks in a ${name} scope project exactly`, () => {
    const roots = {
      base: parse(doc(b)).documentElement,
      local: parse(doc(l)).documentElement,
      remote: parse(doc(r)).documentElement,
    };
    const res = merge3(roots.base, roots.local, roots.remote, {
      hooks: { beforeNodeMorphed: () => {} },
    });
    roots.merged = res.root;
    assert.ok(res.conflicts.length > 0);
    const final = finalTree(res.root);
    assert.deepEqual(recoveryProblems(res.conflicts, final, true, roots), []);
    const t = res.conflicts.find((c) => c.recovery.text).recovery.text;
    if (name === "list") {
      assert.equal(t.remote.start, 18);
      assert.equal(t.remote.end, 21);
      assert.deepEqual(t.remote.span.end, { path: [1, 0, 3], offset: 0 });
      assert.equal(
        t.remote.text.slice(t.remote.start, t.remote.end),
        "\ufffc\ufffc\u001e",
      );
    }
    t.local.text = t.local.text.replace("w0", "ZZ");
    assert.ok(
      recoveryProblems(res.conflicts, final, true, roots).some((x) =>
        x.includes("projection differs"),
      ),
    );
  });
}
