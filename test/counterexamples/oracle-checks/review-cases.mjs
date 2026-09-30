// Rows from the two-seat review of oracle v2 (2026-09-30): each is a case, an
// optional damage to the real engine's output, the statuses that count as
// right, and an optional hook that captures a live node before the merge.
import { OK_PASS, MUST_FAIL } from "./bench-cases.mjs";

const q = (sel) => (doc) => doc.querySelector(sel);

const INVENTED = {
  shape: "dirty",
  identity: "authored",
  base: '<p id="P">alpha</p>',
  local: '<p id="P" title="local">alpha</p>',
  remote: '<p id="P">alpha beta</p>',
};
const LOCAL_WORD = {
  shape: "dirty",
  identity: "authored",
  base: '<p id="a">one two</p><p id="b">x</p>',
  local: '<p id="a">one two LOCALW</p><p id="b">x</p>',
  remote: '<p id="a">one two</p><p id="b">x REMW</p>',
};
const HUNKS = (conflicts) => ({
  shape: "dirty",
  identity: "authored",
  ...(conflicts ? { options: { conflicts } } : {}),
  base: '<p id="a">one two three</p>',
  local: '<p id="a">one LOC three</p>',
  remote: '<p id="a">one REM three</p>',
});
const MOVE_ONE = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p id="A">one</p><p id="B">two</p></main>',
  local: '<main id="M"><p id="A"></p><p id="B">two one</p></main>',
  remote: '<main id="M"><p id="A">one</p><p id="B">two</p></main>',
};
const MOVE_TWO = {
  shape: "dirty",
  identity: "authored",
  base: '<p id="a">keep MOVED</p><p id="b">stay</p>',
  local: '<p id="a">keep</p><p id="b">stay MOVED</p>',
  remote: '<p id="a">keep MOVED</p><p id="b">stay</p><p id="c">new</p>',
};
const BOTH_MOVE = {
  shape: "dirty",
  identity: "authored",
  base: '<p id="a">keep MOVED</p><p id="b">stay</p><p id="c">rest</p>',
  local: '<p id="a">keep</p><p id="b">stay MOVED</p><p id="c">rest</p>',
  remote: '<p id="a">keep</p><p id="b">stay</p><p id="c">rest MOVED</p>',
};
const RELABEL = {
  shape: "dirty",
  identity: "plain",
  base: '<p sid="x">old</p><p sid="k">keep</p>',
  local: '<p sid="x">old</p><p sid="k">keep LOCALW</p>',
  remote: '<p sid="y">new</p><p sid="k">keep</p>',
};
const NEW_ID = (conflicts, local) => ({
  shape: "dirty",
  identity: "authored",
  options: { conflicts },
  base: '<main id="M"></main>',
  local: `<main id="M"><p id="P">${local}</p></main>`,
  remote: '<main id="M"><p id="P">remote</p></main>',
});

const textConflict = (sel, fields) => (d, r) => {
  const el = q(sel)(d);
  el.textContent = fields.resolved;
  return {
    conflicts: [
      ...(r.conflicts || []),
      { kind: "text", node: el, recovery: {}, ...fields },
    ],
  };
};

