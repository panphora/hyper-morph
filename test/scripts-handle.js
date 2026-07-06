describe("Body script handling (scripts.handle)", function () {
  setup();

  it("executes a new inline script exactly once by default", function () {
    window.__x = 0;
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      "<div><p>hi</p><script>window.__x = (window.__x || 0) + 1;</script></div>",
    );

    window.__x.should.equal(1);
  });

  it("does not re-execute a script that existed before the morph", function () {
    const el = make(
      "<div><script>window.__x = (window.__x || 0) + 1;</script></div>",
    );
    getWorkArea().appendChild(el);
    // Ignore any execution that happened when the element was inserted; the
    // contract under test is that the MORPH does not run it again.
    window.__x = 0;

    Idiomorph.morph(
      el,
      "<div><script>window.__x = (window.__x || 0) + 1;</script></div>",
    );

    window.__x.should.equal(0);
  });

  it("handle:false keeps new scripts inert but preserves their markup", function () {
    window.__x = 0;
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      "<div><p>hi</p><script>window.__x = (window.__x || 0) + 1;</script></div>",
      { scripts: { handle: false } },
    );

    window.__x.should.equal(0);
    const script = el.querySelector("script");
    (script !== null).should.equal(true);
    script.textContent.should.equal("window.__x = (window.__x || 0) + 1;");
  });

  it("executes exactly once when the morph replaces the target tag", function () {
    window.__x = 0;
    const el = make("<div>old</div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      "<section><p>hi</p><script>window.__x = (window.__x || 0) + 1;</script></section>",
    );

    window.__x.should.equal(1);
  });

  it("re-executes scripts marked for re-append", function () {
    const el = make(
      `<div><script im-re-append="true">window.__x = (window.__x || 0) + 1;</script></div>`,
    );
    getWorkArea().appendChild(el);
    window.__x = 0;

    Idiomorph.morph(
      el,
      `<div><script im-re-append="true">window.__x = (window.__x || 0) + 1;</script></div>`,
    );

    window.__x.should.equal(1);
  });

  it("does not execute scripts inside sync-ignored regions", function () {
    window.__x = 0;
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    Idiomorph.morph(
      el,
      `<div><p>hi</p><div save-ignore><script>window.__x = (window.__x || 0) + 1;</script></div></div>`,
    );

    window.__x.should.equal(0);
  });

  it("leaves scripts inside a pre-existing sync-ignored region untouched", function () {
    const el = make(
      `<div><div save-ignore><script>window.__x = (window.__x || 0) + 1;</script></div><p>old</p></div>`,
    );
    getWorkArea().appendChild(el);
    window.__x = 0;

    Idiomorph.morph(el, "<div><p>new</p></div>");

    window.__x.should.equal(0);
    (el.querySelector("[save-ignore] script") !== null).should.equal(true);
    el.querySelector("p").textContent.should.equal("new");
  });

  it("smart matchMode treats reformatted URLs as the same script", function () {
    // Detached so the external src never actually loads over the network.
    const el = make(`<div><script src="/x.js?v=1"></script></div>`);
    const originalScript = el.querySelector("script");

    Idiomorph.morph(el, `<div><script src="/x.js?v=1#frag"></script></div>`, {
      scripts: { matchMode: "smart" },
    });

    el.querySelector("script").should.equal(originalScript);
  });

  it("head.block with scripts.handle executes new body scripts after the async head phase", async function () {
    window.__blockBody = 0;
    const bodyWithScript = window.document.body.outerHTML.replace(
      "</body>",
      `<script class="block-body-probe">window.__blockBody = (window.__blockBody || 0) + 1;</script></body>`,
    );

    const result = Idiomorph.morph(
      window.document,
      `<head><link rel="stylesheet" href="/test/lib/fixture.css"></head>${bodyWithScript}`,
      { morphStyle: "innerHTML", head: { block: true, style: "append" } },
    );

    (result instanceof Promise).should.equal(true);
    await result;
    window.__blockBody.should.equal(1);

    document
      .querySelectorAll("script.block-body-probe")
      .forEach((s) => s.remove());
    document.head
      .querySelectorAll('link[href$="fixture.css"]')
      .forEach((l) => l.remove());
    delete window.__blockBody;
  });

  it("returns a resolving Promise and runs an external body script exactly once", async function () {
    window.__extCount = 0;
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    const result = Idiomorph.morph(
      el,
      `<div><p>hi</p><script src="/test/lib/script-counter-fixture.js"></script></div>`,
      { scripts: { handle: true } },
    );

    (result instanceof Promise).should.equal(true);
    await result;
    window.__extCount.should.equal(1);
    delete window.__extCount;
  });

  it("resolves the morph even when a new external body script fails to load", async function () {
    const el = make("<div><p>hi</p></div>");
    getWorkArea().appendChild(el);

    const result = Idiomorph.morph(
      el,
      `<div><p>hi</p><script src="/definitely-missing-404.js"></script></div>`,
      { scripts: { handle: true } },
    );

    (result instanceof Promise).should.equal(true);
    await result; // the error listener must resolve rather than hang
  });

  it("smart matchMode preserves an inline script across whitespace reformatting", function () {
    const el = make(`<div><script>window.__y = 1;</script></div>`);
    getWorkArea().appendChild(el);
    window.__y = 0;
    const original = el.querySelector("script");

    Idiomorph.morph(el, `<div><script>  window.__y = 1;  </script></div>`, {
      scripts: { matchMode: "smart" },
    });

    window.__y.should.equal(0);
    el.querySelector("script").should.equal(original);
  });
});
