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
});