const CORE_ROWS = [
  [
    "Review: invented conflict hides remote's word: real engine",
    INVENTED,
    null,
    OK_PASS,
  ],
  [
    "Review: invented conflict hides remote's word",
    INVENTED,
    textConflict("#P", {
      base: "alpha",
      local: "alpha",
      remote: "alpha beta",
      resolved: "alpha",
    }),
    MUST_FAIL,
  ],
  [
    "Review: fabricated conflict hides local's word",
    LOCAL_WORD,
    textConflict("#a", {
      base: "one two",
      local: "one two LOCALW",
      remote: "one two",
      resolved: "one two",
    }),
    MUST_FAIL,
  ],
  ...[undefined, "local"].map((p) => [
    `Review: real text conflict (${p || "remote"}): real engine`,
    HUNKS(p),
    null,
    OK_PASS,
  ]),
  [
    "Review: real text conflict (both): frozen engine glues the hunks into LOCREM",
    HUNKS("both"),
    null,
    MUST_FAIL,
  ],
  [
    "Review: real text conflict (both): both hunks kept, spaced",
    HUNKS("both"),
    (d) => {
      d.querySelector("#a").textContent = "one LOC REM three";
    },
    OK_PASS,
  ],
  [
    "Review: real text conflict, both hunks dropped",
    HUNKS(),
    (d) => {
      q("#a")(d).textContent = "one three";
    },
    MUST_FAIL,
  ],
  [
    "Review: real text conflict, local hunk kept under the remote policy",
    HUNKS(),
    (d) => {
      q("#a")(d).textContent = "one LOC three";
    },
    MUST_FAIL,
  ],
  [
    "Review: local moves a word, remote unchanged: real engine",
    MOVE_ONE,
    null,
    OK_PASS,
  ],
  [
    "Review: local moves a word, output keeps both copies",
    MOVE_ONE,
    (d) => {
      q("#A")(d).textContent = "one";
    },
    MUST_FAIL,
  ],
  [
    "Review: local moves a word, remote adds a paragraph: real engine",
    MOVE_TWO,
    null,
    OK_PASS,
  ],
  [
    "Review: local moves a word, output keeps both copies (remote adds a paragraph)",
    MOVE_TWO,
    (d) => {
      q("#a")(d).textContent = "keep MOVED";
    },
    MUST_FAIL,
  ],
  [
    "Review: both sides move one word to different places: frozen engine drops #a and loses stay",
    BOTH_MOVE,
    null,
    MUST_FAIL,
  ],
  [
    "Review: both sides move one word to different places: both moves kept",
    BOTH_MOVE,
    (d, r, a) => {
      d.body.prepend(a);
      a.textContent = "keep";
      d.getElementById("b").textContent = "stay MOVED";
      d.getElementById("c").textContent = "rest MOVED";
    },
    OK_PASS,
    (live) => live.getElementById("a"),
  ],
  ["Review: plain identity: real engine", RELABEL, null, OK_PASS],
  [
    "Review: plain identity: live x reused as remote's y and reported as y",
    RELABEL,
    (d, r, x) => {
      const y = [...d.body.children].find(
        (e) => e.textContent === "new" && e !== x,
      );
      if (!y || x.isConnected) return;
      x.textContent = "new";
      y.replaceWith(x);
      return {
        identities: [
          ...(r.identities || []).filter(([el]) => el !== y),
          [x, "y"],
        ],
      };
    },
    MUST_FAIL,
    (live) => live.body.firstElementChild,
  ],
  ...["remote", "local", "both"].flatMap((p) => [
    [
      `Review: same id inserted on both sides (${p}): real engine`,
      NEW_ID(p, "local"),
      null,
      OK_PASS,
    ],
    [
      `Review: same id inserted on both sides with formatting (${p}): real engine`,
      NEW_ID(p, "local <b>bold</b>"),
      null,
      OK_PASS,
    ],
  ]),
];

const INSERTS = (base) => ({
  shape: "dirty",
  identity: "authored",
  base: `<ul id="M">${base}</ul>`,
  local: `<ul id="M">${base}<li id="B">two</li><li id="C">three</li></ul>`,
  remote: `<ul id="M">${base}</ul><p id="z">zz</p>`,
});
const REMOTE_IMG = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p id="A">hello</p></main><aside id="N"></aside>',
  local: '<main id="M"><p id="A">hello local</p></main><aside id="N"></aside>',
  remote:
    '<main id="M"><p id="A">hello</p><img id="B" src="cat.png"></main><aside id="N"></aside>',
};
const swapBC = (d) => {
  const m = d.querySelector("#M");
  m.insertBefore(d.querySelector("#C"), d.querySelector("#B"));
};

export const ORDER_ROWS = [
  ...['<li id="A">one</li>', ""].flatMap((base) => [
    [
      `Review: two local insertions${base ? "" : " into an empty list"}: real engine`,
      INSERTS(base),
      null,
      OK_PASS,
    ],
    [
      `Review: two local insertions${base ? "" : " into an empty list"} reversed`,
      INSERTS(base),
      swapBC,
      MUST_FAIL,
    ],
  ]),
  ["Review: remote inserts an image: real engine", REMOTE_IMG, null, OK_PASS],
  [
    "Review: remote's image lands in the wrong parent",
    REMOTE_IMG,
    (d) => {
      d.querySelector("#N").append(d.querySelector("#B"));
    },
    MUST_FAIL,
  ],
  [
    "Review: remote's image becomes a div",
    REMOTE_IMG,
    (d) => {
      d.querySelector("#B").outerHTML = '<div id="B" src="cat.png"></div>';
    },
    MUST_FAIL,
  ],
];

