describe("formStateSync option — property-driven mode for non-livesync callers", function () {
  setup();

  // In default 'attribute' mode the morph treats the new element's `value` /
  // `checked` / `selected` ATTRIBUTES as authoritative (intended for HTML-
  // serialization use cases like hyperclay-livesync). In 'property' mode the
  // morph reads/writes form-control state via PROPERTY assignment only,
  // leaving attributes untouched — the right default for callers that build
  // their new fragment via `document.createElement` + property assignment
  // (e.g. an in-memory CMS form rebuild).

  describe("input[type=text]", function () {
    it("attribute mode (default) — new input without `value` attribute clears the old value", function () {
      const root = make('<div><input id="x" type="text" value="old"></div>');
      getWorkArea().appendChild(root);
      // The new fragment's input has a `.value` PROPERTY but no `value`
      // ATTRIBUTE — i.e. authored via `el.value = 'fresh'`.
      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "x";
      newInput.type = "text";
      newInput.value = "fresh";
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, { morphStyle: "innerHTML" });

      const liveInput = document.getElementById("x");
      // Default attribute mode wipes the value because the new element has no `value` attribute.
      liveInput.value.should.equal("");
    });

    it("property mode — new input without `value` attribute syncs the property cleanly (does NOT clear it)", function () {
      const root = make('<div><input id="x" type="text" value="old"></div>');
      getWorkArea().appendChild(root);
      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "x";
      newInput.type = "text";
      newInput.value = "fresh";
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      // Default 'attribute' mode would have cleared this to "". Property mode
      // syncs the new live value instead. (The `value` attribute itself may
      // be removed by morphAttributes — that's an orthogonal subsystem and
      // not what callers care about in property mode.)
      document.getElementById("x").value.should.equal("fresh");
    });

    it("property mode — old input gets the new property value when property differs", function () {
      const root = make('<div><input id="x" type="text" value="A"></div>');
      getWorkArea().appendChild(root);
      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "x";
      newInput.type = "text";
      newInput.value = "B";
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      document.getElementById("x").value.should.equal("B");
    });
  });

  describe("input[type=checkbox]", function () {
    it("property mode — syncs .checked via property only, attribute untouched", function () {
      const root = make('<div><input id="c" type="checkbox" checked></div>');
      getWorkArea().appendChild(root);
      // Live checkbox starts checked. New fragment unchecks via property only.
      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "c";
      newInput.type = "checkbox";
      newInput.checked = false;
      // No attribute manipulation — the original 'checked' attribute remains in the fragment.
      newInput.setAttribute("checked", "");
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      const live = document.getElementById("c");
      // Property reflects the new live value.
      live.checked.should.equal(false);
      // Attribute is untouched (still present from original).
      live.hasAttribute("checked").should.equal(true);
    });
  });

  describe("option[selected]", function () {
    it("property mode — syncs .selected via property only, attribute untouched", function () {
      const root = make(
        '<div><select id="s"><option value="a" selected>A</option><option value="b">B</option></select></div>',
      );
      getWorkArea().appendChild(root);
      // Build a new fragment via createElement with `.selected` flipped.
      const newDiv = document.createElement("div");
      const newSelect = document.createElement("select");
      newSelect.id = "s";
      const a = document.createElement("option");
      a.value = "a";
      a.textContent = "A";
      a.setAttribute("selected", "");
      a.selected = false;
      const b = document.createElement("option");
      b.value = "b";
      b.textContent = "B";
      b.selected = true;
      newSelect.appendChild(a);
      newSelect.appendChild(b);
      newDiv.appendChild(newSelect);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      const liveSelect = document.getElementById("s");
      const opts = liveSelect.querySelectorAll("option");
      opts[0].selected.should.equal(false);
      opts[1].selected.should.equal(true);
      // Attributes left as they were in the original DOM (option A still has
      // `selected` attribute — that's the serialization, not the live state).
      opts[0].hasAttribute("selected").should.equal(true);
      opts[1].hasAttribute("selected").should.equal(false);
    });
  });

  describe("default mode unchanged", function () {
    it("attribute mode is the default when option is omitted", function () {
      const root = make('<div><input id="x" type="text" value="old"></div>');
      getWorkArea().appendChild(root);
      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "x";
      newInput.type = "text";
      newInput.setAttribute("value", "fromAttr");
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, { morphStyle: "innerHTML" });

      const live = document.getElementById("x");
      live.value.should.equal("fromAttr");
      live.getAttribute("value").should.equal("fromAttr");
    });
  });

  describe("textarea", function () {
    it("property mode leaves textarea child text alone", function () {
      const root = make("<div><textarea id='t'>old</textarea></div>");
      getWorkArea().appendChild(root);
      // The new textarea keeps the same serialized child text ("old") but a
      // different live value ("new"). Property mode must sync the live value
      // without rewriting the serialized child text to match it.
      const newDiv = document.createElement("div");
      const newTa = document.createElement("textarea");
      newTa.id = "t";
      newTa.textContent = "old";
      newTa.value = "new";
      newDiv.appendChild(newTa);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      const live = document.getElementById("t");
      live.value.should.equal("new");
      live.firstChild.nodeValue.should.equal("old");
    });
  });

  describe("input[type=checkbox] indeterminate", function () {
    it("property mode syncs indeterminate", function () {
      const root = make(`<div><input id="c" type="checkbox"></div>`);
      getWorkArea().appendChild(root);
      document.getElementById("c").indeterminate = false;

      const newDiv = document.createElement("div");
      const newInput = document.createElement("input");
      newInput.id = "c";
      newInput.type = "checkbox";
      newInput.indeterminate = true;
      newDiv.appendChild(newInput);

      Idiomorph.morph(root, newDiv, {
        morphStyle: "innerHTML",
        formStateSync: "property",
      });

      document.getElementById("c").indeterminate.should.equal(true);
    });

    it("attribute mode never touches indeterminate", function () {
      const root = make(`<div><input id="c" type="checkbox"></div>`);
      getWorkArea().appendChild(root);
      document.getElementById("c").indeterminate = true;

      Idiomorph.morph(root, `<div><input id="c" type="checkbox"></div>`, {
        morphStyle: "innerHTML",
      });

      document.getElementById("c").indeterminate.should.equal(true);
    });
  });
});
