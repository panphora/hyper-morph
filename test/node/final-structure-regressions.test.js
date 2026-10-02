import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3, mergeDocument } from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { finalTree, recoveryProblems } from "../lib/differential-observe.js";

const twin = {
  b: '<div id="C"><div id="X"><p>a one</p><p>b one</p></div><p id="Y">y one</p></div><div id="D"><p>d one</p></div>',
  l: '<div id="C"><div id="X"><p>a one</p><p>b one LMARK</p></div><p id="Y">y one LMARK2</p></div><div id="D"><p>d one</p></div>',
  r: '<div id="D"><p>d one</p><div id="X"><p>a one RMARK</p><p>b one</p></div></div>',
};
const boundary = {
  b: '<section><div data-id="A"><p>first words</p><p data-id="y">second words</p><!--tail--></div></section><aside></aside>',
  l: '<section><div data-id="A"><p>first LOCAL words</p><p data-id="y">second words</p><!--tail--></div></section><aside></aside>',
  r: '<section></section><aside><div data-id="A"><p>first words</p><p data-id="y">second words</p><!--tail--></div></aside>',
};
const ignore = (node) => node.matches("aside p:not([data-id])");
function pure(input, options = {}) {
  const documents = [input.b, input.l, input.r].map((html) => parse(doc(html)));
  const report = merge3(...documents, {
    ...options,
    hooks: { beforeNodeMorphed() {} },
  });
  return { report, documents, html: report.doc.body.innerHTML };
}
async function dirty(input, options = {}) {
  const live = parse(doc(input.l));
  const before = Array.from(live.querySelectorAll("*"));
  const report = await mergeDocument({
    live,
    base: doc(input.b),
    remote: doc(input.r),
    scripts: { execute: false },
    ...options,
  });
  return { live, before, report };
}

test("final structure: remote similarity demotion preserves the deleted identity and restores the actual local owner", () => {
  const { report, documents } = pure(twin);
  const baseY = documents[0].getElementById("Y");
  assert.equal(report.R.map.has(baseY), false);
  assert.equal(report.R.moved.has(baseY), false);
  assert.equal(report.doc.getElementById("Y").textContent, "y one LMARK2");
  const output = report.doc.getElementById("X").firstChild;
  const p = report.provenance.get(output);
  assert.equal(p.base, documents[0].getElementById("X").firstChild);
  assert.equal(p.local, documents[1].getElementById("X").firstChild);
  assert.equal(p.remote, documents[2].getElementById("X").firstChild);
  assert.equal(output.textContent, "a one RMARK");
});

test("final structure: early demotion preserves exact live X, its anonymous paragraph, and Y", async () => {
  const { live, before } = await dirty(twin);
  const X = before.find((node) => node.id === "X"),
    Y = before.find((node) => node.id === "Y");
  const A = before.find(
    (node) => node.tagName === "P" && node.textContent === "a one RMARK",
  );
  assert.equal(live.getElementById("X"), X);
  assert.equal(live.getElementById("Y"), Y);
  assert.equal(X.firstChild, A);
  assert.equal(Y.textContent, "y one LMARK2");
  assert.equal(live.body.textContent.split("RMARK").length - 1, 1);
});

test("final structure: a valid named remote move from a deleted parent remains an identity move", async () => {
  const input = {
    ...twin,
    r: twin.r.replace('<div id="D">', '<div id="D"><p id="Y">y one REMOTE</p>'),
  };
  const { live, before } = await dirty(input);
  const Y = before.find((node) => node.id === "Y");
  assert.equal(live.getElementById("Y"), Y);
  assert.equal(Y.parentNode.id, "D");
  assert.equal(Y.textContent, "y one LMARK2 REMOTE");
  const { report, documents } = pure(input);
  assert.equal(
    report.R.identityPaired.has(documents[0].getElementById("Y")),
    true,
  );
});

test("final structure: a valid anonymous remote move from a deleted parent retains its live owner", async () => {
  const input = {
    b: '<div id="C"><p>unique owner text</p></div><div id="D"></div>',
    l: '<div id="C"><p>unique LOCAL owner text</p></div><div id="D"></div>',
    r: '<div id="D"><p>unique owner text</p></div>',
  };
  const { live, before } = await dirty(input);
  const paragraph = before.find((node) => node.tagName === "P");
  assert.equal(live.getElementById("D").firstChild, paragraph);
  assert.equal(paragraph.textContent, "unique LOCAL owner text");
});

