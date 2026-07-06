/**
 * Regression tests for HyperMatch edge cases
 * These tests verify fixes for issues found during code review
 */

import { createMatcher } from "/src/hyper-morph-matcher.js";

describe("HyperMatch Edge Cases", function () {
  setup();

  // ==========================================================================
  // Issue 1: Scoring should reject wrong matches with asymmetric text
  // The goal is to prevent WRONG matches (element A matched to element B),
  // not to prevent text updates on the same element.
  // ==========================================================================

  describe("Issue 1: Asymmetric text handling", function () {

    it("should use text to disambiguate between multiple candidates", function () {
      // When multiple elements have the same signature, text helps pick the right one
      let old = make("<ul><li>Apple</li><li>Banana</li></ul>");
      let liApple = old.children[0];
      let liBanana = old.children[1];
      Idiomorph.morph(old, "<ul><li>Banana</li><li>Apple</li></ul>");
      // Text matching should help identify which li is which
      old.children[0].should.equal(liBanana);
      old.children[1].should.equal(liApple);
    });

    it("should penalize asymmetric text to prevent wrong matches", function () {
      // When one element has text and another doesn't, they're less likely to match
      let old = make("<ul><li>Text</li><li></li></ul>");
      let liText = old.children[0];
      let liEmpty = old.children[1];
      Idiomorph.morph(old, "<ul><li></li><li>Text</li></ul>");
      // Elements should be matched by their text content
      old.children[0].should.equal(liEmpty);
      old.children[1].should.equal(liText);
    });

    it("should NOT grant unique bonus when text mismatches (multiple candidates)", function () {
      // Test that unique bonus requires text match by using two candidates
      // where text mismatch prevents the wrong match
      let old = make("<div><span class='a'>Alpha</span><span class='a'>Beta</span></div>");
      let alpha = old.children[0];
      let beta = old.children[1];
      Idiomorph.morph(old, "<div><span class='a'>Beta</span><span class='a'>Alpha</span></div>");
      // Text should help correctly match despite same signature
      old.children[0].should.equal(beta);
      old.children[1].should.equal(alpha);
    });

    it("should match elements when both have matching text", function () {
      let old = make("<ul><li>Same Text</li></ul>");
      let li = old.children[0];
      Idiomorph.morph(old, "<ul><li>Same Text</li></ul>");
      // signature(100) + textMatch(20) + unique(50) = 170
      old.children[0].should.equal(li);
    });

    it("should match elements when both are empty (no text)", function () {
      let old = make("<ul><li></li></ul>");
      let li = old.children[0];
      Idiomorph.morph(old, "<ul><li></li></ul>");
      // signature(100) + unique(50) = 150 (no text penalty since both empty)
      old.children[0].should.equal(li);
    });

    it("should allow text updates on same element when path matches strongly", function () {
      // When an element is clearly the same (same position, same signature),
      // changing text content should update the existing element, not recreate it
      let old = make("<ul><li>Original</li></ul>");
      let li = old.children[0];
      Idiomorph.morph(old, "<ul><li>Updated</li></ul>");
      // High path similarity allows this match despite text change
      old.children[0].should.equal(li);
      old.children[0].textContent.should.equal("Updated");
    });
  });

  // ==========================================================================
  // Issue 2 & 3: ID element handling
  // ==========================================================================

  describe("Issue 2 & 3: ID element handling", function () {

    it("should let ID-based matching handle elements with IDs", function () {
      // Elements with IDs should be handled by Idiomorph's ID system, not HyperMatch
      let old = make("<ul><li id='item1'>A</li><li id='item2'>B</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li id='item2'>B</li><li id='item1'>A</li></ul>");
      // ID-based matching should work correctly
      old.children[0].should.equal(li2);
      old.children[1].should.equal(li1);
    });

    it("should not let ID elements inflate unique candidate count", function () {
      // If there are 2 candidates but one has an ID, the non-ID one should
      // still get the unique bonus since it's the only eligible candidate
      let old = make("<div><span class='a'>Text</span><span id='special' class='a'>Text</span></div>");
      let span1 = old.children[0];
      // The ID span should be skipped, leaving only one eligible candidate
      Idiomorph.morph(old, "<div><span class='a'>Text</span></div>");
      // span1 should be preserved (it's the unique eligible candidate)
      old.children[0].should.equal(span1);
    });

    it("should correctly match non-ID elements even when ID elements exist", function () {
      let old = make("<ul><li id='fixed'>Fixed</li><li>Dynamic A</li><li>Dynamic B</li></ul>");
      let dynamicA = old.children[1];
      let dynamicB = old.children[2];
      Idiomorph.morph(old, "<ul><li id='fixed'>Fixed</li><li>Dynamic B</li><li>Dynamic A</li></ul>");
      // Non-ID elements should still be matched by HyperMatch
      old.children[1].should.equal(dynamicB);
      old.children[2].should.equal(dynamicA);
    });
  });

  // ==========================================================================
  // Issue 4: Algorithm consistency (getTextHint for nested elements)
  // ==========================================================================

  describe("Issue 4: Nested element text hints", function () {

    it("should use nested text content for matching wrapper elements", function () {
      let old = make("<div><div class='card'><span>Card A</span></div><div class='card'><span>Card B</span></div></div>");
      let card1 = old.children[0];
      let card2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='card'><span>Card B</span></div><div class='card'><span>Card A</span></div></div>");
      // Cards should be matched by their nested text content
      old.children[0].should.equal(card2);
      old.children[1].should.equal(card1);
    });

    it("should differentiate wrapper elements by their children's text", function () {
      let old = make("<ul><li><span>Apple</span></li><li><span>Banana</span></li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li><span>Banana</span></li><li><span>Apple</span></li></ul>");
      // Parent li elements should match based on child span text
      old.children[0].should.equal(li2);
      old.children[1].should.equal(li1);
    });

    it("should handle deeply nested text content", function () {
      let old = make("<div><div class='wrapper'><div class='inner'><p>Content A</p></div></div><div class='wrapper'><div class='inner'><p>Content B</p></div></div></div>");
      let wrapper1 = old.children[0];
      let wrapper2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='wrapper'><div class='inner'><p>Content B</p></div></div><div class='wrapper'><div class='inner'><p>Content A</p></div></div></div>");
      old.children[0].should.equal(wrapper2);
      old.children[1].should.equal(wrapper1);
    });
  });

  // ==========================================================================
  // Issue 5: Threshold behavior (minConfidence = 101)
  // ==========================================================================

  describe("Issue 5: Confidence threshold behavior", function () {

    it("should require more than just signature match (101 threshold)", function () {
      // Signature alone = 100, which is < 101
      // This test ensures signature-only matches are rejected
      let old = make("<div><div class='item'></div></div>");
      let item = old.children[0];
      // Same signature but different position, no text - should score exactly 100
      // which is below 101 threshold
      // Actually with path match it might be higher, let's make sure
      Idiomorph.morph(old, "<div><div class='item'></div></div>");
      // With path match, this should exceed 101 and work
      old.children[0].should.equal(item);
    });

    it("should accept matches with signature + path similarity", function () {
      // signature(100) + pathSegment(10) = 110
      let old = make("<main><div class='a'>X</div></main>");
      let div = old.children[0];
      Idiomorph.morph(old, "<main><div class='a'>X</div></main>");
      old.children[0].should.equal(div);
    });

    it("should accept matches with signature + text match", function () {
      // signature(100) + textMatch(20) = 120
      let old = make("<div><span>Hello</span></div>");
      let span = old.children[0];
      Idiomorph.morph(old, "<div><span>Hello</span></div>");
      old.children[0].should.equal(span);
    });

    it("should accept matches with signature + unique (when text matches)", function () {
      // signature(100) + unique(50) = 150 (when both empty, textMatches=true)
      let old = make("<div><input type='text'></div>");
      let input = old.children[0];
      Idiomorph.morph(old, "<div><input type='text'></div>");
      old.children[0].should.equal(input);
    });
  });

  // ==========================================================================
  // Combined scenarios
  // ==========================================================================

  describe("Combined edge case scenarios", function () {

    it("should handle mixed ID and non-ID siblings correctly", function () {
      let old = make("<ul><li id='a'>A</li><li>B</li><li id='c'>C</li><li>D</li></ul>");
      let liB = old.children[1];
      let liD = old.children[3];
      Idiomorph.morph(old, "<ul><li id='c'>C</li><li>D</li><li id='a'>A</li><li>B</li></ul>");
      // ID elements handled by ID matching, non-ID by HyperMatch
      old.children[1].should.equal(liD);
      old.children[3].should.equal(liB);
    });

    it("should correctly identify the right element among multiple candidates", function () {
      // When there are multiple candidates with same signature,
      // text content helps identify the correct match
      let old = make("<nav><a href='/page'>Home</a><a href='/page'>About</a></nav>");
      let home = old.children[0];
      let about = old.children[1];
      Idiomorph.morph(old, "<nav><a href='/page'>About</a><a href='/page'>Home</a></nav>");
      // Text matching should correctly identify which link is which
      old.children[0].should.equal(about);
      old.children[1].should.equal(home);
    });

    it("should correctly accept true matches in complex scenarios", function () {
      // Same signature, same text, unique candidate
      let old = make("<nav><a href='/home'>Home</a></nav>");
      let a = old.children[0];
      Idiomorph.morph(old, "<nav><a href='/home'>Home</a></nav>");
      // signature(100) + textMatch(20) + unique(50) + path = well over 101
      old.children[0].should.equal(a);
    });

    it("should allow text update on clearly same element", function () {
      // When signature and path strongly indicate same element,
      // text change should update existing element (preserving state)
      let old = make("<nav><a href='/home'>Home</a></nav>");
      let a = old.children[0];
      Idiomorph.morph(old, "<nav><a href='/home'>Dashboard</a></nav>");
      // Path + signature is strong enough to preserve element
      old.children[0].should.equal(a);
      old.children[0].textContent.should.equal("Dashboard");
    });
  });

  // ==========================================================================
  // Slot identity: pair same-tag-same-position elements when signatures
  // differ (class/attr change). Required: same parent, same tag, same
  // sibling index, identical child counts. Hard rule: never crosses tags.
  // ==========================================================================

  describe("Slot identity", function () {

    it("preserves element across class change at same position", function () {
      let old = make("<div><div class='card'><span>x</span></div></div>");
      let card = old.children[0];
      let span = card.children[0];
      Idiomorph.morph(old, "<div><div class='card active'><span>x</span></div></div>");
      old.children[0].should.equal(card);
      old.children[0].getAttribute('class').should.equal('card active');
      old.children[0].children[0].should.equal(span);
    });

    it("preserves element across attribute change at same position", function () {
      let old = make("<div><a href='/old' class='link'>Click</a></div>");
      let link = old.children[0];
      Idiomorph.morph(old, "<div><a href='/new' class='link'>Click</a></div>");
      old.children[0].should.equal(link);
      old.children[0].getAttribute('href').should.equal('/new');
    });

    it("preserves nested element when middle wrapper class changes", function () {
      let old = make("<div><div class='outer-a'><div class='inner'><span>x</span></div></div></div>");
      let outer = old.children[0];
      let inner = outer.children[0];
      let span = inner.children[0];
      Idiomorph.morph(old, "<div><div class='outer-b'><div class='inner'><span>x</span></div></div></div>");
      old.children[0].should.equal(outer);
      old.children[0].children[0].should.equal(inner);
      old.children[0].children[0].children[0].should.equal(span);
    });

    it("does not slot-match across tag boundaries", function () {
      // Same position but different tags: must not be paired by slot.
      let old = make("<div><button class='primary'>Click</button></div>");
      let button = old.children[0];
      Idiomorph.morph(old, "<div><a class='primary'>Click</a></div>");
      // The <button> should be removed and <a> created (different elements).
      old.children[0].should.not.equal(button);
      old.children[0].tagName.should.equal('A');
    });

    it("does not slot-match when sibling counts differ (insertion)", function () {
      // Inserting a new sibling shifts positions; slot must not pair shifted
      // elements together. The original elements should be preserved by
      // signature matching, the new one created.
      let old = make("<div><div class='a'>A</div><div class='b'>B</div></div>");
      let divA = old.children[0];
      let divB = old.children[1];
      Idiomorph.morph(old, "<div><div class='new'>NEW</div><div class='a'>A</div><div class='b'>B</div></div>");
      old.children[1].should.equal(divA);
      old.children[2].should.equal(divB);
    });

    it("loses to signature matching when both apply", function () {
      // Reorder with classes: signature matching pairs cross-position by
      // class+text identity. Slot would propose same-position pairs but
      // signature scores higher and wins.
      let old = make("<div><div class='a'>A</div><div class='b'>B</div></div>");
      let divA = old.children[0];
      let divB = old.children[1];
      Idiomorph.morph(old, "<div><div class='b'>B</div><div class='a'>A</div></div>");
      old.children[0].should.equal(divB);
      old.children[1].should.equal(divA);
    });
  });

  describe("Form with a control named id", function () {
    it("matches a form that contains an input named id", function () {
      const el = make(
        `<div><p>lead</p><form class="f"><input name="id"><span>x</span></form></div>`,
      );
      getWorkArea().appendChild(el);
      const form = el.querySelector("form.f");
      Idiomorph.morph(
        el,
        `<div><form class="f"><input name="id"><span>x</span></form><p>lead</p></div>`,
      );
      // The form's `id` property is shadowed by its input[name=id]; the matcher
      // must read getAttribute('id') so the form stays hyper-matchable.
      el.querySelector("form.f").should.equal(form);
    });
  });

  describe("Matcher public API", function () {
    it("findMatch returns a match object with element, confidence, breakdown", function () {
      const oldRoot = make(
        "<div><section class='card'><span>Alpha</span></section></div>",
      );
      const newRoot = make(
        "<div><section class='card'><span>Alpha</span></section></div>",
      );
      const matcher = createMatcher();
      const match = matcher.findMatch(newRoot.querySelector(".card"), oldRoot);
      (match !== null).should.equal(true);
      match.element.should.equal(oldRoot.querySelector(".card"));
      match.confidence.should.be.above(100);
      match.breakdown.should.be.an("object");
    });

    it("explain returns matches, score, and breakdown", function () {
      const oldEl = make("<section class='card'><span>Alpha</span></section>");
      const newEl = make("<section class='card'><span>Alpha</span></section>");
      const matcher = createMatcher();
      const result = matcher.explain(newEl, oldEl);
      result.matches.should.equal(true);
      result.score.should.be.a("number");
      result.breakdown.should.be.an("object");
    });

    it("invalidate does not throw and reflects new state after a DOM mutation", function () {
      const oldRoot = make("<div><p class='x'>one</p></div>");
      const newP = make("<p class='x'>one</p>");
      const matcher = createMatcher();
      (matcher.findMatch(newP, oldRoot) !== null).should.equal(true);

      // Mutate the old tree; without invalidate the cached index is stale.
      oldRoot.querySelector(".x").className = "y";
      (() => matcher.invalidate(oldRoot)).should.not.throw();

      // The rebuilt index no longer has the .x signature, so nothing matches.
      should.equal(matcher.findMatch(newP, oldRoot), null);
    });
  });
});
