describe("Core morphing tests", function () {
  setup();

  it("morphs outerHTML by default", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<button>Bar</button>";
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML if morphStyle is missing", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<button>Bar</button>";
    Idiomorph.morph(initial, finalSrc, { morphStyle: null });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML as content properly when argument is null", function () {
    let initial = make("<button>Foo</button>");
    Idiomorph.morph(initial, null, { morphStyle: "outerHTML" });
    initial.isConnected.should.equal(false);
  });

  it("morphs outerHTML as content properly when argument is single node", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<button>Bar</button>";
    let final = make(finalSrc);
    Idiomorph.morph(initial, final, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML as content properly when argument is single node", function () {
    let initial = make("<button>Foo</button>");
    let element = document.createElement("button");
    element.innerText = "Bar";
    Idiomorph.morph(initial, element, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML as content properly when argument is string", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<button>Bar</button>";
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML as content properly when argument is an HTMLElementCollection", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<div><button>Bar</button></div>";
    let final = make(finalSrc).children;
    Idiomorph.morph(initial, final, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs outerHTML as content properly when argument is an Array", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<div><button>Bar</button></div>";
    let final = [...make(finalSrc).children];
    Idiomorph.morph(initial, final, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<button>Bar</button>");
  });

  it("morphs innerHTML as content properly when argument is null", function () {
    let initial = make("<div>Foo</div>");
    Idiomorph.morph(initial, null, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<div></div>");
  });

  it("morphs innerHTML as content properly when argument is single node string", function () {
    let initial = make("<div>Foo</div>");
    let finalSrc = "<button>Bar</button>";
    let final = make(finalSrc);
    Idiomorph.morph(initial, final, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<div><button>Bar</button></div>");
  });

  it("morphs innerHTML as content properly when argument is single node", function () {
    let initial = make("<div>Foo</div>");
    let element = document.createElement("button");
    element.innerText = "Bar";
    Idiomorph.morph(initial, element, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<div><button>Bar</button></div>");
  });

  it("morphs innerHTML as content properly when argument is string", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<button>Bar</button>";
    Idiomorph.morph(initial, finalSrc, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<button><button>Bar</button></button>");
  });

  it("morphs innerHTML as content properly when argument is an HTMLElementCollection", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<div><button>Bar</button></div>";
    let final = make(finalSrc).children;
    Idiomorph.morph(initial, final, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<button><button>Bar</button></button>");
  });

  it("morphs innerHTML as content properly when argument is an Array", function () {
    let initial = make("<button>Foo</button>");
    let finalSrc = "<div><button>Bar</button></div>";
    let final = [...make(finalSrc).children];
    Idiomorph.morph(initial, final, { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<button><button>Bar</button></button>");
  });

  it("morphs innerHTML as content properly when argument is empty array", function () {
    let initial = make("<div>Foo</div>");
    Idiomorph.morph(initial, [], { morphStyle: "innerHTML" });
    initial.outerHTML.should.equal("<div></div>");
  });

  it("can morph a template tag properly", function () {
    let initial = make("<template data-old>Foo</template>");
    let final = make("<template data-new>Bar</template>");
    Idiomorph.morph(initial, final);
    initial.outerHTML.should.equal(final.outerHTML);
  });

  it("can handle numeric ids", function () {
    let initial = make(`<div><hr id="1"></div>`);
    let final = `<div><div><hr id="1"></div></div>`;
    Idiomorph.morph(initial, final);
    initial.outerHTML.should.equal(final);
  });

  it("can morph a body tag properly", function () {
    let initial = parseHTML("<body>Foo</body>");
    let finalSrc = '<body foo="bar">Foo</body>';
    let final = parseHTML(finalSrc);
    Idiomorph.morph(initial.body, final.body);
    initial.body.outerHTML.should.equal(finalSrc);
  });

  it("can morph a full document properly", function () {
    let initial = parseHTML("<html><body>Foo</body></html>");
    let finalSrc =
      '<html foo="bar"><head></head><body foo="bar">Foo</body></html>';
    Idiomorph.morph(initial, finalSrc);
    initial.documentElement.outerHTML.should.equal(finalSrc);
  });

  it("ignores active input value when ignoreActiveValue is true", function () {
    let parent = make("<div><input value='foo'></div>");
    document.body.append(parent);

    let initial = parent.querySelector("input");

    // morph
    let finalSrc = '<input value="bar">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input value="bar">');

    initial.focus();

    document.activeElement.should.equal(initial);

    let finalSrc2 = '<input class="foo" value="doh">';
    Idiomorph.morph(initial, finalSrc2, {
      morphStyle: "outerHTML",
      ignoreActiveValue: true,
    });
    initial.value.should.equal("bar");
    initial.classList.value.should.equal("foo");

    document.body.removeChild(parent);
  });

  it("does not ignore body when ignoreActiveValue is true and no element has focus", function () {
    let parent = make("<div><input value='foo'></div>");
    document.body.append(parent);

    let initial = parent.querySelector("input");

    // morph
    let finalSrc = '<input value="bar">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input value="bar">');

    document.activeElement.should.equal(document.body);

    let finalSrc2 = '<input class="foo" value="doh">';
    Idiomorph.morph(initial, finalSrc2, {
      morphStyle: "outerHTML",
      ignoreActiveValue: true,
    });
    initial.value.should.equal("doh");
    initial.classList.value.should.equal("foo");

    document.body.removeChild(parent);
  });

  it("can ignore attributes w/ the beforeAttributeUpdated callback", function () {
    let parent = make("<div><input value='foo'></div>");
    document.body.append(parent);

    let initial = parent.querySelector("input");

    // morph
    let finalSrc = '<input value="bar">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input value="bar">');

    let finalSrc2 = '<input class="foo" value="doh">';
    Idiomorph.morph(initial, finalSrc2, {
      morphStyle: "outerHTML",
      callbacks: {
        beforeAttributeUpdated: function (attr) {
          if (attr === "value") {
            return false;
          }
        },
      },
    });
    initial.value.should.equal("bar");
    initial.classList.value.should.equal("foo");

    document.body.removeChild(parent);
  });

  it("can ignore attributes w/ the beforeAttributeUpdated callback 2", function () {
    let parent = make("<div><input value='foo'></div>");
    document.body.append(parent);

    let initial = parent.querySelector("input");

    // morph
    let finalSrc = '<input value="bar">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input value="bar">');

    let finalSrc2 = '<input class="foo" value="doh">';
    Idiomorph.morph(initial, finalSrc2, {
      morphStyle: "outerHTML",
      callbacks: {
        beforeAttributeUpdated: function (attr) {
          if (attr === "class") {
            return false;
          }
        },
      },
    });
    initial.value.should.equal("doh");
    initial.classList.value.should.equal("");

    document.body.removeChild(parent);
  });

  it("can prevent element addition w/ the beforeNodeAdded callback", function () {
    let parent = make("<div><p>1</p><p>2</p></div>");
    document.body.append(parent);

    // morph
    let finalSrc = "<p>1</p><p>2</p><p>3</p><p>4</p>";

    Idiomorph.morph(parent, finalSrc, {
      morphStyle: "innerHTML",
      callbacks: {
        beforeNodeAdded(node) {
          if (node.outerHTML === "<p>3</p>") return false;
        },
      },
    });
    parent.innerHTML.should.equal("<p>1</p><p>2</p><p>4</p>");

    document.body.removeChild(parent);
  });

  it("ignores active textarea value when ignoreActiveValue is true", function () {
    let parent = make("<div><textarea>foo</textarea></div>");
    document.body.append(parent);
    let initial = parent.querySelector("textarea");

    let finalSrc = "<textarea>bar</textarea>";
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal("<textarea>bar</textarea>");

    initial.focus();

    document.activeElement.should.equal(initial);

    let finalSrc2 = '<textarea class="foo">doh</textarea>';
    Idiomorph.morph(initial, finalSrc2, {
      morphStyle: "outerHTML",
      ignoreActiveValue: true,
    });
    initial.outerHTML.should.equal('<textarea class="foo">bar</textarea>');

    document.body.removeChild(parent);
  });

  it("can morph input value properly because value property is special and doesnt reflect", function () {
    let initial = make('<div><input value="foo"></div>');
    let final = make('<input value="foo">');
    final.value = "bar";
    Idiomorph.morph(initial, final, { morphStyle: "innerHTML" });
    initial.innerHTML.should.equal('<input value="bar">');
  });

  it("can morph textarea value properly because value property is special and doesnt reflect", function () {
    let initial = make("<textarea>foo</textarea>");
    let final = make("<textarea>foo</textarea>");
    final.value = "bar";
    Idiomorph.morph(initial, final, { morphStyle: "outerHTML" });
    initial.value.should.equal("bar");
  });

  it("specially considers textarea value property in beforeAttributeUpdated hook because value property is special and doesnt reflect", function () {
    let initial = make("<div><textarea>foo</textarea></div>");
    let final = make("<textarea>foo</textarea>");
    final.value = "bar";
    Idiomorph.morph(initial, final, {
      morphStyle: "innerHTML",
      callbacks: {
        beforeAttributeUpdated: (attr, to, updatetype) => false,
      },
    });
    initial.innerHTML.should.equal("<textarea>foo</textarea>");
  });

  it("can morph input checked properly, remove checked", function () {
    let parent = make('<div><input type="checkbox" checked></div>');
    document.body.append(parent);
    let initial = parent.querySelector("input");

    let finalSrc = '<input type="checkbox">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input type="checkbox">');
    initial.checked.should.equal(false);
    document.body.removeChild(parent);
  });

  it("can morph input checked properly, add checked", function () {
    let parent = make('<div><input type="checkbox"></div>');
    document.body.append(parent);
    let initial = parent.querySelector("input");

    let finalSrc = '<input type="checkbox" checked>';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input type="checkbox" checked="">');
    initial.checked.should.equal(true);
    document.body.removeChild(parent);
  });

  it("can morph input checked properly, set checked property to true", function () {
    let parent = make('<div><input type="checkbox" checked></div>');
    document.body.append(parent);
    let initial = parent.querySelector("input");
    initial.checked = false;

    let finalSrc = '<input type="checkbox" checked>';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input type="checkbox" checked="">');
    initial.checked.should.equal(true);
    document.body.removeChild(parent);
  });

  it("can morph input checked properly, set checked property to false", function () {
    let parent = make('<div><input type="checkbox"></div>');
    document.body.append(parent);
    let initial = parent.querySelector("input");
    initial.checked = true;

    let finalSrc = '<input type="checkbox">';
    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });
    initial.outerHTML.should.equal('<input type="checkbox">');
    initial.checked.should.equal(false);
    document.body.removeChild(parent);
  });

  it("can morph <select> remove selected option properly", function () {
    let parent = make(`
      <div>
        <select>
          <option>0</option>
          <option selected>1</option>
        </select>
      </div>
    `);
    document.body.append(parent);
    let select = parent.querySelector("select");
    let options = parent.querySelectorAll("option");
    select.selectedIndex.should.equal(1);
    Array.from(select.selectedOptions).should.eql([options[1]]);
    Array.from(options)
      .map((o) => o.selected)
      .should.eql([false, true]);

    let finalSrc = `
        <select>
          <option>0</option>
          <option>1</option>
        </select>
      `;
    Idiomorph.morph(parent, finalSrc, { morphStyle: "innerHTML" });
    // the browser auto-selects the first option; no attribute is written
    parent.innerHTML.should.equal(`
        <select>
          <option>0</option>
          <option>1</option>
        </select>
      `);
    select.selectedIndex.should.equal(0);
    Array.from(select.selectedOptions).should.eql([options[0]]);
    Array.from(options)
      .map((o) => o.selected)
      .should.eql([true, false]);
  });

  it("can morph <select> new selected option properly", function () {
    let parent = make(`
      <div>
        <select>
          <option>0</option>
          <option>1</option>
        </select>
      </div>
    `);
    document.body.append(parent);
    let select = parent.querySelector("select");
    let options = parent.querySelectorAll("option");
    select.selectedIndex.should.equal(0);
    Array.from(select.selectedOptions).should.eql([options[0]]);
    Array.from(options)
      .map((o) => o.selected)
      .should.eql([true, false]);

    let finalSrc = `
        <select>
          <option>0</option>
          <option selected="">1</option>
        </select>
      `;
    Idiomorph.morph(parent, finalSrc, { morphStyle: "innerHTML" });
    parent.innerHTML.should.equal(finalSrc);
    select.selectedIndex.should.equal(1);
    Array.from(select.selectedOptions).should.eql([options[1]]);
    Array.from(options)
      .map((o) => o.selected)
      .should.eql([false, true]);
  });

  it("add loc coverage for findSoftMatch aborting on two future soft matches", function () {
    // when nodes can't be softMatched because they have different types it will scan ahead
    // but it aborts the scan ahead if it finds two nodes ahead in both the new and old content
    // that softmatch so it can just insert the mis matched node it is on and get to the matching.
    // had no test coverage but not easy to test but at least it is called now.
    let initial = parseHTML("<body><span></span><p></p><p></p></body>");
    let finalSrc = "<body><div></div><p></p><p></p></body>";
    let final = parseHTML(finalSrc);
    Idiomorph.morph(initial.body, final.body);
    initial.body.outerHTML.should.equal(finalSrc);
  });

  it("do not build id in new content parent into persistent id set", function () {
    let initial = make("<span><div id='a'>Foo</div></span>");
    let finalParent = make("<div id='a'><span>Bar</span></div>");
    let finalSrc = finalParent.querySelector("span");

    Idiomorph.morph(initial, finalSrc, { morphStyle: "outerHTML" });

    // have to make sure the id located in the parent of the new content is not
    // included in the persistent ID set or it will pantry the id'ed node in error
    initial.outerHTML.should.equal("<span>Bar</span>");
  });

  it("morphs id'd elements whose id contains a double quote without losing them", function () {
    const el = make(
      `<div><section><p id='we"ird'>x</p></section><footer>f</footer></div>`,
    );
    getWorkArea().appendChild(el);
    (() => {
      Idiomorph.morph(el, `<div><footer>f</footer><p id='we"ird'>x</p></div>`);
    }).should.not.throw();
    const p = el.querySelector("p");
    (p !== null).should.equal(true);
    p.getAttribute("id").should.equal('we"ird');
    p.textContent.should.equal("x");
  });

  it("creates SVG subtrees containing persistent ids in the SVG namespace", function () {
    const el = make(
      `<div><aside><svg width="1"><circle id="c" r="1"></circle></svg></aside><p>keep</p></div>`,
    );
    getWorkArea().appendChild(el);
    Idiomorph.morph(
      el,
      `<div><p>keep</p><svg width="1"><circle id="c" r="1"></circle></svg></div>`,
    );
    const svg = el.querySelector("svg");
    (svg !== null).should.equal(true);
    svg.namespaceURI.should.equal("http://www.w3.org/2000/svg");
    const circle = el.querySelector("circle");
    (circle !== null).should.equal(true);
    circle.getAttribute("id").should.equal("c");
    circle.namespaceURI.should.equal("http://www.w3.org/2000/svg");
  });

  it("treats a fragment whose textarea mentions </body> as a fragment", function () {
    const el = make("<div><span>x</span></div>");
    getWorkArea().appendChild(el);
    Idiomorph.morph(el, "<div><textarea>literal </body> text</textarea></div>");
    el.tagName.should.equal("DIV");
    el.querySelector("textarea").value.should.equal("literal </body> text");
  });

  it("handles nested svg content in strings", function () {
    const el = make("<div>old</div>");
    getWorkArea().appendChild(el);
    Idiomorph.morph(
      el,
      `<div><svg><g><svg><circle r="1"></circle></svg></g></svg><textarea>after </body> text</textarea></div>`,
    );
    (el.querySelector("svg svg circle") !== null).should.equal(true);
    el.querySelector("textarea").value.should.equal("after </body> text");
  });
});
