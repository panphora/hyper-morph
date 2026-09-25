/**
 * inline-merge.js — three-way merge of a block's inline content.
 *
 * One inline segment (the text nodes, formatting elements and atoms such as
 * <br> and <img> between block-level children) is flattened into one
 * character sequence: an atom is one U+FFFC character and every formatting
 * element is a mark, a range over the sequence. Text merges by the word
 * rules of text-merge.js; marks merge per character as sets, with the
 * three-way rule class tokens use; the output is rebuilt from the merged
 * sequence with provenance to the local nodes and a caret map.
 *
 * Rules:
 *   - text hunks: overlap conflicts; a pure insertion touching the other
 *     side's edit conflicts; touching replacements both land; identical
 *     hunks land once; same-point insertions both land, local first
 *   - a text edit strictly inside a range the other side formatted inherits
 *     that formatting; one that crosses the range's edge conflicts, and a
 *     deletion of exactly that range conflicts (edit beats delete)
 *   - atoms pair by position; the alignment overrides that where it names
 *     a different, unequal element (a swap) or an atom a side deleted in
 *     place and inserted elsewhere (a move), and the other side's version
 *     of the atom merges at its destination
 *   - deleting or replacing an atom the other side changed conflicts
 *   - marks pair with base through the alignment; marks new on both sides
 *     with one tag over the same characters are one mark (an echo)
 *   - formatting never conflicts with formatting; a text edit that lost a
 *     conflict takes the winner's marks
 *
 * Bounds: past MAX_TOKENS word tokens on any side (text-merge's bound) the
 * text merges by line; diffTokens caps the edit distance and treats a
 * middle that shares few tokens as one replacement.
 */

import { textTokens, allAscii, diffTokens, MAX_TOKENS } from "./text-merge.js";

export const ATOM = "￼";

export const MARK_TAGS = new Set(
  "A ABBR B BDI BDO CITE CODE DATA DEL DFN EM FONT I INS KBD MARK Q S SAMP SMALL SPAN STRIKE STRONG SUB SUP TIME TT U VAR".split(
    " ",
  ),
);
export const ATOM_TAGS = new Set(["BR", "WBR", "IMG"]);

// ---------------------------------------------------------------------
// Segments and the flat model
// ---------------------------------------------------------------------

/**
 * True for a node that belongs to an inline segment: text, an atom, an
 * ignored element (skipped, never a boundary), or a mark whose subtree is
 * inline-only. A remoteWins element is a boundary.
 * @param {Node} node
 * @param {{ ignored?: Function, remoteWins?: Function, inlineCache?: WeakMap }} o
 */
export function isInlineUnit(node, o = {}) {
  if (node.nodeType === 3) return true;
  if (node.nodeType !== 1) return false;
  if (o.ignored && o.ignored(node)) return true;
  if (ATOM_TAGS.has(node.tagName)) return true;
  if (!MARK_TAGS.has(node.tagName)) return false;
  if (o.remoteWins && o.remoteWins(node)) return false;
  const cached = o.inlineCache && o.inlineCache.get(node);
  if (cached !== undefined) return cached;
  let ok = true;
  for (const c of node.childNodes)
    if (!isInlineUnit(c, o)) {
      ok = false;
      break;
    }
  if (o.inlineCache) o.inlineCache.set(node, ok);
  return ok;
}

function isEmptyMark(el) {
  return (
    !el.firstChild || (el.textContent === "" && !el.querySelector("br,img,wbr"))
  );
}

/**
 * Flatten inline nodes into { text, marks, atoms, nodes, stackAt, placeholder }.
 * `stackAt[i]` is the list of enclosing marks of character i, outermost
 * first; the arrays are shared, so equal stacks compare by identity. A lone
 * <br> in an otherwise empty segment is a placeholder and reads as empty.
 * @param {Node[]} units
 * @param {{ ignored?: Function, remoteWins?: Function }} [o]
 */
