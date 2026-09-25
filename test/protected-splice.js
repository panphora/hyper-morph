describe("Protected splice (findChangedRoots + spliceProtected)", function () {
  setup();

  function doc(bodyInner, { rootAttrs = "", head = "<title>t</title>" } = {}) {
    return parseHTML(
      `<html ${rootAttrs}><head>${head}</head><body>${bodyInner}</body></html>`,
    );
  }

  function diff(localDoc, baseDoc, options) {
    return HyperMorph.findChangedRoots(
      localDoc.documentElement,
      baseDoc.documentElement,
      options,
    ).entries;
  }

  function byType(entries, type) {
    return entries.filter((e) => e.type === type);
  }

  //===========================================================================
  // findChangedRoots
  //===========================================================================

  it("returns no entries for identical trees", function () {
    const html = `<div id="a"><p>hi</p></div>`;
    diff(doc(html), doc(html)).length.should.equal(0);
  });

  it("reports an attribute toggle as an attrs-only entry, not a subtree", function () {
    const local = doc(`<div id="a" theme="dark"><p>hi</p></div>`);
    const base = doc(`<div id="a"><p>hi</p></div>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("attrs");
    entries[0].names.should.deep.equal(["theme"]);
  });

  it("reports root <html> attribute changes as an attrs entry on the root", function () {
    const local = doc(`<p>x</p>`, { rootAttrs: 'theme="dark"' });
    const base = doc(`<p>x</p>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("attrs");
    entries[0].el.tagName.should.equal("HTML");
  });

  it("promotes an attr edit on a KEYLESS element instead of emitting an unaddressable attrs entry", function () {
    // An attrs entry on a keyless element would be silently dropped by the
    // splice (skippedAttrs) even though the element survives remotely; the
    // local edit must instead ride up to the keyed ancestor as a subtree.
    const local = doc(`<div id="a"><p class="highlight">hi</p></div>`);
    const base = doc(`<div id="a"><p>hi</p></div>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("a");
  });

  it("promotes a text edit to the nearest KEYED element", function () {
    // The <p> holding the edit is keyless; the splice could never address it
    // in a foreign tree, so the dirty root climbs to the keyed div.
    const local = doc(`<div id="a"><p>edited</p></div>`);
    const base = doc(`<div id="a"><p>original</p></div>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("a");
  });

  it("keeps a locally-added keyed child as its own entry (no parent promotion)", function () {
    const local = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section><section id="s9">NEW</section></main>`,
    );
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("s9");
  });

  it("records a locally-deleted keyed child as a deletion entry", function () {
    const local = doc(`<main id="m"><section id="s1">one</section></main>`);
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("deletion");
    entries[0].el.getAttribute("id").should.equal("s2");
  });

  it("promotes the parent when keyed children were locally reordered", function () {
    const local = doc(`<ul id="list"><li id="b">B</li><li id="a">A</li></ul>`);
    const base = doc(`<ul id="list"><li id="a">A</li><li id="b">B</li></ul>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("list");
  });

  it("promotes the parent for an ambiguous keyless child-count change", function () {
    const local = doc(`<div id="wrap"><p>one</p><p>two</p><p>three</p></div>`);
    const base = doc(`<div id="wrap"><p>one</p><p>two</p></div>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("wrap");
  });

  it("pairs equal-length keyless runs positionally", function () {
    const local = doc(
      `<div id="wrap"><span id="k">key</span><p><em id="deep">EDITED</em></p><p>two</p><section id="new">added</section></div>`,
    );
    const base = doc(
      `<div id="wrap"><span id="k">key</span><p><em id="deep">original</em></p><p>two</p></div>`,
    );
    // Lockstep breaks on the added keyed section; the two keyless <p>s pair
    // positionally, so the edit stays scoped to the keyed <em> inside the
    // first pair instead of promoting to #wrap.
    const entries = diff(local, base);
    const subtrees = byType(entries, "subtree");
    subtrees.length.should.equal(2);
    const ids = subtrees.map((e) => e.el.getAttribute("id")).sort();
    ids.should.deep.equal(["deep", "new"]);
  });

  it("promotes the parent when a keyed child moved past keyless siblings", function () {
    // A single keyed element has no keyed-pair inversion to trip on; the
    // order check must run over the combined keyed + keyless sequence or the
    // move reads as clean and a full morph reverts it.
    const local = doc(
      `<div id="wrap"><span id="k">key</span><p>one</p><p>two</p></div>`,
    );
    const base = doc(
      `<div id="wrap"><p>one</p><p>two</p><span id="k">key</span></div>`,
    );
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("wrap");
  });

  it("reads a browser-split text node as clean (coalesced runs)", function () {
    const local = doc(`<div id="a"><p>hello world</p></div>`);
    const base = doc(`<div id="a"><p>hello world</p></div>`);
    // Typing/IME splits live text nodes without changing content; the parsed
    // base side is always coalesced, so raw node comparison would read dirty.
    local.querySelector("p").firstChild.splitText(5);
    diff(local, base).length.should.equal(0);
  });

  it("coalesces text runs across skipped elements", function () {
    const local = doc(
      `<div id="a"><p>hello<span no-save>chrome</span> world</p></div>`,
    );
    const base = doc(`<div id="a"><p>hello world</p></div>`);
    diff(local, base, {
      skip: (el) => el.hasAttribute("no-save"),
    }).length.should.equal(0);
  });

  it("promotes an attrs edit whose element is only keyed LOCALLY", function () {
    // The incoming doc carries the remote's identity, which matches the base
    // side; an id added locally (unsaved) can never resolve there, so the
    // attrs entry would be silently dropped as skippedAttrs. It must promote.
    const local = doc(
      `<main id="m"><p id="added-locally" class="x">same</p></main>`,
    );
    const base = doc(`<main id="m"><p>same</p></main>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("m");
  });

  it("excludes skip-matched subtrees on both sides", function () {
    const local = doc(
      `<aside no-save>LOCAL CHROME</aside><div id="a">same</div>`,
    );
    const base = doc(`<div id="a">same</div>`);
    const entries = diff(local, base, {
      skip: (el) => el.hasAttribute("no-save"),
    });
    entries.length.should.equal(0);
  });

  it("excludes ignoreAttr-matched attributes", function () {
    const local = doc(`<p>x</p>`, { rootAttrs: 'savestatus="saved"' });
    const base = doc(`<p>x</p>`, { rootAttrs: 'savestatus="unsaved"' });
    diff(local, base, {
      ignoreAttr: (el, name) => name === "savestatus",
    }).length.should.equal(0);
  });

  it("reports any head difference as one head entry", function () {
    const local = doc(`<p>x</p>`, {
      head: `<title>t</title><meta name="a" content="1">`,
    });
    const base = doc(`<p>x</p>`);
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("head");
    entries[0].el.tagName.should.equal("HEAD");
  });

  it("falls through to a lower tier when the top tier exists on one side only", function () {
    // The disk-frame asymmetry from review: local elements carry synthetic
    // identities (top tier) that the base/target side never has. A scalar
    // first-tier-wins key would mismatch every element and duplicate every
    // dirty root; same-tier matching must fall through to data-id instead.
    const ids = new WeakMap();
    const local = doc(
      `<main id="m"><section data-id="a">EDIT</section><section data-id="b">two</section></main>`,
    );
    const base = doc(
      `<main id="m"><section data-id="a">one</section><section data-id="b">two</section></main>`,
    );
    for (const [i, el] of Array.from(
      local.querySelectorAll("section"),
    ).entries()) {
      ids.set(el, `synthetic:${i}`); // local side only
    }
    const tiers = [
      (el) => ids.get(el) || null,
      (el) => el.getAttribute("data-id"),
    ];
    const entries = diff(local, base, { tiers });
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("data-id").should.equal("a");

    // And the splice pairs on the data-id tier: replacement, not duplication.
    const target = doc(
      `<main id="m"><section data-id="a">one</section><section data-id="b">REMOTE</section></main>`,
    );
    splice(target, entries, { tiers }).ok.should.equal(true);
    target.querySelectorAll('[data-id="a"]').length.should.equal(1);
    target.querySelector('[data-id="a"]').textContent.should.equal("EDIT");
    target.querySelector('[data-id="b"]').textContent.should.equal("REMOTE");
  });

  it("disables a tier value duplicated on one side and falls through", function () {
    const local = doc(
      `<main id="m"><div data-id="d" id="u1">EDIT</div><div data-id="d" id="u2">two</div></main>`,
    );
    const base = doc(
      `<main id="m"><div data-id="d" id="u1">one</div><div data-id="d" id="u2">two</div></main>`,
    );
    // data-id tier is duplicated on both sides; the id tier still pairs both
    // divs, so only the edited one is dirty.
    const entries = diff(local, base);
    entries.length.should.equal(1);
    entries[0].type.should.equal("subtree");
    entries[0].el.getAttribute("id").should.equal("u1");
  });

  it("accepts caller-supplied tiers (synthetic identity)", function () {
    const ids = new WeakMap();
    const local = doc(`<main id="m"><div>EDIT</div><div>two</div></main>`);
    const base = doc(`<main id="m"><div>one</div><div>two</div></main>`);
    const lKids = local.querySelectorAll("main > div");
    const bKids = base.querySelectorAll("main > div");
    ids.set(lKids[0], "s:1");
    ids.set(lKids[1], "s:2");
    ids.set(bKids[0], "s:1");
    ids.set(bKids[1], "s:2");
    const entries = diff(local, base, { tiers: [(el) => ids.get(el) || null] });
    entries.length.should.equal(1);
    entries[0].el.should.equal(lKids[0]);
  });

  //===========================================================================
  // spliceProtected
  //===========================================================================

  function splice(targetDoc, entries, options) {
    return HyperMorph.spliceProtected(targetDoc, entries, options);
  }

  it("replaces the counterpart of a dirty keyed subtree", function () {
    const local = doc(
      `<main id="m"><section id="s1">MY EDIT</section><section id="s2">two</section></main>`,
    );
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    const target = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">REMOTE EDIT</section></main>`,
    );
    const entries = diff(local, base);
    const res = splice(target, entries);
    res.ok.should.equal(true);
    target.querySelector("#s1").textContent.should.equal("MY EDIT");
    target.querySelector("#s2").textContent.should.equal("REMOTE EDIT");
  });

  it("copies only the locally-changed attributes (three-way)", function () {
    const local = doc(`<div id="a" theme="dark" lang="en">x</div>`);
    const base = doc(`<div id="a" lang="en">x</div>`);
    const target = doc(`<div id="a" lang="fr">x</div>`);
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    const el = target.querySelector("#a");
    el.getAttribute("theme").should.equal("dark"); // local win
    el.getAttribute("lang").should.equal("fr"); // remote win (locally clean)
  });

  it("applies a local attribute REMOVAL onto the counterpart", function () {
    const local = doc(`<div id="a">x</div>`);
    const base = doc(`<div id="a" theme="dark">x</div>`);
    const target = doc(`<div id="a" theme="dark">x</div>`);
    splice(target, diff(local, base)).ok.should.equal(true);
    target.querySelector("#a").hasAttribute("theme").should.equal(false);
  });

  it("removes the counterpart for a local deletion (delete beats remote edit)", function () {
    const local = doc(`<main id="m"><section id="s1">one</section></main>`);
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    const target = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">REMOTE</section></main>`,
    );
    splice(target, diff(local, base)).ok.should.equal(true);
    (target.querySelector("#s2") === null).should.equal(true);
  });

  it("reinserts a locally-edited section a remote deleted (edits beat deletes)", function () {
    const local = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">MY EDIT</section><section id="s3">three</section></main>`,
    );
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section><section id="s3">three</section></main>`,
    );
    const target = doc(
      `<main id="m"><section id="s1">one</section><section id="s3">three</section></main>`,
    );
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    const ids = Array.from(target.querySelectorAll("main > section")).map(
      (s) => s.id,
    );
    ids.should.deep.equal(["s1", "s2", "s3"]);
    target.querySelector("#s2").textContent.should.equal("MY EDIT");
  });

  it("inserts a locally-new keyed section after its keyed preceding sibling", function () {
    const local = doc(
      `<main id="m"><section id="s1">one</section><section id="s9">NEW</section><section id="s2">two</section></main>`,
    );
    const base = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    const target = doc(
      `<main id="m"><section id="s1">one</section><section id="s2">two</section></main>`,
    );
    splice(target, diff(local, base)).ok.should.equal(true);
    const ids = Array.from(target.querySelectorAll("main > section")).map(
      (s) => s.id,
    );
    ids.should.deep.equal(["s1", "s9", "s2"]);
  });

  it("prepends when a locally-new keyed section has no placeable predecessor", function () {
    const local = doc(
      `<main id="m"><section id="s9">NEW</section><section id="s1">one</section></main>`,
    );
    const base = doc(`<main id="m"><section id="s1">one</section></main>`);
    const target = doc(`<main id="m"><section id="s1">one</section></main>`);
    splice(target, diff(local, base)).ok.should.equal(true);
    target.querySelector("main").firstElementChild.id.should.equal("s9");
  });

  it("chains anchors: an already-placed clone anchors the next entry", function () {
    const local = doc(
      `<main id="m"><section id="s1">one</section><section id="s8">NEW1</section><section id="s9">NEW2</section></main>`,
    );
    const base = doc(`<main id="m"><section id="s1">one</section></main>`);
    const target = doc(`<main id="m"><section id="s1">one</section></main>`);
    splice(target, diff(local, base)).ok.should.equal(true);
    const ids = Array.from(target.querySelectorAll("main > section")).map(
      (s) => s.id,
    );
    ids.should.deep.equal(["s1", "s8", "s9"]);
  });

  it("promotes a keyless dirty root to its keyed ancestor (edits beat deletes)", function () {
    const local = doc(`<main id="m"><div>MY EDIT</div></main>`);
    const base = doc(`<main id="m"><div>one</div></main>`);
    // Remote deleted the keyless div, but the dirty root promoted to main#m,
    // which IS addressable: the edited subtree survives wholesale.
    const target = doc(`<main id="m"></main>`);
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    target.querySelector("main#m > div").textContent.should.equal("MY EDIT");
  });

  it("holds the frame when a dirty root has no keyed ancestor below <body>", function () {
    const local = doc(`<main><div><p>MY EDIT</p></div></main>`);
    const base = doc(`<main><div><p>one</p></div></main>`);
    // Nothing keyed anywhere: promotion climbs to <body>, and a body-level
    // dirty root is a hold, not a wholesale replace.
    const target = doc(`<main></main>`);
    const res = splice(target, diff(local, base));
    res.ok.should.equal(false);
    (res.held !== null).should.equal(true);
  });

  it("holds the frame when <body> itself is the dirty root", function () {
    const entries = [{ type: "subtree", el: doc(`<p>whole body</p>`).body }];
    const target = doc(`<p>incoming</p>`);
    splice(target, entries).ok.should.equal(false);
  });

  it("never pairs counterparts across tag names", function () {
    const local = doc(`<main id="m"><div id="x">MY EDIT</div></main>`);
    const base = doc(`<main id="m"><div id="x">one</div></main>`);
    const target = doc(`<main id="m"><span id="x">clash</span></main>`);
    // The id resolves to a different tag in the target: not a counterpart.
    // The root still has a usable key, main#m places it by anchor logic.
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    target.querySelector("div#x").textContent.should.equal("MY EDIT");
    (target.querySelector("span#x") !== null).should.equal(true);
  });

  it("drops an attribute edit whose element a remote deleted (skippedAttrs)", function () {
    const local = doc(
      `<main id="m"><div id="a" theme="dark">same</div></main>`,
    );
    const base = doc(`<main id="m"><div id="a">same</div></main>`);
    const target = doc(`<main id="m"></main>`);
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    res.skippedAttrs.should.equal(1);
    (target.querySelector("#a") === null).should.equal(true);
  });

  it("replaces the whole head for a head entry", function () {
    const local = doc(`<p>x</p>`, {
      head: `<title>local</title><style>.a{}</style>`,
    });
    const base = doc(`<p>x</p>`, { head: `<title>base</title>` });
    const target = doc(`<p>x</p>`, { head: `<title>incoming</title>` });
    splice(target, diff(local, base)).ok.should.equal(true);
    target.querySelector("title").textContent.should.equal("local");
    (target.querySelector("style") !== null).should.equal(true);
  });

  it("survives a cross-parent keyed move (deletion must not orphan the insert)", function () {
    // The move splits into a deletion (old parent) and a keyed insert (new
    // parent). The deletion detaches the target's copy first; the insert's
    // tier match still names that detached node, and replaceWith on it would
    // silently drop the element from the merge.
    const local = doc(
      `<div id="a"></div><div id="b"><section id="x">moved</section></div>`,
    );
    const base = doc(
      `<div id="a"><section id="x">moved</section></div><div id="b"></div>`,
    );
    const target = doc(
      `<div id="a"><section id="x">moved</section></div><div id="b"></div>`,
    );
    const res = splice(target, diff(local, base));
    res.ok.should.equal(true);
    target.querySelectorAll("#x").length.should.equal(1);
    target.querySelector("#b > #x").textContent.should.equal("moved");
  });

  it("holds when a dirty section's only identity was added locally", function () {
    // The target may still contain the section keylessly; inserting under
    // the unsaved local id would duplicate it on disk. base is keyless, so
    // deletion cannot be proven and the frame holds.
    const local = doc(
      `<main id="m"><section data-id="loc1">EDITED</section></main>`,
    );
    const base = doc(`<main id="m"><section>orig</section></main>`);
    const target = doc(
      `<main id="m"><section>orig</section><aside id="other">REMOTE</aside></main>`,
    );
    const res = splice(target, diff(local, base));
    res.ok.should.equal(false);
    (res.held !== null).should.equal(true);
  });

  it("appends at the local position when no keyed anchor precedes", function () {
    // All preceding siblings are keyless: the anchor scan finds nothing, and
    // the fallback must use the local child index, not the parent's front.
    const local = doc(
      `<main id="m"><p>one</p><p>two</p><section id="s9">NEW</section></main>`,
    );
    const base = doc(`<main id="m"><p>one</p><p>two</p></main>`);
    const target = doc(`<main id="m"><p>one</p><p>two</p></main>`);
    splice(target, diff(local, base)).ok.should.equal(true);
    target.querySelector("main").lastElementChild.id.should.equal("s9");
  });

  it("returns placed entries with their imported clones", function () {
    const local = doc(`<main id="m"><section id="s1">EDIT</section></main>`);
    const base = doc(`<main id="m"><section id="s1">one</section></main>`);
    const target = doc(`<main id="m"><section id="s1">one</section></main>`);
    const res = splice(target, diff(local, base));
    res.placed.length.should.equal(1);
    res.placed[0].imported.ownerDocument.should.equal(target);
    res.placed[0].imported.textContent.should.equal("EDIT");
  });

  //===========================================================================
  // Regression: the morph's sync-ignore policy is unchanged by scoped sync
  //===========================================================================

  it("still morphs no-trigger-autosave content (saved content must sync)", function () {
    // no-trigger-autosave regions are SAVED content — only the dirty
    // comparison strips them. Sync-ignoring them would desync tabs.
    let parent = make(
      `<div><div no-trigger-autosave><p>old filter</p></div></div>`,
    );
    Idiomorph.morph(
      parent,
      `<div no-trigger-autosave><p>new filter</p></div>`,
      {
        morphStyle: "innerHTML",
      },
    );
    parent.querySelector("p").textContent.should.equal("new filter");
  });
});