const MAY_DEFER_ = ["counterexample", "undecidable"];
const TWO_P = (localSecond, remoteZ) => ({
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p>alpha</p><p>beta</p></main><div id="z">zz</div>',
  local: `<main id="M"><p>alpha</p><p${localSecond}</p></main><div id="z">zz</div>`,
  remote: `<main id="M"><p>alpha</p><p>beta</p></main><div id="z">zz${remoteZ}</div>`,
});
const WORDS = TWO_P(">beta LOCALW", " REMW");
const HOT = TWO_P(' class="hot">beta', " REMW");
const COMMON = {
  shape: "dirty",
  identity: "default",
  base: "<p>the cat and the dog</p><p>the end of the day</p><p>the last of the words</p>",
  local:
    "<p>the big cat and the dog</p><p>the end of the day</p><p>the last of the words</p>",
  remote:
    "<p>the cat and the dog</p><p>the end of the day</p><p>the very last of the words</p>",
};
const SAME = {
  shape: "dirty",
  identity: "default",
  base: "<p>Same</p><p>Same</p><div>x</div>",
  local: "<p>Same</p><p>Same EDIT</p><div>x</div>",
  remote: "<p>Same</p><p>Same</p><div>x REMW</div>",
};
const LIST = {
  shape: "dirty",
  identity: "authored",
  base: '<ul id="L"><li>A</li><li>B</li></ul><p id="z">zz</p>',
  local: '<ul id="L"><li>A</li><li>B</li><li>NEW</li></ul><p id="z">zz</p>',
  remote: '<ul id="L"><li>A</li><li>B</li></ul><p id="z">zz REMW</p>',
};

export const ANON_ROWS = [
  [
    "Review: local edits an unidentified paragraph: real engine",
    WORDS,
    null,
    OK_PASS,
  ],
  [
    "Review: local's word moved to the other unidentified paragraph",
    WORDS,
    (d) => {
      const ps = d.querySelectorAll("#M p");
      ps[0].textContent = "alpha LOCALW";
      ps[1].textContent = "beta";
    },
    MUST_FAIL,
  ],
  [
    "Review: default identity, both sides edit: real engine",
    COMMON,
    null,
    OK_PASS,
  ],
  [
    "Review: default identity, remote's word moved to the first paragraph",
    COMMON,
    (d) => {
      const ps = d.querySelectorAll("p");
      ps[2].textContent = ps[2].textContent.replace("very ", "");
      ps[0].textContent = "the very " + ps[0].textContent.slice(4);
    },
    MUST_FAIL,
  ],
  [
    "Review: identical paragraphs, local edits the second: real engine",
    SAME,
    null,
    OK_PASS,
  ],
  [
    "Review: identical paragraphs, local's edit lands on the first",
    SAME,
    (d) => {
      const ps = d.querySelectorAll("p");
      ps[0].textContent = "Same EDIT";
      ps[1].textContent = "Same";
    },
    MUST_FAIL,
  ],
  [
    "Review: local adds a class to an unidentified paragraph: real engine",
    HOT,
    null,
    OK_PASS,
  ],
  [
    "Review: local's class on an unidentified paragraph dropped",
    HOT,
    (d) => d.querySelectorAll("#M p")[1].removeAttribute("class"),
    MAY_DEFER_,
  ],
  [
    "Review: local's class moved to the other unidentified paragraph",
    HOT,
    (d) => {
      const ps = d.querySelectorAll("#M p");
      ps[1].removeAttribute("class");
      ps[0].className = "hot";
    },
    MAY_DEFER_,
  ],
  [
    "Review: local appends an unidentified item: real engine",
    LIST,
    null,
    OK_PASS,
  ],
  [
    "Review: local's unidentified item moved to the front",
    LIST,
    (d) => {
      const ul = d.getElementById("L");
      ul.prepend([...ul.children].find((x) => x.textContent === "NEW"));
    },
    MAY_DEFER_,
  ],
  [
    "Review: unidentified list reordered",
    LIST,
    (d) => {
      const ul = d.getElementById("L");
      ul.append(ul.children[0]);
    },
    MAY_DEFER_,
  ],
];

