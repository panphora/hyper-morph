const fullDoc = (attrs, body) =>
  `<!DOCTYPE html><html${attrs ? " " + attrs : ""}><head></head><body>${body}</body></html>`;
function pathOfNode(root, node) {
  const parts = [];
  let el = node;
  while (el && el !== root) {
    const p = el.parentElement;
    if (!p) return null;
    parts.unshift(String(Array.prototype.indexOf.call(p.children, el)));
    el = p;
  }
  return el === root ? parts.join(".") : null;
}
function nodeAtPath(root, p) {
  let el = root;
  for (const part of p.split(".")) el = el.children[Number(part)];
  return el;
}

const moveSurgery =
  ([from, to]) =>
  (map, capMap) => {
    map[to] = capMap[from];
    map[from] = "t:copy";
    for (const k of Object.keys(map))
      if (k.startsWith(from + ".")) map[k] = "t:copy" + k.slice(from.length);
    for (const k of Object.keys(capMap))
      if (k.startsWith(from + ".")) map[to + k.slice(from.length)] = capMap[k];
  };
const swapSurgery = (map, capMap) => {
  const a = capMap["1.0.0"],
    b = capMap["1.1.0"];
  map["1.0.0"] = b;
  map["1.1.0"] = a;
};

const card = (t) =>
  `<div class="card"><h3>${t}</h3><p>Body text of the card.</p></div>`;
const secsAB = (a, b) =>
  `<section class="a">${a}</section><section class="b">${b}</section>`;
const cases = {
  "1 html[data-theme] + paragraph": {
    base: fullDoc('data-theme="old"', "<main><p>one</p><p>two</p></main>"),
    remote: fullDoc(
      'data-theme="new"',
      "<main><p>one</p><p>two changed</p></main>",
    ),
    ident: true,
    probe: ({ live }) => ({
      theme: live.documentElement.getAttribute("data-theme"),
    }),
  },
  "2a copy left in A, original moved to B": {
    base: fullDoc("", secsAB(card("One") + card("Two"), "")),
    remote: fullDoc("", secsAB(card("One") + card("Two"), card("One"))),
    ident: true,
    surgery: moveSurgery(["1.0.0", "1.1.0"]),
    pre: ({ live }) => ({ src: nodeAtPath(live.documentElement, "1.0.0") }),
    probe: ({ live, pre, ids }) => ({
      originalNowAt: pathOfNode(live.documentElement, pre.src),
      destIsFresh:
        ids.get(nodeAtPath(live.documentElement, "1.1.0")) === undefined,
    }),
  },
  "2b same, moved card edited": {
    base: fullDoc("", secsAB(card("One") + card("Two"), "")),
    remote: fullDoc("", secsAB(card("One") + card("Two"), card("One edited"))),
    ident: true,
    surgery: moveSurgery(["1.0.0", "1.1.0"]),
    pre: ({ live }) => ({ src: nodeAtPath(live.documentElement, "1.0.0") }),
    probe: ({ live, pre, ids }) => ({
      originalNowAt: pathOfNode(live.documentElement, pre.src),
      destIsFresh:
        ids.get(nodeAtPath(live.documentElement, "1.1.0")) === undefined,
    }),
  },
  "3 two equal <p> exchange ids, h3 edited": {
    base: fullDoc(
      "",
      `<section class="a"><p>same</p></section><section class="b"><p>same</p></section><h3>Title old</h3>`,
    ),
    remote: fullDoc(
      "",
      `<section class="a"><p>same</p></section><section class="b"><p>same</p></section><h3>Title new</h3>`,
    ),
    ident: true,
    surgery: swapSurgery,
    pre: ({ live }) => ({
      a: nodeAtPath(live.documentElement, "1.0.0"),
      b: nodeAtPath(live.documentElement, "1.1.0"),
    }),
    probe: ({ live, pre, rep }) => ({
      pA: pathOfNode(live.documentElement, pre.a),
      pB: pathOfNode(live.documentElement, pre.b),
      pAdopt: rep.identities
        .filter(([el]) => el.tagName === "P")
        .map(
          ([el, id]) =>
            (el === pre.a ? "pA" : el === pre.b ? "pB" : "p?") + "=" + id,
        )
        .join(" "),
    }),
  },
  "4 beforeNodeMorphed hook, h1 edit": {
    base: fullDoc(
      "",
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><h1>Title</h1>`,
    ),
    remote: fullDoc(
      "",
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><h1>Title edited</h1>`,
    ),
    ident: false,
    extra: (state) => {
      state.v = [];
      return {
        hooks: {
          beforeNodeMorphed: (el) => {
            state.v.push(el.tagName);
          },
        },
      };
    },
    probe: ({ state }) => ({ hooks: state.v.length + ":" + state.v.join(",") }),
  },
  "4b same hook, synthetic identity": {
    base: fullDoc(
      "",
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><h1>Title</h1>`,
    ),
    remote: fullDoc(
      "",
      `<section><h2>one</h2><p>alpha</p></section><section><h2>two</h2><p>beta</p></section><h1>Title edited</h1>`,
    ),
    ident: true,
    extra: (state) => {
      state.v = [];
      return {
        hooks: {
          beforeNodeMorphed: (el) => {
            state.v.push(el.tagName);
          },
        },
      };
    },
    probe: ({ state }) => ({ hooks: state.v.length + ":" + state.v.join(",") }),
  },
  "5 input.value=RUNTIME, heading edit (no ids)": {
    base: fullDoc("", `<h3>Title</h3><input value="original">`),
    remote: fullDoc("", `<h3>Title changed</h3><input value="original">`),
    ident: false,
    pre: ({ live }) => {
      const i = live.querySelector("input");
      i.value = "RUNTIME";
      return { i };
    },
    probe: ({ pre }) => ({ inputValue: pre.i.value }),
  },
  "5b same, synthetic identity": {
    base: fullDoc("", `<h3>Title</h3><input value="original">`),
    remote: fullDoc("", `<h3>Title changed</h3><input value="original">`),
    ident: true,
    pre: ({ live }) => {
      const i = live.querySelector("input");
      i.value = "RUNTIME";
      return { i };
    },
    probe: ({ pre }) => ({ inputValue: pre.i.value }),
  },
  "5c input inside a card, sibling card edited": {
    base: fullDoc(
      "",
      `<div class="card"><h3>A</h3><input value="original"></div><div class="card"><h3>B</h3></div>`,
    ),
    remote: fullDoc(
      "",
      `<div class="card"><h3>A</h3><input value="original"></div><div class="card"><h3>B edited</h3></div>`,
    ),
    ident: true,
    pre: ({ live }) => {
      const i = live.querySelector("input");
      i.value = "RUNTIME";
      return { i };
    },
    probe: ({ pre }) => ({ inputValue: pre.i.value }),
  },
};

export { cases };
