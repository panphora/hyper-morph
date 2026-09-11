describe("pantry ownership", function () {
  beforeEach(function () {
    clearWorkArea();
  });

  it("does not connect a pantry when no node needs staging", function () {
    const initial = make("<div><p>A</p></div>");
    getWorkArea().append(initial);
    let connected = 0;
    const insertAdjacentElement = HTMLElement.prototype.insertAdjacentElement;
    HTMLElement.prototype.insertAdjacentElement = function (position, node) {
      if (this === document.body && position === "afterend" && node.hidden) {
        connected++;
      }
      return insertAdjacentElement.call(this, position, node);
    };

    try {
      Idiomorph.morph(initial, "<div><p>B</p></div>");
    } finally {
      HTMLElement.prototype.insertAdjacentElement = insertAdjacentElement;
    }

    connected.should.equal(0);
  });

  it("marks the pantry mutation-owned before connecting it", function () {
    const initial = make(
      '<main><section id="discard"><span id="keep">keep</span></section><article id="destination"></article></main>',
    );
    getWorkArea().append(initial);
    const connected = [];
    const insertAdjacentElement = HTMLElement.prototype.insertAdjacentElement;
    HTMLElement.prototype.insertAdjacentElement = function (position, node) {
      if (this === document.body && position === "afterend" && node.hidden) {
        connected.push(node.hasAttribute("mutations-ignore"));
      }
      return insertAdjacentElement.call(this, position, node);
    };

    try {
      Idiomorph.morph(
        initial,
        '<main><article id="destination"><span id="keep">keep</span></article></main>',
      );
    } finally {
      HTMLElement.prototype.insertAdjacentElement = insertAdjacentElement;
    }

    connected.should.eql([true]);
  });

});
