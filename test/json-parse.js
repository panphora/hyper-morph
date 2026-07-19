import {
  parseJsonRelaxed,
  parseRulesRelaxed,
} from "../src/hyper-morph-json-parse.js";

describe("parseJsonRelaxed: conservative relaxed JSON", function () {
  describe("strict fast path", function () {
    it("parses strict JSON objects", function () {
      parseJsonRelaxed('{"a": 1}').should.deep.equal({ a: 1 });
    });

    it("parses strict JSON scalars", function () {
      parseJsonRelaxed("42").should.equal(42);
    });
  });

  describe("relaxed syntax", function () {
    it("accepts unquoted identifier keys", function () {
      parseJsonRelaxed("{a: 1, _b: 2, $c: 3, d1: 4}").should.deep.equal({
        a: 1,
        _b: 2,
        $c: 3,
        d1: 4,
      });
    });

    it("accepts single-quoted strings", function () {
      parseJsonRelaxed("{a: 'x'}").should.deep.equal({ a: "x" });
    });

    it("unescapes \\' in single-quoted strings", function () {
      parseJsonRelaxed("{a: 'don\\'t'}").should.deep.equal({ a: "don't" });
    });

    it("escapes bare double quotes inside single-quoted strings", function () {
      parseJsonRelaxed("{a: 'say \"hi\"'}").should.deep.equal({
        a: 'say "hi"',
      });
    });

    it("keeps already-escaped double quotes inside single-quoted strings", function () {
      parseJsonRelaxed("{a: 'x\\\"y'}").should.deep.equal({ a: 'x"y' });
    });

    it("handles escaped quotes in double-quoted strings", function () {
      parseJsonRelaxed('{a: "s\\"q"}').should.deep.equal({ a: 's"q' });
    });

    it("drops trailing commas in objects", function () {
      parseJsonRelaxed("{a: 1,}").should.deep.equal({ a: 1 });
    });

    it("drops trailing commas in arrays", function () {
      parseJsonRelaxed("[1, 2,]").should.deep.equal([1, 2]);
    });

    it("drops a trailing comma separated from the brace by a comment", function () {
      parseJsonRelaxed("{a: 1, /* end */ }").should.deep.equal({ a: 1 });
    });

    it("keeps commas between entries", function () {
      parseJsonRelaxed("{a: 1, b: 2}").should.deep.equal({ a: 1, b: 2 });
    });

    it("strips line comments", function () {
      parseJsonRelaxed("{\n  // count of things\n  a: 1\n}").should.deep.equal({
        a: 1,
      });
    });

    it("strips a line comment at end of input", function () {
      parseJsonRelaxed("{a: 1} // done").should.deep.equal({ a: 1 });
    });

    it("strips block comments", function () {
      parseJsonRelaxed("{a: /* note */ 1}").should.deep.equal({ a: 1 });
    });

    it("allows a comment between a key and its colon", function () {
      parseJsonRelaxed("{a /* key */ : 1}").should.deep.equal({ a: 1 });
    });

    it("accepts JSON number forms", function () {
      parseJsonRelaxed("{a: 2e3, b: 1.5E-2, c: -0.5, d: 0}").should.deep.equal({
        a: 2000,
        b: 0.015,
        c: -0.5,
        d: 0,
      });
    });

    it("accepts true, false, and null values", function () {
      parseJsonRelaxed("{a: true, b: false, c: null}").should.deep.equal({
        a: true,
        b: false,
        c: null,
      });
    });

    it("parses nested relaxed structures", function () {
      parseJsonRelaxed(
        "{todos: [{id: 1, text: 'buy milk',}, {id: 2, text: 'call'}], done: false}",
      ).should.deep.equal({
        todos: [
          { id: 1, text: "buy milk" },
          { id: 2, text: "call" },
        ],
        done: false,
      });
    });
  });

  describe("conservative rejections", function () {
    it("rejects bareword values instead of coercing them to strings", function () {
      (() => parseJsonRelaxed("{a: hello}")).should.throw(/unquoted value/);
    });

    it("rejects tokens that are neither literals nor identifiers", function () {
      (() => parseJsonRelaxed("{a: +1}")).should.throw(/invalid token/);
    });

    it("rejects unexpected characters", function () {
      (() => parseJsonRelaxed("{a: @}")).should.throw(/unexpected character/);
    });

    it("rejects a lone slash", function () {
      (() => parseJsonRelaxed("{a: /}")).should.throw(/unexpected character/);
    });

    it("rejects unterminated strings", function () {
      (() => parseJsonRelaxed('{a: "x')).should.throw(/unterminated string/);
    });

    it("rejects an unterminated block comment (truncated JSON)", function () {
      (() => parseJsonRelaxed("{a: 1 /* oops")).should.throw();
    });

    it("rejects comment-only input", function () {
      (() => parseJsonRelaxed("// nothing")).should.throw();
    });

    it("rejects reserved words as unquoted keys", function () {
      (() => parseJsonRelaxed("{true: 1}")).should.throw();
    });

    it("rejects truncated structures", function () {
      (() => parseJsonRelaxed("{a: 1, b:")).should.throw();
    });
  });
});