const ANY = ["passes", "undecidable", "counterexample"];
const PLAIN_RELABEL = {
  shape: "dirty",
  identity: "plain",
  base: '<p sid="x">old</p><p sid="k">keep</p>',
  local: '<p sid="x">old</p><p sid="k">keep LOCALW</p>',
  remote: '<p sid="y">new</p><p sid="k">keep</p>',
};
const INSERTED = (local, remote, options) => ({
  shape: "dirty",
  identity: "authored",
  ...(options ? { options } : {}),
  base: '<main id="M"></main>',
  local: `<main id="M"><div id="P">${local}</div></main>`,
  remote: `<main id="M"><div id="P">${remote}</div></main>`,
});

export const RE_ROWS = [
  [
    "Review 2: plain live x relabelled as y through provenance",
    PLAIN_RELABEL,
    (d, r, pre) => {
      const y = [...d.body.children].find(
        (e) => e.textContent === "new" && e !== pre.x,
      );
      if (!y || pre.x.isConnected) return;
      pre.x.textContent = "new";
      y.replaceWith(pre.x);
      const provenance = new Map(r.provenance || []);
      provenance.set(pre.x, { remote: pre.remote });
      return {
        identities: [
          ...(r.identities || []).filter(([el]) => el !== y && el !== pre.x),
          [pre.x, "x"],
        ],
        provenance,
      };
    },
    MUST_FAIL,
    (live, o) => ({
      x: live.body.firstElementChild,
      remote: o.remote.body.firstElementChild,
    }),
  ],
  [
    "Review 2: unsettled copies with leaves (local policy): real engine",
    INSERTED("local <b>bold</b>", 'remote <img src="a"><img src="b">', {
      conflicts: "local",
    }),
    null,
    OK_PASS,
  ],
  [
    "Review 2: unsettled copies with leaves: real engine",
    INSERTED("local <b>bold</b>", 'remote <img src="a"><img src="b">'),
    null,
    OK_PASS,
  ],
  [
    "Review 2: unsettled copy with a nested id: real engine",
    INSERTED('local <b id="Q">bold</b>', "remote"),
    null,
    OK_PASS,
  ],
  [
    "Review 2: unsettled copy with a nested paragraph id: real engine",
    INSERTED('<p id="Q">hello</p> local', "<b>remote</b> words"),
    null,
    OK_PASS,
  ],
  [
    "Review 2: opposite nesting of two new ids does not crash",
    {
      shape: "dirty",
      identity: "authored",
      base: '<main id="M"></main>',
      local: '<main id="M"><div id="A"><div id="B">local</div></div></main>',
      remote: '<main id="M"><div id="B"><div id="A">remote</div></div></main>',
    },
    null,
    ANY,
  ],
  [
    "Review 2: identified inline span between two words survives edit-vs-delete: real engine",
    {
      shape: "dirty",
      identity: "authored",
      base: '<div id="M"><p>foo<span id="s"></span>bar</p><p>other</p></div>',
      local: '<div id="M"><p>foobar</p><p>other</p></div>',
      remote:
        '<div id="M"><p>foo<span id="s" class="x"></span>bar</p><p>other</p></div>',
    },
    null,
    OK_PASS,
  ],
  [
    "Review 2: insertions after anchors the other side reordered: real engine",
    {
      shape: "dirty",
      identity: "authored",
      base: '<ul id="M"><li id="A">a</li><li id="E">e</li></ul>',
      local:
        '<ul id="M"><li id="A">a</li><li id="B">b</li><li id="E">e</li><li id="C">c</li></ul>',
      remote: '<ul id="M"><li id="E">e</li><li id="A">a</li></ul>',
    },
    null,
    OK_PASS,
  ],
];

const BOTH_SLOTS = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p>alpha beta gamma</p><p>one two three</p></main>',
  local:
    '<main id="M"><p>alpha LOCAL beta gamma</p><p>one LOCAL2 two three</p></main>',
  remote:
    '<main id="M"><p>alpha beta gamma REMOTE</p><p>one two three REMOTE2</p></main>',
};
const NEW_LIST = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"><p id="A">a</p></main>',
  local: '<main id="M"><p id="A">a LOCAL</p></main>',
  remote:
    '<main id="M"><p id="A">a</p><ul id="N"><li>one</li><li class="hot">two</li></ul></main>',
};
const SURVIVOR = {
  shape: "dirty",
  identity: "authored",
  base: '<div id="X"><p>alpha</p><p>beta</p></div><p id="z">z</p>',
  local: '<div id="X"><p>alpha</p><p>beta LOCALW</p></div><p id="z">z</p>',
  remote: '<p id="z">z REM</p>',
};
const DEEP = (depth) => ({
  shape: "dirty",
  identity: "authored",
  base: `<div id="M">${"<div>".repeat(depth)}x${"</div>".repeat(depth)}</div><p id="z">z</p>`,
  local: `<div id="M">${"<div>".repeat(depth)}x LOCAL${"</div>".repeat(depth)}</div><p id="z">z</p>`,
  remote: `<div id="M">${"<div>".repeat(depth)}x${"</div>".repeat(depth)}</div><p id="z">z REM</p>`,
});