export function flatten(units, o = {}) {
  const f = {
    text: "",
    marks: [],
    atoms: [],
    nodes: [],
    stackAt: [],
    placeholder: null,
  };
  const walk = (list, stack) => {
    for (const node of list) {
      if (node.nodeType === 3) {
        const v = node.nodeValue;
        if (!v) continue;
        f.nodes.push({ node, s: f.text.length, e: f.text.length + v.length });
        f.text += v;
        for (let i = 0; i < v.length; i++) f.stackAt.push(stack);
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (o.ignored && o.ignored(node)) continue;
      const tag = node.tagName;
      const empty = MARK_TAGS.has(tag) && isEmptyMark(node);
      if (
        ATOM_TAGS.has(tag) ||
        !MARK_TAGS.has(tag) ||
        (o.remoteWins && o.remoteWins(node)) ||
        empty
      ) {
        f.atoms.push({
          i: f.text.length,
          el: node,
          key: empty ? tag + ":empty" : tag,
          stack,
        });
        f.stackAt.push(stack);
        f.text += ATOM;
        continue;
      }
      const m = {
        el: node,
        tag,
        from: f.text.length,
        to: -1,
        depth: stack.length,
      };
      f.marks.push(m);
      walk(node.childNodes, stack.concat([m]));
      m.to = f.text.length;
    }
  };
  walk(units, []);
  if (
    f.atoms.length === 1 &&
    f.atoms[0].el.tagName === "BR" &&
    f.marks.length === 0 &&
    stripAtoms(f).trim() === ""
  ) {
    const br = f.atoms[0];
    f.placeholder = br.el;
    f.text = f.text.slice(0, br.i) + f.text.slice(br.i + 1);
    f.stackAt.splice(br.i, 1);
    for (const n of f.nodes)
      if (n.s > br.i) {
        n.s--;
        n.e--;
      }
    f.atoms = [];
  }
  f.atomAt = new Map(f.atoms.map((a) => [a.i, a]));
  return f;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
}

function openTag(el) {
  let s = "<" + el.tagName.toLowerCase();
  for (const a of el.attributes)
    s += ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`;
  return s + ">";
}

/** The inline HTML of one side's characters [from, to), for conflict records. */
export function sliceHtml(f, from, to) {
  let out = "";
  const stack = [];
  for (let i = from; i < to; i++) {
    const want = f.stackAt[i];
    let c = 0;
    while (c < stack.length && c < want.length && stack[c] === want[c]) c++;
    while (stack.length > c) out += `</${stack.pop().tag.toLowerCase()}>`;
    while (stack.length < want.length) {
      const m = want[stack.length];
      out += openTag(m.el);
      stack.push(m);
    }
    const atom = f.atomAt.get(i);
    out += atom ? atom.el.outerHTML : escapeHtml(f.text[i]);
  }
  while (stack.length) out += `</${stack.pop().tag.toLowerCase()}>`;
  return out;
}

function markSig(m) {
  const attrs = [...m.el.attributes]
    .map((a) => a.name + "=" + a.value)
    .sort()
    .join("\u0001");
  return m.tag + "|" + attrs;
}

/** Canonical form of a flat model: text, atoms and per-character mark sets. */
export function flatSig(f) {
  const sigOf = new Map();
  const stackSig = (stack) => {
    let s = sigOf.get(stack);
    if (s === undefined) {
      s = "{" + stack.map(markSig).sort().join(",") + "}";
      sigOf.set(stack, s);
    }
    return s;
  };
  let out = "";
  for (let i = 0; i < f.text.length; i++) {
    const atom = f.atomAt.get(i);
    out +=
      (atom ? "[" + atom.el.outerHTML + "]" : f.text[i]) +
      stackSig(f.stackAt[i]);
  }
  if (f.text.length === 0 && f.placeholder) out += "[br]";
  return out;
}

// ---------------------------------------------------------------------
// Tokens and hunks, in character offsets
// ---------------------------------------------------------------------

function tokensOf(f, fast, lines) {
  const out = [];
  const text = f.text;
  let i = 0;
  const pieceTo = (j) => {
    if (j <= i) return;
    const piece = text.slice(i, j);
    if (lines)
      for (const w of piece.split(/(?<=\n)/))
        out.push({ k: w, raw: w, len: w.length });
    else for (const t of textTokens(piece, fast)) out.push(t);
  };
  for (const a of f.atoms) {
    pieceTo(a.i);
    out.push({ k: "\0" + a.key, raw: ATOM, len: 1, atom: true });
    i = a.i + 1;
  }
  pieceTo(text.length);
  return out;
}

/** The text without its atoms; a literal U+FFFC in a text node stays. */
function stripAtoms(f) {
  if (!f.atoms.length) return f.text;
  let s = "",
    p = 0;
  for (const a of f.atoms) {
    s += f.text.slice(p, a.i);
    p = a.i + 1;
  }
  return s + f.text.slice(p);
}

const offsets = (toks) => {
  const off = new Int32Array(toks.length + 1);
  for (let i = 0; i < toks.length; i++) off[i + 1] = off[i] + toks[i].len;
  return off;
};

/**
 * Hunks turning base into one side, as character ranges on both sides:
 * { bs, be, ss, se, text, toks }. `respell` maps a base token index to the
 * side's spelling where the tokens are equal by key but not by text (nbsp).
 */
function sideDiff(fs, bToks, sToks) {
  const d = diffTokens(bToks, sToks);
  const bOff = offsets(bToks),
    sOff = offsets(sToks);
  const hunks = [];
  let bi = 0,
    si = 0;
  for (const h of d.hunks) {
    si += h.bs - bi;
    const ste = si + h.toks.length;
    hunks.push({
      bs: bOff[h.bs],
      be: bOff[h.be],
      ss: sOff[si],
      se: sOff[ste],
      text: fs.text.slice(sOff[si], sOff[ste]),
      toks: h.toks,
    });
    si = ste;
    bi = h.be;
  }
  const respell = new Map();
  for (const c of d.cosmetic) respell.set(c.bi, c.tok.raw);
  return { hunks, respell };
}

/** base <-> side character maps from the hunks; -1 where a character is not kept. */
function charMaps(hunks, baseLen, sideLen) {
  const bTo = new Int32Array(baseLen + 1).fill(-1);
  const toB = new Int32Array(sideLen + 1).fill(-1);
  let bp = 0,
    sp = 0;
  const eq = (to) => {
    while (bp < to) {
      bTo[bp] = sp;
      toB[sp] = bp;
      bp++;
      sp++;
    }
  };
  for (const h of hunks) {
    eq(h.bs);
    bp = h.be;
    sp = h.se;
  }
  eq(baseLen);
  bTo[baseLen] = sp;
  toB[sp] = baseLen;
  return { bTo, toB };
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------

/**
 * @param {object} o
 * @param {Node[]} o.base - the base segment's nodes
 * @param {Node[]} o.local - the local segment's nodes (base's in two-way mode)
 * @param {Node[]} o.remote - the remote segment's nodes
 * @param {Document} o.out - the output document
 * @param {"remote" | "local" | "both"} [o.policy]
 * @param {object} [o.L] - base-to-local alignment ({ reverse, identical, pairIdenticalChildren })
 * @param {object} [o.R] - base-to-remote alignment
 * @param {{ local: Function, remote: Function }} [o.idOf] - identity of a side element, for echo pairing
 * @param {(n: Node) => boolean} [o.ignored]
 * @param {(el: Element) => boolean} [o.remoteWins]
 * @param {(b: Element, l: Element, r: Element) => Element} [o.mergeElement] - merges an atom kept by both sides
 * @param {(el: Element, side: string) => Element} [o.cloneUnit] - clones a one-sided atom
 * @param {(b: Element, l: Element | null, r: Element | null, el: Element) => void} [o.mergeAttrs] - attributes of a mark that has a base
 * @param {WeakMap} [o.provenance]
 * @param {WeakMap} [o.textMappers]
 * @param {Array} [o.conflicts]
 * @param {Array} [o.decisions]
 * @param {Element | null} [o.node] - the output block, for conflict records
 * @returns {{ nodes: Node[], text: string, textNodes: Array, localDiverged: boolean, mapLocal: (k: number) => number, conflicts: Array, granularity: "word" | "line", localHunks: Array, remoteHunks: Array, lToM: Int32Array }}
 * `localHunks`, `remoteHunks` (character ranges) and `lToM` (local offset
 * to merged offset, -1 when dropped) exist for the property tests.
 */
export function mergeInline(o) {
  const { out, policy = "remote", L, R } = o;
  const provenance = o.provenance || new WeakMap();
  const textMappers = o.textMappers || new WeakMap();
  const conflicts = o.conflicts || [];
  const decisions = o.decisions || [];
  const firstConflict = conflicts.length;
  const fb = flatten(o.base, o),
    fl = flatten(o.local, o),
    fr = flatten(o.remote, o);

  // Atoms pair by tag and position in the diff; the rebuild lets the
  // alignment override that pairing where it names a different element.
  const byTwin = !!(L && L.reverse && L.map && R && R.reverse && R.map);
  const baseAtomOf = new Map(fb.atoms.map((a) => [a.el, a]));

  const setAttr = (el, sample, v) => {
    if (sample.namespaceURI)
      el.setAttributeNS(sample.namespaceURI, sample.name, v);
    else el.setAttribute(sample.name, v);
  };
  const attrsOf = (el, b, l, r) => {
    if (!b && (!l || !r)) {
      for (const a of (l || r).attributes) setAttr(el, a, a.value);
      return;
    }
    const names = new Map();
    for (const src of [b, l, r])
      if (src) for (const a of src.attributes) names.set(a.name, a);
    for (const [name, sample] of names) {
      const bv = b ? b.getAttribute(name) : null;
      const lv = l ? l.getAttribute(name) : bv;
      const rv = r ? r.getAttribute(name) : bv;
      let v;
      if (lv === rv) v = lv;
      else if (lv === bv) {
        v = rv;
        decisions.push({ kind: "attr", el, name, source: "remote" });
      } else if (rv === bv) {
        v = lv;
        decisions.push({ kind: "attr", el, name, source: "local" });
      } else {
        v = policy === "local" ? lv : rv;
        conflicts.push({
          kind: "attr",
          el,
          name,
          base: bv,
          local: lv,
          remote: rv,
          resolved: v,
        });
        decisions.push({ kind: "attr", el, name, source: "both" });
      }
      if (v != null) setAttr(el, sample, v);
    }
  };
  const mergeAttrs = (b, l, r, el) =>
    b && o.mergeAttrs ? o.mergeAttrs(b, l, r, el) : attrsOf(el, b, l, r);
  const mergeAtom =
    o.mergeElement ||
    ((b, l, r) => {
      const el = out.createElement(b.tagName);
      mergeAttrs(b, l, r, el);
      const lv = l || b,
        rv = r || b;
      const src =
        policy === "local"
          ? lv.isEqualNode(b)
            ? rv
            : lv
          : rv.isEqualNode(b)
            ? lv
            : rv;
      for (const c of src.childNodes) el.appendChild(out.importNode(c, true));
      provenance.set(el, { base: b, local: l, remote: r });
      return el;
    });
  const cloneAtom =
    o.cloneUnit ||
    ((el, side) => {
      const c = out.importNode(el, true);
      provenance.set(c, {
        base: null,
        local: side === "local" ? el : null,
        remote: side === "remote" ? el : null,
      });
      return c;
    });

  // Tokens and hunks: words, or lines past the same bound text-merge uses.
  const fast = allAscii(stripAtoms(fb), stripAtoms(fl), stripAtoms(fr));
  let bToks = tokensOf(fb, fast, false),
    lToks = tokensOf(fl, fast, false),
    rToks = tokensOf(fr, fast, false);
  const lines =
    bToks.length > MAX_TOKENS ||
    lToks.length > MAX_TOKENS ||
    rToks.length > MAX_TOKENS;
  if (lines) {
    bToks = tokensOf(fb, fast, true);
    lToks = tokensOf(fl, fast, true);
    rToks = tokensOf(fr, fast, true);
  }
  const Ld = sideDiff(fl, bToks, lToks),
    Rd = sideDiff(fr, bToks, rToks);
  const ML = charMaps(Ld.hunks, fb.text.length, fl.text.length),
    MR = charMaps(Rd.hunks, fb.text.length, fr.text.length);
  const n = fb.text.length;

  // Base atoms a side deleted in place and inserted elsewhere: moves, not
  // deletions. The other side's edits merge at the destination.
  const movedAtoms = (fs, A, M) => {
    const s = new Set();
    if (!byTwin) return s;
    for (const a of fs.atoms) {
      const t = baseAtomOf.get(A.reverse.get(a.el));
      if (t && M.bTo[t.i] < 0) s.add(t);
    }
    return s;
  };
  const movedL = movedAtoms(fl, L, ML),
    movedR = movedAtoms(fr, R, MR);

  // Unified marks: every base mark, then each side's marks by alignment twin.
  let nextId = 1;
  const newU = (tag, rank) => ({
    id: nextId++,
    tag,
    base: null,
    local: null,
    remote: null,
    rank,
  });
  const byEl = new Map();
  const baseUs = [];
  for (const m of fb.marks) {
    const u = newU(m.tag, m.depth);
    u.base = m.el;
    u.baseMark = m;
    byEl.set(m.el, u);
    baseUs.push(u);
  }
  const rangeToBase = (m, toB) => {
    let bf = -1,
      bt = -1;
    for (let i = m.from; i < m.to; i++) {
      const b = toB[i];
      if (b >= 0) {
        if (bf < 0) bf = b;
        bt = b + 1;
      }
    }
    return bf < 0 ? null : [bf, bt];
  };
  // A side mark pairs with the base mark the alignment paired it with; one
  // the alignment left unpaired (a wrapped element) pairs with the base mark
  // of its tag whose characters it covers most.
  const pairSide = (fs, side, A, toB) => {
    for (const m of fs.marks) {
      const twin = A ? A.reverse.get(m.el) : null;
      if (twin && A.identical.has(twin) && A.pairIdenticalChildren)
        A.pairIdenticalChildren(twin);
      let u = twin ? byEl.get(twin) : null;
      if (u && u[side]) u = null;
      if (!u) {
        const r = rangeToBase(m, toB);
        let bestOv = 0;
        if (r)
          for (const c of baseUs) {
            if (c.tag !== m.tag || c[side]) continue;
            const ov =
              Math.min(r[1], c.baseMark.to) - Math.max(r[0], c.baseMark.from);
            if (
              ov > bestOv ||
              (ov === bestOv &&
                ov > 0 &&
                Math.abs(c.rank - m.depth) < Math.abs(u.rank - m.depth))
            ) {
              u = c;
              bestOv = ov;
            }
          }
      }
      if (!u) {
        u = newU(m.tag, m.depth);
        u.new = side;
      }
      u[side] = m.el;
      u[side + "Mark"] = m;
      byEl.set(m.el, u);
    }
  };
  pairSide(fl, "local", L, ML.toB);
  pairSide(fr, "remote", R, MR.toB);
  const resolve = (u) => u.merged || u;
  const usOf = (stack) => {
    const s = new Set();
    for (const m of stack) s.add(byEl.get(m.el));
    return s;
  };
  const usCache = new Map();
  const usOfCached = (stack) => {
    let s = usCache.get(stack);
    if (!s) {
      s = usOf(stack);
      usCache.set(stack, s);
    }
    return s;
  };

  // Format hunks per side: maximal runs of kept base characters whose mark
  // delta against base is constant and not empty.
  const formatHunks = (fs, bTo) => {
    const hs = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const si = bTo[i];
      if (si < 0) {
        if (cur) hs.push(cur);
        cur = null;
        continue;
      }
      const B = usOfCached(fb.stackAt[i]),
        S = usOfCached(fs.stackAt[si]);
      const added = new Set(),
        removed = new Set();
      for (const u of S) if (!B.has(u)) added.add(u);
      for (const u of B) if (!S.has(u)) removed.add(u);
      if (!added.size && !removed.size) {
        if (cur) hs.push(cur);
        cur = null;
        continue;
      }
      if (cur && setEq(cur.added, added) && setEq(cur.removed, removed)) {
        cur.be = i + 1;
        continue;
      }
      if (cur) hs.push(cur);
      cur = { bs: i, be: i + 1, added, removed };
    }
    if (cur) hs.push(cur);
    return hs;
  };
  const LF = formatHunks(fl, ML.bTo),
    RF = formatHunks(fr, MR.bTo);

  // The characters an edit must agree with: the replaced ones, or for a
  // pure insertion the two around the point.
  const neighborhood = (h) =>
    h.be > h.bs
      ? [h.bs, h.be - 1]
      : [Math.max(h.bs - 1, 0), Math.min(h.bs, n - 1)];
  // The format hunk containing h's neighborhood, "straddle" when h crosses
  // a boundary, or null.
  const formatRelation = (h, fhs) => {
    if (n === 0) return null;
    const [lo, hi] = neighborhood(h);
    for (const F of fhs) {
      if (F.be <= lo) continue;
      if (F.bs > hi) break;
      const contained = F.bs <= lo && hi < F.be;
      if (contained && h.text === "" && F.bs === h.bs && F.be === h.be)
        return "straddle";
      if (contained) return F;
      return h.be > h.bs ? "straddle" : null;
    }
    return null;
  };
  const isInsert = (h) => h.bs === h.be;
  const textConflict = (a, b) =>
    (a.bs < b.be && b.bs < a.be) ||
    (a.bs <= b.be && b.bs <= a.be && isInsert(a) !== isInsert(b));
  const sameHunk = (l, r) => {
    if (l.bs !== r.bs || l.be !== r.be || l.toks.length !== r.toks.length)
      return false;
    let lp = l.ss,
      rp = r.ss;
    for (let t = 0; t < l.toks.length; t++) {
      const a = l.toks[t],
        b = r.toks[t];
      if (a.k !== b.k) return false;
      if (a.atom && !fl.atomAt.get(lp).el.isEqualNode(fr.atomAt.get(rp).el))
        return false;
      lp += a.len;
      rp += b.len;
    }
    return true;
  };
  const atomConflict = (h, otherM, otherFlat, moved) => {
    for (const a of fb.atoms) {
      if (a.i < h.bs || a.i >= h.be || moved.has(a)) continue;
      const si = otherM.bTo[a.i];
      const oa = si >= 0 ? otherFlat.atomAt.get(si) : null;
      if (oa && !oa.el.isEqualNode(a.el)) return true;
    }
    return false;
  };

  // Pieces, in base order.
  const pieces = [];
  const lh = Ld.hunks,
    rh = Rd.hunks;
  let li = 0,
    ri = 0,
    pos = 0,
    dL = 0,
    dR = 0;
  const pushBase = (to) => {
    if (to > pos) {
      pieces.push({ src: "base", from: pos, to, dL, dR });
      pos = to;
    }
  };
  while (li < lh.length || ri < rh.length) {
    const l = lh[li],
      r = rh[ri];
    const takeL = !!l && (!r || l.bs < r.bs || (l.bs === r.bs && l.be <= r.be));
    const h = takeL ? l : r,
      other = takeL ? r : l;
    const same = !!other && sameHunk(l, r);
    // Two different texts typed into an empty segment collide.
    const withOther = !!other && !same && (n === 0 || textConflict(h, other));
    let conflict = withOther;
    const rel = formatRelation(h, takeL ? RF : LF);
    if (rel === "straddle") conflict = true;
    if (!conflict && h.be > h.bs)
      conflict = atomConflict(
        h,
        takeL ? MR : ML,
        takeL ? fr : fl,
        takeL ? movedL : movedR,
      );
    if (!conflict && same) {
      pushBase(h.bs);
      pieces.push({
        src: "both",
        lfrom: l.ss,
        rfrom: r.ss,
        len: h.text.length,
      });
      pos = h.be;
      dL += h.text.length - (h.be - h.bs);
      dR += h.text.length - (h.be - h.bs);
      li++;
      ri++;
      continue;
    }
    if (!conflict) {
      pushBase(h.bs);
      pieces.push({
        src: takeL ? "local" : "remote",
        from: h.ss,
        to: h.se,
        inherit: rel && rel !== "straddle" ? rel : null,
      });
      pos = h.be;
      if (takeL) {
        dL += h.text.length - (h.be - h.bs);
        li++;
      } else {
        dR += h.text.length - (h.be - h.bs);
        ri++;
      }
      continue;
    }
    // A region grows over the other side's hunks that overlap it, or are
    // pure insertions at its edges. Format hunks never widen a region.
    let bs = h.bs,
      be = h.be;
    let lEnd = li,
      rEnd = ri;
    const absorbs = (x) =>
      (x.bs < be && x.be > bs) || (isInsert(x) && (x.bs === bs || x.bs === be));
    if (takeL) lEnd++;
    else rEnd++;
    if (withOther) {
      bs = Math.min(bs, other.bs);
      be = Math.max(be, other.be);
      if (takeL) rEnd++;
      else lEnd++;
    }
    let grew = true;
    while (grew) {
      grew = false;
      while (lEnd < lh.length && absorbs(lh[lEnd])) {
        bs = Math.min(bs, lh[lEnd].bs);
        be = Math.max(be, lh[lEnd].be);
        lEnd++;
        grew = true;
      }
      while (rEnd < rh.length && absorbs(rh[rEnd])) {
        bs = Math.min(bs, rh[rEnd].bs);
        be = Math.max(be, rh[rEnd].be);
        rEnd++;
        grew = true;
      }
    }
    const lss = bs + dL,
      rss = bs + dR;
    let lLen = be - bs,
      rLen = be - bs;
    for (let i = li; i < lEnd; i++)
      lLen += lh[i].text.length - (lh[i].be - lh[i].bs);
    for (let i = ri; i < rEnd; i++)
      rLen += rh[i].text.length - (rh[i].be - rh[i].bs);
    const lse = lss + lLen,
      rse = rss + rLen;
    pushBase(bs);
    const rec = {
      kind: "text",
      node: o.node || null,
      base: sliceHtml(fb, bs, be),
      local: sliceHtml(fl, lss, lse),
      remote: sliceHtml(fr, rss, rse),
      resolved: null,
      range: null,
      bs,
      be,
      lss,
      lse,
      rss,
      rse,
    };
    rec.resolved =
      policy === "local"
        ? rec.local
        : policy === "remote"
          ? rec.remote
          : rec.local + rec.remote;
    if (policy !== "remote")
      pieces.push({ src: "local", from: lss, to: lse, conflict: rec });
    if (policy !== "local")
      pieces.push({ src: "remote", from: rss, to: rse, conflict: rec });
    conflicts.push(rec);
    pos = be;
    dL += lLen - (be - bs);
    dR += rLen - (be - bs);
    li = lEnd;
    ri = rEnd;
  }
  pushBase(n);

  // Base spelling: nbsp and space by the three-way rule, policy on a tie.
  let spelled = fb.text;
  const respelled = []; // [base char offset, source]
  if (Ld.respell.size || Rd.respell.size) {
    const bOff = offsets(bToks);
    const parts = [];
    for (let t = 0; t < bToks.length; t++) {
      const bv = bToks[t].raw;
      const lv = Ld.respell.get(t) ?? bv,
        rv = Rd.respell.get(t) ?? bv;
      if (lv !== bv || rv !== bv)
        respelled.push([
          bOff[t],
          lv !== bv && rv !== bv ? "both" : lv !== bv ? "local" : "remote",
        ]);
      parts.push(
        lv === rv
          ? lv
          : lv === bv
            ? rv
            : rv === bv
              ? lv
              : policy === "local"
                ? lv
                : rv,
      );
    }
    spelled = parts.join("");
  }

  // Merged text with the origin of every character.
  let text = "";
  const ob = [],
    ol = [],
    or = [],
    pieceAt = [];
  for (const p of pieces) {
    const start = text.length;
    if (p.src === "base") {
      for (let i = p.from; i < p.to; i++) {
        ob.push(i);
        ol.push(i + p.dL);
        or.push(i + p.dR);
        pieceAt.push(p);
      }
      text += spelled.slice(p.from, p.to);
    } else if (p.src === "both") {
      for (let k = 0; k < p.len; k++) {
        ob.push(-1);
        ol.push(p.lfrom + k);
        or.push(p.rfrom + k);
        pieceAt.push(p);
      }
      text += fl.text.slice(p.lfrom, p.lfrom + p.len);
    } else {
      const f = p.src === "local" ? fl : fr;
      for (let i = p.from; i < p.to; i++) {
        ob.push(-1);
        ol.push(p.src === "local" ? i : -1);
        or.push(p.src === "remote" ? i : -1);
        pieceAt.push(p);
      }
      text += f.text.slice(p.from, p.to);
    }
    p.ms = start;
    p.me = text.length;
    if (p.conflict) {
      if (!p.conflict.range) p.conflict.range = [start, start];
      p.conflict.range[1] = text.length;
    }
  }
  const m = text.length;
  const bToM = new Int32Array(n + 1).fill(-1),
    lToM = new Int32Array(fl.text.length + 1).fill(-1),
    rToM = new Int32Array(fr.text.length + 1).fill(-1);
  for (let i = 0; i < m; i++) {
    if (ob[i] >= 0) bToM[ob[i]] = i;
    if (ol[i] >= 0) lToM[ol[i]] = i;
    if (or[i] >= 0) rToM[or[i]] = i;
  }

  // Echo pairing: a new local mark and a new remote mark of one tag are one
  // mark when they share an identity, or when their merged ranges overlap.
  const mergedRange = (mk, toM) => {
    let a = -1,
      b = -1;
    for (let i = mk.from; i < mk.to; i++) {
      const x = toM[i];
      if (x >= 0) {
        if (a < 0) a = x;
        b = x + 1;
      }
    }
    return a < 0 ? null : [a, b];
  };
  const newL = [],
    newR = [];
  for (const u of new Set(byEl.values())) {
    if (u.new === "local") newL.push(u);
    else if (u.new === "remote") newR.push(u);
  }
  const unify = (ul, ur) => {
    ul.remote = ur.remote;
    ul.remoteMark = ur.remoteMark;
    ul.new = "both";
    ur.merged = ul;
    byEl.set(ur.remote, ul);
  };
  if (newL.length && newR.length) {
    const ids = o.idOf;
    for (const ul of newL) {
      const id = ids ? ids.local(ul.local) : null;
      if (!id) continue;
      const ur = newR.find(
        (x) => !x.merged && x.tag === ul.tag && ids.remote(x.remote) === id,
      );
      if (ur) unify(ul, ur);
    }
    for (const ul of newL) {
      if (ul.remote) continue;
      const ra = mergedRange(ul.localMark, lToM);
      if (!ra) continue;
      for (const ur of newR) {
        if (ur.merged || ur.tag !== ul.tag) continue;
        const rb = mergedRange(ur.remoteMark, rToM);
        if (rb && Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]) > 0) {
          unify(ul, ur);
          break;
        }
      }
    }
  }
  usCache.clear();

  // The marks of each merged character, as a sorted list. Nesting order:
  // the side whose stack holds both marks decides (local, remote, base);
  // else the mark over more of the output goes outside, then the depth each
  // mark had where it came from, then creation order.
  const extents = new Map();
  const extentOf = (u) => {
    let e = extents.get(u);
    if (e) return e;
    e = [Infinity, -Infinity];
    for (const [mk, toM] of [
      [u.baseMark, bToM],
      [u.localMark, lToM],
      [u.remoteMark, rToM],
    ]) {
      const r = mk && mergedRange(mk, toM);
      if (r) {
        e[0] = Math.min(e[0], r[0]);
        e[1] = Math.max(e[1], r[1]);
      }
    }
    extents.set(u, e);
    return e;
  };
  const orderIn = (stack, a, b) => {
    let ia = -1,
      ib = -1;
    for (let i = 0; i < stack.length; i++) {
      const u = byEl.get(stack[i].el);
      if (u === a) ia = i;
      if (u === b) ib = i;
    }
    return ia >= 0 && ib >= 0 ? ia - ib : 0;
  };
  const listOf = (set, stacks) =>
    [...set].sort((a, b) => {
      for (const st of stacks) {
        const d = orderIn(st, a, b);
        if (d) return d;
      }
      const ea = extentOf(a),
        eb = extentOf(b);
      return ea[0] - eb[0] || eb[1] - ea[1] || a.rank - b.rank || a.id - b.id;
    });
  const setCache = new Map();
  const inheritCache = new Map();
  const marksAt = (i) => {
    const b = ob[i],
      l = ol[i],
      r = or[i];
    const p = pieceAt[i];
    if (b >= 0) {
      const sb = fb.stackAt[b],
        sl = fl.stackAt[l],
        sr = fr.stackAt[r];
      let c1 = setCache.get(sb);
      if (!c1) setCache.set(sb, (c1 = new Map()));
      let c2 = c1.get(sl);
      if (!c2) c1.set(sl, (c2 = new Map()));
      let res = c2.get(sr);
      if (res) return res;
      const B = usOfCached(sb),
        Ls = usOfCached(sl),
        Rs = usOfCached(sr);
      const outSet = new Set();
      for (const u of new Set([...B, ...Ls, ...Rs])) {
        const inB = B.has(u),
          inL = Ls.has(u),
          inR = Rs.has(u);
        if (inL === inR ? inL : inL === inB ? inR : inL) outSet.add(u);
      }
      res = listOf(outSet, [sl, sr, sb]);
      c2.set(sr, res);
      return res;
    }
    if (p.src === "both") {
      const sl = fl.stackAt[l];
      return listOf(usOfCached(sl), [sl, fr.stackAt[r]]);
    }
    const f = p.src === "local" ? fl : fr;
    const st = f.stackAt[p.src === "local" ? l : r];
    if (!p.inherit) return listOf(usOfCached(st), [st]);
    let c1 = inheritCache.get(p);
    if (!c1) inheritCache.set(p, (c1 = new Map()));
    let res = c1.get(st);
    if (res) return res;
    const outSet = new Set(usOfCached(st));
    for (const u of p.inherit.added) outSet.add(resolve(u));
    for (const u of p.inherit.removed) outSet.delete(resolve(u));
    const other = p.src === "local" ? fr : fl;
    const os = (p.src === "local" ? MR.bTo : ML.bTo)[p.inherit.bs];
    res = listOf(outSet, [st, other.stackAt[os]]);
    c1.set(st, res);
    return res;
  };

  // Rebuild.
  const nodes = [];
  const textNodes = [];
  let container = null;
  const stack = [];
  let buf = "",
    bufStart = -1;
  const append = (node) => {
    if (container) container.appendChild(node);
    else nodes.push(node);
  };
  const flush = (i) => {
    if (!buf) return;
    const t = out.createTextNode(buf);
    append(t);
    textNodes.push({
      node: t,
      ms: bufStart,
      me: i,
      local: [],
      u: stack.length ? stack[stack.length - 1].u : null,
    });
    buf = "";
  };
  const movedOut = new Set();
  const opened = new Map();
  const openMark = (u) => {
    const el = out.createElement(u.tag);
    const first = !opened.has(u);
    if (first) {
      opened.set(u, el);
      mergeAttrs(u.base, u.local, u.remote, el);
      provenance.set(el, { base: u.base, local: u.local, remote: u.remote });
      if (!u.base)
        decisions.push({
          kind: "insert",
          el,
          source: u.local && u.remote ? "both" : u.local ? "local" : "remote",
        });
    } else {
      const src = opened.get(u);
      for (const a of src.attributes) setAttr(el, a, a.value);
      provenance.set(el, { base: null, local: null, remote: null });
    }
    append(el);
    stack.push({ u, el });
    container = el;
  };
  const anyAtoms = fb.atoms.length || fl.atoms.length || fr.atoms.length;
  for (let i = 0; i < m; i++) {
    const want = marksAt(i);
    let c = 0;
    while (c < stack.length && c < want.length && stack[c].u === want[c]) c++;
    if (c < stack.length || want.length > c) {
      flush(i);
      while (stack.length > c) {
        stack.pop();
        container = stack.length ? stack[stack.length - 1].el : null;
      }
      while (stack.length < want.length) openMark(want[stack.length]);
    }
    let ab = null,
      al = null,
      ar = null;
    if (anyAtoms) {
      ab = ob[i] >= 0 ? fb.atomAt.get(ob[i]) : null;
      al = ol[i] >= 0 ? fl.atomAt.get(ol[i]) : null;
      ar = or[i] >= 0 ? fr.atomAt.get(or[i]) : null;
    }
    if (ab || al || ar) {
      flush(i);
      // The alignment names the element where it says more than position
      // does: a kept position whose side atom is paired with a different,
      // unequal base atom (a swap), or an inserted atom paired with a base
      // atom whose place this side deleted (a move). Identical atoms pair
      // arbitrarily in the alignment, so an equal twin never overrides.
      const twinOf = (a, A, M) => {
        if (!a || !byTwin) return null;
        const t = baseAtomOf.get(A.reverse.get(a.el)) || null;
        if (!t || t === ab) return null;
        if (ab ? t.el.isEqualNode(ab.el) : M.bTo[t.i] >= 0) return null;
        return t;
      };
      const tr = twinOf(ar, R, MR),
        tl = twinOf(al, L, ML);
      let bk = ab,
        from = null;
      if (tr) {
        bk = tr;
        from = "remote";
      } else if (tl) {
        bk = tl;
        from = "local";
      }
      let el;
      if (bk) {
        if (movedOut.has(bk)) {
          conflicts.push({
            kind: "structure",
            el: null,
            detail: "both-moved",
            base: bk.el,
          });
          continue;
        }
        movedOut.add(bk);
        if (bk === ab) el = mergeAtom(ab.el, al.el, ar.el);
        else {
          const lk = L.map.get(bk.el) || null,
            rk = R.map.get(bk.el) || null;
          el = mergeAtom(bk.el, lk, rk);
          if (!lk || !rk)
            conflicts.push({
              kind: "structure",
              el: null,
              detail: "move-beats-delete",
              base: bk.el,
            });
          decisions.push({ kind: "move", el, source: from });
        }
      } else if (al) {
        el = cloneAtom(al.el, "local");
        if (ar) provenance.get(el).remote = ar.el;
        decisions.push({ kind: "insert", el, source: ar ? "both" : "local" });
      } else {
        el = cloneAtom(ar.el, "remote");
        decisions.push({ kind: "insert", el, source: "remote" });
      }
      append(el);
      continue;
    }
    if (!buf) bufStart = i;
    buf += text[i];
  }
  flush(m);
  if (m === 0 && (fl.placeholder || fr.placeholder || fb.placeholder)) {
    const br = out.createElement("br");
    provenance.set(br, {
      base: fb.placeholder,
      local: fl.placeholder,
      remote: fr.placeholder,
    });
    nodes.push(br);
  }

  const nodeAt = (p) => {
    for (const t of textNodes) if (p >= t.ms && p < t.me) return t;
    for (const t of textNodes) if (p === t.me) return t;
    for (const t of textNodes) if (p < t.ms) return t;
    return textNodes[textNodes.length - 1] || null;
  };

  // Decisions: one text decision per output text node, from the pieces and
  // respellings it holds and the empty pieces (deletions, lost conflicts)
  // at its edges; removed base marks; marks a side moved (its base range
  // deleted, its side range inserted somewhere else).
  const changed = new Map();
  const note = (pos, src) => {
    const t = nodeAt(pos);
    if (!t) return;
    const c = changed.get(t) || { l: false, r: false };
    if (src !== "remote") c.l = true;
    if (src !== "local") c.r = true;
    changed.set(t, c);
  };
  for (const p of pieces)
    if (p.src !== "base") note(p.ms, p.conflict ? "both" : p.src);
  for (const [b, src] of respelled) if (bToM[b] >= 0) note(bToM[b], src);
  for (const t of textNodes) {
    const c = changed.get(t);
    if (c)
      decisions.push({
        kind: "text",
        node: t.node,
        source: c.l && c.r ? "both" : c.l ? "local" : "remote",
      });
  }
  for (const u of baseUs) {
    if (opened.has(u) || (u.local && u.remote)) continue;
    decisions.push({
      kind: "remove",
      source: !u.local && !u.remote ? "both" : u.local ? "remote" : "local",
      base: u.base,
    });
  }
  const allGone = (from, to, map) => {
    if (to <= from) return false;
    for (let i = from; i < to; i++) if (map[i] >= 0) return false;
    return true;
  };
  for (const u of baseUs)
    for (const side of ["local", "remote"]) {
      const mk = u[side + "Mark"],
        bm = u.baseMark;
      if (!mk) continue;
      const M = side === "local" ? ML : MR;
      if (!allGone(bm.from, bm.to, M.bTo) || !allGone(mk.from, mk.to, M.toB))
        continue;
      const h = (side === "local" ? lh : rh).find(
        (x) => x.ss <= mk.from && mk.from < x.se,
      );
      if (h && (h.be <= bm.from || h.bs >= bm.to))
        decisions.push({
          kind: "move",
          el: opened.get(u) || null,
          source: side,
        });
    }

  // Caret map: local flat offset -> merged offset. The position after the
  // last surviving local character before k; if that character was dropped,
  // the position of the first surviving one at or after k.
  const mapLocal = (k) => {
    if (k <= 0) return 0;
    if (k > fl.text.length) k = fl.text.length;
    if (lToM[k - 1] >= 0) return lToM[k - 1] + 1;
    for (let j = k; j < fl.text.length; j++) if (lToM[j] >= 0) return lToM[j];
    return m;
  };

  // Provenance: each local text node goes to the output text node holding
  // its first surviving character. One with none goes to the output node
  // at its mapped position when that node sits in the same mark (the text
  // was replaced in place); otherwise it stays unclaimed, so apply treats
  // it as a leftover, kept or removed with its parent.
  const markOfLocal = (ln) => {
    const u = byEl.get(ln.node.parentNode);
    return u ? resolve(u) : null;
  };
  for (const ln of fl.nodes) {
    let first = -1;
    for (let i = ln.s; i < ln.e; i++)
      if (lToM[i] >= 0) {
        first = lToM[i];
        break;
      }
    let t;
    if (first >= 0) t = nodeAt(first);
    else {
      const p = mapLocal(ln.s),
        u = markOfLocal(ln);
      t =
        textNodes.find((x) => x.u === u && x.me >= p) ||
        textNodes.filter((x) => x.u === u).pop();
    }
    if (t) t.local.push(ln);
  }
  // Caret coverage: per local text node, the offsets that map into each
  // output node.
  const caretOf = new Map();
  for (const ln of fl.nodes) {
    let cur = null;
    for (let k = ln.s; k <= ln.e; k++) {
      const mp = mapLocal(k);
      let t = textNodes.find(
        (x) =>
          mp >= x.ms && mp <= x.me && (mp < x.me || k === ln.e || x === cur),
      );
      if (!t) t = nodeAt(mp);
      if (!t) break;
      if (cur === t) {
        const list = caretOf.get(t);
        list[list.length - 1].to = k - ln.s;
        continue;
      }
      cur = t;
      if (!caretOf.has(t)) caretOf.set(t, []);
      caretOf
        .get(t)
        .push({ node: ln.node, from: k - ln.s, to: k - ln.s, flatStart: ln.s });
    }
  }
  for (const t of textNodes) {
    const locals = t.local;
    let partial = false;
    for (const ln of locals)
      for (let i = ln.s; i < ln.e && !partial; i++)
        if (lToM[i] < t.ms || lToM[i] >= t.me) partial = true;
    provenance.set(t.node, {
      base: null,
      local: locals.map((x) => x.node),
      remote: null,
      caret: caretOf.get(t) || [],
      partial,
    });
    const start = t.ms,
      len = t.me - t.ms;
    const mapper = (runOffset) => {
      let cum = 0,
        flat = -1;
      for (const x of locals) {
        const l = x.e - x.s;
        if (runOffset <= cum + l) {
          flat = x.s + (runOffset - cum);
          break;
        }
        cum += l;
      }
      if (flat < 0) flat = locals.length ? locals[locals.length - 1].e : 0;
      return Math.max(0, Math.min(mapLocal(flat) - start, len));
    };
    mapper.flat = (flat) => Math.max(0, Math.min(mapLocal(flat) - start, len));
    textMappers.set(t.node, mapper);
  }

  const localDiverged = flatSig(flatten(nodes, o)) !== flatSig(fr);
  return {
    nodes,
    text,
    textNodes,
    localDiverged,
    mapLocal,
    conflicts: conflicts.slice(firstConflict),
    granularity: lines ? "line" : "word",
    localHunks: lh,
    remoteHunks: rh,
    lToM,
  };
}
