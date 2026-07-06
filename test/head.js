describe("Tests to ensure that the head tag merging works correctly", function () {
  setup();

  it("adds a new element correctly", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><title>Foo</title><meta name='foo' content='bar'></head></html>",
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal("<title>Foo</title>");
    originalHead.childNodes[1].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
  });

  it("removes a new element correctly", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title><meta name='foo' content='bar'></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(document, "<html><head><title>Foo</title></head></html>");
    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(1);
    originalHead.childNodes[0].outerHTML.should.equal("<title>Foo</title>");
  });

  it("preserves an element correctly", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(document, "<html><head><title>Foo</title></head></html>");

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(1);
    originalHead.childNodes[0].outerHTML.should.equal("<title>Foo</title>");
  });

  it("head elements are preserved in order", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title><meta name='foo' content='bar'></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><meta name='foo' content='bar'><title>Foo</title></head></html>",
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal("<title>Foo</title>");
    originalHead.childNodes[1].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
  });

  it("morph style reorders head", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title><meta name='foo' content='bar'></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><meta name='foo' content='bar'><title>Foo</title></head></html>",
      { head: { style: "morph" } },
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
    originalHead.childNodes[1].outerHTML.should.equal("<title>Foo</title>");
  });

  it("append style appends to head", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><meta name='foo' content='bar'></head></html>",
      { head: { style: "append" } },
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal("<title>Foo</title>");
    originalHead.childNodes[1].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
  });

  it("ignore style ignores head", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><meta name='foo' content='bar'></head></html>",
      { head: { ignore: true } },
    );

    originalHead.outerHTML.should.equal("<head><title>Foo</title></head>");
  });

  it("im-preserve preserves", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title im-preserve='true'>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      "<html><head><meta name='foo' content='bar'></head></html>",
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal(
      '<title im-preserve="true">Foo</title>',
    );
    originalHead.childNodes[1].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
  });

  it("im-re-append re-appends", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><title im-re-append='true'>Foo</title></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    let originalTitle = originalHead.children[0];
    Idiomorph.morph(
      document,
      "<html><head><title im-re-append='true'>Foo</title><meta name='foo' content='bar'></head></html>",
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.childNodes[0].outerHTML.should.equal(
      '<title im-re-append="true">Foo</title>',
    );
    originalHead.childNodes[0].should.not.equal(originalTitle); // original title should have been removed in place of a new, reappended title
    originalHead.childNodes[1].outerHTML.should.equal(
      '<meta name="foo" content="bar">',
    );
  });

  it("im-re-append re-appends with append style", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      "<html><head><meta name='foo' content='bar' im-re-append='true'></head></html>",
      "text/html",
    );
    let originalHead = document.head;
    let originalTitle = originalHead.children[0];
    Idiomorph.morph(
      document,
      "<html><head><meta name='bar' content='baz' im-re-append='true'></head></html>",
      { head: { style: "append" } },
    );

    originalHead.should.equal(document.head);
    originalHead.childNodes.length.should.equal(2);
    originalHead.innerHTML.should.equal(
      '<meta name="foo" content="bar" im-re-append="true"><meta name="bar" content="baz" im-re-append="true">',
    );
  });

  it("can handle scripts with block mode with innerHTML morph", async function () {
    Idiomorph.morph(
      window.document,
      `<head><script src='../test/lib/fixture.js'></script></head>${window.document.body.outerHTML}`,
      { morphStyle: "innerHTML", head: { block: true, style: "append" } },
    );
    await waitFor(() => window.hasOwnProperty("fixture"));
    window.fixture.should.equal("FIXTURE");
    delete window.fixture;
    window.document.head
      .querySelector('script[src$="lib/fixture.js"]')
      .remove();
  });

  it("can handle scripts with block mode with outerHTML morph", async function () {
    Idiomorph.morph(
      window.document,
      `<html><head><script src='../test/lib/fixture.js'></script></head>${window.document.body.outerHTML}</html>`,
      { morphStyle: "outerHTML", head: { block: true, style: "append" } },
    );
    await waitFor(() => window.hasOwnProperty("fixture"));
    window.fixture.should.equal("FIXTURE");
    delete window.fixture;
    window.document.head
      .querySelector('script[src$="lib/fixture.js"]')
      .remove();
  });

  describe("smart matching preserves cache-busting query strings", function () {
    it("link: different version query replaces old stylesheet", function () {
      let parser = new DOMParser();
      let document = parser.parseFromString(
        "<html><head><link rel='stylesheet' href='/app.css?v=1'></head></html>",
        "text/html",
      );
      let originalHead = document.head;
      Idiomorph.morph(
        document,
        "<html><head><link rel='stylesheet' href='/app.css?v=2'></head></html>",
        { scripts: { matchMode: "smart" } },
      );

      const links = originalHead.querySelectorAll("link");
      links.length.should.equal(1);
      links[0].getAttribute("href").should.equal("/app.css?v=2");
    });

    it("link: same href with same query is preserved", function () {
      let parser = new DOMParser();
      let document = parser.parseFromString(
        "<html><head><link rel='stylesheet' href='/app.css?v=1'></head></html>",
        "text/html",
      );
      let originalHead = document.head;
      let originalLink = originalHead.querySelector("link");
      Idiomorph.morph(
        document,
        "<html><head><link rel='stylesheet' href='/app.css?v=1'></head></html>",
        { scripts: { matchMode: "smart" } },
      );

      const links = originalHead.querySelectorAll("link");
      links.length.should.equal(1);
      links[0].should.equal(originalLink);
    });

    it("script: different version query is treated as a new script", function () {
      let parser = new DOMParser();
      let document = parser.parseFromString(
        "<html><head><script src='/app.js?v=1'></script></head></html>",
        "text/html",
      );
      let originalHead = document.head;
      Idiomorph.morph(
        document,
        "<html><head><script src='/app.js?v=2'></script></head></html>",
        { scripts: { matchMode: "smart" } },
      );

      const scripts = originalHead.querySelectorAll("script");
      scripts.length.should.equal(1);
      scripts[0].getAttribute("src").should.equal("/app.js?v=2");
    });
  });

  describe("head.block load handling and duplicates", function () {
    it("head.block resolves even when a new stylesheet fails to load", async function () {
      const result = Idiomorph.morph(
        window.document,
        `<head><link rel="stylesheet" href="/definitely-missing-404.css"></head>${window.document.body.outerHTML}`,
        { morphStyle: "innerHTML", head: { block: true, style: "append" } },
      );
      // Must resolve via the error listener rather than hanging forever.
      await result;
      window.document.head
        .querySelectorAll('link[href$="404.css"]')
        .forEach((l) => l.remove());
    });

    it("head.block does not wait on non-loading link elements", async function () {
      let parser = new DOMParser();
      let document = parser.parseFromString(
        "<html><head></head><body></body></html>",
        "text/html",
      );
      const result = Idiomorph.morph(
        document,
        `<html><head><link rel="canonical" href="https://example.com/"></head><body></body></html>`,
        { head: { block: true } },
      );
      // A canonical link never fires load; the morph must still complete.
      await result;
      (
        document.head.querySelector('link[rel="canonical"]') !== null
      ).should.equal(true);
    });

    it("keeps duplicate identical head elements", function () {
      let parser = new DOMParser();
      let document = parser.parseFromString(
        "<html><head></head><body></body></html>",
        "text/html",
      );
      Idiomorph.morph(
        document,
        `<html><head><link rel="preload" as="script" href="/a.js"><link rel="preload" as="script" href="/a.js"></head><body></body></html>`,
      );
      document.head
        .querySelectorAll('link[rel="preload"]')
        .length.should.equal(2);
    });
  });
});
