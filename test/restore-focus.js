describe("Option to forcibly restore focus after morph", function () {
  setup();

  function assertFocusPreservationWithoutMoveBefore(
    before,
    after,
    focusId,
    selection,
    restoreFocus = true,
  ) {
    getWorkArea().innerHTML = before;
    for (const elt of getWorkArea().querySelectorAll("input")) {
      elt.parentElement.moveBefore = undefined;
    }
    setFocusAndSelection(focusId, selection);
    Idiomorph.morph(getWorkArea(), after, {
      morphStyle: "innerHTML",
      restoreFocus: restoreFocus,
    });
    getWorkArea().innerHTML.should.equal(after);
  }

  describe("defaults to on", function () {
    it("restores focus and selection state with outerHTML morphStyle", function () {
      const div = make(`
        <div>
          <input type="text" id="focused" value="abc">
          <input type="text" id="other">
        </div>
      `);
      getWorkArea().append(div);
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>
      `;
      Idiomorph.morph(div, finalSrc, {
        morphStyle: "outerHTML",
      });

      getWorkArea().innerHTML.trim().should.equal(finalSrc.trim());
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state when elements are moved to different levels of the DOM", function () {
      getWorkArea().innerHTML = `
        <div>
          <input type="text" id="other">
          <div>
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "a");

      let finalSrc = `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "a");
    });

    it("restores focus and selection state when elements are moved between different containers", function () {
      getWorkArea().innerHTML = `
        <div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
          <div id="right">
            <input type="text" id="other">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <div id="left">
            <input type="text" id="other">
          </div>
          <div id="right">
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state when parents are reorderd", function () {
      getWorkArea().innerHTML = `
        <div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
          <div id="right">
            <input type="text" id="other">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <div id="right">
            <input type="text" id="other">
          </div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state with outerHTML morphStyle", function () {
      const div = make(`
        <div>
          <input type="text" id="focused" value="abc">
          <input type="text" id="other">
        </div>
      `);
      getWorkArea().append(div);
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>
      `;
      Idiomorph.morph(div, finalSrc, {
        morphStyle: "outerHTML",
      });

      getWorkArea().innerHTML.trim().should.equal(finalSrc.trim());
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state when elements are moved to different levels of the DOM", function () {
      getWorkArea().innerHTML = `
        <div>
          <input type="text" id="other">
          <div>
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state when elements are moved between different containers", function () {
      getWorkArea().innerHTML = `
        <div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
          <div id="right">
            <input type="text" id="other">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <div id="left">
            <input type="text" id="other">
          </div>
          <div id="right">
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state when parents are reordered", function () {
      getWorkArea().innerHTML = `
        <div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
          <div id="right">
            <input type="text" id="other">
          </div>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <div id="right">
            <input type="text" id="other">
          </div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("restores focus and selection state with a textarea", function () {
      getWorkArea().innerHTML = `
        <div>
          <textarea id="focused">abc</textarea>
          <textarea id="other"></textarea>
        </div>
      `;
      setFocusAndSelection("focused", "b");

      let finalSrc = `
        <div>
          <textarea id="other"></textarea>
          <textarea id="focused">abc</textarea>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertFocusAndSelection("focused", "b");
    });

    it("does nothing if a non input/textarea el is focused", function () {
      getWorkArea().innerHTML = `
        <div>
          <p id="focused"></p>
          <p id="other"></p>
        </div>
      `;
      setFocus("focused");

      let finalSrc = `
        <div>
          <p id="other"></p>
          <p id="focused"></p>
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, {
        morphStyle: "innerHTML",
      });

      getWorkArea().innerHTML.should.equal(finalSrc);
      assertNoFocus();
    });

    it("does not restore selection if selection still set or changed", function () {
      getWorkArea().innerHTML = `
          <div>
            <input type="text" id="focused" value="abc">
            <input type="text" id="other">
          </div>`;
      const after = `
          <div>
            <input type="text" id="other">
            <input type="text" id="focused" value="abc">
          </div>`;
      setFocusAndSelection("focused", "b");
      Idiomorph.morph(getWorkArea(), after, {
        morphStyle: "innerHTML",
        restoreFocus: true,
        callbacks: {
          beforeNodeMorphed: function () {
            // simulate changing the focus selection during morphing
            setFocusAndSelection("focused", "c");
          },
        },
      });
      getWorkArea().innerHTML.should.equal(after);
      assertFocusAndSelection("focused", "c");
    });
  });

  describe("with option on but moveBefore disabled", function () {
    it("preserves focus state and outerHTML morphStyle", function () {
      assertFocusPreservationWithoutMoveBefore(
        `
        <div>
          <input type="text" id="focused" value="abc">
          <input type="text" id="other">
        </div>`,
        `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>`,
        "focused",
        "b",
      );
      assertFocus("focused");
    });

    it("preserves focus state when elements are moved to different levels of the DOM", function () {
      assertFocusPreservationWithoutMoveBefore(
        `
        <div>
          <input type="text" id="other">
          <div>
            <input type="text" id="focused" value="abc">
          </div>
        </div>`,
        `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>`,
        "focused",
        "b",
      );
      assertFocus("focused");
    });

    it("restores focus state with reparented numeric id", function () {
      assertFocusPreservationWithoutMoveBefore(
        `
        <div>
          <input type="text" id="other">
          <div>
            <input type="text" id="1" value="abc">
          </div>
        </div>`,
        `
        <div>
          <input type="text" id="other">
          <input type="text" id="1" value="abc">
        </div>`,
        "1",
        "b",
      );
    });

    it("preserves focus state when focused element is moved between anonymous containers", function () {
      assertFocusPreservationWithoutMoveBefore(
        `
        <div>
          <input type="text" id="other">
        </div>
        <div>
          <input type="text" id="focused" value="abc">
        </div>`,
        `
        <div>
          <input type="text" id="other">
          <input type="text" id="focused" value="abc">
        </div>`,
        "focused",
        "b",
      );
      assertFocus("focused");
    });

    it("preserves focus state when elements are moved between IDed containers", function () {
      assertFocusPreservationWithoutMoveBefore(
        `
        <div>
          <div id="left">
            <input type="text" id="focused" value="abc">
          </div>
          <div id="right">
            <input type="text" id="other">
          </div>
        </div>`,
        `
        <div>
          <div id="left">
            <input type="text" id="other">
          </div>
          <div id="right">
            <input type="text" id="focused" value="abc">
          </div>
        </div>`,
        "focused",
        "b",
      );
      assertFocus("focused");
    });
  });

  describe("edge cases", function () {
    it("restores focus when the focused element's id contains a double quote", function () {
      getWorkArea().innerHTML = `
        <div>
          <input type="text" id="other">
          <div>
            <input type="text" id='we"ird' value="abc">
          </div>
        </div>
      `;
      // Force the insertBefore path so the input is reparented and refocused
      // via the id selector, which must be CSS.escaped to survive the quote.
      for (const elt of getWorkArea().querySelectorAll("input")) {
        elt.parentElement.moveBefore = undefined;
      }
      const focused = document.getElementById('we"ird');
      focused.focus();
      focused.setSelectionRange(1, 2);

      const finalSrc = `
        <div>
          <input type="text" id="other">
          <input type="text" id='we"ird' value="abc">
        </div>
      `;
      Idiomorph.morph(getWorkArea(), finalSrc, { morphStyle: "innerHTML" });

      document.activeElement.should.equal(document.getElementById('we"ird'));
    });

    it("does not throw when a focused text input becomes type=number during the morph", function () {
      getWorkArea().innerHTML = `
        <div>
          <input type="text" id="focused" value="123">
          <input type="text" id="other">
        </div>
      `;
      setFocusAndSelection("focused", "2");

      const finalSrc = `
        <div>
          <input type="number" id="other">
          <input type="number" id="focused" value="123">
        </div>
      `;
      (() => {
        Idiomorph.morph(getWorkArea(), finalSrc, { morphStyle: "innerHTML" });
      }).should.not.throw();
    });
  });
  describe("caret across an inline merge", function () {
    // Seat B's six apply scenarios (CHARMERGE step 6): the live paragraph is
    // the local side, the caret sits in a text node the merge splits, joins
    // or re-wraps, and it must land on the same character afterwards.
    const FOX = "The quick brown fox jumps over the lazy dog.";
    const P = (s) => `<p contenteditable id="ce">${s}</p>`;

    async function scenario(baseInner, liveSetup, remoteInner, caretOf) {
      const wa = getWorkArea();
      wa.innerHTML = P(baseInner);
      const p = wa.firstElementChild;
      liveSetup(p);
      p.focus();
      const [node, offset] = caretOf(p);
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      await HyperMorph.morphElement(p, P(remoteInner), { base: P(baseInner) });
      document.activeElement.should.equal(p);
      const got = window.getSelection().getRangeAt(0);
      return {
        p,
        node: got.startContainer,
        offset: got.startOffset,
        html: p.innerHTML,
      };
    }

    it("1. local bolds a word, remote edits later: caret after 'fox' stays there", async function () {
      const r = await scenario(
        FOX,
        (p) => {
          const rest = p.firstChild.splitText(4);
          rest.splitText(5);
          const b = document.createElement("b");
          p.insertBefore(b, rest);
          b.appendChild(rest);
        },
        "The quick brown fox jumps over the sleepy dog.",
        (p) => [p.lastChild, " brown fox".length],
      );
      r.html.should.equal(
        "The <b>quick</b> brown fox jumps over the sleepy dog.",
      );
      r.node.should.equal(r.p.lastChild);
      r.offset.should.equal(" brown fox".length);
    });

    it("2. browser-split text nodes, caret in the middle piece", async function () {
      const r = await scenario(
        "Hello world again",
        (p) => {
          const b = p.firstChild.splitText(6);
          b.splitText(6);
        },
        "Hello world again!",
        (p) => [p.childNodes[1], 3],
      );
      r.html.should.equal("Hello world again!");
      r.node.should.equal(r.p.firstChild);
      r.offset.should.equal("Hello wor".length);
    });

    it("3. local types at the end, remote bolds a word: caret stays after the typing", async function () {
      const typed = FOX + " Really.";
      const r = await scenario(
        FOX,
        (p) => {
          p.firstChild.nodeValue = typed;
        },
        "The <b>quick</b> brown fox jumps over the lazy dog.",
        (p) => [p.firstChild, typed.length],
      );
      r.html.should.equal(
        "The <b>quick</b> brown fox jumps over the lazy dog. Really.",
      );
      r.node.should.equal(r.p.lastChild);
      r.offset.should.equal(r.p.lastChild.nodeValue.length);
    });

    it("4. remote unbolds while local edits elsewhere: caret follows its character into the joined node", async function () {
      const r = await scenario(
        "The <b>quick</b> brown fox.",
        (p) => {
          p.lastChild.nodeValue = " brown hound.";
        },
        "The quick brown fox.",
        (p) => [p.lastChild, " brown ".length],
      );
      r.html.should.equal("The quick brown hound.");
      r.node.should.equal(r.p.firstChild);
      r.offset.should.equal("The quick brown ".length);
    });

    it("5. same-word conflict remote wins: a caret inside the lost word lands after the winner", async function () {
      const r = await scenario(
        "the lazy dog",
        (p) => {
          p.firstChild.nodeValue = "the LAZY dog";
        },
        "the sleepy dog",
        (p) => [p.firstChild, "the LA".length],
      );
      r.html.should.equal("the sleepy dog");
      r.node.should.equal(r.p.firstChild);
      r.offset.should.equal("the sleepy".length);
    });

    it("6. remote links a word, local types after it: caret stays at the end of the typing", async function () {
      const typed = "See docs now please";
      const r = await scenario(
        "See docs now",
        (p) => {
          p.firstChild.nodeValue = typed;
        },
        'See <a href="/d">docs</a> now',
        (p) => [p.firstChild, typed.length],
      );
      r.html.should.equal('See <a href="/d">docs</a> now please');
      r.node.should.equal(r.p.lastChild);
      r.offset.should.equal(" now please".length);
    });

    it("7. typing after the snapshot survives an inline merge that re-wrapped its node", async function () {
      const page = (b) =>
        `<!DOCTYPE html><html><head></head><body>${b}</body></html>`;
      const live = parseHTML(page(`<p>${FOX}</p>`));
      const clone = live.documentElement.cloneNode(true);
      const prov = new Map();
      (function pair(l, c) {
        prov.set(c, l);
        for (let i = 0; i < l.childNodes.length; i++)
          pair(l.childNodes[i], c.childNodes[i]);
      })(live.documentElement, clone);
      live.querySelector("p").firstChild.nodeValue = "Hey " + FOX;
      await HyperMorph.mergeDocument({
        live,
        base: page(`<p>${FOX}</p>`),
        remote: page(
          "<p>The <b>quick</b> brown fox jumps over the lazy dog.</p>",
        ),
        local: { root: clone, toLive: (n) => prov.get(n) || null },
      });
      live.body.innerHTML.should.equal(
        "<p>Hey The <b>quick</b> brown fox jumps over the lazy dog.</p>",
      );
    });
  });
});
