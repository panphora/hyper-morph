// Echo-aware structural fuzz (Opus 18). Every word and every image is unique,
// so the model is simple: nothing may appear twice in the merge, and what
// both sides still hold must appear exactly once. The generator makes echo
// inserts (both sides insert the same block at the same place, as a relayed
// edit does), nested slots (lists inside containers, blocks rewritten in
// place), cross-block moves of blocks and of inline elements, paragraph
// splits and joins, and rewrites a peer relayed back beside an insertion.
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
let nextId = 0;
let echoing = false;
const word = () => "w" + fresh++;
const words = (r, n) => Array.from({ length: n }, word);

export let idMode = 0;
export function setIdMode(m) {
  idMode = m;
}
const idOn = (n) =>
  n.id !== undefined &&
  (idMode === 1 ||
    idMode === 2 ||
    (idMode === 3 && n.id % 2 === 1) ||
    (idMode === 4 && n.id % 3 !== 0) ||
    (idMode === 5 && !!n.kids) ||
    (idMode === 6 && !n.kids));
const idAttr = (n) => (idMode && idOn(n) ? ` data-id="b${n.id}"` : "");

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
  const b = { id: nextId++, tag, parts };
  if (echoing) b.echo = true;
  return b;
}

function baseTree(r) {
  const kids = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.5) kids.push(block(r));
    else if (k < 0.75)
      kids.push({
        id: nextId++,
        tag: "ul",
        kids: Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
          block(r, "li"),
        ),
      });
    else
      kids.push({
        id: nextId++,
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
  if (n.parts)
    return `<${n.tag}${idAttr(n)}>${n.parts.map(html).join(" ")}</${n.tag}>`;
  const inner = n.kids.map(html).join("");
  return n.tag === "body" ? inner : `<${n.tag}${idAttr(n)}>${inner}</${n.tag}>`;
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
// A block one side moved while the other side split or joined it, or moved
// an inline element into or out of it, has no single right merge (which
// block did the words follow?), and the merge keeps the move. The claims
// map records what each side did to a block by id, so the other side's own
// ops skip it: `claim(b, kind)` is false when the other side did something
// else to the block.
function op(r, t, echo = false, claims = null, side = 0) {
  const { containers } = walk(t);
  const claim = (b, kind) => {
    if (!claims) return true;
    const c = claims.get(b.id);
    if (c && c.kind !== kind) return false;
    claims.set(b.id, { side, kind });
    return true;
  };
  // A side's own edits leave echoed blocks alone: with no base to pair
  // them by, two diverging copies of one are two inserts by design.
  const blocks = walk(t).blocks.filter((b) => !b.echo);
  const k = echo ? r() * 0.68 : r();
  if (k < 0.2 && blocks.length) {
    const b = pick(r, blocks);
    const i = b.parts.findIndex((p) => typeof p === "string");
    if (i >= 0) b.parts[i] = word();
    if (echoing) b.hot = true;
  } else if (k < 0.28 && blocks.length) {
    const b = pick(r, blocks);
    b.parts.splice(Math.floor(r() * (b.parts.length + 1)), 0, word());
    if (echoing) b.hot = true;
  } else if (k < 0.36 && blocks.length > 2) {
    const b = pick(r, blocks);
    const p = parentOf(t, b);
    p.kids.splice(p.kids.indexOf(b), 1);
  } else if (k < 0.46) {
    const c = pick(r, containers);
    c.kids.splice(
      Math.floor(r() * (c.kids.length + 1)),
      0,
      block(r, c.tag === "ul" ? "li" : "p"),
    );
  } else if (k < 0.54 && blocks.length) {
    // A paragraph split: Enter inside a block moves its tail into a new
    // block of the same tag right after it.
    const b =
      pick(
        r,
        blocks.filter((x) => x.parts.length > 1 && !x.hot),
      ) || null;
    if (b && claim(b, "reshape")) {
      const i = 1 + Math.floor(r() * (b.parts.length - 1));
      const tail = { id: nextId++, tag: b.tag, parts: b.parts.splice(i) };
      if (echoing) b.echo = tail.echo = true;
      const p = parentOf(t, b);
      p.kids.splice(p.kids.indexOf(b) + 1, 0, tail);
    }
  } else if (k < 0.6 && blocks.length && !echoing) {
    // A join: Backspace at the start of a block pulls it into the block
    // before it. Not echoed: a relayed join beside a block the other side
    // moved into the same container is a residual (see the plan).
    const b = pick(r, blocks);
    const p = parentOf(t, b);
    const i = p.kids.indexOf(b);
    const prev = i > 0 ? p.kids[i - 1] : null;
    if (
      prev &&
      prev.parts &&
      prev.tag === b.tag &&
      !prev.echo &&
      !prev.hot &&
      !b.hot &&
      claim(b, "reshape") &&
      claim(prev, "reshape")
    ) {
      prev.parts.push(...b.parts);
      p.kids.splice(i, 1);
      if (echoing) prev.echo = true;
    }
  } else if (k < 0.68 && blocks.length) {
    // A block rewritten in place: same tag, same slot, new words. Relayed
    // back by a peer, the rewrite is an echo the other side then edits
    // around (a sibling inserted after it), which the slot pass alone
    // cannot pair.
    const b = pick(r, blocks);
    b.parts = words(r, 2 + Math.floor(r() * 3));
    if (echoing) b.echo = true;
  } else if (k < 0.78 && blocks.length > 1) {
    // A block moved to another container (nested slots included).
    const b = pick(r, blocks);
    const from = parentOf(t, b);
    const to = pick(
      r,
      containers.filter(
        (c) => c !== from && (c.tag === "ul") === (b.tag === "li"),
      ),
    );
    if (to && claim(b, "move")) {
      from.kids.splice(from.kids.indexOf(b), 1);
      to.kids.splice(Math.floor(r() * (to.kids.length + 1)), 0, b);
    }
  } else if (k < 0.9 && blocks.length > 1) {
    // An inline element moved into another block.
    const src = pick(
      r,
      blocks.filter(
        (b) => !b.hot && b.parts.some((p) => typeof p !== "string"),
      ),
    );
    const dst =
      src &&
      pick(
        r,
        blocks.filter((b) => b !== src && !b.hot),
      );
    if (src && dst && claim(src, "inline") && claim(dst, "inline")) {
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
// deleted blocks, splits and rewrites. Moves are not echoed.
// Replay ops on two identical trees with one random stream each, both
// seeded alike, so the echo lands the same edit on both sides.
function echo(seed, a, b, n) {
  const at = fresh;
  const idAt = nextId;
  echoing = true;
  const ra = rng(seed);
  for (let i = 0; i < n; i++) op(ra, a, true);
  const end = fresh;
  fresh = at;
  nextId = idAt;
  const rb = rng(seed);
  for (let i = 0; i < n; i++) op(rb, b, true);
  echoing = false;
  if (fresh !== end) throw new Error("echo replay diverged");
}

// Words are read from the text and images from their tags, so an image turned
// into text is a lost image, not a surviving token.
const tokens = (s) => [
  ...(s.replace(/<[^>]*>/g, " ").match(/\b(?:w|i)\d+\b/g) || []),
  ...[...s.matchAll(/<img\b[^>]*\bsrc="(i\d+)\.png"/g)].map((m) => `<${m[1]}>`),
];
const tally = (s) => {
  const m = new Map();
  for (const t of tokens(s)) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

// The base, local and remote HTML for a seed. The random stream is consumed
// in one fixed order, so a seed always yields the same three documents; ids
// are handed out from the same fixed starting point.
export function generate(seed) {
  fresh = 0;
  nextId = 0;
  const r = rng(seed);
  const base = baseTree(r);
  const local = clone(base),
    remote = clone(base);
  if (r() < 0.6) echo(seed * 7 + 1, local, remote, 1 + Math.floor(r() * 2));
  const nl = Math.floor(r() * 3),
    nr = Math.floor(r() * 3);
  const claims = new Map();
  for (let i = 0; i < nl; i++) op(r, local, false, claims, 1);
  for (let i = 0; i < nr; i++) op(r, remote, false, claims, 2);
  // Mode 2: one side's block is relabelled with a sibling's id, as a copy and
  // paste that carried an id (or a hand-authored collision) does.
  if (idMode === 2) {
    for (const t of [local, remote]) {
      if (r() < 0.5) continue;
      const bl = walk(t).blocks;
      if (bl.length < 2) continue;
      const a = pick(r, bl),
        b = pick(r, bl);
      if (a !== b) b.id = a.id;
    }
  }
  const [b, l, rm] = [base, local, remote].map(html);
  return { b, l, r: rm };
}

// `merge` returns the merged body HTML, or { html, conflicts } to also check
// one-sided edits: with no conflict reported, a token only one side added is
// kept and a token only one side removed stays gone.
async function run(seed, merge) {
  const { b, l, r: rm } = generate(seed);
  const res = await merge(b, l, rm);
  const out = typeof res === "string" ? res : res.html;
  const got = tally(out),
    inB = tally(b),
    inL = tally(l),
    inR = tally(rm);
  const problems = [];
  for (const [t, n] of got) if (n > 1) problems.push(`${t} x${n}`);
  for (const t of inL.keys())
    if (inR.has(t) && !got.has(t)) problems.push(`${t} lost`);
  if (typeof res !== "string" && res.conflicts.length === 0)
    for (const [mine, theirs] of [
      [inL, inR],
      [inR, inL],
    ]) {
      for (const t of mine.keys())
        if (!inB.has(t) && !theirs.has(t) && !got.has(t))
          problems.push(`${t} inserted by one side lost`);
      for (const t of inB.keys())
        if (!mine.has(t) && theirs.has(t) && got.has(t))
          problems.push(`${t} deleted by one side kept`);
    }
  return problems.length
    ? { seed, problems, base: b, local: l, remote: rm, out }
    : null;
}

export async function fuzz(from, to, merge) {
  const fails = [];
  for (let seed = from; seed <= to; seed++) {
    fresh = 0;
    nextId = 0;
    const f = await run(seed, merge);
    if (f) fails.push(f);
  }
  return fails;
}
