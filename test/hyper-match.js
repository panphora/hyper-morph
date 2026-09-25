// HyperMatch-specific tests
// Tests content-based element matching without explicit IDs

describe("HyperMatch: Core Strengths", function () {
  setup();

  // ==========================================================================
  // Text Content Matching (10 tests)
  // ==========================================================================

  describe("Text Content Matching", function () {
    it("1. Match elements by identical text content", function () {
      let initial = make("<ul><li>Apple</li><li>Banana</li></ul>");
      let final = make("<ul><li>Banana</li><li>Apple</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>Banana</li><li>Apple</li></ul>");
    });

    it("2. Match elements with whitespace-normalized text", function () {
      let initial = make("<ul><li>  Apple  </li><li>Banana</li></ul>");
      let final = make("<ul><li>Banana</li><li>Apple</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>Banana</li><li>Apple</li></ul>");
    });

    it("3. Reject match when text differs completely", function () {
      let initial = make("<div><span>Hello</span></div>");
      let final = make("<div><span>Goodbye</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<div><span>Goodbye</span></div>");
    });

    it("4. Reject match when one has text, other empty", function () {
      let initial = make("<div><p>Content</p><p></p></div>");
      let final = make("<div><p></p><p>Content</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<div><p></p><p>Content</p></div>");
    });

    it("5. Match with long text (64+ chars, truncated hint)", function () {
      const longText =
        "This is a very long text that exceeds sixty-four characters for testing purposes";
      let initial = make(`<div><p>${longText}</p><p>Short</p></div>`);
      let final = make(`<div><p>Short</p><p>${longText}</p></div>`);
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        `<div><p>Short</p><p>${longText}</p></div>`,
      );
    });

    it("6. Match list items by unique text", function () {
      let initial = make("<ul><li>One</li><li>Two</li><li>Three</li></ul>");
      let final = make("<ul><li>Three</li><li>One</li><li>Two</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>Three</li><li>One</li><li>Two</li></ul>",
      );
    });

    it("7. Match buttons by label text", function () {
      let initial = make(
        "<div><button>Save</button><button>Cancel</button></div>",
      );
      let final = make(
        "<div><button>Cancel</button><button>Save</button></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><button>Cancel</button><button>Save</button></div>",
      );
    });

    it("8. Match headings by text content", function () {
      let initial = make(
        "<article><h2>Introduction</h2><h2>Conclusion</h2></article>",
      );
      let final = make(
        "<article><h2>Conclusion</h2><h2>Introduction</h2></article>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<article><h2>Conclusion</h2><h2>Introduction</h2></article>",
      );
    });

    it("9. Match links by link text", function () {
      let initial = make("<nav><a>Home</a><a>About</a><a>Contact</a></nav>");
      let final = make("<nav><a>About</a><a>Contact</a><a>Home</a></nav>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<nav><a>About</a><a>Contact</a><a>Home</a></nav>",
      );
    });

    it("10. Match spans by text content", function () {
      let initial = make("<p><span>First</span> and <span>Second</span></p>");
      let final = make("<p><span>Second</span> and <span>First</span></p>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<p><span>Second</span> and <span>First</span></p>",
      );
    });
  });

  // ==========================================================================
  // Structural Path Matching (10 tests)
  // ==========================================================================

  describe("Structural Path Matching", function () {
    it("11. Match by position within same parent", function () {
      let initial = make(
        "<div><span class='a'>A</span><span class='b'>B</span></div>",
      );
      let final = make(
        "<div><span class='b'>B</span><span class='a'>A</span></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="b">B</span><span class="a">A</span></div>',
      );
    });

    it("12. Match after sibling insertion", function () {
      let initial = make("<div><p>First</p><p>Second</p></div>");
      let final = make("<div><p>First</p><p>New</p><p>Second</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><p>First</p><p>New</p><p>Second</p></div>",
      );
    });

    it("13. Match after sibling removal", function () {
      let initial = make("<div><p>First</p><p>Middle</p><p>Last</p></div>");
      let final = make("<div><p>First</p><p>Last</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<div><p>First</p><p>Last</p></div>");
    });

    it("14. Match with landmark ancestor (main, nav, etc)", function () {
      let initial = make("<main><section><div>Content</div></section></main>");
      let final = make("<main><section><div>Content</div></section></main>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<main><section><div>Content</div></section></main>",
      );
    });

    it("15. Match with id ancestor as landmark", function () {
      let initial = make("<div id='app'><div><span>Text</span></div></div>");
      let final = make("<div id='app'><div><span>Text</span></div></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div id="app"><div><span>Text</span></div></div>',
      );
    });

    it("16. Match with role attribute as landmark", function () {
      let initial = make("<div role='main'><div><p>Content</p></div></div>");
      let final = make("<div role='main'><div><p>Content</p></div></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div role="main"><div><p>Content</p></div></div>',
      );
    });

    it("17. Match deeply nested (4 levels)", function () {
      let initial = make(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
    });

    it("18. Match when parent tag changes but path similar", function () {
      let initial = make("<div><section><p>Text</p></section></div>");
      let final = make("<div><article><p>Text</p></article></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><article><p>Text</p></article></div>",
      );
    });

    it("19. Match nth-of-type correctly", function () {
      let initial = make("<div><p>First</p><span>X</span><p>Second</p></div>");
      let final = make("<div><p>Second</p><span>X</span><p>First</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><p>Second</p><span>X</span><p>First</p></div>",
      );
    });

    it("20. Match across same-level reorder", function () {
      let initial = make(
        "<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>",
      );
      let final = make(
        "<div><div class='c'>C</div><div class='a'>A</div><div class='b'>B</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="c">C</div><div class="a">A</div><div class="b">B</div></div>',
      );
    });
  });

  // ==========================================================================
  // Signature Matching (10 tests)
  // ==========================================================================

  describe("Signature Matching", function () {
    it("21. Match by tag name alone (unique tag)", function () {
      let initial = make(
        "<div><header>H</header><main>M</main><footer>F</footer></div>",
      );
      let final = make(
        "<div><footer>F</footer><main>M</main><header>H</header></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><footer>F</footer><main>M</main><header>H</header></div>",
      );
    });

    it("22. Match by tag + single class", function () {
      let initial = make(
        "<div><div class='card'>A</div><div class='panel'>B</div></div>",
      );
      let final = make(
        "<div><div class='panel'>B</div><div class='card'>A</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="panel">B</div><div class="card">A</div></div>',
      );
    });

    it("23. Match by tag + multiple classes (order independent)", function () {
      let initial = make(
        "<div><div class='card featured'>A</div><div class='panel active'>B</div></div>",
      );
      let final = make(
        "<div><div class='active panel'>B</div><div class='featured card'>A</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="active panel">B</div><div class="featured card">A</div></div>',
      );
    });

    it("24. Match by tag + href attribute", function () {
      let initial = make(
        "<nav><a href='/home'>Home</a><a href='/about'>About</a></nav>",
      );
      let final = make(
        "<nav><a href='/about'>About</a><a href='/home'>Home</a></nav>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<nav><a href="/about">About</a><a href="/home">Home</a></nav>',
      );
    });

    it("25. Match by tag + src attribute", function () {
      let initial = make("<div><img src='a.png'><img src='b.png'></div>");
      let final = make("<div><img src='b.png'><img src='a.png'></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><img src="b.png"><img src="a.png"></div>',
      );
    });

    it("26. Match by tag + type attribute", function () {
      let initial = make(
        "<form><input type='text'><input type='email'></form>",
      );
      let final = make("<form><input type='email'><input type='text'></form>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<form><input type="email"><input type="text"></form>',
      );
    });

    it("27. Match by tag + role attribute", function () {
      let initial = make(
        "<div><div role='button'>A</div><div role='link'>B</div></div>",
      );
      let final = make(
        "<div><div role='link'>B</div><div role='button'>A</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div role="link">B</div><div role="button">A</div></div>',
      );
    });

    it("28. Match by tag + name attribute", function () {
      let initial = make(
        "<form><input name='email'><input name='password'></form>",
      );
      let final = make(
        "<form><input name='password'><input name='email'></form>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<form><input name="password"><input name="email"></form>',
      );
    });

    it("29. Reject match when classes differ", function () {
      let initial = make("<div><span class='old'>Text</span></div>");
      let final = make("<div><span class='new'>Text</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="new">Text</span></div>',
      );
    });

    it("30. Reject match when key attribute differs", function () {
      let initial = make("<div><a href='/old'>Link</a></div>");
      let final = make("<div><a href='/new'>Link</a></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal('<div><a href="/new">Link</a></div>');
    });
  });

  // ==========================================================================
  // List Operations (10 tests)
  // ==========================================================================

  describe("List Operations", function () {
    it("31. Prepend single item to list", function () {
      let initial = make("<ul><li>A</li><li>B</li></ul>");
      let final = make("<ul><li>New</li><li>A</li><li>B</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>New</li><li>A</li><li>B</li></ul>",
      );
    });

    it("32. Prepend multiple items to list", function () {
      let initial = make("<ul><li>A</li><li>B</li></ul>");
      let final = make("<ul><li>X</li><li>Y</li><li>A</li><li>B</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>X</li><li>Y</li><li>A</li><li>B</li></ul>",
      );
    });

    it("33. Append single item to list", function () {
      let initial = make("<ul><li>A</li><li>B</li></ul>");
      let final = make("<ul><li>A</li><li>B</li><li>New</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>A</li><li>B</li><li>New</li></ul>",
      );
    });

    it("34. Append multiple items to list", function () {
      let initial = make("<ul><li>A</li><li>B</li></ul>");
      let final = make("<ul><li>A</li><li>B</li><li>X</li><li>Y</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>A</li><li>B</li><li>X</li><li>Y</li></ul>",
      );
    });

    it("35. Insert item in middle", function () {
      let initial = make("<ul><li>A</li><li>C</li></ul>");
      let final = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>A</li><li>B</li><li>C</li></ul>");
    });

    it("36. Remove item from front", function () {
      let initial = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let final = make("<ul><li>B</li><li>C</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>B</li><li>C</li></ul>");
    });

    it("37. Remove item from middle", function () {
      let initial = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let final = make("<ul><li>A</li><li>C</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>A</li><li>C</li></ul>");
    });

    it("38. Remove item from end", function () {
      let initial = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let final = make("<ul><li>A</li><li>B</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>A</li><li>B</li></ul>");
    });

    it("39. Reverse entire list", function () {
      let initial = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let final = make("<ul><li>C</li><li>B</li><li>A</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li>C</li><li>B</li><li>A</li></ul>");
    });

    it("40. Shuffle list (complex reorder)", function () {
      let initial = make("<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>");
      let final = make("<ul><li>C</li><li>A</li><li>D</li><li>B</li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>C</li><li>A</li><li>D</li><li>B</li></ul>",
      );
    });
  });
});

// =============================================================================
// ADVANCED SCENARIOS (40 tests)
// =============================================================================

describe("HyperMatch: Advanced Scenarios", function () {
  setup();

  // ==========================================================================
  // Multi-Element Reorders (6 tests)
  // ==========================================================================

  describe("Multi-Element Reorders", function () {
    it("41. Swap two elements", function () {
      let initial = make("<div><span>First</span><span>Second</span></div>");
      let final = make("<div><span>Second</span><span>First</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><span>Second</span><span>First</span></div>",
      );
    });

    it("42. Rotate three elements (A,B,C → C,A,B)", function () {
      let initial = make("<div><p>A</p><p>B</p><p>C</p></div>");
      let final = make("<div><p>C</p><p>A</p><p>B</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<div><p>C</p><p>A</p><p>B</p></div>");
    });

    it("43. Move first to last", function () {
      let initial = make("<div><p>First</p><p>Middle</p><p>Last</p></div>");
      let final = make("<div><p>Middle</p><p>Last</p><p>First</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><p>Middle</p><p>Last</p><p>First</p></div>",
      );
    });

    it("44. Move last to first", function () {
      let initial = make("<div><p>First</p><p>Middle</p><p>Last</p></div>");
      let final = make("<div><p>Last</p><p>First</p><p>Middle</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><p>Last</p><p>First</p><p>Middle</p></div>",
      );
    });

    it("45. Interleave two lists", function () {
      let initial = make(
        "<div><span>A1</span><span>A2</span><span>B1</span><span>B2</span></div>",
      );
      let final = make(
        "<div><span>A1</span><span>B1</span><span>A2</span><span>B2</span></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><span>A1</span><span>B1</span><span>A2</span><span>B2</span></div>",
      );
    });

    it("46. Random permutation (5 items)", function () {
      let initial = make(
        "<ul><li>1</li><li>2</li><li>3</li><li>4</li><li>5</li></ul>",
      );
      let final = make(
        "<ul><li>3</li><li>5</li><li>1</li><li>4</li><li>2</li></ul>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>3</li><li>5</li><li>1</li><li>4</li><li>2</li></ul>",
      );
    });
  });

  // ==========================================================================
  // Cross-Container Movement (6 tests)
  // ==========================================================================

  describe("Cross-Container Movement", function () {
    it("47. Move element to sibling container", function () {
      let initial = make(
        "<div><div class='a'><span>Item</span></div><div class='b'></div></div>",
      );
      let final = make(
        "<div><div class='a'></div><div class='b'><span>Item</span></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="a"></div><div class="b"><span>Item</span></div></div>',
      );
    });

    it("48. Move element to nested container", function () {
      let initial = make(
        "<div><span>Item</span><div class='target'></div></div>",
      );
      let final = make(
        "<div><div class='target'><span>Item</span></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="target"><span>Item</span></div></div>',
      );
    });

    it("49. Move element to parent container", function () {
      let initial = make(
        "<div><div class='wrapper'><span>Item</span></div></div>",
      );
      let final = make(
        "<div><span>Item</span><div class='wrapper'></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span>Item</span><div class="wrapper"></div></div>',
      );
    });

    it("50. Move multiple elements between containers", function () {
      let initial = make(
        "<div><div class='a'><p>1</p><p>2</p></div><div class='b'></div></div>",
      );
      let final = make(
        "<div><div class='a'></div><div class='b'><p>1</p><p>2</p></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="a"></div><div class="b"><p>1</p><p>2</p></div></div>',
      );
    });

    it("51. Swap elements between two containers", function () {
      let initial = make(
        "<div><div class='a'><span>X</span></div><div class='b'><span>Y</span></div></div>",
      );
      let final = make(
        "<div><div class='a'><span>Y</span></div><div class='b'><span>X</span></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="a"><span>Y</span></div><div class="b"><span>X</span></div></div>',
      );
    });

    it("52. Move element across landmark boundary", function () {
      let initial = make(
        "<div><header><span>Item</span></header><main></main></div>",
      );
      let final = make(
        "<div><header></header><main><span>Item</span></main></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><header></header><main><span>Item</span></main></div>",
      );
    });
  });

  // ==========================================================================
  // Partial Content Updates (6 tests)
  // ==========================================================================

  describe("Partial Content Updates", function () {
    it("53. Update text, keep structure", function () {
      let initial = make("<div><p class='msg'>Hello</p></div>");
      let final = make("<div><p class='msg'>Goodbye</p></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal('<div><p class="msg">Goodbye</p></div>');
    });

    it("54. Update class, keep text", function () {
      let initial = make("<div><span class='old'>Text</span></div>");
      let final = make("<div><span class='new'>Text</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="new">Text</span></div>',
      );
    });

    it("55. Update attribute, keep everything else", function () {
      let initial = make("<div><a href='/old' class='link'>Click</a></div>");
      let final = make("<div><a href='/new' class='link'>Click</a></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><a href="/new" class="link">Click</a></div>',
      );
    });

    it("56. Add class to existing element", function () {
      let initial = make("<div><span class='base'>Text</span></div>");
      let final = make("<div><span class='base active'>Text</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="base active">Text</span></div>',
      );
    });

    it("57. Remove class from element", function () {
      let initial = make("<div><span class='base active'>Text</span></div>");
      let final = make("<div><span class='base'>Text</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="base">Text</span></div>',
      );
    });

    it("58. Change href on matched link", function () {
      let initial = make("<nav><a href='/page1'>Link</a></nav>");
      let final = make("<nav><a href='/page2'>Link</a></nav>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal('<nav><a href="/page2">Link</a></nav>');
    });
  });

  // ==========================================================================
  // Similar Elements Disambiguation (6 tests)
  // ==========================================================================

  describe("Similar Elements Disambiguation", function () {
    it("59. Two divs, different classes", function () {
      let initial = make(
        "<div><div class='a'>X</div><div class='b'>Y</div></div>",
      );
      let final = make(
        "<div><div class='b'>Y</div><div class='a'>X</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="b">Y</div><div class="a">X</div></div>',
      );
    });

    it("60. Two divs, different text", function () {
      let initial = make("<section><div>Alpha</div><div>Beta</div></section>");
      let final = make("<section><div>Beta</div><div>Alpha</div></section>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<section><div>Beta</div><div>Alpha</div></section>",
      );
    });

    it("61. Two divs, different nested content", function () {
      let initial = make(
        "<div><div><span>A</span></div><div><span>B</span></div></div>",
      );
      let final = make(
        "<div><div><span>B</span></div><div><span>A</span></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><span>B</span></div><div><span>A</span></div></div>",
      );
    });

    it("62. Three similar items, one unique", function () {
      let initial = make(
        "<ul><li class='a'>X</li><li class='b'>Y</li><li class='a'>Z</li></ul>",
      );
      let final = make(
        "<ul><li class='b'>Y</li><li class='a'>Z</li><li class='a'>X</li></ul>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<ul><li class="b">Y</li><li class="a">Z</li><li class="a">X</li></ul>',
      );
    });

    it("63. Greedy assignment (highest confidence first)", function () {
      let initial = make(
        "<div><span class='x'>Unique</span><span>Common</span><span>Common</span></div>",
      );
      let final = make(
        "<div><span>Common</span><span class='x'>Unique</span><span>Common</span></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span>Common</span><span class="x">Unique</span><span>Common</span></div>',
      );
    });

    it.skip("64. [skip] Tie-breaking by DOM order", function () {
      let initial = make("<div><span>Same</span><span>Same</span></div>");
      let final = make("<div><span>Same</span><span>Same</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><span>Same</span><span>Same</span></div>",
      );
    });
  });

  // ==========================================================================
  // Deeply Nested DOM (10 tests)
  // ==========================================================================

  describe("Deeply Nested DOM", function () {
    it("65. Match element 4 levels deep", function () {
      let initial = make(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><span>Deep</span></div></div></div></div>",
      );
    });

    it("66. Match element 6 levels deep", function () {
      let initial = make(
        "<div><div><div><div><div><div><span>VeryDeep</span></div></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><div><span>VeryDeep</span></div></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><div><span>VeryDeep</span></div></div></div></div></div></div>",
      );
    });

    it("67. Match element 8 levels deep", function () {
      let initial = make(
        "<div><div><div><div><div><div><div><div><span>SuperDeep</span></div></div></div></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><div><div><div><span>SuperDeep</span></div></div></div></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><div><div><div><span>SuperDeep</span></div></div></div></div></div></div></div></div>",
      );
    });

    it("68. Reorder siblings at depth 4", function () {
      let initial = make(
        "<main><section><article><div><p>A</p><p>B</p><p>C</p></div></article></section></main>",
      );
      let final = make(
        "<main><section><article><div><p>C</p><p>A</p><p>B</p></div></article></section></main>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<main><section><article><div><p>C</p><p>A</p><p>B</p></div></article></section></main>",
      );
    });

    it("69. Reorder siblings at depth 6", function () {
      let initial = make(
        "<div><div><div><div><div><div><span>X</span><span>Y</span><span>Z</span></div></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><div><span>Z</span><span>X</span><span>Y</span></div></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><div><span>Z</span><span>X</span><span>Y</span></div></div></div></div></div></div>",
      );
    });

    it("70. Insert element at depth 5", function () {
      let initial = make(
        "<div><div><div><div><div><span>A</span><span>C</span></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><span>A</span><span>B</span><span>C</span></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><span>A</span><span>B</span><span>C</span></div></div></div></div></div>",
      );
    });

    it("71. Remove element at depth 5", function () {
      let initial = make(
        "<div><div><div><div><div><span>A</span><span>B</span><span>C</span></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><span>A</span><span>C</span></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><span>A</span><span>C</span></div></div></div></div></div>",
      );
    });

    it("72. Move element between branches (same depth)", function () {
      let initial = make(
        "<div><div class='left'><div><div><span>Item</span></div></div></div><div class='right'><div><div></div></div></div></div>",
      );
      let final = make(
        "<div><div class='left'><div><div></div></div></div><div class='right'><div><div><span>Item</span></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div class="left"><div><div></div></div></div><div class="right"><div><div><span>Item</span></div></div></div></div>',
      );
    });

    it("73. Nested cards inside sections inside main", function () {
      let initial = make(
        "<main><section><div class='card'><header>Card A</header><div class='body'>Content A</div></div><div class='card'><header>Card B</header><div class='body'>Content B</div></div></section></main>",
      );
      let final = make(
        "<main><section><div class='card'><header>Card B</header><div class='body'>Content B</div></div><div class='card'><header>Card A</header><div class='body'>Content A</div></div></section></main>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<main><section><div class="card"><header>Card B</header><div class="body">Content B</div></div><div class="card"><header>Card A</header><div class="body">Content A</div></div></section></main>',
      );
    });

    it.skip("74. [skip] Match element 10+ levels deep", function () {
      let initial = make(
        "<div><div><div><div><div><div><div><div><div><div><span>UltraDeep</span></div></div></div></div></div></div></div></div></div></div>",
      );
      let final = make(
        "<div><div><div><div><div><div><div><div><div><div><span>UltraDeep</span></div></div></div></div></div></div></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><div><div><div><div><div><div><div><div><div><span>UltraDeep</span></div></div></div></div></div></div></div></div></div></div>",
      );
    });
  });

  // ==========================================================================
  // Nested Components (6 tests)
  // ==========================================================================

  describe("Nested Components", function () {
    it("75. Card component (wrapper + header + body + footer)", function () {
      let initial = make(
        "<div class='card'><header>Title A</header><div class='body'>Body A</div><footer>Footer A</footer></div>",
      );
      let final = make(
        "<div class='card'><header>Title B</header><div class='body'>Body B</div><footer>Footer B</footer></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div class="card"><header>Title B</header><div class="body">Body B</div><footer>Footer B</footer></div>',
      );
    });

    it("76. Table with thead/tbody/rows/cells", function () {
      let initial = make(
        "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      );
      let final = make(
        "<table><thead><tr><th>B</th><th>A</th></tr></thead><tbody><tr><td>2</td><td>1</td></tr></tbody></table>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<table><thead><tr><th>B</th><th>A</th></tr></thead><tbody><tr><td>2</td><td>1</td></tr></tbody></table>",
      );
    });

    it("77. Nested list (ul > li > ul > li)", function () {
      let initial = make(
        "<ul><li>Parent A<ul><li>Child 1</li><li>Child 2</li></ul></li><li>Parent B<ul><li>Child 3</li></ul></li></ul>",
      );
      let final = make(
        "<ul><li>Parent B<ul><li>Child 3</li></ul></li><li>Parent A<ul><li>Child 1</li><li>Child 2</li></ul></li></ul>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<ul><li>Parent B<ul><li>Child 3</li></ul></li><li>Parent A<ul><li>Child 1</li><li>Child 2</li></ul></li></ul>",
      );
    });

    it("78. Tree structure with expandable nodes", function () {
      let initial = make(
        "<div class='tree'><div class='node'><span>Root</span><div class='children'><div class='node'><span>Branch A</span></div><div class='node'><span>Branch B</span></div></div></div></div>",
      );
      let final = make(
        "<div class='tree'><div class='node'><span>Root</span><div class='children'><div class='node'><span>Branch B</span></div><div class='node'><span>Branch A</span></div></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div class="tree"><div class="node"><span>Root</span><div class="children"><div class="node"><span>Branch B</span></div><div class="node"><span>Branch A</span></div></div></div></div>',
      );
    });

    it("79. Accordion with nested content", function () {
      let initial = make(
        "<div class='accordion'><div class='item'><div class='header'>Section 1</div><div class='content'><p>Content 1</p></div></div><div class='item'><div class='header'>Section 2</div><div class='content'><p>Content 2</p></div></div></div>",
      );
      let final = make(
        "<div class='accordion'><div class='item'><div class='header'>Section 2</div><div class='content'><p>Content 2</p></div></div><div class='item'><div class='header'>Section 1</div><div class='content'><p>Content 1</p></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div class="accordion"><div class="item"><div class="header">Section 2</div><div class="content"><p>Content 2</p></div></div><div class="item"><div class="header">Section 1</div><div class="content"><p>Content 1</p></div></div></div>',
      );
    });

    it.skip("80. [skip] Recursive component matching", function () {
      let initial = make(
        "<div class='component'><div class='component'><div class='component'><span>Leaf</span></div></div></div>",
      );
      let final = make(
        "<div class='component'><div class='component'><div class='component'><span>Leaf</span></div></div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div class="component"><div class="component"><div class="component"><span>Leaf</span></div></div></div>',
      );
    });
  });
});

// =============================================================================
// EDGE CASES & FUTURE DIRECTION (20 tests)
// =============================================================================

describe("HyperMatch: Edge Cases", function () {
  setup();

  // ==========================================================================
  // Challenging Scenarios (10 tests)
  // ==========================================================================

  describe("Challenging Scenarios", function () {
    it.skip("81. [skip] Identical elements (no distinguishing features)", function () {
      let initial = make("<ul><li></li><li></li><li></li></ul>");
      let final = make("<ul><li></li><li></li></ul>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<ul><li></li><li></li></ul>");
    });

    it.skip("82. [skip] Elements with only data-* attributes", function () {
      let initial = make(
        "<div><span data-id='1'>A</span><span data-id='2'>B</span></div>",
      );
      let final = make(
        "<div><span data-id='2'>B</span><span data-id='1'>A</span></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span data-id="2">B</span><span data-id="1">A</span></div>',
      );
    });

    it.skip("83. [skip] Empty elements (no classes, no text)", function () {
      let initial = make("<div><div></div><div></div><div></div></div>");
      let final = make("<div><div></div><div></div></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal("<div><div></div><div></div></div>");
    });

    it.skip("84. [skip] Dynamic content (timestamps)", function () {
      let initial = make("<div><span class='time'>10:00:00</span></div>");
      let final = make("<div><span class='time'>10:00:01</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="time">10:00:01</span></div>',
      );
    });

    it.skip("85. [skip] Counter values that change", function () {
      let initial = make("<div><span class='count'>42</span></div>");
      let final = make("<div><span class='count'>43</span></div>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><span class="count">43</span></div>',
      );
    });

    it("86. Form inputs by value attribute", function () {
      let initial = make(
        "<form><input type='text' value='a'><input type='text' value='b'></form>",
      );
      let final = make(
        "<form><input type='text' value='b'><input type='text' value='a'></form>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<form><input type="text" value="b"><input type="text" value="a"></form>',
      );
    });

    it("87. Form inputs by name attribute", function () {
      let initial = make(
        "<form><input name='first'><input name='last'></form>",
      );
      let final = make("<form><input name='last'><input name='first'></form>");
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<form><input name="last"><input name="first"></form>',
      );
    });

    it("88. Select elements with options", function () {
      let initial = make(
        "<form><select name='a'><option>1</option></select><select name='b'><option>2</option></select></form>",
      );
      let final = make(
        "<form><select name='b'><option>2</option></select><select name='a'><option>1</option></select></form>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<form><select name="b"><option>2</option></select><select name="a"><option>1</option></select></form>',
      );
    });

    it.skip("89. [skip] Textarea content matching", function () {
      let initial = make(
        "<div><textarea>Text A</textarea><textarea>Text B</textarea></div>",
      );
      let final = make(
        "<div><textarea>Text B</textarea><textarea>Text A</textarea></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        "<div><textarea>Text B</textarea><textarea>Text A</textarea></div>",
      );
    });

    it.skip("90. [skip] Contenteditable matching", function () {
      let initial = make(
        "<div><div contenteditable>Edit A</div><div contenteditable>Edit B</div></div>",
      );
      let final = make(
        "<div><div contenteditable>Edit B</div><div contenteditable>Edit A</div></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><div contenteditable="">Edit B</div><div contenteditable="">Edit A</div></div>',
      );
    });
  });

  // ==========================================================================
  // Special Elements (10 tests)
  // ==========================================================================

  describe("Special Elements", function () {
    it("91. SVG elements", function () {
      let initial = make(
        "<div><svg class='icon-a'></svg><svg class='icon-b'></svg></div>",
      );
      let final = make(
        "<div><svg class='icon-b'></svg><svg class='icon-a'></svg></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><svg class="icon-b"></svg><svg class="icon-a"></svg></div>',
      );
    });

    it("92. Image elements by src", function () {
      let initial = make(
        "<div><img src='cat.jpg' alt='cat'><img src='dog.jpg' alt='dog'></div>",
      );
      let final = make(
        "<div><img src='dog.jpg' alt='dog'><img src='cat.jpg' alt='cat'></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><img src="dog.jpg" alt="dog"><img src="cat.jpg" alt="cat"></div>',
      );
    });

    it("93. Video/audio elements", function () {
      let initial = make(
        "<div><video src='a.mp4'></video><video src='b.mp4'></video></div>",
      );
      let final = make(
        "<div><video src='b.mp4'></video><video src='a.mp4'></video></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><video src="b.mp4"></video><video src="a.mp4"></video></div>',
      );
    });

    it.skip("94. [skip] iframe elements", function () {
      let initial = make(
        "<div><iframe src='a.html'></iframe><iframe src='b.html'></iframe></div>",
      );
      let final = make(
        "<div><iframe src='b.html'></iframe><iframe src='a.html'></iframe></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><iframe src="b.html"></iframe><iframe src="a.html"></iframe></div>',
      );
    });

    it.skip("95. [skip] Canvas elements", function () {
      let initial = make(
        "<div><canvas class='a'></canvas><canvas class='b'></canvas></div>",
      );
      let final = make(
        "<div><canvas class='b'></canvas><canvas class='a'></canvas></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><canvas class="b"></canvas><canvas class="a"></canvas></div>',
      );
    });

    it.skip("96. [skip] Custom elements (web components)", function () {
      let initial = make(
        "<div><my-component type='a'>A</my-component><my-component type='b'>B</my-component></div>",
      );
      let final = make(
        "<div><my-component type='b'>B</my-component><my-component type='a'>A</my-component></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><my-component type="b">B</my-component><my-component type="a">A</my-component></div>',
      );
    });

    it("97. Links with fragments (#anchor)", function () {
      let initial = make(
        "<nav><a href='#section1'>S1</a><a href='#section2'>S2</a></nav>",
      );
      let final = make(
        "<nav><a href='#section2'>S2</a><a href='#section1'>S1</a></nav>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<nav><a href="#section2">S2</a><a href="#section1">S1</a></nav>',
      );
    });

    it("98. Links with query params", function () {
      let initial = make(
        "<nav><a href='?page=1'>P1</a><a href='?page=2'>P2</a></nav>",
      );
      let final = make(
        "<nav><a href='?page=2'>P2</a><a href='?page=1'>P1</a></nav>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<nav><a href="?page=2">P2</a><a href="?page=1">P1</a></nav>',
      );
    });

    it.skip("99. [skip] Template element content", function () {
      let initial = make(
        "<div><template><span>A</span></template><template><span>B</span></template></div>",
      );
      let final = make(
        "<div><template><span>B</span></template><template><span>A</span></template></div>",
      );
      Idiomorph.morph(initial, final);
      // Template content is special - may need different handling
    });

    it.skip("100. [skip] Slot element matching", function () {
      let initial = make(
        "<div><slot name='a'></slot><slot name='b'></slot></div>",
      );
      let final = make(
        "<div><slot name='b'></slot><slot name='a'></slot></div>",
      );
      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(
        '<div><slot name="b"></slot><slot name="a"></slot></div>',
      );
    });
  });
});
