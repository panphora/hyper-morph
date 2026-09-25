// The new API's own guarantees: whole documents, three-way merges with a
// snapshot, identity through provenance, caret mapping, and the report.
describe("mergeDocument / morphDocument / morphElement", function () {
  setup();

  const page = (body, head = "") =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

  it("T-D1 whole-document morph with a doctype keeps head and body identity", async function () {
    const live = parseHTML(page("<p>a</p>", "<title>t</title>"));
    const head = live.head,
      body = live.body;
    const report = await HyperMorph.morphDocument(
      live,
      page("<p>b</p>", "<title>t2</title>"),
    );
    should.exist(live.doctype);
    head.should.equal(live.head);
    body.should.equal(live.body);
    live.title.should.equal("t2");
    live.body.innerHTML.should.equal("<p>b</p>");
    report.localDiverged.should.equal(false);
  });

  it("T-D1b inserts a doctype when the incoming document has one", async function () {
    const live = parseHTML("<html><body><p>a</p></body></html>");
    should.not.exist(live.doctype);
    await HyperMorph.morphDocument(live, page("<p>a</p>"));
    should.exist(live.doctype);
  });

  it("T-D3 unknown option throws before any mutation", function () {
    const live = parseHTML(page("<p>a</p>"));
    (() =>
      HyperMorph.morphDocument(live, page("<p>b</p>"), {
        morphStyle: "innerHTML",
      })).should.throw(/unknown option/);
    live.body.innerHTML.should.equal("<p>a</p>");
  });

  it("T-D5 always returns a Promise", function () {
    const live = parseHTML(page("<p>a</p>"));
    const r = HyperMorph.morphDocument(live, page("<p>b</p>"));
    (r instanceof Promise).should.equal(true);
    // and the DOM work is already done synchronously
    live.body.innerHTML.should.equal("<p>b</p>");
  });

  it("S3 three-way with a snapshot: the moved card keeps its live node and takes the remote title", async function () {
    const base = page(
      `<div class="col"><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`,
    );
    const live = parseHTML(base);
    const card = live.querySelector(".card"),
      video = card.querySelector("video");
    live.querySelectorAll(".col")[1].appendChild(card); // local drag
    // snapshot clone with provenance, as ClayJS captures it
    const clone = live.documentElement.cloneNode(true);
    const prov = new Map();
    (function pair(l, c) {
      prov.set(c, l);
      for (let i = 0; i < l.childNodes.length; i++)
        pair(l.childNodes[i], c.childNodes[i]);
    })(live.documentElement, clone);
    const remote = page(
      `<div class="col"><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`,
    );
    const report = await HyperMorph.mergeDocument({
      live,
      base,
      remote,
      local: { root: clone, toLive: (n) => prov.get(n) || null },
    });
    live.body.innerHTML.should.equal(
      `<div class="col"><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div></div>`,
    );
    live.querySelectorAll(".card")[2].should.equal(card);
    video.isConnected.should.equal(true);
    report.localDiverged.should.equal(true);
  });

  it("S1 three-way without a snapshot: the live DOM is the local side", async function () {
    const base = page("<p>The quick brown fox jumps over the lazy dog.</p>");
    const live = parseHTML(base);
    live.querySelector("p").firstChild.nodeValue =
      "Note: The quick brown fox jumps over the lazy dog.";
    await HyperMorph.mergeDocument({
      live,
      base,
      remote: page("<p>The quick brown fox jumps over the sleepy dog.</p>"),
    });
    live.body.innerHTML.should.equal(
      "<p>Note: The quick brown fox jumps over the sleepy dog.</p>",
    );
  });

  it("S8 typing in a contenteditable while a remote edit lands in the same paragraph: text merged, caret kept", async function () {
    const wa = getWorkArea();
    wa.innerHTML = `<article><p contenteditable id="a">Hello world</p><p>Other</p></article>`;
    const base = document.documentElement.outerHTML;
    const p = wa.querySelector("#a");
    p.focus();
    p.firstChild.nodeValue = "Hello brave world";
    const sel = window.getSelection(),
      rng = document.createRange();
    rng.setStart(p.firstChild, 11);
    rng.collapse(true);
    sel.removeAllRanges();
    sel.addRange(rng); // after "Hello brave"
    const remote = base
      .replace("Hello world", "Hello world!")
      .replace("Other", "Other edited");
    await HyperMorph.mergeDocument({
      live: document,
      base,
      remote,
      ignore: (el) => el.tagName === "SCRIPT",
    });
    p.textContent.should.equal("Hello brave world!");
    wa.querySelectorAll("p")[1].textContent.should.equal("Other edited");
    document.activeElement.should.equal(p);
    const r = window.getSelection().getRangeAt(0);
    r.startContainer.should.equal(p.firstChild);
    r.startOffset.should.equal(11);
    wa.innerHTML = "";
  });

  it("identities: every live element paired with an identified remote element is reported", async function () {
    const live = parseHTML(page(`<ul><li>a</li><li>b</li></ul>`));
    const ids = new Map([[live.querySelectorAll("li")[1], "tab1:2"]]);
    const remote = parseHTML(page(`<ul><li>b</li><li>c</li></ul>`));
    const rIds = new Map([
      [remote.querySelectorAll("li")[0], "tab2:9"],
      [remote.querySelectorAll("li")[1], "tab2:10"],
    ]);
    const report = await HyperMorph.mergeDocument({
      live,
      base: null,
      remote,
      identity: {
        local: (el) => ids.get(el) || null,
        remote: (el) => rIds.get(el) || null,
      },
    });
    const got = report.identities.map(([el, id]) => [el.textContent, id]);
    got.should.deep.include(["b", "tab2:9"]);
    got.should.deep.include(["c", "tab2:10"]);
  });

  it("protectFocusedValue keeps the focused input's value", async function () {
    const wa = getWorkArea();
    wa.innerHTML = `<input id="f" value="typed">`;
    const input = wa.querySelector("input");
    input.focus();
    await HyperMorph.morphElement(wa, `<input id="f" value="remote">`, {
      children: true,
    });
    input.value.should.equal("typed");
    input.getAttribute("value").should.equal("typed");
    await HyperMorph.morphElement(wa, `<input id="f" value="remote">`, {
      children: true,
      protectFocusedValue: false,
    });
    input.value.should.equal("remote");
    wa.innerHTML = "";
  });

  it("remoteWins region takes the remote version even when edited locally", async function () {
    const base = page(`<div no-dirty><h4>Filters</h4><p>a</p></div>`);
    const live = parseHTML(base);
    live.querySelector("p").textContent = "local";
    await HyperMorph.mergeDocument({
      live,
      base,
      remote: page(`<div no-dirty><h4>Filters</h4><p>remote</p></div>`),
      remoteWins: (el) => el.hasAttribute("no-dirty"),
    });
    live.querySelector("p").textContent.should.equal("remote");
  });

  it("ignoreAttribute keeps tab-local root attributes out of the merge and the report", async function () {
    const live = parseHTML(page("<p>a</p>"));
    live.documentElement.setAttribute("savestatus", "saving");
    const report = await HyperMorph.morphDocument(live, page("<p>a</p>"), {
      ignoreAttribute: (el, n) => n === "savestatus",
    });
    live.documentElement.getAttribute("savestatus").should.equal("saving");
    report.decisions.length.should.equal(0);
  });

  it("scripts inserted by a merge run exactly once, after apply", async function () {
    window.__mm = 0;
    const wa = getWorkArea();
    wa.innerHTML = "<div><p>x</p></div>";
    await HyperMorph.morphElement(
      wa,
      "<div><p>x</p><script>window.__mm++</script></div>",
      { children: true },
    );
    window.__mm.should.equal(1);
    await HyperMorph.morphElement(
      wa,
      "<div><p>y</p><script>window.__mm++</script></div>",
      { children: true },
    );
    window.__mm.should.equal(1);
    wa.innerHTML = "";
  });

  it("T-P10 typing that lands after the snapshot survives the apply", async function () {
    const base = page("<p>Hello world</p>");
    const live = parseHTML(base);
    const clone = live.documentElement.cloneNode(true);
    const prov = new Map();
    (function pair(l, c) {
      prov.set(c, l);
      for (let i = 0; i < l.childNodes.length; i++)
        pair(l.childNodes[i], c.childNodes[i]);
    })(live.documentElement, clone);
    // keystrokes after the snapshot was taken
    live.querySelector("p").firstChild.nodeValue = "Hello world, typed";
    await HyperMorph.mergeDocument({
      live,
      base,
      remote: page("<p>Hello there world</p>"),
      local: { root: clone, toLive: (n) => prov.get(n) || null },
    });
    live
      .querySelector("p")
      .textContent.should.equal("Hello there world, typed");
  });

  it("perf: 3000-element page, one remote edit, under budget", async function () {
    this.timeout(20000);
    let items = "";
    for (let i = 0; i < 1000; i++)
      items += `<li class="row"><span class="t">Item ${i}</span><a href="/i/${i}">open</a></li>`;
    const base = page(`<main><ul>${items}</ul></main>`);
    const remote = base.replace("Item 500<", "Item 500 edited<");
    const run = async () => {
      const live = parseHTML(base);
      const t0 = performance.now();
      await HyperMorph.morphDocument(live, remote);
      return performance.now() - t0;
    };
    for (let i = 0; i < 3; i++) await run();
    const times = [];
    for (let i = 0; i < 5; i++) times.push(await run());
    times.sort((a, b) => a - b);
    console.log(`perf clean-tab morph median ms: ${times[2].toFixed(1)}`);
    times[2].should.be.below(80);
  });
});
