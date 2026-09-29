// The fast path in a real browser: each case merges a clean tab (a fresh
// capture of the live page as base and local) twice, with `fastPath` off and
// on, and the two must leave the same page and report the same result. The
// node suite holds the full equivalence gate; this file runs the path under
// the browser's own parser and DOM, and keeps it in coverage.
describe("fastPath", function () {
  setup();

  const page = (body, head = "", attrs = "") =>
    `<!DOCTYPE html><html${attrs ? " " + attrs : ""}><head>${head}</head><body>${body}</body></html>`;
  const cards = (b = "B", header = "top") =>
    `<header><p>${header}</p></header><main><div class="card"><h3>A</h3><p>alpha</p></div><div class="card"><h3>${b}</h3><p>beta</p></div></main>`;

  const pathOf = (n) => {
    const p = [];
    for (; n.parentNode && n.parentNode.nodeType === 1; n = n.parentNode)
      p.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
    return p.join(".");
  };
  const lockstep = (a, b) => {
    const m = new Map();
    (function pair(x, y) {
      m.set(x, y);
      for (let i = 0; i < x.childNodes.length && i < y.childNodes.length; i++)
        pair(x.childNodes[i], y.childNodes[i]);
    })(a, b);
    return m;
  };
  const authored = (el) =>
    el.getAttribute("data-id") || el.getAttribute("id") || null;
  const synthetic = (cap, remote, toLive) => {
    const store = HyperMorph.createIdentityStore("t");
    const capMap = store.exportMap(cap.documentElement, toLive);
    const map = HyperMorph.createIdentityStore("s").exportMap(
      remote.documentElement,
      (n) => n,
    );
    for (const k of Object.keys(map))
      if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
    const local = (el) => authored(el) || store.idOf(toLive(el) || el) || null;
    return {
      base: local,
      local,
      remote: { first: authored, map, then: authored },
    };
  };
  const byPath = (base, remote) => () => {
    const f = (ids) => (el) => ids[pathOf(el)] || null;
    return { base: f(base), local: f(base), remote: f(remote) };
  };

  async function clean(fastPath, c) {
    const base = parseHTML(c.base),
      live = parseHTML(c.base),
      remote = parseHTML(c.remote);
    if (c.prepare) c.prepare(live);
    if (c.fixRemote) c.fixRemote(remote);
    const lock = lockstep(base.documentElement, live.documentElement);
    const toLive = (n) => {
      const m = c.toLive ? c.toLive(n, live) : undefined;
      return m === undefined ? lock.get(n) || null : m;
    };
    const identity =
      c.identity === "synthetic"
        ? synthetic(base, remote, toLive)
        : c.identity
          ? c.identity()
          : undefined;
    const report = await HyperMorph.mergeDocument({
      live,
      base,
      local: { root: base.documentElement, toLive },
      remote,
      scripts: { execute: false },
      ...(identity ? { identity } : {}),
      ...(c.options || {}),
      fastPath,
    });
    const s = report.stats;
    return {
      seen: {
        html: live.documentElement.outerHTML,
        identities: report.identities.map(([el, id]) => [pathOf(el), id]),
        moved: report.moved.length,
        replaced: report.replaced.length,
        conflicts: report.conflicts.length,
        localDiverged: report.localDiverged,
        values: [...live.querySelectorAll("input,textarea,option")].map((el) =>
          el.tagName === "OPTION" ? el.selected : el.value,
        ),
      },
      outcome: !s.fastPathAttempted
        ? "off"
        : s.fastPathTaken
          ? "taken"
          : s.fastPathFallback,
    };
  }

  const one = (n) => n.tagName === "H3" && n.textContent === "B";
  const CASES = [
    [
      "one card edited",
      { base: page(cards()), remote: page(cards("B2")) },
      "taken",
    ],
    [
      "one card edited, synthetic identity",
      { base: page(cards()), remote: page(cards("B2")), identity: "synthetic" },
      "taken",
    ],
    [
      "a card edited beside a runtime input value",
      {
        base: page(`<form><input name="q" value="v"></form>` + cards()),
        remote: page(`<form><input name="q" value="v"></form>` + cards("B2")),
        prepare: (live) => {
          live.querySelector("input").value = "RUNTIME";
        },
        identity: "synthetic",
      },
      "taken",
    ],
    [
      "nothing changed",
      { base: page(cards()), remote: page(cards()) },
      "equal",
    ],
    [
      "the header and a card changed",
      { base: page(cards()), remote: page(cards("B2", "TOP")) },
      "root-level",
    ],
    [
      "the title changed",
      {
        base: page(cards(), "<title>t</title>"),
        remote: page(cards(), "<title>t2</title>"),
      },
      "not-in-body",
    ],
    [
      "a root attribute changed",
      {
        base: page(cards(), "", 'data-theme="old"'),
        remote: page(cards("B2"), "", 'data-theme="new"'),
      },
      "root-attrs",
    ],
    [
      "a template on the page",
      {
        base: page("<template><p>t</p></template>" + cards()),
        remote: page("<template><p>t</p></template>" + cards("B2")),
      },
      "script-or-template",
    ],
    [
      "a script inside the changed card",
      {
        base: page(
          `<main><div><script>1</script><p>a</p><p>b</p></div></main>`,
        ),
        remote: page(
          `<main><div><script>1</script><p>A</p><p>B</p></div></main>`,
        ),
      },
      "script-or-template",
    ],
    [
      "an option on the chain",
      {
        base: page(
          `<main><select><option>a</option><option>b</option></select></main>`,
        ),
        remote: page(
          `<main><select><option>a</option><option>c</option></select></main>`,
        ),
      },
      "form-ancestor",
    ],
    [
      "the change inside an ignored region",
      {
        base: page(`<main><div data-ignore><p>x</p></div></main>`),
        remote: page(`<main><div data-ignore><p>y</p></div></main>`),
        options: { ignore: (el) => el.hasAttribute("data-ignore") },
      },
      "ignored-ancestor",
    ],
    [
      "the change inside a remote-wins region",
      {
        base: page(`<main><div data-wins><p>x</p></div></main>`),
        remote: page(`<main><div data-wins><p>y</p></div></main>`),
        options: { remoteWins: (el) => el.hasAttribute("data-wins") },
      },
      "remote-wins-ancestor",
    ],
    [
      "two unchanged paragraphs trade identities",
      {
        base: page(`<main><p>same</p><p>same</p><div><h3>T</h3></div></main>`),
        remote: page(
          `<main><p>same</p><p>same</p><div><h3>T2</h3></div></main>`,
        ),
        identity: byPath(
          { "1.0.0": "x", "1.0.1": "y" },
          { "1.0.0": "y", "1.0.1": "x" },
        ),
      },
      "outside-id-changed",
    ],
    [
      "the alignment moves a chain element into a copy",
      {
        base: page(
          `<div><p><em><b>x words</b></em></p><span>old</span></div><p>tail</p>`,
        ),
        remote: page(
          `<div><p><em><b>x words</b></em></p><span><div><p><em><b>x words</b></em></p><span>old</span></div></span></div><p>tail</p>`,
        ),
        identity: byPath({ "1.0.0.0.0": "s1" }, { "1.0.0.0.0": "s1" }),
      },
      "chain-unpaired",
    ],
    [
      "a per-node morph hook",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        options: { hooks: { beforeNodeMorphed: () => {} } },
      },
      "off",
    ],
    [
      "no live element for the branch",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        toLive: (n) => (one(n) ? null : undefined),
      },
      "no-live-twin",
    ],
    [
      "the branch maps outside the live page",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        toLive: (n, live) => (one(n) ? live.createElement("h3") : undefined),
      },
      "live-detached",
    ],
    [
      "no live element for an ancestor",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        toLive: (n) => (n.tagName === "MAIN" ? null : undefined),
      },
      "ancestor-live",
    ],
    [
      "no live element for an unchanged sibling",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        toLive: (n) => (n.tagName === "HEADER" ? null : undefined),
      },
      "sibling-live",
    ],
    [
      "the remote root is not html",
      {
        base: page(cards()),
        remote: page(cards("B2")),
        fixRemote: (remote) => {
          const d = remote.createElement("div");
          d.innerHTML = "<p>x</p>";
          remote.replaceChild(d, remote.documentElement);
        },
      },
      "root-tag",
    ],
  ];

  for (const [name, c, expected] of CASES)
    it(`${name}: ${expected}, the same result as the full merge`, async function () {
      const off = await clean(false, c);
      const on = await clean(true, c);
      off.outcome.should.equal("off");
      on.outcome.should.equal(expected);
      JSON.stringify(on.seen).should.equal(JSON.stringify(off.seen));
    });

  it("a dirty tab is never attempted", async function () {
    const report = await HyperMorph.mergeDocument({
      live: parseHTML(page(cards("mine"))),
      base: page(cards()),
      remote: page(cards("B2")),
      fastPath: true,
    });
    report.stats.fastPathAttempted.should.equal(0);
  });
});
