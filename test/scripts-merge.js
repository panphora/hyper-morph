describe("Mergeable script tags (merge attribute + scripts.mergeTags)", function () {
  setup();

  function warnStub() {
    return sinon.stub(console, "warn");
  }

  afterEach(() => {
    if (console.warn.restore) console.warn.restore();
  });

  const BASE =
    '<div><script type="application/json" merge="store">{"a": 1, "b": 1}</script><p>x</p></div>';

  function makeLocal() {
    // Local made an unsaved change to "a".
    const el = make(
      '<div><script type="application/json" merge="store">{"a": 2, "b": 1}</script><p>x</p></div>',
    );
    getWorkArea().appendChild(el);
    return el;
  }

  const REMOTE =
    '<div><script type="application/json" merge="store">{"a": 1, "b": 2}</script><p>x</p></div>';

  it("merges a content-changed data tag instead of replacing it (smart mode)", function () {
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(el, REMOTE, {
      scripts: { matchMode: "smart", mergeBase: BASE },
    });

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("merges relaxed-JSON bodies by default (unquoted keys, single quotes, trailing commas)", function () {
    const el = make(
      '<div><script type="application/json" merge="store">{a: 2, b: 1, note: \'kept\',}</script><p>x</p></div>',
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="store">{a: 1, b: 2, note: \'kept\',}</script><p>x</p></div>',
      {
        scripts: {
          mergeBase:
            '<div><script type="application/json" merge="store">{a: 1, b: 1, note: \'kept\',}</script><p>x</p></div>',
        },
      },
    );

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({
      a: 2,
      b: 2,
      note: "kept",
    });
  });

  it("merges in outerHTML matchMode too", function () {
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(el, REMOTE, { scripts: { mergeBase: BASE } });

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("keeps the tag byte-identical when only local changed", function () {
    const el = makeLocal();
    const script = el.querySelector("script");
    const localText = script.textContent;

    // Remote is unchanged from base: the merge equals local, no write.
    Idiomorph.morph(el, BASE, { scripts: { mergeBase: BASE } });

    script.textContent.should.equal(localText);
  });

  it("accepts mergeBase as an Element", function () {
    const el = makeLocal();
    const baseEl = make(BASE);

    Idiomorph.morph(el, REMOTE, { scripts: { mergeBase: baseEl } });

    JSON.parse(el.querySelector("script").textContent).should.deep.equal({
      a: 2,
      b: 2,
    });
  });

  it("accepts mergeBase as a script element directly", function () {
    const el = makeLocal();
    const baseScript = make(
      '<script type="application/json" merge="store">{"a": 1, "b": 1}</script>',
    );

    Idiomorph.morph(el, REMOTE, { scripts: { mergeBase: baseScript } });

    JSON.parse(el.querySelector("script").textContent).should.deep.equal({
      a: 2,
      b: 2,
    });
  });

  it("accepts mergeBase as a Document", function () {
    const el = makeLocal();
    const baseDoc = parseHTML(BASE);

    Idiomorph.morph(el, REMOTE, { scripts: { mergeBase: baseDoc } });

    JSON.parse(el.querySelector("script").textContent).should.deep.equal({
      a: 2,
      b: 2,
    });
  });

  it("degrades to a two-way merge without a base", function () {
    const el = make(
      '<div><script type="application/json" merge="store">{"a": 2, "c": 3}</script><p>x</p></div>',
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(el, REMOTE, {});

    // Local-only keys survive; same-key conflicts go to remote.
    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 1, b: 2, c: 3 });
  });

  it("still morphs the tag's attributes", function () {
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="store" data-x="1">{"a": 1, "b": 2}</script><p>x</p></div>',
      { scripts: { mergeBase: BASE } },
    );

    script.getAttribute("data-x").should.equal("1");
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("merges when the tag moved position in the incoming content", function () {
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><p>x</p><script type="application/json" merge="store">{"a": 1, "b": 2}</script></div>',
      { scripts: { matchMode: "smart", mergeBase: BASE } },
    );

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
    el.children[1].should.equal(script);
  });

  it("keeps local text when the incoming tag is malformed, and warns", function () {
    const stub = warnStub();
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="store">{broken</script><p>x</p></div>',
      { scripts: { mergeBase: BASE } },
    );

    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 1 });
    stub.called.should.equal(true);
  });

  it("disables merging for duplicate identities and warns", function () {
    const stub = warnStub();
    const el = make(
      '<div><script type="application/json" merge="dup">{"a": 1}</script><script type="application/json" merge="dup">{"b": 1}</script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="dup">{"a": 2}</script><script type="application/json" merge="dup">{"b": 2}</script></div>',
    );

    // Plain replace behavior: remote text lands wholesale.
    JSON.parse(el.querySelectorAll("script")[0].textContent).should.deep.equal({
      a: 2,
    });
    stub.called.should.equal(true);
  });

  it("ignores merge on an executable script type and warns", function () {
    const stub = warnStub();
    const el = make(
      '<div><script type="text/javascript" merge="store">var x = 1;</script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script type="text/javascript" merge="store">var x = 2;</script></div>',
      { scripts: { handle: false } },
    );

    el.querySelector("script").textContent.should.equal("var x = 2;");
    stub.called.should.equal(true);
  });

  it("ignores merge on a typeless script and warns", function () {
    const stub = warnStub();
    const el = make('<div><script merge="store">var x = 1;</script></div>');
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script merge="store">var x = 2;</script></div>',
      { scripts: { handle: false } },
    );

    el.querySelector("script").textContent.should.equal("var x = 2;");
    stub.called.should.equal(true);
  });

  it("accepts +json subtypes and MIME parameters", function () {
    const el = make(
      '<div><script type="application/ld+json; charset=utf-8" merge="ld">{"a": 2, "b": 1}</script></div>',
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/ld+json; charset=utf-8" merge="ld">{"a": 1, "b": 2}</script></div>',
      {
        scripts: {
          mergeBase:
            '<div><script type="application/ld+json; charset=utf-8" merge="ld">{"a": 1, "b": 1}</script></div>',
        },
      },
    );

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("does not merge external scripts even with a merge attribute", function () {
    const el = make(
      '<div><script src="/nope.json" type="application/json" merge="ext"></script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script src="/other.json" type="application/json" merge="ext"></script></div>',
      { scripts: { handle: false } },
    );

    el.querySelector("script").getAttribute("src").should.equal("/other.json");
  });

  it("does not merge inside sync-ignored regions", function () {
    const el = make(
      '<div><div no-save><script type="application/json" merge="chrome">{"a": 1}</script></div><p>x</p></div>',
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(el, "<div><p>y</p></div>", {});

    // The ignored region is local chrome: untouched by the morph.
    el.querySelector("script").should.equal(script);
    script.textContent.should.equal('{"a": 1}');
  });

  it("treats an empty merge value as not mergeable", function () {
    const el = make(
      '<div><script type="application/json" merge="">{"a": 1}</script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="">{"a": 2}</script></div>',
    );

    el.querySelector("script").textContent.should.equal('{"a": 2}');
  });

  it("replaces normally when the incoming tag dropped the merge attribute", function () {
    const el = makeLocal();

    Idiomorph.morph(
      el,
      '<div><script type="application/json">{"a": 9}</script><p>x</p></div>',
      { scripts: { mergeBase: BASE } },
    );

    el.querySelector("script").textContent.should.equal('{"a": 9}');
  });

  it("replaces normally when identities differ", function () {
    const el = makeLocal();

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="other">{"a": 9}</script><p>x</p></div>',
      { scripts: { mergeBase: BASE } },
    );

    el.querySelector("script").textContent.should.equal('{"a": 9}');
  });

  it("inserts a merge tag that only exists in the incoming content", function () {
    const el = make("<div><p>x</p></div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(el, REMOTE, {});

    JSON.parse(el.querySelector("script").textContent).should.deep.equal({
      a: 1,
      b: 2,
    });
  });

  it("removes a merge tag missing from the incoming content", function () {
    const el = makeLocal();

    Idiomorph.morph(el, "<div><p>x</p></div>", {});

    (el.querySelector("script") === null).should.equal(true);
  });

  it("honors merge-key for arrays without a recognized id field", function () {
    const el = make(
      '<div><script type="application/json" merge="tasks" merge-key="taskId">' +
        '[{"taskId": "t1", "done": false}, {"taskId": "t2", "done": true}]' +
        "</script></div>",
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="tasks" merge-key="taskId">' +
        '[{"taskId": "t1", "done": true}, {"taskId": "t2", "done": true}]' +
        "</script></div>",
      {
        scripts: {
          mergeBase:
            '<div><script type="application/json" merge="tasks" merge-key="taskId">' +
            '[{"taskId": "t1", "done": false}, {"taskId": "t2", "done": false}]' +
            "</script></div>",
        },
      },
    );

    JSON.parse(script.textContent).should.deep.equal([
      { taskId: "t1", done: true },
      { taskId: "t2", done: true },
    ]);
  });

  it("morphs a lone script element passed directly as the morph target", function () {
    const el = make(
      '<script type="application/json" merge="solo">{"a": 2, "b": 1}</script>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<script type="application/json" merge="solo">{"a": 1, "b": 2}</script>',
      {
        scripts: {
          mergeBase:
            '<script type="application/json" merge="solo">{"a": 1, "b": 1}</script>',
        },
      },
    );

    JSON.parse(el.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("merges when the incoming content is an attached node (SlicedParentNode)", function () {
    const el = makeLocal();
    const script = el.querySelector("script");
    const container = make("<div>" + REMOTE + "</div>");
    const newContent = container.firstElementChild;

    Idiomorph.morph(el, newContent, { scripts: { mergeBase: BASE } });

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("wins over conflicting config.key pairings on both ends", function () {
    const el = make(
      '<div><script type="application/json" merge="store" data-k="s">{"a": 2, "b": 1}</script>' +
        '<script type="application/json" data-k="other">{"oldDecoy": 1}</script></div>',
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    // config.key pairs the old merge tag with the "s" decoy and the incoming
    // merge tag with the old "other" decoy; merge pairing must undo both.
    Idiomorph.morph(
      el,
      '<div><script type="application/json" data-k="s">{"newDecoy": 1}</script>' +
        '<script type="application/json" merge="store" data-k="other">{"a": 1, "b": 2}</script></div>',
      {
        key: (e) => e.getAttribute && e.getAttribute("data-k"),
        scripts: { mergeBase: BASE },
      },
    );

    const merged = el.querySelector("script[merge]");
    merged.should.equal(script);
    JSON.parse(merged.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("supports custom recognizers via scripts.mergeTags (rules-tag style)", function () {
    const rulesRecognizer = {
      match: (e) => e.hasAttribute("data-rules-name"),
      identity: (e) => {
        const names = (e.getAttribute("data-rules-name") || "")
          .split(/\s+/)
          .filter(Boolean)
          .sort()
          .join(" ");
        return names
          ? "rules:" + e.getAttribute("data-rules-version") + ":" + names
          : null;
      },
      parse: (text) => JSON.parse(text.replace(/'/g, '"')),
    };

    const el = make(
      '<div><script type="application/json" data-rules-name="cms extra" data-rules-version="1">' +
        "{'Title': '#t', 'Local': '#l'}" +
        "</script></div>",
    );
    getWorkArea().appendChild(el);
    const script = el.querySelector("script");

    Idiomorph.morph(
      el,
      '<div><script type="application/json" data-rules-name="extra cms" data-rules-version="1">' +
        "{'Title': '#t', 'Remote': '#r'}" +
        "</script></div>",
      {
        scripts: {
          mergeTags: [rulesRecognizer],
          mergeBase:
            '<div><script type="application/json" data-rules-name="cms extra" data-rules-version="1">' +
            "{'Title': '#t'}" +
            "</script></div>",
        },
      },
    );

    el.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({
      Title: "#t",
      Local: "#l",
      Remote: "#r",
    });
  });

  it("custom recognizer returning null identity disables merging for that tag", function () {
    const nullRecognizer = {
      match: (e) => e.hasAttribute("data-rules-name"),
      identity: () => null,
    };
    const el = make(
      '<div><script type="application/json" data-rules-name="cms">{"a": 1}</script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script type="application/json" data-rules-name="cms">{"a": 2}</script></div>',
      { scripts: { mergeTags: [nullRecognizer] } },
    );

    el.querySelector("script").textContent.should.equal('{"a": 2}');
  });

  it("merges a data tag in the head, preserving the element", function () {
    const doc = parseHTML(
      '<html><head><title>T</title><script type="application/json" merge="store">{"a": 2, "b": 1}</script></head><body></body></html>',
    );
    const script = doc.head.querySelector("script");

    Idiomorph.morph(
      doc,
      '<html><head><title>T</title><script type="application/json" merge="store" merge-key="unused">{"a": 1, "b": 2}</script></head><body></body></html>',
      { scripts: { mergeBase: BASE } },
    );

    doc.head.querySelector("script").should.equal(script);
    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("reads merge-key from the old element in the head-preserve path", function () {
    const doc = parseHTML(
      '<html><head><script type="application/json" merge="tasks" merge-key="taskId">' +
        '[{"taskId": "t1", "done": false}]' +
        "</script></head><body></body></html>",
    );
    const script = doc.head.querySelector("script");

    Idiomorph.morph(
      doc,
      '<html><head><script type="application/json" merge="tasks">' +
        '[{"taskId": "t1", "done": true}, {"taskId": "t2", "done": false}]' +
        "</script></head><body></body></html>",
      {
        scripts: {
          mergeBase:
            '<script type="application/json" merge="tasks">[{"taskId": "t1", "done": false}]</script>',
        },
      },
    );

    JSON.parse(script.textContent).should.deep.equal([
      { taskId: "t1", done: true },
      { taskId: "t2", done: false },
    ]);
  });

  it("uses the first occurrence when the base has duplicate identities", function () {
    const el = makeLocal();
    const script = el.querySelector("script");

    Idiomorph.morph(el, REMOTE, {
      scripts: {
        mergeBase:
          '<div><script type="application/json" merge="store">{"a": 1, "b": 1}</script>' +
          '<script type="application/json" merge="store">{"z": 9}</script></div>',
      },
    });

    JSON.parse(script.textContent).should.deep.equal({ a: 2, b: 2 });
  });

  it("does not re-execute or replace a changed non-merge JS script in outerHTML mode beyond existing behavior", function () {
    // Regression guard: merge signatures must not affect plain scripts.
    window.__mx = 0;
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      "<div><p>hi</p><script>window.__mx = (window.__mx || 0) + 1;</script>" +
        '<script type="application/json" merge="store">{"a": 1}</script></div>',
    );

    window.__mx.should.equal(1);
    JSON.parse(el.querySelectorAll("script")[1].textContent).should.deep.equal({
      a: 1,
    });
  });
});

describe("scripts.merge kill-switch", function () {
  setup();

  it("merge:false disables merging so rewinds overwrite", function () {
    const el = make(
      '<div><script type="application/json" merge="store">{"a": 2, "mine": 1}</script></div>',
    );
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      '<div><script type="application/json" merge="store">{"a": 1}</script></div>',
      { scripts: { merge: false } },
    );

    el.querySelector("script").textContent.should.equal('{"a": 1}');
  });
});
