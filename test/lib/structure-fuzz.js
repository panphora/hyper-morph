// Echo-aware structural fuzz (Opus 18). Every word and every image is unique,
// so the model is simple: nothing may appear twice in the merge, and what
// both sides still hold must appear exactly once. The generator makes echo
// inserts (both sides insert the same block at the same place, as a relayed
// edit does), nested slots (lists inside containers, blocks rewritten in
// place), and cross-block moves of blocks and of inline elements. Paragraph
// splits and joins are left out: they are a documented limitation.
//
// Shared by the node test and the browser test; `merge(base, local, remote)`
// returns the merged body HTML.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

let fresh = 0;
let echoing = false;
const word = () => "w" + fresh++;
const words = (r, n) => Array.from({ length: n }, word);

// A block is { tag, parts }: a part is a word string, { b: [words] } or
// { img: key }. A container is { tag, kids }.
function block(r, tag = "p") {
  const parts = words(r, 3 + Math.floor(r() * 4));
  if (r() < 0.4)
    parts.splice(1 + Math.floor(r() * (parts.length - 1)), 0, {
      b: words(r, 1 + Math.floor(r() * 2)),
    });
  if (r() < 0.3)
    parts.splice(Math.floor(r() * parts.length), 0, { img: "i" + fresh++ });
  return echoing ? { tag, parts, echo: true } : { tag, parts };
}

function baseTree(r) {
  const kids = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.5) kids.push(block(r));
    else if (k < 0.75)
      kids.push({
        tag: "ul",
        kids: Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
          block(r, "li"),
        ),
      });
    else
      kids.push({
        tag: "div",
        kids: Array.from({ length: 1 + Math.floor(r() * 2) }, () => block(r)),
      });
  }
  return { tag: "body", kids };
}

const html = (n) => {
  if (typeof n === "string") return n;
  if (n.img) return `<img src="${n.img}.png">`;
  if (n.b) return `<b>${n.b.join(" ")}</b>`;
  if (n.parts) return `<${n.tag}>${n.parts.map(html).join(" ")}</${n.tag}>`;
  const inner = n.kids.map(html).join("");
  return n.tag === "body" ? inner : `<${n.tag}>${inner}</${n.tag}>`;
};

const clone = (t) => structuredClone(t);

// Every container in the tree (the body included), and every block.
function walk(t) {
  const containers = [],
    blocks = [];
  const visit = (n) => {
    if (n.parts) return blocks.push(n);
    containers.push(n);
    n.kids.forEach(visit);
  };
  visit(t);
  return { containers, blocks };
}
const parentOf = (t, n) => walk(t).containers.find((c) => c.kids.includes(n));
const pick = (r, a) => a[Math.floor(r() * a.length)];

// Ops choose their targets by index, so the same op replays on another
// clone of the same tree (the echo).
function op(r, t, echo = false) {
  const { containers } = walk(t);
  // A side's own edits leave echoed blocks alone: with no base to pair
  // them by, two diverging copies of one are two inserts by design.
  const blocks = walk(t).blocks.filter((b) => !b.echo);
  const k = echo ? r() * 0.6 : r();
  if (k < 0.25 && blocks.length) {
    const b = pick(r, blocks);
    const i = b.parts.findIndex((p) => typeof p === "string");
    if (i >= 0) b.parts[i] = word();
  } else if (k < 0.35 && blocks.length) {
    const b = pick(r, blocks);
    b.parts.splice(Math.floor(r() * (b.parts.length + 1)), 0, word());
  } else if (k < 0.45 && blocks.length > 2) {
    const b = pick(r, blocks);
    const p = parentOf(t, b);
    p.kids.splice(p.kids.indexOf(b), 1);
  } else if (k < 0.6) {
    const c = pick(r, containers);
    c.kids.splice(
      Math.floor(r() * (c.kids.length + 1)),
      0,
      block(r, c.tag === "ul" ? "li" : "p"),
    );
  } else if (k < 0.72 && blocks.length > 1) {
    // A block moved to another container (nested slots included).
    const b = pick(r, blocks);
    const from = parentOf(t, b);
    const to = pick(
      r,
      containers.filter(
        (c) => c !== from && (c.tag === "ul") === (b.tag === "li"),
      ),
    );
    if (to) {
      from.kids.splice(from.kids.indexOf(b), 1);
      to.kids.splice(Math.floor(r() * (to.kids.length + 1)), 0, b);
    }
  } else if (k < 0.84 && blocks.length > 1) {
    // An inline element moved into another block.
    const src = pick(
      r,
      blocks.filter((b) => b.parts.some((p) => typeof p !== "string")),
    );
    const dst =
      src &&
      pick(
        r,
        blocks.filter((b) => b !== src),
      );
    if (src && dst) {
      const i = src.parts.findIndex((p) => typeof p !== "string");
      const [el] = src.parts.splice(i, 1);
      if (!src.parts.length) src.parts.push(word());
      dst.parts.splice(Math.floor(r() * (dst.parts.length + 1)), 0, el);
    }
  } else if (blocks.length) {
    // A block rewritten in place: same tag, same slot, new words.
    const b = pick(r, blocks);
    b.parts = words(r, 2 + Math.floor(r() * 3));
  }
}

// An echo is an ordinary edit a peer relayed back: word edits, inserted and
// deleted blocks. Moves and whole rewrites are not echoed (a rewritten block
// has no identity to pair by, so two diverging copies of one are two
// inserts by design).
// Replay ops on two identical trees with one random stream each, both
// seeded alike, so the echo lands the same edit on both sides.
function echo(seed, a, b, n) {
  const at = fresh;
  echoing = true;
  const ra = rng(seed);
  for (let i = 0; i < n; i++) op(ra, a, true);
  const end = fresh;
  fresh = at;
  const rb = rng(seed);
  for (let i = 0; i < n; i++) op(rb, b, true);
  echoing = false;
  if (fresh !== end) throw new Error("echo replay diverged");
}

const tokens = (s) => s.match(/\b(?:w|i)\d+\b/g) || [];
const tally = (s) => {
  const m = new Map();
  for (const t of tokens(s)) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

async function run(seed, merge) {
  const r = rng(seed);
  const base = baseTree(r);
  const local = clone(base),
    remote = clone(base);
  if (r() < 0.6) echo(seed * 7 + 1, local, remote, 1 + Math.floor(r() * 2));
  const nl = Math.floor(r() * 3),
    nr = Math.floor(r() * 3);
  for (let i = 0; i < nl; i++) op(r, local);
  for (let i = 0; i < nr; i++) op(r, remote);
  const [b, l, rm] = [base, local, remote].map(html);
  const out = await merge(b, l, rm);
  const got = tally(out),
    inL = tally(l),
    inR = tally(rm);
  const problems = [];
  for (const [t, n] of got) if (n > 1) problems.push(`${t} x${n}`);
  for (const t of inL.keys())
    if (inR.has(t) && !got.has(t)) problems.push(`${t} lost`);
  return problems.length
    ? { seed, problems, base: b, local: l, remote: rm, out }
    : null;
}

export async function fuzz(from, to, merge) {
  const fails = [];
  for (let seed = from; seed <= to; seed++) {
    fresh = 0;
    const f = await run(seed, merge);
    if (f) fails.push(f);
  }
  return fails;
}
