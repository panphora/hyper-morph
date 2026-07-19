import { mergeJson, mergeScriptText } from "../src/hyper-morph-json-merge.js";

describe("mergeJson: three-way JSON merge", function () {
  describe("core rule", function () {
    it("returns the shared value when both sides made the same change", function () {
      mergeJson({ a: 1 }, { a: 2 }, { a: 2 }).should.deep.equal({ a: 2 });
    });

    it("takes remote when only remote changed", function () {
      mergeJson({ a: 1 }, { a: 1 }, { a: 2 }).should.deep.equal({ a: 2 });
    });

    it("takes local when only local changed", function () {
      mergeJson({ a: 1 }, { a: 2 }, { a: 1 }).should.deep.equal({ a: 2 });
    });

    it("keeps both sides' changes to different keys", function () {
      mergeJson(
        { a: 1, b: 1 },
        { a: 2, b: 1 },
        { a: 1, b: 2 },
      ).should.deep.equal({ a: 2, b: 2 });
    });

    it("resolves a same-key conflict remote-wins", function () {
      mergeJson({ a: 1 }, { a: 2 }, { a: 3 }).should.deep.equal({ a: 3 });
    });

    it("merges nested objects recursively", function () {
      mergeJson(
        { o: { x: 1, y: 1 }, z: 1 },
        { o: { x: 2, y: 1 }, z: 1 },
        { o: { x: 1, y: 3 }, z: 2 },
      ).should.deep.equal({ o: { x: 2, y: 3 }, z: 2 });
    });

    it("resolves a type conflict (object vs scalar) remote-wins", function () {
      mergeJson({ a: 1 }, { a: { x: 1 } }, { a: "s" }).should.deep.equal({
        a: "s",
      });
    });

    it("recurses with an empty base when base had a scalar where both sides now have objects", function () {
      mergeJson({ o: 5 }, { o: { x: 1 } }, { o: { y: 2 } }).should.deep.equal({
        o: { x: 1, y: 2 },
      });
    });

    it("merges arrays where base had a scalar", function () {
      mergeJson({ o: 5 }, { o: [1] }, { o: [2] }).should.deep.equal({
        o: [1, 2],
      });
    });
  });

  describe("deletions", function () {
    it("propagates a local deletion when remote left the key unchanged", function () {
      mergeJson({ a: 1, b: 1 }, { b: 1 }, { a: 1, b: 2 }).should.deep.equal({
        b: 2,
      });
    });

    it("remote deletion beats a local edit", function () {
      mergeJson({ a: 1, b: 1 }, { a: 2, b: 1 }, { b: 2 }).should.deep.equal({
        b: 2,
      });
    });

    it("remote edit beats a local deletion", function () {
      mergeJson({ a: 1, z: 1 }, { z: 2 }, { a: 2, z: 1 }).should.deep.equal({
        a: 2,
        z: 2,
      });
    });

    it("keeps a key deleted by both sides deleted", function () {
      mergeJson({ a: 1, b: 2 }, { a: 2 }, { a: 3 }).should.deep.equal({
        a: 3,
      });
    });
  });

  describe("additions", function () {
    it("keeps a local-only addition", function () {
      mergeJson({}, { n: 1 }, {}).should.deep.equal({ n: 1 });
    });

    it("takes remote when both added the same scalar key differently", function () {
      mergeJson({}, { n: 1 }, { n: 2 }).should.deep.equal({ n: 2 });
    });

    it("recurses when both added the same key as objects", function () {
      mergeJson({}, { n: { x: 1 } }, { n: { y: 2 } }).should.deep.equal({
        n: { x: 1, y: 2 },
      });
    });
  });

  describe("no base (two-way degradation)", function () {
    it("keeps local additions, applies remote changes, never deletes", function () {
      mergeJson(undefined, { a: 1, b: 1 }, { b: 2, c: 3 }).should.deep.equal({
        a: 1,
        b: 2,
        c: 3,
      });
    });
  });

  describe("prototype safety", function () {
    it("treats __proto__ as a plain own key and never pollutes prototypes", function () {
      const local = JSON.parse('{"__proto__": {"polluted": 1}, "a": 1}');
      const remote = JSON.parse('{"a": 2}');
      const merged = mergeJson({}, local, remote);
      merged.a.should.equal(2);
      Object.getOwnPropertyDescriptor(
        merged,
        "__proto__",
      ).value.should.deep.equal({ polluted: 1 });
      Object.getPrototypeOf(merged).should.equal(Object.prototype);
      (({}).polluted === undefined).should.equal(true);
    });
  });

  describe("keyed arrays", function () {
    it("merges element content per id", function () {
      mergeJson(
        [
          { id: 1, t: "a" },
          { id: 2, t: "b" },
        ],
        [
          { id: 1, t: "a2" },
          { id: 2, t: "b" },
        ],
        [
          { id: 1, t: "a" },
          { id: 2, t: "b2" },
        ],
      ).should.deep.equal([
        { id: 1, t: "a2" },
        { id: 2, t: "b2" },
      ]);
    });

    it("combines a local addition with a remote deletion", function () {
      mergeJson(
        [{ id: 1 }, { id: 2 }],
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        [{ id: 2 }],
      ).should.deep.equal([{ id: 2 }, { id: 3 }]);
    });

    it("remote deletion of a locally-edited item wins", function () {
      mergeJson([{ id: 1, v: 1 }], [{ id: 1, v: 2 }], []).should.deep.equal([]);
    });

    it("drops an item the local side deleted when remote left it unchanged", function () {
      mergeJson(
        [
          { id: 1, v: 1 },
          { id: 2, v: 1 },
        ],
        [{ id: 2, v: 2 }],
        [
          { id: 1, v: 1 },
          { id: 2, v: 1 },
          { id: 3, v: 1 },
        ],
      ).should.deep.equal([
        { id: 2, v: 2 },
        { id: 3, v: 1 },
      ]);
    });

    it("merges items both sides added under the same id", function () {
      mergeJson([], [{ id: 1, x: 1 }], [{ id: 1, y: 2 }]).should.deep.equal([
        { id: 1, x: 1, y: 2 },
      ]);
    });

    it("uses caller keyCandidates before the built-ins", function () {
      const base = [{ taskId: "t1", done: false }];
      const local = [
        { taskId: "t1", done: true },
        { taskId: "t2", done: false },
      ];
      const remote = [
        { taskId: "t1", done: false },
        { taskId: "t3", done: false },
      ];
      mergeJson(base, local, remote, {
        keyCandidates: ["taskId"],
      }).should.deep.equal([
        { taskId: "t1", done: true },
        { taskId: "t2", done: false },
        { taskId: "t3", done: false },
      ]);
      // Without the hint no candidate qualifies: remote wins wholesale.
      mergeJson(base, local, remote).should.deep.equal(remote);
    });
  });

  describe("array identity inference", function () {
    it("rejects a key with duplicate values", function () {
      const remote = [{ id: 1, v: 9 }];
      mergeJson(
        [
          { id: 1, v: 1 },
          { id: 1, v: 2 },
        ],
        [
          { id: 1, v: 1 },
          { id: 1, v: 3 },
        ],
        remote,
      ).should.deep.equal(remote);
    });

    it("rejects a key with non-primitive values", function () {
      const remote = [{ id: { deep: 2 } }];
      mergeJson(
        [{ id: { deep: 1 } }],
        [{ id: { deep: 1 }, extra: 1 }],
        remote,
      ).should.deep.equal(remote);
    });

    it("rejects a key missing on some elements", function () {
      const remote = [{ id: 1 }, { other: 3 }];
      mergeJson(
        [{ id: 1 }, { other: 1 }],
        [{ id: 1 }, { other: 2 }],
        remote,
      ).should.deep.equal(remote);
    });

    it("falls back to remote for unkeyed object arrays when both sides changed", function () {
      const remote = [{ title: "B" }];
      mergeJson(
        [{ title: "A" }],
        [{ title: "A", enabled: true }],
        remote,
      ).should.deep.equal(remote);
    });

    it("falls back to remote for mixed arrays", function () {
      const remote = ["x", { id: 2 }];
      mergeJson(["x", { id: 1 }], ["y", { id: 1 }], remote).should.deep.equal(
        remote,
      );
    });

    it("falls back to remote for primitive arrays with duplicate values", function () {
      const remote = [1, 3];
      mergeJson([1, 2], [1, 2, 2], remote).should.deep.equal(remote);
    });

    it('keeps 1 and "1" distinct as identities', function () {
      mergeJson([1], [1, "1"], [1, 2]).should.deep.equal([1, "1", 2]);
    });
  });

  describe("array ordering", function () {
    it("takes remote's order and anchors a local insertion (research example)", function () {
      mergeJson(
        ["a", "b", "c"],
        ["a", "x", "b", "c"],
        ["c", "a", "b"],
      ).should.deep.equal(["c", "a", "x", "b"]);
    });

    it("walks past non-surviving neighbors to find an anchor", function () {
      mergeJson(
        ["a", "d", "b"],
        ["a", "d", "x", "b"],
        ["a", "b"],
      ).should.deep.equal(["a", "x", "b"]);
    });

    it("inserts at the front when the local addition has no anchor", function () {
      mergeJson(["a"], ["x", "a"], ["a", "b"]).should.deep.equal([
        "x",
        "a",
        "b",
      ]);
    });
  });
});