export const ANON2_ROWS = [
  [
    "Review 2: both sides edit both unidentified paragraphs: real engine",
    BOTH_SLOTS,
    null,
    OK_PASS,
  ],
  [
    "Review 2: both sides edit both unidentified paragraphs, local's words swapped",
    BOTH_SLOTS,
    (d) => {
      const ps = d.querySelectorAll("#M p");
      ps[0].textContent = "alpha LOCAL2 beta gamma REMOTE";
      ps[1].textContent = "one LOCAL two three REMOTE2";
    },
    MAY_DEFER_,
  ],
  [
    "Review 2: remote inserts a list without item ids: real engine",
    NEW_LIST,
    null,
    OK_PASS,
  ],
  [
    "Review 2: remote's new list reversed",
    NEW_LIST,
    (d) => {
      const ul = d.getElementById("N");
      ul.append(ul.firstElementChild);
    },
    MAY_DEFER_,
  ],
  [
    "Review 2: remote's new list, class moved to the other item",
    NEW_LIST,
    (d) => {
      const lis = d.querySelectorAll("#N li");
      lis[1].removeAttribute("class");
      lis[0].className = "hot";
    },
    MAY_DEFER_,
  ],
  [
    "Review 2: edited container survives remote's delete: real engine",
    SURVIVOR,
    null,
    OK_PASS,
  ],
  [
    "Review 2: edited container survives remote's delete, local's word moved",
    SURVIVOR,
    (d) => {
      const ps = d.querySelectorAll("#X p");
      if (ps.length !== 2) return;
      ps[0].textContent = "alpha LOCALW";
      ps[1].textContent = "beta";
    },
    MAY_DEFER_,
  ],
  [
    "Review 2: fabricated conflict cannot excuse a moved word in an unidentified paragraph",
    WORDS,
    (d, r) => {
      const ps = d.querySelectorAll("#M p");
      ps[0].textContent = "alpha LOCALW";
      ps[1].textContent = "beta";
      return {
        conflicts: [
          ...(r.conflicts || []),
          {
            kind: "text",
            node: ps[1],
            base: "beta",
            local: "beta LOCALW",
            remote: "beta",
            resolved: "beta",
            recovery: {},
          },
        ],
      };
    },
    MUST_FAIL,
  ],
  [
    "Review 2: 30 nested unidentified divs: real engine",
    DEEP(30),
    null,
    OK_PASS,
  ],
];

const HEAD_PAGE = (word, insideA = "inside-a") =>
  '<!DOCTYPE html><html sid="R"><head sid="HD"><title sid="TT">base</title><noscript><meta name="' +
  insideA +
  '" content="keep"></noscript><noscript><meta name="inside-b" content="keep"></noscript></head><body sid="BD"><main sid="M"><p sid="P">' +
  word +
  "</p></main></body></html>";
const HEAD_NOSCRIPT = (insideA) => ({
  shape: "clean",
  identity: "plain",
  base: HEAD_PAGE("old", insideA),
  remote: HEAD_PAGE("NEW", insideA),
  live: { head: '<meta name="runtime" content="keep">' },
});
const REORDERED_ANCHORS = {
  shape: "dirty",
  identity: "authored",
  base: '<ul id="M"><li id="A">a</li><li id="E">e</li></ul>',
  local:
    '<ul id="M"><li id="A">a</li><li id="B">b</li><li id="C">c</li><li id="E">e</li></ul>',
  remote: '<ul id="M"><li id="E">e</li><li id="A">a</li></ul>',
};
const SCRIPT_SPAN = {
  shape: "dirty",
  identity: "authored",
  base: '<div id="M"><p>foo<span id="s"><script>secret</script></span>bar</p><p>other</p></div>',
  local: '<div id="M"><p>foobar</p><p>other</p></div>',
  remote:
    '<div id="M"><p>foo<span id="s" class="x"><script>secret</script></span>bar</p><p>other</p></div>',
};

