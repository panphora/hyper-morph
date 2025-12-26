// 30 DOM Manipulation Scenarios
// Comparing original Idiomorph vs HyperMatch
// Each test verifies element identity is preserved (not just final DOM correctness)

describe("DOM Manipulation Scenarios: Element Identity", function () {
  setup();

  // Helper to track if specific elements were reused vs recreated
  function trackElements(initial, final) {
    const oldElements = new Map();
    initial.querySelectorAll('*').forEach((el, i) => {
      el.setAttribute('data-track-id', `old-${i}`);
      oldElements.set(`old-${i}`, el);
    });

    Idiomorph.morph(initial, final);

    const results = { preserved: [], recreated: [] };
    initial.querySelectorAll('*').forEach(el => {
      const trackId = el.getAttribute('data-track-id');
      if (trackId && trackId.startsWith('old-')) {
        results.preserved.push(el);
      } else {
        results.recreated.push(el);
      }
    });
    return results;
  }

  // ==========================================================================
  // SIMPLE OPERATIONS (1-10)
  // ==========================================================================

  describe("Simple Operations", function () {

    // 1. Append one item (same tag)
    it("1. Append one item to list of same-tag elements", function () {
      let old = make("<ul><li>A</li><li>B</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>A</li><li>B</li><li>C</li></ul>");
      // Both should check: are li1 and li2 still the same elements?
      old.children[0].should.equal(li1); // A preserved
      old.children[1].should.equal(li2); // B preserved
    });

    // 2. Prepend one item (same tag)
    it("2. Prepend one item to list of same-tag elements", function () {
      let old = make("<ul><li>A</li><li>B</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>NEW</li><li>A</li><li>B</li></ul>");
      old.children[1].should.equal(li1); // A preserved at new position
      old.children[2].should.equal(li2); // B preserved at new position
    });

    // 3. Remove first item (same tag)
    it("3. Remove first item from list of same-tag elements", function () {
      let old = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let li2 = old.children[1]; // B
      let li3 = old.children[2]; // C
      Idiomorph.morph(old, "<ul><li>B</li><li>C</li></ul>");
      old.children[0].should.equal(li2); // B preserved
      old.children[1].should.equal(li3); // C preserved
    });

    // 4. Remove middle item (same tag)
    it("4. Remove middle item from list of same-tag elements", function () {
      let old = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let li1 = old.children[0]; // A
      let li3 = old.children[2]; // C
      Idiomorph.morph(old, "<ul><li>A</li><li>C</li></ul>");
      old.children[0].should.equal(li1); // A preserved
      old.children[1].should.equal(li3); // C preserved
    });

    // 5. Remove last item (same tag)
    it("5. Remove last item from list of same-tag elements", function () {
      let old = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>A</li><li>B</li></ul>");
      old.children[0].should.equal(li1);
      old.children[1].should.equal(li2);
    });

    // 6. Swap two items (same tag)
    it("6. Swap two items with same tag", function () {
      let old = make("<ul><li>A</li><li>B</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>B</li><li>A</li></ul>");
      old.children[0].should.equal(li2); // B element now first
      old.children[1].should.equal(li1); // A element now second
    });

    // 7. Reverse three items (same tag)
    it("7. Reverse three items with same tag", function () {
      let old = make("<ul><li>A</li><li>B</li><li>C</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      let li3 = old.children[2];
      Idiomorph.morph(old, "<ul><li>C</li><li>B</li><li>A</li></ul>");
      old.children[0].should.equal(li3);
      old.children[1].should.equal(li2);
      old.children[2].should.equal(li1);
    });

    // 8. Insert in middle (same tag)
    it("8. Insert item in middle of same-tag list", function () {
      let old = make("<ul><li>A</li><li>C</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>A</li><li>B</li><li>C</li></ul>");
      old.children[0].should.equal(li1); // A preserved
      old.children[2].should.equal(li2); // C preserved at new position
    });

    // 9. Append with unique tags
    it("9. Append item to list of unique-tag elements", function () {
      let old = make("<div><header>H</header><main>M</main></div>");
      let h = old.children[0];
      let m = old.children[1];
      Idiomorph.morph(old, "<div><header>H</header><main>M</main><footer>F</footer></div>");
      old.children[0].should.equal(h);
      old.children[1].should.equal(m);
    });

    // 10. Reorder unique tags
    it("10. Reorder elements with unique tags", function () {
      let old = make("<div><header>H</header><main>M</main><footer>F</footer></div>");
      let h = old.children[0];
      let m = old.children[1];
      let f = old.children[2];
      Idiomorph.morph(old, "<div><footer>F</footer><main>M</main><header>H</header></div>");
      old.children[0].should.equal(f);
      old.children[1].should.equal(m);
      old.children[2].should.equal(h);
    });
  });

  // ==========================================================================
  // CLASS-DIFFERENTIATED ELEMENTS (11-15)
  // ==========================================================================

  describe("Class-Differentiated Elements", function () {

    // 11. Swap elements with different classes
    it("11. Swap two divs with different classes", function () {
      let old = make("<div><div class='a'>A</div><div class='b'>B</div></div>");
      let div1 = old.children[0];
      let div2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='b'>B</div><div class='a'>A</div></div>");
      old.children[0].should.equal(div2);
      old.children[1].should.equal(div1);
    });

    // 12. Prepend with class-differentiated elements
    it("12. Prepend to class-differentiated list", function () {
      let old = make("<div><div class='a'>A</div><div class='b'>B</div></div>");
      let div1 = old.children[0];
      let div2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='new'>NEW</div><div class='a'>A</div><div class='b'>B</div></div>");
      old.children[1].should.equal(div1);
      old.children[2].should.equal(div2);
    });

    // 13. Remove first with class-differentiated elements
    it("13. Remove first from class-differentiated list", function () {
      let old = make("<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>");
      let div2 = old.children[1];
      let div3 = old.children[2];
      Idiomorph.morph(old, "<div><div class='b'>B</div><div class='c'>C</div></div>");
      old.children[0].should.equal(div2);
      old.children[1].should.equal(div3);
    });

    // 14. Complex reorder with classes
    it("14. Rotate three class-differentiated elements", function () {
      let old = make("<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>");
      let div1 = old.children[0];
      let div2 = old.children[1];
      let div3 = old.children[2];
      Idiomorph.morph(old, "<div><div class='c'>C</div><div class='a'>A</div><div class='b'>B</div></div>");
      old.children[0].should.equal(div3);
      old.children[1].should.equal(div1);
      old.children[2].should.equal(div2);
    });

    // 15. Insert with classes
    it("15. Insert into middle of class-differentiated list", function () {
      let old = make("<div><div class='a'>A</div><div class='c'>C</div></div>");
      let div1 = old.children[0];
      let div2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>");
      old.children[0].should.equal(div1);
      old.children[2].should.equal(div2);
    });
  });

  // ==========================================================================
  // TEXT-DIFFERENTIATED ELEMENTS (16-20)
  // ==========================================================================

  describe("Text-Differentiated Elements", function () {

    // 16. Swap by text content only
    it("16. Swap two divs differentiated only by text", function () {
      let old = make("<div><div>Alpha</div><div>Beta</div></div>");
      let div1 = old.children[0];
      let div2 = old.children[1];
      Idiomorph.morph(old, "<div><div>Beta</div><div>Alpha</div></div>");
      old.children[0].should.equal(div2);
      old.children[1].should.equal(div1);
    });

    // 17. Prepend text-differentiated
    it("17. Prepend to text-differentiated list", function () {
      let old = make("<ul><li>First</li><li>Second</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>New</li><li>First</li><li>Second</li></ul>");
      old.children[1].should.equal(li1);
      old.children[2].should.equal(li2);
    });

    // 18. Remove middle text-differentiated
    it("18. Remove middle from text-differentiated list", function () {
      let old = make("<ul><li>One</li><li>Two</li><li>Three</li></ul>");
      let li1 = old.children[0];
      let li3 = old.children[2];
      Idiomorph.morph(old, "<ul><li>One</li><li>Three</li></ul>");
      old.children[0].should.equal(li1);
      old.children[1].should.equal(li3);
    });

    // 19. Shuffle text-differentiated (4 items)
    it("19. Shuffle four text-differentiated items", function () {
      let old = make("<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      let li3 = old.children[2];
      let li4 = old.children[3];
      Idiomorph.morph(old, "<ul><li>C</li><li>A</li><li>D</li><li>B</li></ul>");
      old.children[0].should.equal(li3);
      old.children[1].should.equal(li1);
      old.children[2].should.equal(li4);
      old.children[3].should.equal(li2);
    });

    // 20. Multiple insertions text-differentiated
    it("20. Insert multiple items into text-differentiated list", function () {
      let old = make("<ul><li>A</li><li>D</li></ul>");
      let li1 = old.children[0];
      let li2 = old.children[1];
      Idiomorph.morph(old, "<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>");
      old.children[0].should.equal(li1);
      old.children[3].should.equal(li2);
    });
  });

  // ==========================================================================
  // ATTRIBUTE-DIFFERENTIATED ELEMENTS (21-25)
  // ==========================================================================

  describe("Attribute-Differentiated Elements", function () {

    // 21. Swap by href
    it("21. Swap links differentiated by href", function () {
      let old = make("<nav><a href='/home'>Home</a><a href='/about'>About</a></nav>");
      let a1 = old.children[0];
      let a2 = old.children[1];
      Idiomorph.morph(old, "<nav><a href='/about'>About</a><a href='/home'>Home</a></nav>");
      old.children[0].should.equal(a2);
      old.children[1].should.equal(a1);
    });

    // 22. Swap by src
    it("22. Swap images differentiated by src", function () {
      let old = make("<div><img src='a.jpg'><img src='b.jpg'></div>");
      let img1 = old.children[0];
      let img2 = old.children[1];
      Idiomorph.morph(old, "<div><img src='b.jpg'><img src='a.jpg'></div>");
      old.children[0].should.equal(img2);
      old.children[1].should.equal(img1);
    });

    // 23. Swap by type
    it("23. Swap inputs differentiated by type", function () {
      let old = make("<form><input type='text'><input type='email'></form>");
      let in1 = old.children[0];
      let in2 = old.children[1];
      Idiomorph.morph(old, "<form><input type='email'><input type='text'></form>");
      old.children[0].should.equal(in2);
      old.children[1].should.equal(in1);
    });

    // 24. Swap by name
    it("24. Swap inputs differentiated by name", function () {
      let old = make("<form><input name='first'><input name='last'></form>");
      let in1 = old.children[0];
      let in2 = old.children[1];
      Idiomorph.morph(old, "<form><input name='last'><input name='first'></form>");
      old.children[0].should.equal(in2);
      old.children[1].should.equal(in1);
    });

    // 25. Prepend with attribute differentiation
    it("25. Prepend to href-differentiated links", function () {
      let old = make("<nav><a href='/a'>A</a><a href='/b'>B</a></nav>");
      let a1 = old.children[0];
      let a2 = old.children[1];
      Idiomorph.morph(old, "<nav><a href='/new'>New</a><a href='/a'>A</a><a href='/b'>B</a></nav>");
      old.children[1].should.equal(a1);
      old.children[2].should.equal(a2);
    });
  });

  // ==========================================================================
  // NESTED STRUCTURES (26-30)
  // ==========================================================================

  describe("Nested Structures", function () {

    // 26. Swap nested cards
    it("26. Swap two nested card structures", function () {
      let old = make("<div><div class='card'><h2>Card A</h2><p>Body A</p></div><div class='card'><h2>Card B</h2><p>Body B</p></div></div>");
      let card1 = old.children[0];
      let card2 = old.children[1];
      Idiomorph.morph(old, "<div><div class='card'><h2>Card B</h2><p>Body B</p></div><div class='card'><h2>Card A</h2><p>Body A</p></div></div>");
      old.children[0].should.equal(card2);
      old.children[1].should.equal(card1);
    });

    // 27. Reorder deeply nested
    it("27. Reorder items 3 levels deep", function () {
      let old = make("<main><section><div><span>A</span><span>B</span><span>C</span></div></section></main>");
      let span1 = old.querySelector('div').children[0];
      let span2 = old.querySelector('div').children[1];
      let span3 = old.querySelector('div').children[2];
      Idiomorph.morph(old, "<main><section><div><span>C</span><span>A</span><span>B</span></div></section></main>");
      let newDiv = old.querySelector('div');
      newDiv.children[0].should.equal(span3);
      newDiv.children[1].should.equal(span1);
      newDiv.children[2].should.equal(span2);
    });

    // 28. Prepend at depth
    it("28. Prepend item 3 levels deep", function () {
      let old = make("<main><section><ul><li>A</li><li>B</li></ul></section></main>");
      let li1 = old.querySelector('ul').children[0];
      let li2 = old.querySelector('ul').children[1];
      Idiomorph.morph(old, "<main><section><ul><li>NEW</li><li>A</li><li>B</li></ul></section></main>");
      let newUl = old.querySelector('ul');
      newUl.children[1].should.equal(li1);
      newUl.children[2].should.equal(li2);
    });

    // 29. Remove from nested list
    it("29. Remove first item from nested list", function () {
      let old = make("<div><div><ul><li>X</li><li>Y</li><li>Z</li></ul></div></div>");
      let li2 = old.querySelector('ul').children[1];
      let li3 = old.querySelector('ul').children[2];
      Idiomorph.morph(old, "<div><div><ul><li>Y</li><li>Z</li></ul></div></div>");
      let newUl = old.querySelector('ul');
      newUl.children[0].should.equal(li2);
      newUl.children[1].should.equal(li3);
    });

    // 30. Complex nested reorder
    it("30. Shuffle items in nested structure with wrappers", function () {
      let old = make("<div class='list'><div class='item'><span>1</span></div><div class='item'><span>2</span></div><div class='item'><span>3</span></div></div>");
      let item1 = old.children[0];
      let item2 = old.children[1];
      let item3 = old.children[2];
      Idiomorph.morph(old, "<div class='list'><div class='item'><span>3</span></div><div class='item'><span>1</span></div><div class='item'><span>2</span></div></div>");
      old.children[0].should.equal(item3);
      old.children[1].should.equal(item1);
      old.children[2].should.equal(item2);
    });
  });
});
