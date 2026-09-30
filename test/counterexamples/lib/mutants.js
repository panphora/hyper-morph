// Planted faults for the oracle's own test: each wraps a real engine and
// damages what one merge leaves in the live page in one way the oracle
// claims to see. They act on the engine's output, not its source, so they
// keep working whatever the engine's code becomes.

const firstText = (root) => {
  const walk = root.ownerDocument.createTreeWalker(root, 4);
  for (let t = walk.nextNode(); t; t = walk.nextNode())
    if (
      /\S/.test(t.nodeValue) &&
      !t.parentElement.closest("script,style,title")
    )
      return t;
  return null;
};

function sameTagPair(root) {
  for (const el of root.querySelectorAll("*")) {
    const kids = [...el.children];
    for (let i = 0; i + 1 < kids.length; i++)
      if (kids[i].tagName === kids[i + 1].tagName)
        return [kids[i], kids[i + 1]];
  }
  return null;
}

const damage = {
  loss(root) {
    const t = firstText(root);
    if (t) t.nodeValue = t.nodeValue.replace(/\S+\s*$/, "");
  },
  duplication(root) {
    const t = firstText(root);
    if (t) t.nodeValue = t.nodeValue + " " + t.nodeValue.trim();
  },
  reorder(root) {
    const pair = sameTagPair(root);
    if (pair) pair[0].before(pair[1]);
  },
  move(root) {
    const els = [...root.querySelectorAll("*")].filter(
      (e) => e.parentElement !== root && e.parentElement.children.length > 1,
    );
    const el = els.at(-1);
    if (el) root.append(el);
  },
};

function wrap(E, fault, onlyFast = false) {
  const hit = (opts) => !onlyFast || opts?.fastPath === true;
  return {
    ...E,
    async mergeDocument(o) {
      const r = await E.mergeDocument(o);
      if (hit(o)) damage[fault](o.live.body);
      return r;
    },
    async morphElement(el, content, o) {
      const parent = el.parentElement;
      const r = await E.morphElement(el, content, o);
      if (hit(o)) damage[fault](parent);
      return r;
    },
    merge3(b, l, r, o) {
      const res = E.merge3(b, l, r, o);
      if (hit(o)) damage[fault](res.doc.body);
      return res;
    },
  };
}

export const MUTANTS = {
  loss: (E) => wrap(E, "loss"),
  duplication: (E) => wrap(E, "duplication"),
  reorder: (E) => wrap(E, "reorder"),
  move: (E) => wrap(E, "move"),
  "fast-only loss": (E) => wrap(E, "loss", true),
};