export const ROUND3_ROWS = [
  [
    "Round 3: runtime head meta moved into a noscript",
    HEAD_NOSCRIPT("inside-a"),
    (d) => {
      const m = d.head.querySelector(':scope > meta[name="runtime"]');
      const ns = d.head.querySelector("noscript");
      if (!m || !ns) return;
      ns.append(m.cloneNode());
      m.remove();
    },
    MAY_DEFER_,
  ],
  [
    "Round 3: a nested meta equal to the runtime meta: real engine",
    HEAD_NOSCRIPT("runtime"),
    null,
    OK_PASS,
  ],
  [
    "Round 3: slot deletions of different occurrences beside a conflict elsewhere: real engine",
    {
      shape: "dirty",
      identity: "authored",
      base: '<main id="M"><p>w a w b</p><p>other</p></main><p id="X">w</p>',
      local: '<main id="M"><p>a w b</p><p>other</p></main><p id="X">lx</p>',
      remote: '<main id="M"><p>w a b</p><p>other</p></main><p id="X">rx</p>',
    },
    null,
    OK_PASS,
  ],
  [
    "Round 3: owner-level deletions of different occurrences under a conflict: real engine",
    {
      shape: "dirty",
      identity: "authored",
      base: '<p id="P">w a w b w</p>',
      local: '<p id="P">a w b lx</p>',
      remote: '<p id="P">w a b rx</p>',
    },
    null,
    OK_PASS,
  ],
  [
    "Round 3: one side's adjacent insertions swapped after the other side reordered the anchors",
    REORDERED_ANCHORS,
    (d) => {
      const b = d.getElementById("B"),
        c = d.getElementById("C");
      if (b && c && b.nextElementSibling === c) b.before(c);
    },
    MUST_FAIL,
  ],
  [
    "Round 3: both sides insert the same list: real engine",
    {
      shape: "dirty",
      identity: "authored",
      base: '<main id="M"><p id="A">a</p></main>',
      local:
        '<main id="M"><p id="A">a</p><ul id="N"><li>one</li><li class="hot">two</li></ul></main>',
      remote:
        '<main id="M"><p id="A">a</p><ul id="N"><li>one</li><li class="hot">two</li></ul></main>',
    },
    null,
    ["passes"],
  ],
  [
    "Round 3: local reorders words in a slot remote also edited (local policy): real engine",
    {
      shape: "dirty",
      identity: "authored",
      options: { conflicts: "local" },
      base: '<main id="M"><p>alpha beta gamma</p><p>one two three</p></main>',
      local:
        '<main id="M"><p>beta alpha gamma</p><p>one LOCAL two three</p></main>',
      remote:
        '<main id="M"><p>alpha alpha beta gamma</p><p>one two three REMOTE</p></main>',
    },
    null,
    OK_PASS,
  ],
  [
    "Round 3: conflict carried as HTML fragments (local policy): real engine",
    {
      shape: "dirty",
      identity: "authored",
      options: { conflicts: "local" },
      base: '<main id="M"><p>alpha beta gamma</p><p>alpha beta gamma</p></main>',
      local:
        '<main id="M"><p>alpha LOCAL beta gamma</p><p>alpha REMOTE gamma</p></main>',
      remote:
        '<main id="M"><p>alpha LOCAL gamma</p><p>alpha LOCAL beta gamma</p></main>',
    },
    null,
    OK_PASS,
  ],
  [
    "Round 3: identified span holding only a script survives edit-vs-delete",
    SCRIPT_SPAN,
    (d) => {
      const m = d.getElementById("M");
      if (d.getElementById("s")) return;
      m.firstElementChild.innerHTML =
        'foo<span id="s" class="x"><script>secret</script></span>bar';
    },
    OK_PASS,
  ],
];

const REBUILT_HEAD = {
  shape: "clean",
  identity: "authored",
  base: '<!DOCTYPE html><html><head><title>base</title></head><body><main id="M"><p id="P">old</p></main></body></html>',
  remote:
    '<!DOCTYPE html><html><head><title>base</title></head><body><main id="M"><p id="P">NEW</p></main></body></html>',
  live: { head: '<meta name="runtime" content="keep">' },
};