describe("parseRulesRelaxed: rules-tag dialect", function () {
  describe("strict fast path", function () {
    it("parses strict JSON", function () {
      parseRulesRelaxed('{"Title": "#hero"}').should.deep.equal({
        Title: "#hero",
      });
    });
  });

  describe("selector barewords", function () {
    it("turns unquoted selector values into strings", function () {
      parseRulesRelaxed("{Title: #hero .quote}").should.deep.equal({
        Title: "#hero .quote",
      });
    });

    it("turns plain identifier values into strings", function () {
      parseRulesRelaxed("{Title: h2}").should.deep.equal({ Title: "h2" });
    });

    it("keeps known pseudo-selectors inside a value", function () {
      parseRulesRelaxed(
        "{a: #t:first .x, b: .item:last-child}",
      ).should.deep.equal({ a: "#t:first .x", b: ".item:last-child" });
    });

    it("treats @-prefixed barewords as selectors", function () {
      parseRulesRelaxed("{a: @attr}").should.deep.equal({ a: "@attr" });
    });

    it("parses nested rule objects", function () {
      parseRulesRelaxed(
        "{Books: {selector: .book, fields: {Title: h2, Price: .price}}}",
      ).should.deep.equal({
        Books: {
          selector: ".book",
          fields: { Title: "h2", Price: ".price" },
        },
      });
    });
  });

  describe("attribute selectors vs arrays", function () {
    it("treats [letter...] as an attribute selector string", function () {
      parseRulesRelaxed("{a: [data-role]}").should.deep.equal({
        a: "[data-role]",
      });
    });

    it("treats [ whitespace letter...] as an attribute selector string", function () {
      parseRulesRelaxed("{a: [ foo]}").should.deep.equal({ a: "[ foo]" });
    });

    it("handles single-quoted values inside attribute selectors", function () {
      parseRulesRelaxed("{a: [data-t='x y']}").should.deep.equal({
        a: "[data-t='x y']",
      });
    });

    it("throws on double-quoted values inside attribute selectors", function () {
      // Selector text is emitted raw into the JSON string, so inner double
      // quotes break it — same behavior as the original parser.
      (() => parseRulesRelaxed('{a: [data-t="x y"]}')).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws when an attribute selector value has an escaped quote", function () {
      // The selector text is emitted raw, so \' becomes an invalid JSON
      // escape — same behavior as the original hyper-html-api parser.
      (() => parseRulesRelaxed("{a: [t='p\\'q']}")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws on an unterminated attribute selector", function () {
      // The selector scan eats the closing brace looking for "]".
      (() => parseRulesRelaxed("{a: [x}")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("parses quoted-string arrays as arrays", function () {
      parseRulesRelaxed('{b: ["x"]}').should.deep.equal({ b: ["x"] });
    });

    it("parses bareword array elements only with a trailing comma", function () {
      // A bareword scan doesn't stop at "]", so "2]" glues into one token —
      // same behavior as the original parser. The trailing comma avoids it.
      parseRulesRelaxed("{a: [1, 2,]}").should.deep.equal({ a: [1, 2] });
      (() => parseRulesRelaxed("{a: [1, 2]}")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });
  });

  describe("literals and strings", function () {
    it("parses numbers, booleans, and null", function () {
      parseRulesRelaxed(
        "{a: -1.5, b: true, c: false, d: null}",
      ).should.deep.equal({ a: -1.5, b: true, c: false, d: null });
    });

    it("parses double-quoted strings with spaces", function () {
      parseRulesRelaxed('{a: "x y"}').should.deep.equal({ a: "x y" });
    });

    it("handles escaped quotes in double-quoted strings", function () {
      parseRulesRelaxed('{a: "s\\"q"}').should.deep.equal({ a: 's"q' });
    });

    it("re-quotes single-quoted strings", function () {
      parseRulesRelaxed("{a: 'don\\'t', b: 'say \"hi\"'}").should.deep.equal({
        a: "don't",
        b: 'say "hi"',
      });
    });

    it("keeps already-escaped double quotes inside single-quoted strings", function () {
      parseRulesRelaxed("{a: 'x\\\"y'}").should.deep.equal({ a: 'x"y' });
    });

    it("drops trailing commas in objects", function () {
      parseRulesRelaxed("{a: 1,}").should.deep.equal({ a: 1 });
    });
  });

  describe("errors", function () {
    it("throws on unknown pseudo-selector colons", function () {
      (() => parseRulesRelaxed("{a: #t:foo}")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws on a bracket that opens nothing", function () {
      (() => parseRulesRelaxed("{a: [")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws on an unterminated single-quoted string", function () {
      (() => parseRulesRelaxed("{a: 'x")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws on a trailing comma after the root", function () {
      (() => parseRulesRelaxed("{a: 1},")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });

    it("throws on empty input", function () {
      (() => parseRulesRelaxed("")).should.throw(
        /Invalid extraction rules syntax/,
      );
    });
  });
});
