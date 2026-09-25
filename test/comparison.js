// 30 DOM Manipulation Scenarios
// Comparing original Idiomorph vs HyperMatch
// Each test verifies element identity is preserved (not just final DOM correctness)

describe("DOM Manipulation Scenarios: Element Identity", function () {
  setup();

  // Track results for final summary
  const results = {
    idiomorph: { passed: 0, failed: 0, tests: [] },
    hypermatch: { passed: 0, failed: 0, tests: [] },
  };

  // Test a scenario with both libraries using innerHTML mode (realistic for body morphing)
  function testBoth(
    name,
    beforeHtml,
    afterHtml,
    getTrackedElements,
    checkPreserved,
  ) {
    it(name, function () {
      // Test with Original Idiomorph - use innerHTML mode like real-world body morphing
      let containerIdi = document.createElement("div");
      containerIdi.innerHTML = beforeHtml;
      let rootIdi = containerIdi.children[0];
      let trackedIdi = getTrackedElements(rootIdi);
      OriginalIdiomorph.morph(containerIdi, afterHtml, {
        morphStyle: "innerHTML",
      });
      rootIdi = containerIdi.children[0];
      let idiPreserved = checkPreserved(rootIdi, trackedIdi);

      // Test with HyperMatch - use innerHTML mode like real-world body morphing
      let containerHyper = document.createElement("div");
      containerHyper.innerHTML = beforeHtml;
      let rootHyper = containerHyper.children[0];
      let trackedHyper = getTrackedElements(rootHyper);
      HyperMatch.morph(containerHyper, afterHtml, { morphStyle: "innerHTML" });
      rootHyper = containerHyper.children[0];
      let hyperPreserved = checkPreserved(rootHyper, trackedHyper);

      // Record results
      results.idiomorph.tests.push({ name, passed: idiPreserved });
      results.hypermatch.tests.push({ name, passed: hyperPreserved });
      if (idiPreserved) results.idiomorph.passed++;
      else results.idiomorph.failed++;
      if (hyperPreserved) results.hypermatch.passed++;
      else results.hypermatch.failed++;

      // Only assert HyperMatch passes (that's what we're testing)
      if (!hyperPreserved) {
        throw new Error(`HyperMatch failed to preserve elements`);
      }
    });
  }

  // ==========================================================================
  // SIMPLE OPERATIONS (1-10)
  // ==========================================================================

  describe("Simple Operations", function () {
    testBoth(
      "1. Append one item to list",
      "<ul><li>A</li><li>B</li></ul>",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "2. Prepend one item to list",
      "<ul><li>A</li><li>B</li></ul>",
      "<ul><li>NEW</li><li>A</li><li>B</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[1] === tracked[0] && el.children[2] === tracked[1],
    );

    testBoth(
      "3. Remove first item from list",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      "<ul><li>B</li><li>C</li></ul>",
      (el) => [el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "4. Remove middle item from list",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      "<ul><li>A</li><li>C</li></ul>",
      (el) => [el.children[0], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "5. Remove last item from list",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      "<ul><li>A</li><li>B</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "6. Swap two items",
      "<ul><li>A</li><li>B</li></ul>",
      "<ul><li>B</li><li>A</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "7. Reverse three items",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      "<ul><li>C</li><li>B</li><li>A</li></ul>",
      (el) => [el.children[0], el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[2] &&
        el.children[1] === tracked[1] &&
        el.children[2] === tracked[0],
    );

    testBoth(
      "8. Insert item in middle",
      "<ul><li>A</li><li>C</li></ul>",
      "<ul><li>A</li><li>B</li><li>C</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[2] === tracked[1],
    );

    testBoth(
      "9. Append with unique tags",
      "<div><header>H</header><main>M</main></div>",
      "<div><header>H</header><main>M</main><footer>F</footer></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "10. Reorder unique tags",
      "<div><header>H</header><main>M</main><footer>F</footer></div>",
      "<div><footer>F</footer><main>M</main><header>H</header></div>",
      (el) => [el.children[0], el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[2] &&
        el.children[1] === tracked[1] &&
        el.children[2] === tracked[0],
    );
  });

  // ==========================================================================
  // CLASS-DIFFERENTIATED ELEMENTS (11-15)
  // ==========================================================================

  describe("Class-Differentiated Elements", function () {
    testBoth(
      "11. Swap divs with different classes",
      "<div><div class='a'>A</div><div class='b'>B</div></div>",
      "<div><div class='b'>B</div><div class='a'>A</div></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "12. Prepend to class-differentiated list",
      "<div><div class='a'>A</div><div class='b'>B</div></div>",
      "<div><div class='new'>NEW</div><div class='a'>A</div><div class='b'>B</div></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[1] === tracked[0] && el.children[2] === tracked[1],
    );

    testBoth(
      "13. Remove first from class-differentiated list",
      "<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>",
      "<div><div class='b'>B</div><div class='c'>C</div></div>",
      (el) => [el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "14. Rotate three class-differentiated elements",
      "<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>",
      "<div><div class='c'>C</div><div class='a'>A</div><div class='b'>B</div></div>",
      (el) => [el.children[0], el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[2] &&
        el.children[1] === tracked[0] &&
        el.children[2] === tracked[1],
    );

    testBoth(
      "15. Insert into class-differentiated list",
      "<div><div class='a'>A</div><div class='c'>C</div></div>",
      "<div><div class='a'>A</div><div class='b'>B</div><div class='c'>C</div></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[2] === tracked[1],
    );
  });

  // ==========================================================================
  // TEXT-DIFFERENTIATED ELEMENTS (16-20)
  // ==========================================================================

  describe("Text-Differentiated Elements", function () {
    testBoth(
      "16. Swap divs by text content only",
      "<div><div>Alpha</div><div>Beta</div></div>",
      "<div><div>Beta</div><div>Alpha</div></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "17. Prepend to text-differentiated list",
      "<ul><li>First</li><li>Second</li></ul>",
      "<ul><li>New</li><li>First</li><li>Second</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[1] === tracked[0] && el.children[2] === tracked[1],
    );

    testBoth(
      "18. Remove middle from text-differentiated list",
      "<ul><li>One</li><li>Two</li><li>Three</li></ul>",
      "<ul><li>One</li><li>Three</li></ul>",
      (el) => [el.children[0], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[1] === tracked[1],
    );

    testBoth(
      "19. Shuffle four text-differentiated items",
      "<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>",
      "<ul><li>C</li><li>A</li><li>D</li><li>B</li></ul>",
      (el) => [el.children[0], el.children[1], el.children[2], el.children[3]],
      (el, tracked) =>
        el.children[0] === tracked[2] &&
        el.children[1] === tracked[0] &&
        el.children[2] === tracked[3] &&
        el.children[3] === tracked[1],
    );

    testBoth(
      "20. Insert multiple items",
      "<ul><li>A</li><li>D</li></ul>",
      "<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[0] && el.children[3] === tracked[1],
    );
  });

  // ==========================================================================
  // ATTRIBUTE-DIFFERENTIATED ELEMENTS (21-25)
  // ==========================================================================

  describe("Attribute-Differentiated Elements", function () {
    testBoth(
      "21. Swap links by href",
      "<nav><a href='/home'>Home</a><a href='/about'>About</a></nav>",
      "<nav><a href='/about'>About</a><a href='/home'>Home</a></nav>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "22. Swap images by src",
      "<div><img src='a.jpg' alt='A'><img src='b.jpg' alt='B'></div>",
      "<div><img src='b.jpg' alt='B'><img src='a.jpg' alt='A'></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "23. Swap inputs by type",
      "<form><input type='text' placeholder='Text'><input type='email' placeholder='Email'></form>",
      "<form><input type='email' placeholder='Email'><input type='text' placeholder='Text'></form>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "24. Swap inputs by name",
      "<form><input name='first' placeholder='First'><input name='last' placeholder='Last'></form>",
      "<form><input name='last' placeholder='Last'><input name='first' placeholder='First'></form>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "25. Prepend to href-differentiated links",
      "<nav><a href='/a'>A</a><a href='/b'>B</a></nav>",
      "<nav><a href='/new'>New</a><a href='/a'>A</a><a href='/b'>B</a></nav>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[1] === tracked[0] && el.children[2] === tracked[1],
    );
  });

  // ==========================================================================
  // NESTED STRUCTURES (26-30)
  // ==========================================================================

  describe("Nested Structures", function () {
    testBoth(
      "26. Swap nested card structures",
      "<div><div class='card'><h2>Card A</h2><p>Body A</p></div><div class='card'><h2>Card B</h2><p>Body B</p></div></div>",
      "<div><div class='card'><h2>Card B</h2><p>Body B</p></div><div class='card'><h2>Card A</h2><p>Body A</p></div></div>",
      (el) => [el.children[0], el.children[1]],
      (el, tracked) =>
        el.children[0] === tracked[1] && el.children[1] === tracked[0],
    );

    testBoth(
      "27. Reorder items 3 levels deep",
      "<main><section><div><span>A</span><span>B</span><span>C</span></div></section></main>",
      "<main><section><div><span>C</span><span>A</span><span>B</span></div></section></main>",
      (el) => {
        const div = el.querySelector("div");
        return [div.children[0], div.children[1], div.children[2]];
      },
      (el, tracked) => {
        const div = el.querySelector("div");
        return (
          div.children[0] === tracked[2] &&
          div.children[1] === tracked[0] &&
          div.children[2] === tracked[1]
        );
      },
    );

    testBoth(
      "28. Prepend item 3 levels deep",
      "<main><section><ul><li>A</li><li>B</li></ul></section></main>",
      "<main><section><ul><li>NEW</li><li>A</li><li>B</li></ul></section></main>",
      (el) => {
        const ul = el.querySelector("ul");
        return [ul.children[0], ul.children[1]];
      },
      (el, tracked) => {
        const ul = el.querySelector("ul");
        return ul.children[1] === tracked[0] && ul.children[2] === tracked[1];
      },
    );

    testBoth(
      "29. Remove first from nested list",
      "<div><div><ul><li>X</li><li>Y</li><li>Z</li></ul></div></div>",
      "<div><div><ul><li>Y</li><li>Z</li></ul></div></div>",
      (el) => {
        const ul = el.querySelector("ul");
        return [ul.children[1], ul.children[2]];
      },
      (el, tracked) => {
        const ul = el.querySelector("ul");
        return ul.children[0] === tracked[0] && ul.children[1] === tracked[1];
      },
    );

    testBoth(
      "30. Shuffle nested wrappers",
      "<div class='list'><div class='item'><span>1</span></div><div class='item'><span>2</span></div><div class='item'><span>3</span></div></div>",
      "<div class='list'><div class='item'><span>3</span></div><div class='item'><span>1</span></div><div class='item'><span>2</span></div></div>",
      (el) => [el.children[0], el.children[1], el.children[2]],
      (el, tracked) =>
        el.children[0] === tracked[2] &&
        el.children[1] === tracked[0] &&
        el.children[2] === tracked[1],
    );
  });

  // ==========================================================================
  // SUMMARY REPORT
  // ==========================================================================

  after(function () {
    console.log("\n");
    console.log(
      "╔══════════════════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                    ELEMENT IDENTITY PRESERVATION COMPARISON                   ║",
    );
    console.log(
      "╠══════════════════════════════════════════════════════════════════════════════╣",
    );
    console.log(
      "║  #  │ Test Name                                    │ Idiomorph │ HyperMatch ║",
    );
    console.log(
      "╠══════════════════════════════════════════════════════════════════════════════╣",
    );

    for (let i = 0; i < results.idiomorph.tests.length; i++) {
      const idi = results.idiomorph.tests[i];
      const hyper = results.hypermatch.tests[i];
      const num = String(i + 1).padStart(2);
      const name = idi.name
        .substring(idi.name.indexOf(".") + 2)
        .padEnd(44)
        .substring(0, 44);
      const idiResult = idi.passed ? "    ✓    " : "    ✗    ";
      const hyperResult = hyper.passed ? "    ✓     " : "    ✗     ";
      console.log(`║ ${num} │ ${name} │${idiResult}│${hyperResult}║`);
    }

    console.log(
      "╠══════════════════════════════════════════════════════════════════════════════╣",
    );
    const idiTotal = `${results.idiomorph.passed}/30`.padStart(5);
    const hyperTotal = `${results.hypermatch.passed}/30`.padStart(5);
    console.log(
      `║                                        TOTAL │  ${idiTotal}   │   ${hyperTotal}   ║`,
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════════════════════╝",
    );
    console.log("\n");
  });
});