test("final structure: a surviving original parent does not demote a legitimate changed-identity move", async () => {
  const input = {
    b: '<section id="C"><p id="Y">y one</p></section><aside id="D"></aside>',
    l: '<section id="C"><p id="Y">y one LOCAL</p></section><aside id="D"></aside>',
    r: '<section id="C"></section><aside id="D"><p>y one REMOTE</p></aside>',
  };
  const { live, before } = await dirty(input);
  const paragraph = before.find((node) => node.tagName === "P");
  assert.equal(live.getElementById("D").firstChild, paragraph);
  assert.equal(paragraph.textContent, "y one LOCAL REMOTE");
});

test("final structure: unpair and rematch do not reassign the deleted identity to another anonymous insertion", () => {
  const input = {
    ...twin,
    r: twin.r.replace(
      '<div id="D">',
      '<div id="D"><p>y one AGAIN</p><p>y one ALSO</p>',
    ),
  };
  const { report, documents } = pure(input);
  assert.equal(report.R.map.has(documents[0].getElementById("Y")), false);
  assert.equal(report.doc.getElementById("Y").textContent, "y one LMARK2");
  assert.equal(
    report.doc
      .getElementById("D")
      .textContent.includes("y one AGAINy one ALSO"),
    true,
  );
});

for (const policy of ["remote", "local", "both"]) {
  test(`final structure: the exact ignored-boundary owner is projected by the ${policy} text policy`, () => {
    const { report, documents } = pure(boundary, { ignore, conflicts: policy });
    const roots = {
      base: documents[0].documentElement,
      local: documents[1].documentElement,
      remote: documents[2].documentElement,
      merged: report.doc.documentElement,
    };
    assert.deepEqual(
      report.conflicts.map((c) => c.kind),
      ["text"],
    );
    assert.deepEqual(
      recoveryProblems(report.conflicts, finalTree(roots.merged), true, roots),
      [],
    );
    const output = report.doc.querySelector('[data-id="A"]');
    assert.equal(
      output.textContent,
      policy === "remote" ? "second words" : "first LOCAL wordssecond words",
    );
    assert.equal(output.parentNode.tagName, "ASIDE");
  });
}

test("final structure: an ignored-boundary conflict retains native recovery and the allowed live siblings", async () => {
  const { live, before, report } = await dirty(boundary, { ignore });
  const A = before.find((node) => node.getAttribute("data-id") === "A");
  const Y = before.find((node) => node.getAttribute("data-id") === "y");
  assert.equal(live.querySelector('[data-id="A"]'), A);
  assert.equal(live.querySelector('[data-id="y"]'), Y);
  assert.equal(A.firstChild, Y);
  assert.equal(A.lastChild.nodeType, 8);
  assert.deepEqual(
    report.conflicts.map((c) => c.kind),
    ["text"],
  );
  assert.deepEqual(
    recoveryProblems(report.conflicts, finalTree(live.documentElement), false),
    [],
  );
});

test("final structure: a real remote deletion without an ignored copy keeps edit-beats-delete", () => {
  const input = {
    ...boundary,
    r: boundary.r.replace("<p>first words</p>", ""),
  };
  const { report } = pure(input, { ignore });
  assert.equal(
    report.doc.querySelector('[data-id="A"]').firstChild.textContent,
    "first LOCAL words",
  );
  assert.deepEqual(
    report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
    ["structure:edit-beats-delete"],
  );
});

test("final structure: an unequal ignored candidate does not prove an original owner transition", () => {
  const input = {
    ...boundary,
    r: boundary.r.replace("first words", "first REMOTE words"),
  };
  const { report } = pure(input, { ignore });
  assert.equal(
    report.doc.querySelector('[data-id="A"]').firstChild.textContent,
    "first LOCAL words",
  );
  assert.deepEqual(
    report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
    ["structure:edit-beats-delete"],
  );
});

test("final structure: repeated ignored candidates refuse owner projection", () => {
  const input = {
    ...boundary,
    r: boundary.r.replace(
      "<p>first words</p>",
      "<p>first words</p><p>first words</p>",
    ),
  };
  const { report } = pure(input, { ignore });
  assert.equal(
    report.doc.querySelector('[data-id="A"]').firstChild.textContent,
    "first LOCAL words",
  );
  assert.deepEqual(
    report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
    ["structure:edit-beats-delete"],
  );
});

test("final structure: an authoritative remote owner remains on its existing region path", () => {
  const { report } = pure(boundary, {
    ignore,
    remoteWins: (node) => node.getAttribute("data-id") === "A",
  });
  const owner = report.doc.querySelector('[data-id="A"]');
  assert.equal(owner.textContent, "second words");
  assert.equal(
    report.conflicts.some(
      (c) => c.kind === "structure" && c.detail === "remote-wins",
    ),
    true,
  );
});
