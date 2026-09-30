// The fix round in a real browser: keepLiveOnly's attributes and class tokens
// (src/apply.js), the both-reordered whitespace check (src/recovery.js), and
// the remote twin guard (src/merge.js). The node suites assert the same cases
// under jsdom; this file runs them on the browser's own parser and DOM, and
// keeps them in browser coverage.
describe("fix round: keepLiveOnly, reorder whitespace, remote twin", function () {
  setup();

  const doc = (body, head = "") =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
  const page = (text, cls = "block") =>
    doc(
      `<main><div id="ed"${cls === null ? "" : ` class="${cls}"`}><p>${text}</p></div><p id="other">other</p></main>`,
    );
  const lockstep = (a, b) => {
    const m = new Map();
    (function pair(x, y) {
      m.set(x, y);
      for (let i = 0; i < x.childNodes.length && i < y.childNodes.length; i++)
        pair(x.childNodes[i], y.childNodes[i]);
    })(a, b);
    return m;
  };
  const keys = (list) => list.map((x) => x.key);
  const elements = (list) => list.filter((x) => x.nodeType === 1);

  // The ClayJS shape: the live tab carries local state, and a capture of it,
  // the same bytes, is `local`.
  async function peer(remote, options) {
    const live = parseHTML(page("hello"));
    const cap = parseHTML(page("hello"));
    const map = lockstep(cap.documentElement, live.documentElement);
    const ed = live.getElementById("ed");
    ed.setAttribute("contenteditable", "true");
    ed.setAttribute("role", "textbox");
    ed.classList.add("richclay-active");
    const report = await HyperMorph.mergeDocument({
      live,
      base: cap,
      local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
      remote,
      scripts: { execute: false },
      ...options,
    });
    return { live, ed, report };
  }

  for (const fastPath of [false, true])
    it(`keepLiveOnly keeps attributes and class tokens the capture lacks (fastPath ${fastPath})`, async function () {
      const { live, ed, report } = await peer(page("hello REMOTE"), {
        keepLiveOnly: true,
        fastPath,
      });
      live.getElementById("ed").should.equal(ed);
      ed.textContent.should.equal("hello REMOTE");
      ed.getAttribute("contenteditable").should.equal("true");
      ed.getAttribute("role").should.equal("textbox");
      ed.getAttribute("class").should.equal("block richclay-active");
      report.conflicts.should.deep.equal([]);
    });

  it("keepLiveOnly applies a remote class change and keeps the live-only token", async function () {
    const { ed } = await peer(page("hello", "block wide"), {
      keepLiveOnly: true,
    });
    ed.getAttribute("class").should.equal("block wide richclay-active");
    ed.getAttribute("contenteditable").should.equal("true");
  });

  it("without keepLiveOnly the apply still makes live attributes equal the merge", async function () {
    const { ed } = await peer(page("hello REMOTE"), {});
    ed.textContent.should.equal("hello REMOTE");
    ed.hasAttribute("contenteditable").should.equal(false);
    ed.getAttribute("class").should.equal("block");
  });

  it("keepLiveOnly must be a boolean", async function () {
    let err = null;
    try {
      await peer(page("hello"), { keepLiveOnly: "yes" });
    } catch (e) {
      err = e;
    }
    err.should.be.an.instanceOf(TypeError);
    err.message.should.match(/keepLiveOnly must be a boolean/);
  });

  it("keepLiveOnly keeps live-only class tokens when the merge drops the class attribute", async function () {
    const { ed } = await peer(page("hello", null), { keepLiveOnly: true });
    ed.getAttribute("class").should.equal("richclay-active");
    ed.getAttribute("contenteditable").should.equal("true");
  });

  it("keepLiveOnly writes the merged class unchanged when no live-only token remains", async function () {
    const live = parseHTML(page("hello"));
    const cap = parseHTML(page("hello"));
    const map = lockstep(cap.documentElement, live.documentElement);
    await HyperMorph.mergeDocument({
      live,
      base: cap,
      local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
      remote: page("hello", "a  b\u00a0c "),
      scripts: { execute: false },
      keepLiveOnly: true,
    });
    live
      .getElementById("ed")
      .getAttribute("class")
      .should.equal("a  b\u00a0c ");
  });

  it("a remote similarity move is not taken as the twin of an element remote deleted", async function () {
    const base = `<div id="C"><div id="X"><p>a one</p><p>b one</p></div><p id="Y">y one</p></div><div id="D"><p>d one</p></div>`;
    const local = `<div id="C"><div id="X"><p>a one</p><p>b one LMARK</p></div><p id="Y">y one LMARK2</p></div><div id="D"><p>d one</p></div>`;
    const remote = `<div id="D"><p>d one</p><div id="X"><p>a one RMARK</p><p>b one</p></div></div>`;
    const live = parseHTML(doc(local));
    await HyperMorph.mergeDocument({
      live,
      base: doc(base),
      remote: doc(remote),
      scripts: { execute: false },
    });
    const body = live.body.innerHTML;
    live.getElementById("Y")?.textContent.should.equal("y one LMARK2");
    (body.split("RMARK").length - 1).should.equal(1, body);
  });

  // The ClayJS shape for a conflict: the live page and its capture are the
  // same bytes, and the merge reads the report's per-conflict recovery.
  async function merge(base, local, remote) {
    const live = parseHTML(doc(local));
    const cap = parseHTML(doc(local));
    const map = lockstep(cap.documentElement, live.documentElement);
    const report = await HyperMorph.mergeDocument({
      live,
      base: parseHTML(doc(base)),
      local: { root: cap.documentElement, toLive: (n) => map.get(n) || null },
      remote: parseHTML(doc(remote)),
      scripts: { execute: false },
    });
    return {
      report,
      live,
      kinds: report.conflicts.map((c) => `${c.kind}:${c.detail || ""}`),
      rv: report.conflicts.map((c) => c.recovery),
      el: (n) => live.body.querySelector(n),
    };
  }

  it("both-reordered: only a whitespace text node in a different place is not a loss", async function () {
    const local = `<div id="s"><p id="a">A</p><p id="c">C</p><p id="b">B</p>\n</div>`;
    const m = await merge(
      `<div id="s"><p id="a">A</p><p id="b">B</p><p id="c">C</p>\n</div>`,
      local,
      `<div id="s"><p id="a">A</p><p id="c">C</p>\n<p id="b">B</p>\n</div>`,
    );
    m.kinds.should.deep.equal(["structure:both-reordered"]);
    const r = m.rv[0];
    const s = r.structure;
    keys(elements(s.localOrder)).should.deep.equal([
      "b:[1,0,0]",
      "b:[1,0,2]",
      "b:[1,0,1]",
    ]);
    keys(elements(s.mergedOrder)).should.deep.equal(
      keys(elements(s.localOrder)),
    );
    keys(s.localOrder).should.not.deep.equal(keys(s.mergedOrder));
    keys(s.localOrder)
      .filter((k) => k.endsWith(":run"))
      .should.deep.equal(keys(s.mergedOrder).filter((k) => k.endsWith(":run")));
    [...m.el("#s").children]
      .map((x) => x.id)
      .should.deep.equal(
        [...parseHTML(doc(local)).querySelector("#s").children].map(
          (x) => x.id,
        ),
      );
    r.localLost.should.equal(false);
  });

  it("both-reordered: a non-breaking-space run that moved is still a loss", async function () {
    const local = `<div id="s"><p id="a">A</p><p id="c">C</p><p id="b">B</p>\u00a0</div>`;
    const m = await merge(
      `<div id="s"><p id="a">A</p><p id="b">B</p><p id="c">C</p>\u00a0</div>`,
      local,
      `<div id="s"><p id="a">A</p><p id="c">C</p>\u00a0<p id="b">B</p>\u00a0</div>`,
    );
    m.kinds.should.include("structure:both-reordered");
    const r = m.rv[0];
    const s = r.structure;
    keys(elements(s.localOrder)).should.deep.equal([
      "b:[1,0,0]",
      "b:[1,0,2]",
      "b:[1,0,1]",
    ]);
    keys(elements(s.mergedOrder)).should.deep.equal(
      keys(elements(s.localOrder)),
    );
    keys(s.localOrder).should.not.deep.equal(keys(s.mergedOrder));
    keys(s.localOrder)
      .filter((k) => k.endsWith(":run"))
      .should.deep.equal(keys(s.mergedOrder).filter((k) => k.endsWith(":run")));
    [...m.el("#s").children]
      .map((x) => x.id)
      .should.deep.equal(
        [...parseHTML(doc(local)).querySelector("#s").children].map(
          (x) => x.id,
        ),
      );
    r.localLost.should.equal(true);
  });

  it("both-reordered: a real element order loss still reports localLost", async function () {
    const m = await merge(
      `<div id="s"><p id="a">A</p><p id="b">B</p><p id="c">C</p>\n</div>`,
      `<div id="s"><p id="b">B</p><p id="a">A</p><p id="c">C</p>\n</div>`,
      `<div id="s"><p id="a">A</p><p id="c">C</p><p id="b">B</p>\n</div>`,
    );
    m.kinds.should.deep.equal(["structure:both-reordered"]);
    const r = m.rv[0];
    const s = r.structure;
    keys(elements(s.localOrder)).should.deep.equal([
      "b:[1,0,1]",
      "b:[1,0,0]",
      "b:[1,0,2]",
    ]);
    keys(elements(s.mergedOrder)).should.deep.equal([
      "b:[1,0,0]",
      "b:[1,0,2]",
      "b:[1,0,1]",
    ]);
    r.localLost.should.equal(true);
  });
});