export const ROUND4_ROWS = [
  [
    "Round 4: engine rebuilds an unidentified head, keeping every child",
    REBUILT_HEAD,
    (d, r, pre) => {
      if (!pre.runtime.isConnected) d.head.append(pre.runtime);
      const head = d.head;
      const copy = head.cloneNode(false);
      copy.append(...head.childNodes);
      head.replaceWith(copy);
    },
    OK_PASS,
    (live) => ({
      runtime: live.head.querySelector(':scope > meta[name="runtime"]'),
    }),
  ],
  [
    "Round 4: identified span holding only a vetoed textarea survives edit-vs-delete",
    {
      shape: "dirty",
      identity: "authored",
      options: { hooks: { vetoAttr: "value" } },
      base: '<div id="M"><p>foo<span id="s"><textarea>typed</textarea></span>bar</p><p>other</p></div>',
      local: '<div id="M"><p>foobar</p><p>other</p></div>',
      remote:
        '<div id="M"><p>foo<span id="s" class="x"><textarea>typed</textarea></span>bar</p><p>other</p></div>',
    },
    (d) => {
      if (d.getElementById("s")) return;
      d.getElementById("M").firstElementChild.innerHTML =
        'foo<span id="s" class="x"><textarea>typed</textarea></span>bar';
    },
    OK_PASS,
  ],
  [
    "Round 4: a local word moved into another paragraph both sides edited: real engine",
    {
      shape: "dirty",
      identity: "authored",
      options: { conflicts: "both" },
      base: '<main id="M"><p>c w</p><p>w a c</p></main>',
      local: '<main id="M"><p>c w L2</p><p>w a a c</p></main>',
      remote: '<main id="M"><p>c R R2</p><p>w w a c</p></main>',
    },
    null,
    MUST_FAIL,
  ],
];

const RW = (local) => ({
  shape: "dirty",
  identity: "authored",
  options: { remoteWins: ".rw" },
  base: '<div class="rw" id="W"><p>alpha</p></div><p id="z">z</p>',
  local,
  remote: '<div class="rw" id="W"><p>alpha REMOTE</p></div><p id="z">z</p>',
});
const HEAD_DIFF = {
  shape: "clean",
  identity: "authored",
  base: '<!DOCTYPE html><html><head><title>old</title></head><body><main id="M"><p id="P">old</p></main></body></html>',
  remote:
    '<!DOCTYPE html><html><head><title>new</title></head><body><main id="M"><p id="P">NEW</p></main></body></html>',
  live: { head: '<meta name="runtime" content="keep">' },
};

export const RULE_ROWS = [
  [
    "Rule: remoteWins region keeps a local edit",
    RW('<div class="rw" id="W"><p>alpha LOCAL</p></div><p id="z">z</p>'),
    (d) => {
      const p = d.querySelector(".rw p");
      if (p) p.textContent = "alpha LOCAL REMOTE";
    },
    MUST_FAIL,
  ],
  [
    "Rule: remoteWins region lands as remote but the dropped local edit is not reported",
    RW('<div class="rw" id="W"><p>alpha LOCAL</p></div><p id="z">z</p>'),
    (d, r) => {
      const p = d.querySelector(".rw p");
      if (p) p.textContent = "alpha REMOTE";
      return { conflicts: [] };
    },
    MUST_FAIL,
  ],
  [
    "Rule: remoteWins region lands as remote and the dropped local edit is reported",
    RW('<div class="rw" id="W"><p>alpha LOCAL</p></div><p id="z">z</p>'),
    (d, r) => {
      const p = d.querySelector(".rw p");
      if (!p) return;
      p.textContent = "alpha REMOTE";
      return {
        conflicts: [
          ...(r.conflicts || []),
          {
            kind: "text",
            node: p.firstChild,
            base: "alpha",
            local: "alpha LOCAL",
            remote: "alpha REMOTE",
            resolved: "alpha REMOTE",
            recovery: {},
          },
        ],
      };
    },
    ["passes", "undecidable"],
  ],
  [
    "Rule: remoteWins region local left alone: real engine",
    RW('<div class="rw" id="W"><p>alpha</p></div><p id="z">z LOCAL</p>'),
    null,
    OK_PASS,
  ],
  [
    "Rule: runtime head tag dropped when the heads differ",
    HEAD_DIFF,
    (d) => d.head.querySelector('meta[name="runtime"]')?.remove(),
    MUST_FAIL,
  ],
  [
    "Rule: runtime head tag kept when the heads differ",
    HEAD_DIFF,
    (d) => {
      if (!d.head.querySelector('meta[name="runtime"]'))
        d.head.insertAdjacentHTML(
          "beforeend",
          '<meta name="runtime" content="keep">',
        );
    },
    OK_PASS,
  ],
];