describe("mergeScriptText: text-level merge with degradation", function () {
  it("serializes a genuine merge as 2-space JSON", function () {
    const { text, warnings } = mergeScriptText(
      '{"a": 1, "b": 1}',
      '{"a": 2, "b": 1}',
      '{"a": 1, "b": 2}',
    );
    text.should.equal('{\n  "a": 2,\n  "b": 2\n}');
    warnings.should.deep.equal([]);
  });

  it("adopts remote's text verbatim when the merge equals remote", function () {
    const remoteText = '{ "a" :   2 }';
    const { text } = mergeScriptText('{"a": 1}', '{ "a": 1 }', remoteText);
    text.should.equal(remoteText);
  });

  it("keeps local's text verbatim when the merge equals local", function () {
    const localText = '{ "a": 2 }';
    const { text } = mergeScriptText('{"a": 1}', localText, '{"a": 1}');
    text.should.equal(localText);
  });

  it("invalid local: takes remote's text and warns", function () {
    const { text, warnings } = mergeScriptText('{"a": 1}', "{nope", '{"a": 2}');
    text.should.equal('{"a": 2}');
    warnings.length.should.equal(1);
    warnings[0].should.contain("local");
  });

  it("invalid remote: keeps local's text and warns", function () {
    const { text, warnings } = mergeScriptText('{"a": 1}', '{"a": 2}', "{nope");
    text.should.equal('{"a": 2}');
    warnings.length.should.equal(1);
    warnings[0].should.contain("remote");
  });

  it("invalid local and remote: takes remote's text and warns twice", function () {
    const { text, warnings } = mergeScriptText('{"a": 1}', "{no", "{nope");
    text.should.equal("{nope");
    warnings.length.should.equal(2);
  });

  it("invalid base: two-way merge with a warning", function () {
    const { text, warnings } = mergeScriptText("nope", '{"a": 1}', '{"b": 2}');
    JSON.parse(text).should.deep.equal({ a: 1, b: 2 });
    warnings.length.should.equal(1);
    warnings[0].should.contain("base");
  });

  it("absent base: two-way merge, silent", function () {
    const { text, warnings } = mergeScriptText(
      undefined,
      '{"a": 1}',
      '{"b": 2}',
    );
    JSON.parse(text).should.deep.equal({ a: 1, b: 2 });
    warnings.should.deep.equal([]);
  });

  it("uses a caller-supplied parser for all three sides", function () {
    const parse = (text) => JSON.parse(text.replace(/'/g, '"'));
    const { text, warnings } = mergeScriptText(
      "{'a': 1, 'b': 1}",
      "{'a': 2, 'b': 1}",
      "{'a': 1, 'b': 2}",
      { parse },
    );
    JSON.parse(text).should.deep.equal({ a: 2, b: 2 });
    warnings.should.deep.equal([]);
  });

  it("parses relaxed JSON by default (unquoted keys, single quotes, trailing commas, comments)", function () {
    const { text, warnings } = mergeScriptText(
      "{items: ['a'], // base\n}",
      "{items: ['a', 'b'],}",
      "{items: ['a', 'c'], /* remote */}",
    );
    JSON.parse(text).should.deep.equal({ items: ["a", "b", "c"] });
    warnings.should.deep.equal([]);
  });

  it("still degrades on bareword values (no silent coercion)", function () {
    const { text, warnings } = mergeScriptText(
      '{"a": 1}',
      '{"a": 2}',
      "{a: oops}",
    );
    text.should.equal('{"a": 2}');
    warnings.should.have.length(1);
  });

  it("passes keyCandidates through to array merging", function () {
    const { text } = mergeScriptText(
      '[{"k9": "a", "v": 1}]',
      '[{"k9": "a", "v": 2}]',
      '[{"k9": "a", "v": 1}, {"k9": "b", "v": 1}]',
      { keyCandidates: ["k9"] },
    );
    JSON.parse(text).should.deep.equal([
      { k9: "a", v: 2 },
      { k9: "b", v: 1 },
    ]);
  });
});
