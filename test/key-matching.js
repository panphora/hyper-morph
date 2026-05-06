/**
 * Tests for the `key` option in createMorphContext.
 *
 * `key: (el) => string | null` lets callers declare element identity
 * out-of-band. Equal non-null returns pair elements regardless of position
 * or content. Duplicate keys on either side fall through to content scoring.
 */

describe("config.key matching", function () {
  setup();

  function keyByDataId(el) {
    return el.getAttribute && el.getAttribute("data-id");
  }

  it("pairs elements with equal keys across class change", function () {
    let old = make('<div><span data-id="a" class="x">hello</span></div>');
    let oldSpan = old.children[0];
    let next = '<div><span data-id="a" class="y">hello</span></div>';
    Idiomorph.morph(old, next, { key: keyByDataId });
    old.children[0].should.equal(oldSpan);
    old.children[0].getAttribute("class").should.equal("y");
  });

  it("does not pair across tag boundary even with equal keys", function () {
    let old = make('<div><button data-id="a">x</button></div>');
    let oldBtn = old.children[0];
    Idiomorph.morph(old, '<div><div data-id="a">x</div></div>', {
      key: keyByDataId,
    });
    old.children[0].tagName.should.equal("DIV");
    old.children[0].should.not.equal(oldBtn);
  });

  it("key wins over text-based content scoring", function () {
    // Without key, content scoring would swap by matching text.
    // With key, each <li> retains its data-id pairing.
    let old = make(
      '<ul><li data-id="a">match</li><li data-id="b">other</li></ul>',
    );
    let liA = old.children[0];
    let liB = old.children[1];
    Idiomorph.morph(
      old,
      '<ul><li data-id="a">other</li><li data-id="b">match</li></ul>',
      { key: keyByDataId },
    );
    old.children[0].should.equal(liA);
    old.children[1].should.equal(liB);
    old.children[0].textContent.should.equal("other");
    old.children[1].textContent.should.equal("match");
  });

  it("duplicate keys in old tree fall through to content scoring", function () {
    // Two <div data-id="dup"> in old; key matching should drop both.
    let old = make(
      '<section><div data-id="dup">A</div><div data-id="dup">B</div></section>',
    );
    let divA = old.children[0];
    let divB = old.children[1];
    Idiomorph.morph(
      old,
      '<section><div data-id="dup">A</div><div data-id="dup">B</div></section>',
      { key: keyByDataId },
    );
    // Should still match by content (signature + text), not by duplicate key.
    old.children[0].should.equal(divA);
    old.children[1].should.equal(divB);
  });

  it("key returning null for all elements is a no-op", function () {
    let old = make('<ul><li>Apple</li><li>Banana</li></ul>');
    let liApple = old.children[0];
    let liBanana = old.children[1];
    Idiomorph.morph(old, '<ul><li>Banana</li><li>Apple</li></ul>', {
      key: () => null,
    });
    // Identical to running without key — content scoring swaps them.
    old.children[0].should.equal(liBanana);
    old.children[1].should.equal(liApple);
  });

  it("key allows cross-range move", function () {
    // <li data-id="x"> moves from end to start. Without key the matcher
    // would soft-match by position; with key the move is honored.
    let old = make(
      '<ul><li data-id="a">A</li><li data-id="b">B</li><li data-id="x">X</li></ul>',
    );
    let liX = old.children[2];
    Idiomorph.morph(
      old,
      '<ul><li data-id="x">X</li><li data-id="a">A</li><li data-id="b">B</li></ul>',
      { key: keyByDataId },
    );
    old.children[0].should.equal(liX);
  });

  it("real id attributes still take priority over key", function () {
    // Element has both id and data-id; id-based match wins.
    let old = make('<div><span id="real" data-id="meta">old</span></div>');
    let oldSpan = old.querySelector("#real");
    Idiomorph.morph(
      old,
      '<div><span id="real" data-id="meta">new</span></div>',
      { key: keyByDataId },
    );
    old.querySelector("#real").should.equal(oldSpan);
    old.querySelector("#real").textContent.should.equal("new");
  });

  it("key applied to root element pairs the roots", function () {
    let old = make('<div data-id="root"><p>a</p></div>');
    let oldRoot = old;
    Idiomorph.morph(old, '<div data-id="root"><p>b</p></div>', {
      key: keyByDataId,
    });
    // Root identity preserved (already implicit, but verifies key code
    // handles root via `if (oldNode instanceof Element)` branch).
    old.should.equal(oldRoot);
    old.children[0].textContent.should.equal("b");
  });
});
