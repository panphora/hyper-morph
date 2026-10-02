import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeBodies } from "./lib/merge.js";

test("occurrences: an orphan cannot claim a neighbor's independent rewrite", () => {
  const { res } = mergeBodies(
    '<p id="a">common one two</p><p id="b">anchor</p>',
    '<p id="b">anchor common xx yy zz</p>',
    '<p id="a">common one IMPORTANT</p><p id="b">anchor</p>',
  );
  assert.equal(res.doc.getElementById("a").textContent, "common one IMPORTANT");
  assert.equal(
    res.doc.getElementById("b").textContent,
    "anchor common xx yy zz",
  );
});

test("occurrences: a shared period does not certify an orphan sentence", () => {
  const { res } = mergeBodies(
    "<p>Agenda below.</p><p>Bring slides tomorrow.</p>",
    "<p>Agenda below. Ask host first.</p>",
    "<p>Agenda below.</p><p>Bring slides Friday.</p>",
  );
  const paragraphs = [...res.doc.body.querySelectorAll("p")].map(
    (p) => p.textContent,
  );
  assert.ok(paragraphs.includes("Agenda below. Ask host first."));
  assert.ok(paragraphs.includes("Bring slides Friday."));
});

test("occurrences: a full copy cannot steal edits from an edited original", () => {
  const { html } = mergeBodies(
    '<p id="a">one two three</p>',
    '<p id="a">one TWO three</p><p id="copy">one two three</p>',
    '<p id="a">one two FOUR</p>',
  );
  assert.equal(
    html,
    '<p id="a">one TWO FOUR</p><p id="copy">one two three</p>',
  );
});

test("occurrences: 255 unrelated blocks do not disable a split", () => {
  const pad = Array.from({ length: 255 }, (_, i) => `<hr id="pad${i}">`).join(
    "",
  );
  const { html } = mergeBodies(
    '<p id="a">alpha beta gamma</p>' + pad,
    '<p id="a">alpha beta GAMMA</p>' + pad,
    '<p id="a">alpha</p><p>beta gamma</p>' + pad,
  );
  assert.equal(html, '<p id="a">alpha</p><p>beta GAMMA</p>' + pad);
});

test("occurrences: an article's total size does not disable a local split", () => {
  const article = Array.from(
    { length: 30 },
    (_, i) =>
      `<p>${Array.from({ length: 40 }, (_, j) => "word" + ((i * 7 + j) % 50)).join(" ")} end${i}</p>`,
  ).join("");
  const { html } = mergeBodies(
    article + "<p>a1 b1 c1 d1</p>",
    article + "<p>a1 b1 c1 D1</p>",
    article + "<p>a1 b1</p><p>c1 d1</p>",
  );
  assert.equal(html, article + "<p>a1 b1</p><p>c1 D1</p>");
});

for (const splitSide of ["local", "remote"]) {
  test(`occurrences: a ${splitSide} list split retains text against a nested sub-list`, () => {
    const base = "<ul><li>a1 b1 c1 d1</li></ul>";
    const split = "<ul><li>a1 b1</li><li>c1 d1</li></ul>";
    const nested = "<ul><li>a1 b1 c1 d1<ul><li>sub</li></ul></li></ul>";
    const { html } = mergeBodies(
      base,
      splitSide === "local" ? split : nested,
      splitSide === "local" ? nested : split,
    );
    for (const word of ["a1", "b1", "c1", "d1", "sub"])
      assert.equal(
        (html.match(new RegExp(`\\b${word}\\b`, "g")) || []).length,
        1,
        word,
      );
  });
}

test("occurrences: a pretty-printed join survives an unrelated heading fix", () => {
  const { res } = mergeBodies(
    "<main>\n  <h1>Titel</h1>\n  <p>first part</p>\n  <p>second part</p>\n</main>",
    "<main>\n  <h1>Titel</h1>\n  <p>first part second part</p>\n</main>",
    "<main>\n  <h1>Title</h1>\n  <p>first part</p>\n  <p>second part</p>\n</main>",
  );
  assert.equal(res.doc.querySelector("h1").textContent, "Title");
  assert.deepEqual(
    [...res.doc.body.querySelectorAll("p")].map((p) => p.textContent),
    ["first part second part"],
  );
  assert.equal(res.conflicts.length, 0);
});

for (const middle of [
  "<hr>",
  '<img src="x.png">',
  "<ul><li>item</li></ul>",
  "<table><tbody><tr><td>t</td></tr></tbody></table>",
]) {
  for (const splitSide of ["local", "remote"]) {
    test(`occurrences: a ${splitSide} split preserves an inserted ${middle} and the other edit`, () => {
      const split = "<p>a1 b1</p>" + middle + "<p>c1 d1</p>";
      const edited = "<p>a1 b1 c1 D1</p>";
      const { html } = mergeBodies(
        "<p>a1 b1 c1 d1</p>",
        splitSide === "local" ? split : edited,
        splitSide === "local" ? edited : split,
      );
      assert.equal(html, "<p>a1 b1</p>" + middle + "<p>c1 D1</p>");
    });
  }
}

test("occurrences: whitespace around an insertion does not disable another split", () => {
  const { res } = mergeBodies(
    "\n<p>z</p>\n<p>a1 b1 c1 d1</p>\n",
    "\n<p>z</p>\n<p>a1 b1</p><p>c1 d1</p>\n",
    "\n<p>z</p>\n<p>NEW</p>\n<p>a1 b1 c1 D1</p>\n",
  );
  assert.deepEqual(
    [...res.doc.body.querySelectorAll("p")].map((p) => p.textContent),
    ["z", "NEW", "a1 b1", "c1 D1"],
  );
});

test("occurrences: a distant rewrite does not exhaust a small split's evidence", () => {
  const oldText = Array.from({ length: 60 }, (_, i) => `old${i}`).join(" ");
  const newText = Array.from({ length: 60 }, (_, i) => `new${i}`).join(" ");
  const { html } = mergeBodies(
    `<p>a1 b1 c1 d1</p><p>keep</p><p>${oldText}</p>`,
    `<p>a1 b1</p><p>c1 d1</p><p>keep</p><p>${newText}</p>`,
    `<p>a1 b1 c1 D1</p><p>keep</p><p>${oldText}</p>`,
  );
  assert.equal(html, `<p>a1 b1</p><p>c1 D1</p><p>keep</p><p>${newText}</p>`);
});