const GLUED = {
  shape: "dirty",
  identity: "authored",
  base: '<div id="M"><p>he said "<em id="q">hi</em>" twice</p><p>other</p></div>',
  local: '<div id="M"><p>he said "" twice</p><p>other</p></div>',
  remote:
    '<div id="M"><p>he said "<em id="q" class="loud">hi</em>" twice</p><p>other</p></div>',
};
const SETTLED_OUTSIDE = {
  shape: "dirty",
  identity: "authored",
  base: '<main id="M"></main>',
  local: '<main id="M"><div id="P">local <b id="Q">bold</b></div></main>',
  remote: '<main id="M"><div id="P">remote</div><b id="Q">bold</b></main>',
};

export const FOLLOWUP_ROWS = [
  [
    "Follow-up: glued inline element kept where one side deleted it and the other edited it",
    GLUED,
    (d) => {
      if (d.getElementById("q")) return;
      d.getElementById("M").firstElementChild.innerHTML =
        'he said "<em id="q" class="loud">hi</em>" twice';
    },
    OK_PASS,
  ],
  [
    "Follow-up: id settled outside an unsettled copy is still required",
    SETTLED_OUTSIDE,
    (d) => d.getElementById("Q")?.remove(),
    MUST_FAIL,
  ],
];

const SIBLINGS = {
  shape: "dirty",
  identity: "plain",
  base: '<main><section><p sid="s0">same words</p></section><section><p sid="s1">same words</p></section><footer>old</footer></main>',
  local:
    '<main><section><p sid="s0">same words FIRST</p></section><section><p sid="s1">same words SECOND</p></section><footer>old</footer></main>',
  remote:
    '<main><section><p sid="s1">same words</p></section><section><p sid="s0">same words</p></section><footer>NEW</footer></main>',
};
const WORDS6 = (local) => ({
  shape: "dirty",
  identity: "authored",
  base: '<p id="P">one two three four five six</p><p id="z">z</p>',
  local: `<p id="P">${local}</p><p id="z">z</p>`,
  remote: '<p id="P">one two three four six</p><p id="z">z REM</p>',
});
const DROP_WITH_CONFLICT = (local) => (d, r) => {
  const p = d.getElementById("P");
  if (!p) return;
  p.textContent = "one two three four six";
  return {
    conflicts: [
      ...(r.conflicts || []),
      {
        kind: "text",
        node: p.firstChild,
        base: "one two three four five six",
        local,
        remote: "one two three four six",
        resolved: "one two three four six",
        recovery: {},
      },
    ],
  };
};

export const POSITION_ROWS = [
  [
    "Position: swapped siblings in unidentified sections, report stripped: real engine",
    SIBLINGS,
    () => ({ identities: undefined }),
    OK_PASS,
  ],
  [
    "Position: swapped siblings in unidentified sections left in place, report stripped",
    SIBLINGS,
    (d) => {
      const ps = [...d.querySelectorAll("main section > p")];
      if (ps.length !== 2) return;
      const [a, b] = ps;
      const pa = a.parentNode,
        pb = b.parentNode;
      pa.append(b);
      pb.append(a);
      return { identities: undefined };
    },
    MAY_DEFER_,
  ],
  [
    "Overlap: a conflict record cannot excuse a word lost far from the other side's edit",
    WORDS6("one two LOCALW three four five six"),
    DROP_WITH_CONFLICT("one two LOCALW three four five six"),
    MUST_FAIL,
  ],
  [
    "Overlap: a conflict record excuses a word lost where both sides edited",
    WORDS6("one two three four LOCALW six"),
    DROP_WITH_CONFLICT("one two three four LOCALW six"),
    OK_PASS,
  ],
];

export const ROWS = [
  ...CORE_ROWS,
  ...ORDER_ROWS,
  ...ANON_ROWS,
  ...RE_ROWS,
  ...ANON2_ROWS,
  ...ROUND3_ROWS,
  ...ROUND4_ROWS,
  ...RULE_ROWS,
  ...FOLLOWUP_ROWS,
  ...POSITION_ROWS,
];
