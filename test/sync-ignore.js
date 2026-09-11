describe("Sync-ignored chrome preservation", function () {
  setup();

  // Morph a parent's children to match `newInner`, mirroring how live-sync
  // reconciles an incoming (chrome-stripped) snapshot against a receiver's
  // live DOM that still holds its own local chrome.
  function morphInner(liveHTML, newInner) {
    let parent = make(liveHTML);
    Idiomorph.morph(parent, newInner, { morphStyle: "innerHTML" });
    return parent;
  }

  const has = (parent, selector) => parent.querySelector(selector) !== null;

  it("preserves a LEADING snapshot-remove node and still syncs content", function () {
    let parent = morphInner(
      `<div><span snapshot-remove>CHROME</span><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, "[snapshot-remove]").should.equal(true);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("preserves a TRAILING snapshot-remove node and still syncs content", function () {
    let parent = morphInner(
      `<div><p>old</p><span snapshot-remove>CHROME</span></div>`,
      `<p>new</p>`,
    );
    has(parent, "[snapshot-remove]").should.equal(true);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("honors the no-snapshot alias the same as snapshot-remove", function () {
    let parent = morphInner(
      `<div><span no-snapshot>CHROME</span><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, "[no-snapshot]").should.equal(true);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("preserves a LEADING save-ignore node (the leading-node quirk fix)", function () {
    let parent = morphInner(
      `<div><span save-ignore>CHROME</span><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, "[save-ignore]").should.equal(true);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("never morphs incoming content INTO a preserved node", function () {
    // The preserved div and the incoming div share a tag; without the fix the
    // matcher/soft-match would morph the new editor into the chrome div.
    let parent = morphInner(
      `<div><div snapshot-remove class="chrome">CHROME</div><div class="editor">old</div></div>`,
      `<div class="editor">new</div>`,
    );
    let chrome = parent.querySelector("[snapshot-remove]");
    (chrome !== null).should.equal(true);
    chrome.classList.contains("chrome").should.equal(true);
    chrome.textContent.should.equal("CHROME");
    parent.querySelector(".editor").textContent.should.equal("new");
  });

  it("still removes an unmarked stray node (no over-preservation)", function () {
    let parent = morphInner(
      `<div><span class="stray">STRAY</span><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, ".stray").should.equal(false);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("preserves a local no-save region when morphing saved HTML that lacks it", function () {
    let parent = morphInner(
      `<div><aside no-save>RUNTIME</aside><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, "[no-save]").should.equal(true);
    parent.querySelector("[no-save]").textContent.should.equal("RUNTIME");
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("preserves a local clay=\"no-save\" region when morphing saved HTML that lacks it", function () {
    let parent = morphInner(
      `<div><aside clay="no-save">RUNTIME</aside><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, '[clay~="no-save"]').should.equal(true);
    parent.querySelector('[clay~="no-save"]').textContent.should.equal("RUNTIME");
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("honors the save-remove legacy alias the same as no-save", function () {
    let parent = morphInner(
      `<div><aside save-remove>RUNTIME</aside><p>old</p></div>`,
      `<p>new</p>`,
    );
    has(parent, "[save-remove]").should.equal(true);
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("skips an incoming no-save region instead of inserting a duplicate", function () {
    let parent = morphInner(
      `<div><aside no-save>MINE</aside><p>old</p></div>`,
      `<aside no-save>THEIRS</aside><p>new</p>`,
    );
    parent.querySelectorAll("[no-save]").length.should.equal(1);
    parent.querySelector("[no-save]").textContent.should.equal("MINE");
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("keeps a freeze region's runtime state instead of resetting to authored content", function () {
    let parent = morphInner(
      `<div><section freeze>RUNTIME STATE</section><p>old</p></div>`,
      `<section freeze>AUTHORED</section><p>new</p>`,
    );
    parent.querySelectorAll("[freeze]").length.should.equal(1);
    parent.querySelector("[freeze]").textContent.should.equal("RUNTIME STATE");
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("honors the save-freeze legacy alias the same as freeze", function () {
    let parent = morphInner(
      `<div><section save-freeze>RUNTIME STATE</section><p>old</p></div>`,
      `<section save-freeze>AUTHORED</section><p>new</p>`,
    );
    parent.querySelectorAll("[save-freeze]").length.should.equal(1);
    parent.querySelector("[save-freeze]").textContent.should.equal("RUNTIME STATE");
    parent.querySelector("p").textContent.should.equal("new");
  });

  it("never morphs incoming content INTO a no-save node", function () {
    let parent = morphInner(
      `<div><div no-save class="chrome">RUNTIME</div><div class="editor">old</div></div>`,
      `<div class="editor">new</div>`,
    );
    let chrome = parent.querySelector("[no-save]");
    (chrome !== null).should.equal(true);
    chrome.classList.contains("chrome").should.equal(true);
    chrome.textContent.should.equal("RUNTIME");
    parent.querySelector(".editor").textContent.should.equal("new");
  });

  it("never steals a node from inside a save-ignore region", function () {
    let parent = morphInner(
      `<div><div save-ignore class="toolbar"><div class="widget"><span>W</span></div></div><p>content</p></div>`,
      `<p>content</p><div class="widget"><span>W</span></div>`,
    );
    // The widget inside the save-ignore toolbar must not be moved out.
    parent
      .querySelector(".toolbar")
      .querySelectorAll(".widget")
      .length.should.equal(1);
    // A fresh widget was created at the container's top level instead.
    parent.querySelectorAll(":scope > .widget").length.should.equal(1);
  });

  it("preserves a save-ignore element inside the head and never syncs one in", function () {
    let parser = new DOMParser();
    let document = parser.parseFromString(
      `<html><head><title>T</title><meta save-ignore name="local"></head><body></body></html>`,
      "text/html",
    );
    let originalHead = document.head;
    Idiomorph.morph(
      document,
      `<html><head><title>T</title><meta save-ignore name="incoming"></head><body></body></html>`,
    );
    let marks = originalHead.querySelectorAll("[save-ignore]");
    marks.length.should.equal(1);
    marks[0].getAttribute("name").should.equal("local");
  });

  it("history policy preserves editor-ui but replays no-save and freeze content", function () {
    const parent = make('<div><p no-save>old saved</p><p freeze>old frozen</p><button editor-ui>Tools</button></div>');
    const button = parent.querySelector('[editor-ui]');
    Idiomorph.morph(parent, '<p no-save>new saved</p><p freeze>new frozen</p>', {
      morphStyle: 'innerHTML',
      policy: 'history',
      scripts: { handle: false, merge: false },
    });
    parent.querySelector('[no-save]').textContent.should.equal('new saved');
    parent.querySelector('[freeze]').textContent.should.equal('new frozen');
    (parent.querySelector('[editor-ui]') === button).should.equal(true);
  });

  it("history matching never steals an id node from retained editor UI", function () {
    const parent = make('<div><aside editor-ui><span id="reused">Runtime</span></aside><p>Content</p></div>');
    const runtime = parent.querySelector('#reused');
    Idiomorph.morph(parent, '<p>Content</p><span id="reused">Authored content</span>', {
      morphStyle: 'innerHTML',
      policy: 'history',
      scripts: { handle: false, merge: false },
    });
    (parent.querySelector('aside #reused') === runtime).should.equal(true);
    parent.querySelector('aside #reused').textContent.should.equal('Runtime');
    parent.querySelector(':scope > #reused').textContent.should.equal('Authored content');
  });

  it("history does not deep-import editor UI inside a newly created owner", function () {
    const parent = make('<main></main>');
    Idiomorph.morph(parent, '<section><p>Restored</p><button editor-ui>Add</button></section>', {
      morphStyle: 'innerHTML', policy: 'history', scripts: { handle: false, merge: false },
    });
    parent.querySelector('p').textContent.should.equal('Restored');
    parent.querySelectorAll('[editor-ui]').length.should.equal(0);
  });

  it("default sync still preserves extension URL nodes", function () {
    const parent = make('<main><script src="chrome-extension://fixture/tool.js"></script><p>Before</p></main>');
    const script = parent.querySelector('script');
    Idiomorph.morph(parent, '<p>After</p>', { morphStyle: 'innerHTML' });
    (parent.querySelector('script') === script).should.equal(true);
    parent.querySelector('p').textContent.should.equal('After');
  });

  it("raw policy reconciles an editor-ui tree's own children", function () {
    const parent = make('<div editor-ui><p>old</p></div>');
    Idiomorph.morph(parent, '<p>new</p>', { morphStyle: 'innerHTML', policy: 'raw' });
    parent.innerHTML.should.equal('<p>new</p>');
  });
});
