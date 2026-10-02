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

import {
  textTokens,
  allAscii,
  diffTokens,
  pairedHunks,
  MAX_TOKENS,
  BREAK,
} from "./text-merge.js";
import { boundaryOccurrences, occurrenceBudget } from "./occurrence-map.js";
import { retainedSourcePolicy } from "./source-retention.js";

export const ATOM = "￼";

/**
 * A block boundary inside a flat sequence: a text block flattened as a mark
 * (see `blocks` in flatten) ends with one. A split is then the replacement
 * of a space by a break, a join the reverse, and the words merge as words.
 */
export { BREAK };

/**
 * Work counters for the tests: a bound on steps holds where a wall clock
 * would be flaky. `caret` counts the characters the caret map scans.
 */
export const steps = { caret: 0 };

export const MARK_TAGS = new Set(
  "A ABBR B BDI BDO CITE CODE DATA DEL DFN EM FONT I INS KBD MARK Q S SAMP SMALL SPAN STRIKE STRONG SUB SUP TIME TT U VAR".split(
    " ",
  ),
);
export const ATOM_TAGS = new Set(["BR", "WBR", "IMG"]);
// Block-level elements end an inline segment. Code-like elements (script,
// style, template, textarea, media) stay here too: they have merge rules of
// their own on the per-unit path. Anything else that is not a mark is an atom.
export const BLOCK_TAGS = new Set(
  "ADDRESS ARTICLE ASIDE AUDIO BLOCKQUOTE BODY CANVAS CAPTION CENTER COL COLGROUP DD DETAILS DIALOG DIR DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM FRAME FRAMESET H1 H2 H3 H4 H5 H6 HEAD HEADER HGROUP HR HTML IFRAME LEGEND LI MAIN MATH MENU NAV NOSCRIPT OBJECT OL OPTGROUP OPTION P PRE SCRIPT SECTION SELECT STYLE SUMMARY SVG TABLE TBODY TD TEMPLATE TEXTAREA TFOOT TH THEAD TITLE TR UL VIDEO".split(
    " ",
  ),
);

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
  if (!MARK_TAGS.has(node.tagName)) return !BLOCK_TAGS.has(node.tagName);
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
    pins: [],
    placeholder: null,
    via: null,
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
      if (o.ignored && o.ignored(node)) {
        f.pins.push({ el: node, i: f.text.length });
        continue;
      }
      if (o.skip && o.skip.has(node)) continue;
      // An element read through another (an unchanged stand-in through the
      // subtree it stands for): the walk descends into that one instead.
      const src = (o.via && o.via(node)) || node;
      if (src !== node) (f.via || (f.via = new Map())).set(src, node);
      const tag = node.tagName;
      if (o.blocks && o.blocks.has(node)) {
        // A block starts after a break: text before it never fuses with
        // its first word. Blocks in a row share the break between them.
        if (f.text.length && f.text[f.text.length - 1] !== BREAK) {
          f.stackAt.push(stack);
          f.text += BREAK;
        }
        const m = {
          el: node,
          tag,
          from: f.text.length,
          to: -1,
          depth: stack.length,
          block: true,
        };
        f.marks.push(m);
        const inner = stack.concat([m]);
        walk(src.childNodes, inner);
        f.stackAt.push(inner);
        f.text += BREAK;
        m.to = f.text.length;
        continue;
      }
      const empty = MARK_TAGS.has(tag) && isEmptyMark(src);
      if (
        ATOM_TAGS.has(tag) ||
        !MARK_TAGS.has(tag) ||
        (o.remoteWins && o.remoteWins(node)) ||
        (o.atomize && o.atomize(node)) ||
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
      walk(src.childNodes, stack.concat([m]));
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
    out += atom
      ? atom.el.outerHTML
      : f.text[i] === BREAK
        ? ""
        : escapeHtml(f.text[i]);
  }
  while (stack.length) out += `</${stack.pop().tag.toLowerCase()}>`;
  return out;
}

function markSig(m, ignoreAttribute) {
  const attrs = [...m.el.attributes]
    .filter((a) => !ignoreAttribute(m.el, a.name))
    .map((a) => a.name + "=" + a.value)
    .sort()
    .join("\u0001");
  return m.tag + "|" + attrs;
}

function atomSig(el, ignoreAttribute) {
  const attrs = [...el.attributes]
    .filter((a) => !ignoreAttribute(el, a.name))
    .map((a) => a.name + "=" + a.value)
    .sort()
    .join("\u0001");
  return el.tagName + "|" + attrs + "|" + el.innerHTML;
}

/**
 * Canonical form of a flat model: text, atoms and per-character mark sets.
 * Attributes the caller ignores are left out, as the merge leaves them out.
 */
export function flatSig(f, ignoreAttribute = () => false) {
  const sigOf = new Map();
  const stackSig = (stack) => {
    let s = sigOf.get(stack);
    if (s === undefined) {
      s =
        "{" +
        stack
          .map((m) => markSig(m, ignoreAttribute))
          .sort()
          .join(",") +
        "}";
      sigOf.set(stack, s);
    }
    return s;
  };
  let out = "";
  for (let i = 0; i < f.text.length; i++) {
    const atom = f.atomAt.get(i);
    out +=
      (atom ? "[" + atomSig(atom.el, ignoreAttribute) + "]" : f.text[i]) +
      stackSig(f.stackAt[i]);
  }
  if (f.text.length === 0 && f.placeholder) out += "[br]";
  return out;
}

// ---------------------------------------------------------------------
// Tokens and hunks, in character offsets
// ---------------------------------------------------------------------

function tokensOf(f, fast, lines, keyOf = (a) => a.key) {
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
    out.push({ k: "\0" + keyOf(a), raw: ATOM, len: 1, atom: true });
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
function sideDiff(fs, bToks, sToks, d) {
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
      lead: !!h.lead,
    });
    si = ste;
    bi = h.be;
  }
  const respell = new Map();
  for (const c of d.cosmetic) respell.set(c.bi, c.tok.raw);
  return { hunks, respell };
}

/**
 * A hunk whose base and side text differ only in block breaks and
 * whitespace (a split or a join, which fuses or parts words) becomes the
 * character hunks that change just those, so a break never overlaps the
 * other side's edit to a word beside it.
 */
function refineBreaks(hunks, baseText, sideText) {
  const soft = (c) => c === BREAK || /\s/.test(c);
  const hard = (t) => t.replace(/[\u001E\s]/g, "");
  const out = [];
  for (const h of hunks) {
    const B = baseText.slice(h.bs, h.be),
      S = sideText.slice(h.ss, h.se);
    if (
      (!B.includes(BREAK) && !S.includes(BREAK)) ||
      B.includes(ATOM) ||
      S.includes(ATOM) ||
      hard(B) !== hard(S)
    ) {
      out.push(h);
      continue;
    }
    let i = 0,
      j = 0;
    for (;;) {
      let i2 = i,
        j2 = j;
      while (i2 < B.length && soft(B[i2])) i2++;
      while (j2 < S.length && soft(S[j2])) j2++;
      let a = i,
        b = j;
      while (a < i2 && b < j2 && B[a] === S[b]) (a++, b++);
      let ae = i2,
        be = j2;
      while (ae > a && be > b && B[ae - 1] === S[be - 1]) (ae--, be--);
      if (ae > a || be > b) {
        const text = S.slice(b, be);
        out.push({
          bs: h.bs + a,
          be: h.bs + ae,
          ss: h.ss + b,
          se: h.ss + be,
          text,
          toks: [...text].map((c) => ({ k: c, raw: c, len: 1 })),
          lead: h.lead,
        });
      }
      if (i2 >= B.length) break;
      i = i2 + 1;
      j = j2 + 1;
    }
  }
  return out;
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

function editsFromOrigins(base, side, mapped) {
  const hunks = [];
  let bs = 0,
    ss = 0;
  const gap = (be, se) => {
    if (bs === be && ss === se) return;
    const text = side.text.slice(ss, se);
    hunks.push({
      bs,
      be,
      ss,
      se,
      text,
      toks: textTokens(text, allAscii(text)),
      lead: false,
    });
  };
  for (const run of mapped.runs) {
    gap(run.from, run.target);
    bs = run.to;
    ss = run.target + run.to - run.from;
  }
  gap(base.text.length, side.text.length);
  return { hunks, respell: new Map() };
}

function tokenDiffFromOrigins(edits, bToks, sToks, splitSide) {
  const bOff = offsets(bToks);
  let sOff = offsets(sToks);
  const index = (off, value) => {
    let lo = 0,
      hi = off.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (off[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return off[lo] === value ? lo : -1;
  };
  for (const h of edits.hunks)
    if (index(bOff, h.bs) < 0 || index(bOff, h.be) < 0) return null;
  if (edits.hunks.some((h) => index(sOff, h.ss) < 0 || index(sOff, h.se) < 0)) {
    if (!splitSide) return null;
    const cuts = [];
    for (const h of edits.hunks) cuts.push(h.ss, h.se);
    const refined = [];
    let ci = 0,
      at = 0;
    for (const token of sToks) {
      const end = at + token.len;
      while (ci < cuts.length && cuts[ci] <= at) ci++;
      let from = at;
      while (ci < cuts.length && cuts[ci] < end) {
        const cut = cuts[ci++];
        if (cut > from) {
          const raw = token.raw.slice(from - at, cut - at);
          refined.push(...textTokens(raw, allAscii(raw)));
          from = cut;
        }
      }
      if (from === at) refined.push(token);
      else {
        const raw = token.raw.slice(from - at);
        refined.push(...textTokens(raw, allAscii(raw)));
      }
      at = end;
    }
    sToks = refined;
    sOff = offsets(sToks);
  }
  const parts = [];
  for (const h of edits.hunks) {
    const bs = index(bOff, h.bs),
      be = index(bOff, h.be);
    const ss = index(sOff, h.ss),
      se = index(sOff, h.se);
    if (bs < 0 || be < 0 || ss < 0 || se < 0) return null;
    parts.push({
      bs,
      be,
      toks: sToks.slice(ss, se),
      gap: [],
      group: parts.length,
    });
  }
  return { parts, cosmeticEq: [], tokens: sToks };
}

export function prepareInline(fb, fl, fr, keys = {}, origins = null) {
  return prepareInlineInputs(
    fb,
    fl,
    fr,
    keys.base,
    keys.local,
    keys.remote,
    origins,
    {},
  );
}

function prepareInlineInputs(fb, fl, fr, bKey, lKey, rKey, origins, prepared) {
  const fast = allAscii(stripAtoms(fb), stripAtoms(fl), stripAtoms(fr));
  let bToks = tokensOf(fb, fast, false, bKey),
    lToks = tokensOf(fl, fast, false, lKey),
    rToks = tokensOf(fr, fast, false, rKey);
  const lines =
    bToks.length > MAX_TOKENS ||
    lToks.length > MAX_TOKENS ||
    rToks.length > MAX_TOKENS;
  if (lines) {
    bToks = tokensOf(fb, fast, true, bKey);
    lToks = tokensOf(fl, fast, true, lKey);
    rToks = tokensOf(fr, fast, true, rKey);
  }
  const localOrigins = origins?.local
    ? editsFromOrigins(fb, fl, origins.local)
    : null;
  const remoteOrigins = origins?.remote
    ? editsFromOrigins(fb, fr, origins.remote)
    : null;
  const localDiff = localOrigins
    ? tokenDiffFromOrigins(localOrigins, bToks, lToks, !lines)
    : diffTokens(bToks, lToks);
  const remoteDiff = remoteOrigins
    ? tokenDiffFromOrigins(remoteOrigins, bToks, rToks, !lines)
    : diffTokens(bToks, rToks);
  if (localOrigins && localDiff) lToks = localDiff.tokens;
  if (remoteOrigins && remoteDiff) rToks = remoteDiff.tokens;
  let localEdits, remoteEdits;
  if (localDiff && remoteDiff) {
    const paired = pairedHunks(localDiff, remoteDiff, bToks);
    localEdits = sideDiff(fl, bToks, lToks, {
      hunks: paired.lh,
      cosmetic: paired.cosL,
    });
    remoteEdits = sideDiff(fr, bToks, rToks, {
      hunks: paired.rh,
      cosmetic: paired.cosR,
    });
  } else {
    localEdits = localOrigins || sideDiff(fl, bToks, lToks, localDiff);
    remoteEdits = remoteOrigins || sideDiff(fr, bToks, rToks, remoteDiff);
  }
  localEdits.hunks = refineBreaks(localEdits.hunks, fb.text, fl.text);
  remoteEdits.hunks = refineBreaks(remoteEdits.hunks, fb.text, fr.text);
  prepared.base = fb;
  prepared.local = fl;
  prepared.remote = fr;
  prepared.lines = lines;
  prepared.baseTokens = bToks;
  prepared.localEdits = localEdits;
  prepared.remoteEdits = remoteEdits;
  prepared.localMap = charMaps(
    localEdits.hunks,
    fb.text.length,
    fl.text.length,
  );
  prepared.remoteMap = charMaps(
    remoteEdits.hunks,
    fb.text.length,
    fr.text.length,
  );
  prepared.full = null;
  return prepared;
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const FORMAT_SPACE = /\s/;

function formatBlank(text, from, to) {
  for (let i = from; i < to; i++) if (!FORMAT_SPACE.test(text[i])) return false;
  return true;
}

function deletedEditedMark(state, u, side) {
  const cache = state.cache[side] || (state.cache[side] = new Map());
  if (cache.has(u)) return cache.get(u);
  const deleted = side === 0 ? "local" : "remote";
  const other = side === 0 ? "remote" : "local";
  const bm = u.baseMark,
    em = u[other + "Mark"];
  let valid = !u.block && !u[deleted] && !!em && bm.to > bm.from;
  if (valid) {
    const D = side === 0 ? state.ML : state.MR;
    const E = side === 0 ? state.MR : state.ML;
    const fs = side === 0 ? state.fr : state.fl;
    let edited = false;
    for (let i = bm.from; i < bm.to; i++) {
      if (D.bTo[i] >= 0) {
        valid = false;
        break;
      }
      if (E.bTo[i] < 0 && !FORMAT_SPACE.test(state.fb.text[i])) edited = true;
    }
    if (valid && !edited)
      for (let i = em.from; i < em.to; i++)
        if (E.toB[i] < 0 && !FORMAT_SPACE.test(fs.text[i])) {
          edited = true;
          break;
        }
    valid &&= edited;
  }
  cache.set(u, valid);
  return valid;
}

function formattingYield(
  state,
  hs,
  from,
  to,
  others,
  start,
  end,
  side,
  policy,
) {
  const fs = side === 0 ? state.fl : state.fr;
  let marks = null;
  for (let at = from; at < to; at++) {
    const h = hs[at];
    if (!formatBlank(fs.text, h.ss, h.se)) return null;
    if (formatBlank(state.fb.text, h.bs, h.be)) {
      if (
        (h.bs < h.be && h.ss < h.se) ||
        FORMAT_SPACE.test(state.fb.text[h.bs - 1] || "") ||
        FORMAT_SPACE.test(state.fb.text[h.be] || "")
      )
        continue;
      return null;
    }
    let marked = false;
    for (let i = h.bs; i < h.be; i++) {
      if (FORMAT_SPACE.test(state.fb.text[i])) continue;
      let found = null;
      for (const mk of state.fb.stackAt[i]) {
        const u = state.byEl.get(mk.el);
        if (u && deletedEditedMark(state, u, side)) {
          found = u;
          break;
        }
      }
      if (!found) return null;
      (marks || (marks = new Set())).add(found);
      marked = true;
    }
    if (!marked) return null;
  }
  if (!marks) {
    if ((side === 0 ? "local" : "remote") !== policy) return null;
    const otherFlat = side === 0 ? state.fr : state.fl;
    let edited = false;
    for (let i = start; i < end; i++) {
      const h = others[i];
      if (!formatBlank(state.fb.text, h.bs, h.be)) return null;
      if (!formatBlank(otherFlat.text, h.ss, h.se)) edited = true;
    }
    if (!edited) return null;
  }
  return marks || 0;
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
 * @param {{ base?: Function, local: Function, remote: Function }} [o.idOf] - identity of an element, for echo pairing and for telling equal atoms apart
 * @param {(n: Node) => boolean} [o.ignored]
 * @param {(el: Element, name: string) => boolean} [o.ignoreAttribute] - left out of localDiverged
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
  const record = o.conflict || ((c) => conflicts.push(c));
  // What the recovery of a text clash needs from this segment: the three
  // flats now, the merged text and its output nodes once they exist.
  const segMeta = {
    textNodes: null,
    text: "",
    out: null,
    atomOut: new Map(),
    breakOut: new Map(),
    node: o.node || null,
  };
  const textMetas = [];
  // Atoms pair by tag and position in the diff; the rebuild lets the
  // alignment override that pairing where it names a different element.
  const byTwin = !!(L && L.reverse && L.map && R && R.reverse && R.map);

  // A mark a side moved to another block travels whole, as an atom, in
  // every flat that holds it: the side that moved it deleted an atom here,
  // the destination merges it with both sides' versions (o.moveIn), and an
  // edit the other side made inside it goes with it instead of conflicting
  // with the move.
  const atomizers = { base: null, local: null, remote: null };
  if (!o.prepared && byTwin && o.moveIn) {
    const within = (nodes) => (x) =>
      nodes.some((n) => n === x || (n.nodeType === 1 && n.contains(x)));
    const inL = within(o.local),
      inR = within(o.remote),
      inB = within(o.base);
    const moved = new Set();
    const visit = (el) => {
      if (!MARK_TAGS.has(el.tagName)) return;
      const lt = L.map.get(el),
        rt = R.map.get(el);
      if ((lt && !inL(lt)) || (rt && !inR(rt))) moved.add(el);
      for (const c of el.children) visit(c);
    };
    for (const n of o.base) if (n.nodeType === 1) visit(n);
    const side = (A) => (el) => {
      if (!MARK_TAGS.has(el.tagName)) return false;
      const b = A.reverse.get(el);
      return !!b && (moved.has(b) || !inB(b));
    };
    if (moved.size) atomizers.base = (el) => moved.has(el);
    atomizers.local = side(L);
    atomizers.remote = side(R);
  }
  // An atom a side moved out of this segment is not in it: it merges at its
  // destination with both sides' versions (o.moveIn). Left in the base and
  // in the other side here, it would read as a deletion by the moving side
  // and could glue that side's neighbouring edits into a conflict, or be
  // emitted a second time by a region that takes the other side whole.
  const skip = { base: new Set(), local: new Set(), remote: new Set() };
  if (!o.prepared && byTwin && o.moveIn) {
    const within = (nodes) => (x) =>
      nodes.some((n) => n === x || (n.nodeType === 1 && n.contains(x)));
    const inL = within(o.local),
      inR = within(o.remote);
    for (const a of flatten(o.base, { ...o, atomize: atomizers.base }).atoms) {
      const lt = L.map.get(a.el),
        rt = R.map.get(a.el);
      const outL = !!lt && !inL(lt),
        outR = !!rt && !inR(rt);
      if (!outL && !outR) continue;
      if (outL) o.movePlanned?.(a.el, "local", lt, null);
      if (outR) o.movePlanned?.(a.el, "remote", rt, null);
      skip.base.add(a.el);
      if (lt && !outL) skip.local.add(lt);
      if (rt && !outR) skip.remote.add(rt);
      // A side read as base (a block it deleted, kept for the other side's
      // edit) holds the base element itself.
      if (inL(a.el)) skip.local.add(a.el);
      if (inR(a.el)) skip.remote.add(a.el);
    }
  }
  const fb =
      o.prepared?.base ||
      flatten(o.base, {
        ...o,
        atomize: atomizers.base,
        skip: skip.base,
      }),
    fl =
      o.prepared?.local ||
      flatten(o.local, {
        ...o,
        atomize: atomizers.local,
        skip: skip.local,
      }),
    fr =
      o.prepared?.remote ||
      flatten(o.remote, {
        ...o,
        atomize: atomizers.remote,
        skip: skip.remote,
      });
  const baseAtomOf = new Map(fb.atoms.map((a) => [a.el, a]));
  // For the conflict report: a side's whole segment, an atom the other side
  // moved out of it included, so its scope reads as the DOM between its ends.
  const fullFlats = {};
  const full = (sd) => {
    if (o.prepared) return o.prepared.full?.(sd) || null;
    if (!skip[sd].size) return null;
    if (!fullFlats[sd])
      fullFlats[sd] = flatten(o[sd], { ...o, atomize: atomizers[sd] });
    return fullFlats[sd];
  };

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
        record(
          {
            kind: "attr",
            el,
            name,
            base: bv,
            local: lv,
            remote: rv,
            resolved: v,
          },
          { el, sample },
        );
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

  // Atom keys. With an alignment an atom keys by what it is, so two images
  // in one block never stand for each other: a side atom paired with a base
  // atom of this segment takes that atom's key (an edited image still reads
  // as the same one), and any other keys by its content. An atom the
  // alignment pairs with a base element outside this segment moved in from
  // elsewhere and keys apart from everything here. Without an alignment,
  // atoms key by tag and pair by position.
  const contentKey = o.atomKey || ((el) => atomSig(el, () => false));
  const atomKeys = (fs, A) => {
    const keyOf = new Map();
    for (const a of fs.atoms) {
      // A remote-wins span holds whatever remote has: its content is no
      // edit of either side, and it keys by what it is and its id.
      if (o.remoteWins && o.remoteWins(a.el) && MARK_TAGS.has(a.el.tagName))
        keyOf.set(a, "w" + a.el.tagName + "#" + (a.el.id || ""));
      else if (!byTwin) keyOf.set(a, a.key);
      else if (fs === fb) keyOf.set(a, "=" + contentKey(a.el));
      else {
        const b = A.reverse.get(a.el);
        const t = b ? baseAtomOf.get(b) : null;
        if (t) keyOf.set(a, "=" + contentKey(t.el));
        else if (b) keyOf.set(a, "m" + contentKey(a.el));
        else keyOf.set(a, "=" + contentKey(a.el));
      }
    }
    return (a) => keyOf.get(a);
  };
  const bKey = atomKeys(fb, null),
    lKey = atomKeys(fl, L),
    rKey = atomKeys(fr, R);

  let origins = o.certifiedOrigins
    ? o.certifiedOrigins(fb, fl, fr, bKey, lKey, rKey)
    : null;
  if (origins?.fallback) return null;
  if (!origins && !o.prepared && o.blocks) {
    const budget = occurrenceBudget();
    const local = boundaryOccurrences({
      base: fb,
      side: fl,
      baseOf: (el) => L?.reverse?.get(el) || null,
      budget,
    });
    const remote = boundaryOccurrences({
      base: fb,
      side: fr,
      baseOf: (el) => R?.reverse?.get(el) || null,
      budget,
    });
    if (local.status === "ready" || remote.status === "ready")
      origins = {
        local: local.status === "ready" ? local : null,
        remote: remote.status === "ready" ? remote : null,
      };
  }
  const prepared =
    o.prepared ||
    prepareInlineInputs(fb, fl, fr, bKey, lKey, rKey, origins, segMeta);
  const lines = prepared.lines,
    bToks = prepared.baseTokens,
    Ld = prepared.localEdits,
    Rd = prepared.remoteEdits,
    ML = prepared.localMap,
    MR = prepared.remoteMap;
  const n = fb.text.length;

  // Base atoms a side deleted in place and inserted elsewhere in this
  // segment: moves, not deletions. The other side's edits merge at the
  // destination. (Atoms moved out of the segment are not in the flats.)
  const sideAtomOf = (fs) => new Map(fs.atoms.map((a) => [a.el, a]));
  const lAtomOf = sideAtomOf(fl),
    rAtomOf = sideAtomOf(fr);
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
  // A block element joined to the segment (see merge.js) keeps the per-unit
  // rule that an edit beats a delete: one side deleting it while the other
  // changed it is no text conflict, and the rebuild keeps the block.
  // A remote-wins span is an atom of the text, not a block.
  const isBlock = (el) => !isInlineUnit(el, { ...o, remoteWins: null });
  const soft = new Set();
  if (byTwin)
    for (const a of fb.atoms) {
      if (!isBlock(a.el)) continue;
      const lt = L.map.get(a.el) || null,
        rt = R.map.get(a.el) || null;
      const t = lt && !rt ? lt : rt && !lt ? rt : null;
      if (t && (lAtomOf.has(t) || rAtomOf.has(t)) && !t.isEqualNode(a.el))
        soft.add(a);
    }

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
    u.block = !!m.block;
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
            if (c.tag !== m.tag || c[side] || !!c.block !== !!m.block) continue;
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
        u.block = !!m.block;
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
  // Block marks are a layer of their own (blockOf below): the inline
  // rules (format hunks, inheritance, nesting) never see them.
  const usOf = (stack) => {
    const s = new Set();
    for (const m of stack) if (!m.block) s.add(byEl.get(m.el));
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
    h.be > h.bs ? [h.bs, h.be - 1] : [h.bs - 1, h.bs];
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
  // A hunk that only puts in or takes out block breaks (whitespace aside):
  // a split or a join. Touching the other side's edit is not a conflict
  // (Decision 2 is about replacements of words): each lands beside the
  // break, in the block its own position names.
  const structural = (h, fs, peer = null) => {
    let brk = false;
    for (let i = h.bs; i < h.be; i++) {
      const c = fb.text[i];
      if (c === BREAK) brk = true;
      else if (!/\s/.test(c)) return false;
    }
    for (let i = h.ss; i < h.se; i++) {
      const c = fs.text[i];
      if (c === BREAK) brk = true;
      else if (!/\s/.test(c)) {
        const atom = peer && o.scopeUnits && isInsert(h) && fs.atomAt.get(i);
        if (!atom || !isBlock(atom.el)) return false;
        if (peer.ss !== peer.se || peer.bs >= peer.be) return false;
        for (let j = peer.bs; j < peer.be; j++)
          if (!/\s/.test(fb.text[j])) return false;
        const side = fs === fl ? 1 : 2;
        if (
          !o.scopeUnits[side].includes(atom.el) ||
          (side === 1 ? L : R)?.reverse.has(atom.el)
        )
          return false;
        brk = true;
      }
    }
    return brk;
  };
  const overlaps = (a, b) => a.bs < b.be && b.bs < a.be;
  const touches = (a, b) =>
    a.bs <= b.be && b.bs <= a.be && isInsert(a) !== isInsert(b);
  const hasBreak = (h, fs) =>
    fb.text.slice(h.bs, h.be).includes(BREAK) ||
    fs.text.slice(h.ss, h.se).includes(BREAK);
  // A replacement of a block's whole text rewrites the block: it meets a
  // join or split beside it as a conflict, as any text replacement does.
  const wholeBlock = (h) => {
    if (isInsert(h)) return false;
    let a = h.bs,
      b = h.be;
    while (a > 0 && /\s/.test(fb.text[a - 1])) a--;
    while (b < fb.text.length && /\s/.test(fb.text[b])) b++;
    return (
      (a === 0 || fb.text[a - 1] === BREAK) &&
      (b === fb.text.length || fb.text[b] === BREAK)
    );
  };
  const wordEdit = (h, fs) => !hasBreak(h, fs) && !wholeBlock(h);
  const textConflict = (l, r) =>
    overlaps(l, r) ||
    (touches(l, r) &&
      !(l.transferIn || l.transferOut || r.transferIn || r.transferOut) &&
      !(structural(l, fl, r) && wordEdit(r, fr)) &&
      !(structural(r, fr, l) && wordEdit(l, fl)));
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
      if (a.i < h.bs || a.i >= h.be || moved.has(a) || soft.has(a)) continue;
      const si = otherM.bTo[a.i];
      const oa = si >= 0 ? otherFlat.atomAt.get(si) : null;
      if (oa && !oa.el.isEqualNode(a.el)) return true;
    }
    return false;
  };

  // Pieces, in base order.
  const pieces = [];
  let formattingState = null,
    keptByEdit = null;
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
    let takeL =
      !!l && (!r || l.bs < r.bs || (l.bs === r.bs && l.be <= r.be && !r.lead));
    // Two insertions at one point, one of them a break: the text goes
    // first, so it stays in the block the break ends.
    if (l && r && l.bs === r.bs && isInsert(l) && isInsert(r)) {
      const sl = structural(l, fl),
        sr = structural(r, fr);
      if (sl !== sr) takeL = sr;
    }
    const h = takeL ? l : r,
      other = takeL ? r : l;
    const same = !!other && sameHunk(l, r);
    // A hunk both sides made (the other side's hunk is this side's next
    // one) is no conflict with the edit it touches.
    const echoed =
      !!other &&
      (takeL
        ? !!lh[li + 1] && sameHunk(lh[li + 1], r)
        : !!rh[ri + 1] && sameHunk(l, rh[ri + 1]));
    // Two different texts typed into an empty segment collide.
    const withOther =
      !!other && !same && !echoed && (n === 0 || textConflict(l, r));
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
        owner: l.owner || r.owner || null,
        transfer: l.transferIn || r.transferIn || null,
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
        owner: h.owner || null,
        transfer: h.transferIn || null,
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
    if (
      li < lEnd &&
      ri < rEnd &&
      !origins &&
      !o.prepared &&
      !o.nativeTransfers &&
      !o.sourceRetentions &&
      !fb.atoms.length &&
      !fl.atoms.length &&
      !fr.atoms.length &&
      !fb.pins.length &&
      !fl.pins.length &&
      !fr.pins.length
    ) {
      formattingState ||= { fb, fl, fr, ML, MR, byEl, cache: [null, null] };
      const lY = formattingYield(
        formattingState,
        lh,
        li,
        lEnd,
        rh,
        ri,
        rEnd,
        0,
        policy,
      );
      const rY = formattingYield(
        formattingState,
        rh,
        ri,
        rEnd,
        lh,
        li,
        lEnd,
        1,
        policy,
      );
      if ((lY === null) !== (rY === null)) {
        const localDeleted = lY !== null,
          marks = localDeleted ? lY : rY;
        if (marks) {
          keptByEdit ||= new Map();
          for (const u of marks)
            keptByEdit.set(u, localDeleted ? "local" : "remote");
        }
        pieces.push(
          localDeleted
            ? { src: "remote", from: rss, to: rse }
            : { src: "local", from: lss, to: lse },
        );
        pos = be;
        dL += lLen - (be - bs);
        dR += rLen - (be - bs);
        li = lEnd;
        ri = rEnd;
        continue;
      }
    }
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
    const effectivePolicy = o.sourceRetentions
      ? retainedSourcePolicy(
          o.sourceRetentions,
          o.scope?.base,
          fb,
          fl,
          fr,
          policy,
          rec,
        )
      : policy;
    rec.resolved =
      effectivePolicy === "local"
        ? rec.local
        : effectivePolicy === "remote"
          ? rec.remote
          : rec.local + rec.remote;
    if (effectivePolicy !== "remote")
      pieces.push({ src: "local", from: lss, to: lse, conflict: rec });
    if (effectivePolicy !== "local")
      pieces.push({ src: "remote", from: rss, to: rse, conflict: rec });
    const meta = {
      site: "inline",
      policy: effectivePolicy,
      fb,
      fl,
      fr,
      scope: o.scope || null,
      synthetic: !!o.synthetic,
      full,
      merged: segMeta,
    };
    textMetas.push(meta);
    record(rec, meta);
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
        ol.push(o.nativeTransfers ? ML.bTo[i] : i + p.dL);
        or.push(o.nativeTransfers ? MR.bTo[i] : i + p.dR);
        pieceAt.push(p);
      }
      text += spelled.slice(p.from, p.to);
    } else if (p.src === "both") {
      for (let k = 0; k < p.len; k++) {
        const at =
          p.transfer &&
          (p.transfer.side === "remote" ? p.rfrom + k : p.lfrom + k);
        ob.push(
          p.transfer && at >= p.transfer.ss && at < p.transfer.se
            ? p.transfer.bs + at - p.transfer.ss
            : -1,
        );
        ol.push(p.lfrom + k);
        or.push(p.rfrom + k);
        pieceAt.push(p);
      }
      text += fl.text.slice(p.lfrom, p.lfrom + p.len);
    } else {
      const f = p.src === "local" ? fl : fr;
      const movedElsewhere =
        p.transfer &&
        o.nativeTransfers.byOrigin[p.src === "local" ? "remote" : "local"].get(
          p.transfer.key,
        );
      for (let i = p.from; i < p.to; i++) {
        const b =
          p.transfer && i >= p.transfer.ss && i < p.transfer.se
            ? p.transfer.bs + i - p.transfer.ss
            : -1;
        const other =
          b >= 0 && (!movedElsewhere || movedElsewhere.destination === p.owner)
            ? (p.src === "local" ? MR : ML).bTo[b]
            : -1;
        ob.push(b);
        ol.push(p.src === "local" ? i : other);
        or.push(p.src === "remote" ? i : other);
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
        (x) =>
          !x.merged &&
          x.tag === ul.tag &&
          !!x.block === !!ul.block &&
          ids.remote(x.remote) === id,
      );
      if (ur) unify(ul, ur);
    }
    for (const ul of newL) {
      if (ul.remote) continue;
      const ra = mergedRange(ul.localMark, lToM);
      if (!ra) continue;
      for (const ur of newR) {
        if (ur.merged || ur.tag !== ul.tag || !!ur.block !== !!ul.block)
          continue;
        const rb = mergedRange(ur.remoteMark, rToM);
        if (rb && Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]) > 0) {
          unify(ul, ur);
          break;
        }
      }
    }
  }
  usCache.clear();

  // The block mark (if any) on a side's stack, as its merged unit.
  const blockU = (stack) => {
    for (const mk of stack) if (mk.block) return resolve(byEl.get(mk.el));
    return null;
  };
  const anyBlocks =
    fb.marks.some((mk) => mk.block) ||
    fl.marks.some((mk) => mk.block) ||
    fr.marks.some((mk) => mk.block);
  // The break that ends a run of characters carries the block they land
  // in: a base break names its block on the three sides (the sides may
  // disagree, and the disagreement resolves like any three-way choice), a
  // break one side inserted names that side's block. Characters after the
  // last break, and before a break no block owns, are loose text. A join
  // deletes a break, so the words of the second block follow the first
  // block's break into it; a split inserts one, so the words after it
  // follow the new block's break.
  const blockOf = new Array(m).fill(null);
  const glue = new Set();
  if (o.nativeTransfers) {
    for (let i = 0; i < m; i++) {
      const owner = pieceAt[i].owner;
      blockOf[i] = owner
        ? resolve(byEl.get(owner))
        : ob[i] >= 0
          ? blockU(fb.stackAt[ob[i]])
          : null;
    }
  } else if (anyBlocks) {
    const threeWay = (B, Ls, Rs) => {
      const cands = new Set([B, Ls, Rs]);
      cands.delete(null);
      const kept = [];
      for (const u of cands) {
        const inB = u === B,
          inL = u === Ls,
          inR = u === Rs;
        if (inL === inR ? inL : inL === inB ? inR : inL) kept.push(u);
      }
      if (kept.length <= 1) return kept[0] || null;
      const pick = policy === "local" ? Ls : Rs;
      return kept.includes(pick) ? pick : kept[0];
    };
    const at = (f, i) => (i >= 0 ? blockU(f.stackAt[i]) : null);
    // A block closes one run when it can: when the three-way pick already
    // closed an earlier run (a join's block, kept by the side that joined),
    // a base break keeps its own block if no other break picks it. Two runs
    // that both start with the block's own words are a split of it: they
    // share it, and the second run gets a copy.
    const picks = new Map();
    for (let i = 0; i < m; i++) {
      if (text[i] !== BREAK) continue;
      const B = ob[i] >= 0 ? at(fb, ob[i]) : null,
        Ls = at(fl, ol[i]),
        Rs = at(fr, or[i]);
      picks.set(i, [B, ob[i] >= 0 ? threeWay(B, Ls, Rs) : Ls || Rs]);
    }
    const picked = new Set([...picks.values()].map((p) => p[1]));
    const wordy = (c) => c !== BREAK && c !== ATOM && !/\s/.test(c);
    const firstFrom = (s, e) => {
      let k = s;
      while (k < e && !wordy(text[k])) k++;
      return k < e && ob[k] >= 0 ? at(fb, ob[k]) : null;
    };
    const closedBy = new Map();
    let runStart = 0;
    for (let i = 0; i < m; i++) {
      if (text[i] !== BREAK) continue;
      const [B, pick] = picks.get(i);
      const from = firstFrom(runStart, i);
      let u = pick;
      const split = closedBy.get(u) === u && from === u;
      if (
        u &&
        closedBy.has(u) &&
        !split &&
        B &&
        !closedBy.has(B) &&
        !picked.has(B)
      )
        u = B;
      if (u && !closedBy.has(u)) closedBy.set(u, from);
      for (let k = runStart; k <= i; k++) blockOf[k] = u;
      runStart = i + 1;
    }
    // No side had words outside a block, so none land there: a run whose
    // break every side's reading dropped (a join beside the other side's
    // break edit) lands in the block its words came from, or when another
    // run holds that block, continues the block before it or the one after.
    const loose = (f) => {
      for (let i = 0; i < f.text.length; i++)
        if (wordy(f.text[i]) && !at(f, i)) return true;
      return false;
    };
    if (!loose(fb) && !loose(fl) && !loose(fr)) {
      const runs = [];
      let s = 0;
      for (let i = 0; i < m; i++)
        if (text[i] === BREAK || i === m - 1) {
          runs.push([s, i]);
          s = i + 1;
        }
      const held = new Set(blockOf);
      for (let r = 0; r < runs.length; r++) {
        const [s, e] = runs[r];
        if (blockOf[e]) continue;
        let k = s;
        while (k <= e && !wordy(text[k])) k++;
        if (k > e) continue;
        const B = at(fb, ob[k]),
          Ls = at(fl, ol[k]),
          Rs = at(fr, or[k]);
        const own = threeWay(B, Ls, Rs) || Ls || Rs || B;
        if (own && !held.has(own)) {
          held.add(own);
          for (let j = s; j <= e; j++) blockOf[j] = own;
          continue;
        }
        const prev = r > 0 && blockOf[runs[r - 1][1]];
        const next = r + 1 < runs.length && blockOf[runs[r + 1][1]];
        if (prev) glue.add(runs[r - 1][1]);
        else if (next && text[e] === BREAK) glue.add(e);
        else continue;
        for (let k = s; k <= e; k++) blockOf[k] = prev || next;
      }
    }
  }

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
  const nativeMarks = o.nativeTransfers ? [] : null;
  const marksAt = (i) => {
    if (nativeMarks) return nativeMarks;
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
      // The same text inserted on both sides carries the marks of either.
      const sl = fl.stackAt[l],
        sr = fr.stackAt[r];
      return listOf(new Set([...usOfCached(sl), ...usOfCached(sr)]), [sl, sr]);
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

  // Caret map: local flat offset -> merged offset. The position after the
  // last surviving local character before k; if that character was dropped,
  // the position of the first surviving one at or after k.
  // nextM[k] is the merged offset of the first surviving local character
  // at or after k, filled in one backward pass so each lookup is O(1).
  const nextM = new Int32Array(fl.text.length + 1);
  nextM[fl.text.length] = m;
  for (let j = fl.text.length - 1; j >= 0; j--)
    nextM[j] = lToM[j] >= 0 ? lToM[j] : nextM[j + 1];
  steps.caret += fl.text.length;
  const mapLocal = (k) => {
    if (k <= 0) return 0;
    if (k > fl.text.length) k = fl.text.length;
    if (lToM[k - 1] >= 0) return lToM[k - 1] + 1;
    return nextM[k];
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
  const claimedLocal = new Set();
  const openMark = (u) => {
    const el = out.createElement(u.tag);
    if (u.block) blockEls.add(el);
    const first = !opened.has(u);
    if (first) {
      opened.set(u, el);
      mergeAttrs(u.base, u.local, u.remote, el);
      provenance.set(el, { base: u.base, local: u.local, remote: u.remote });
      // A mark new here whose alignment twin is a base element elsewhere
      // moved in from another block.
      const from = (A, side) =>
        byTwin && u[side] && A.reverse.get(u[side]) ? side : null;
      const movedIn = !u.base && (from(L, "local") || from(R, "remote"));
      if (movedIn) {
        // Its live element is the local twin of that base element, which
        // apply moves here instead of building a new one.
        const b =
          movedIn === "local"
            ? L.reverse.get(u.local)
            : R.reverse.get(u.remote);
        const p = provenance.get(el);
        p.local = p.local || L.map.get(b) || null;
        p.remote = p.remote || R.map.get(b) || null;
        decisions.push({ kind: "move", el, source: movedIn });
        o.moveBuilt?.(b, movedIn, u[movedIn], el);
      } else if (!u.base)
        decisions.push({
          kind: "insert",
          el,
          source: u.local && u.remote ? "both" : u.local ? "local" : "remote",
        });
      // A live element holds one output element. When two claim it (a
      // block the other side split, whose halves both trace back to it),
      // the first keeps it and the later one is built new.
      const p = provenance.get(el);
      if (p.local) {
        if (claimedLocal.has(p.local)) p.local = null;
        else claimedLocal.add(p.local);
      }
    } else {
      // A later piece of the same element (a block split in two, a mark cut
      // by another) copies its attributes but not its authored identity,
      // which stays unique on the first piece.
      const src = opened.get(u);
      for (const a of src.attributes)
        if (a.name !== "id" && a.name !== "data-id") setAttr(el, a, a.value);
      provenance.set(el, { base: null, local: null, remote: null });
    }
    append(el);
    stack.push({ u, el });
    container = el;
  };
  // Pins: local ignored elements, placed where their local offset maps to.
  // Apply positions the live element there and never touches it.
  const pinNodes = new Set();
  const pinsAt = new Map();
  for (const p of fl.pins) {
    const at = mapLocal(p.i);
    if (!pinsAt.has(at)) pinsAt.set(at, []);
    pinsAt.get(at).push(p);
  }
  const emitPins = (i) => {
    const list = pinsAt.get(i);
    if (!list) return;
    flush(i);
    for (const p of list) {
      const el =
        p.el.namespaceURI &&
        p.el.namespaceURI !== "http://www.w3.org/1999/xhtml"
          ? out.createElementNS(p.el.namespaceURI, p.el.tagName)
          : out.createElement(p.el.tagName);
      provenance.set(el, {
        base: null,
        local: p.el,
        remote: null,
        pinned: true,
      });
      pinNodes.add(el);
      append(el);
    }
  };
  const anyAtoms = fb.atoms.length || fl.atoms.length || fr.atoms.length;
  const atomsAt = (i) => {
    if (!anyAtoms) return null;
    const ab = ob[i] >= 0 ? fb.atomAt.get(ob[i]) : null,
      al = ol[i] >= 0 ? fl.atomAt.get(ol[i]) : null,
      ar = or[i] >= 0 ? fr.atomAt.get(or[i]) : null;
    return ab || al || ar ? { ab, al, ar } : null;
  };
  // What each atom position emits, decided before anything is built so the
  // atoms no position claimed can be placed as well. The alignment names
  // the element where it says more than position does: a kept position
  // whose side atom is paired with a different, unequal base atom (a swap),
  // or an inserted atom paired with a base atom whose place this side
  // deleted (a move). Identical atoms pair arbitrarily in the alignment, so
  // an equal twin overrides only when its identity names it (a swap of two
  // equal atoms the identity tells apart). An atom paired with a base element
  // outside this segment moved in from another block and merges here.
  const sameId = (t, a, side) => {
    const ids = o.idOf;
    if (!ids || !ids.base) return false;
    const id = ids.base(t.el);
    return id != null && id === ids[side](a.el);
  };
  const twinOf = (a, A, M, ab, side) => {
    if (!a || !byTwin) return null;
    const t = baseAtomOf.get(A.reverse.get(a.el)) || null;
    if (!t || t === ab) return null;
    if (ab ? t.el.isEqualNode(ab.el) && !sameId(t, a, side) : M.bTo[t.i] >= 0)
      return null;
    return t;
  };
  const fromOutside = (a, A) => {
    if (!a || !byTwin || !o.moveIn) return null;
    const b = A.reverse.get(a.el);
    return b && !baseAtomOf.has(b) ? b : null;
  };
  // Identical atoms are interchangeable and the alignment pairs them
  // arbitrarily, so only an atom whose key is unique on all three sides is
  // known to be the one a side's copy stands for.
  const counts = (fs, key) => {
    const c = new Map();
    for (const a of fs.atoms) c.set(key(a), (c.get(key(a)) || 0) + 1);
    return c;
  };
  const cB = counts(fb, bKey),
    cL = counts(fl, lKey),
    cR = counts(fr, rKey);
  const unique = (a) => {
    const k = bKey(a);
    return cB.get(k) === 1 && (cL.get(k) || 0) <= 1 && (cR.get(k) || 0) <= 1;
  };
  const choices = new Map();
  const claimed = new Set(),
    claimedOut = new Set(),
    copied = new Set();
  let displaced = null;
  for (let i = 0; i < m; i++) {
    const at = atomsAt(i);
    if (!at) continue;
    const { ab, al, ar } = at;
    const tr = twinOf(ar, R, MR, ab, "remote"),
      tl = twinOf(al, L, ML, ab, "local");
    let bk = ab,
      from = null;
    if (tr) {
      bk = tr;
      from = "remote";
    } else if (tl) {
      bk = tl;
      from = "local";
    }
    if (bk) {
      if (ab && bk !== ab) (displaced ||= new Map()).set(ab, from);
      if (claimed.has(bk)) choices.set(i, { dup: bk.el });
      else {
        claimed.add(bk);
        choices.set(i, { bk, from, al, ar });
      }
      continue;
    }
    const outR = fromOutside(ar, R),
      outL = fromOutside(al, L);
    const moved = outR || outL;
    if (moved) {
      if (claimedOut.has(moved)) choices.set(i, { dup: moved });
      else {
        claimedOut.add(moved);
        choices.set(i, {
          moveIn: moved,
          side: outR ? "remote" : "local",
          sideEl: outR ? ar.el : al.el,
        });
      }
      continue;
    }
    // A side's copy of a base atom: the atom is not missing, whatever the
    // alignment paired. Taken whole as a conflict region's winner, it is
    // that atom, and no other position repeats it (identical atoms aside,
    // which the alignment pairs arbitrarily).
    const paired = (a, A) =>
      a && byTwin ? baseAtomOf.get(A.reverse.get(a.el)) || null : null;
    const t = paired(ar, R) || paired(al, L);
    if (t) {
      copied.add(t);
      if (
        pieceAt[i].conflict &&
        (unique(t) ||
          (ar &&
            (ar.el === t.el || R.identityPaired?.has(t.el)) &&
            sameId(t, ar, "remote")) ||
          (al &&
            (al.el === t.el || L.identityPaired?.has(t.el)) &&
            sameId(t, al, "local")))
      ) {
        if (claimed.has(t)) {
          choices.set(i, { dup: t.el });
          continue;
        }
        claimed.add(t);
      }
    }
    choices.set(i, { al, ar });
  }
  // Base atoms no position claimed although neither side deleted them: a
  // conflict region or a move settled on text that no longer holds them.
  // One of them goes where the policy side has it. A block one side deleted
  // and the other changed goes where the changing side has it (edit beats
  // delete). An atom a side moved out of this segment is placed at its
  // destination instead.
  const rescueAt = new Map();
  let localAtomOrder, remoteAtomOrder;
  const posOf = (toM, k) => {
    if (toM[k] >= 0) return toM[k];
    for (let j = k - 1; j >= 0; j--) if (toM[j] >= 0) return toM[j] + 1;
    return 0;
  };
  if (byTwin)
    for (const a of fb.atoms) {
      if (claimed.has(a) || copied.has(a)) continue;
      const lt = L.map.get(a.el) || null,
        rt = R.map.get(a.el) || null;
      const la = lt && lAtomOf.get(lt),
        ra = rt && rAtomOf.get(rt);
      if ((lt && !la) || (rt && !ra)) continue;
      const edited = !(la && ra) && soft.has(a);
      if (
        !edited &&
        !(
          la &&
          ra &&
          (unique(a) ||
            displaced?.has(a) ||
            ((la.el === a.el || L.identityPaired?.has(a.el)) &&
              (ra.el === a.el || R.identityPaired?.has(a.el)) &&
              sameId(a, la, "local") &&
              sameId(a, ra, "remote")))
        )
      )
        continue;
      const movedBy = displaced?.get(a);
      let preferred = policy;
      if (movedBy) {
        const opposite = movedBy === "local" ? fr : fl;
        const A = movedBy === "local" ? R : L;
        let unchanged = movedBy === "local" ? remoteAtomOrder : localAtomOrder;
        if (unchanged === undefined) {
          unchanged = opposite.atoms.length === fb.atoms.length;
          for (let j = 0; unchanged && j < fb.atoms.length; j++)
            unchanged = A.reverse.get(opposite.atoms[j].el) === fb.atoms[j].el;
          if (movedBy === "local") remoteAtomOrder = unchanged;
          else localAtomOrder = unchanged;
        }
        if (unchanged) preferred = movedBy;
      }
      const order =
        preferred === "local"
          ? [
              [la, lToM],
              [ra, rToM],
            ]
          : [
              [ra, rToM],
              [la, lToM],
            ];
      const [sa, toM] = order.find(([x]) => x);
      const at = posOf(toM, sa.i);
      if (!rescueAt.has(at)) rescueAt.set(at, []);
      rescueAt.get(at).push({ a, lt, rt, edited });
      claimed.add(a);
    }
  // An atom a side moved in from another block that no position emitted (a
  // conflict region here took the other side's text) still lands where
  // that side put it: the move is not the other side's to undo.
  if (byTwin && o.moveIn) {
    const sides = [
      [fl, L, lToM, "local"],
      [fr, R, rToM, "remote"],
    ];
    if (policy !== "local") sides.reverse();
    for (const [fs, A, toM, side] of sides)
      for (const a of fs.atoms) {
        const b = fromOutside(a, A);
        if (!b || claimedOut.has(b)) continue;
        claimedOut.add(b);
        const at = posOf(toM, a.i);
        if (!rescueAt.has(at)) rescueAt.set(at, []);
        rescueAt.get(at).push({ move: b, side, sideEl: a.el });
      }
  }
  const emitRescues = (i) => {
    const list = rescueAt.get(i);
    if (!list) return;
    flush(i);
    if (list.some((x) => isBlock(x.move ? x.sideEl : x.a.el)))
      while (stack.length) {
        stack.pop();
        container = stack.length ? stack[stack.length - 1].el : null;
      }
    for (const { a, lt, rt, edited, move, side, sideEl } of list) {
      if (move) {
        const el = o.moveIn(move, side, sideEl);
        if (el) append(el);
        continue;
      }
      movedOut.add(a);
      const el = mergeAtom(a.el, lt, rt);
      if (edited) {
        record(
          {
            kind: "structure",
            el,
            detail: "edit-beats-delete",
            base: a.el,
          },
          { subject: a.el, deleted: lt ? "remote" : "local" },
        );
        decisions.push({
          kind: "insert",
          el,
          source: lt ? "local" : "remote",
        });
      }
      append(el);
    }
  };
  const blockEls = new Set();
  const track = conflicts.length > firstConflict;
  for (let i = 0; i < m; i++) {
    const at = atomsAt(i);
    const nestedAtom =
      o.scopeUnits &&
      at &&
      (at.ab?.stack.some((mark) => mark.block) ||
        at.al?.stack.some((mark) => mark.block) ||
        at.ar?.stack.some((mark) => mark.block));
    const atomBlock =
      !!at && isBlock((at.ab || at.al || at.ar).el) && !nestedAtom;
    const want = atomBlock
      ? []
      : blockOf[i]
        ? [blockOf[i], ...marksAt(i)]
        : marksAt(i);
    let c = 0;
    while (c < stack.length && c < want.length && stack[c].u === want[c]) c++;
    if (c < stack.length) {
      flush(i);
      while (stack.length > c) {
        stack.pop();
        container = stack.length ? stack[stack.length - 1].el : null;
      }
    }
    // A pin sits between the marks that close here and those that open.
    emitPins(i);
    emitRescues(i);
    if (want.length > stack.length) {
      flush(i);
      while (stack.length < want.length) openMark(want[stack.length]);
    }
    if (text[i] === BREAK) {
      if (glue.has(i)) continue;
      // The block ends here: close it (and the marks inside it), so the
      // next block opens afresh even when the same block continues.
      flush(i);
      let k = stack.length;
      while (k > 0 && !stack[k - 1].u.block) k--;
      if (k > 0) {
        if (track) segMeta.breakOut.set(i, stack[k - 1].el);
        while (stack.length >= k) {
          stack.pop();
          container = stack.length ? stack[stack.length - 1].el : null;
        }
      }
      continue;
    }
    if (at) {
      flush(i);
      const ch = choices.get(i);
      let el;
      if (ch.dup) {
        record(
          {
            kind: "structure",
            el: null,
            detail: "both-moved",
            base: ch.dup,
          },
          { subject: ch.dup },
        );
        continue;
      }
      if (ch.moveIn) {
        el = o.moveIn(ch.moveIn, ch.side, ch.sideEl);
        if (!el) continue;
      } else if (ch.bk) {
        const bk = ch.bk;
        movedOut.add(bk);
        if (bk === at.ab) el = mergeAtom(bk.el, ch.al.el, ch.ar.el);
        else {
          const lk = L.map.get(bk.el) || null,
            rk = R.map.get(bk.el) || null;
          el = mergeAtom(bk.el, lk, rk);
          if (!lk || !rk)
            record(
              {
                kind: "structure",
                el: null,
                detail: "move-beats-delete",
                base: bk.el,
              },
              { subject: bk.el, deleted: lk ? "remote" : "local" },
            );
          decisions.push({ kind: "move", el, source: ch.from });
        }
      } else if (ch.al) {
        el = cloneAtom(ch.al.el, "local");
        if (ch.ar) provenance.get(el).remote = ch.ar.el;
        decisions.push({
          kind: "insert",
          el,
          source: ch.ar ? "both" : "local",
        });
      } else {
        el = cloneAtom(ch.ar.el, "remote");
        decisions.push({ kind: "insert", el, source: "remote" });
      }
      if (track) segMeta.atomOut.set(i, el);
      append(el);
      continue;
    }
    if (!buf) bufStart = i;
    buf += text[i];
  }
  flush(m);
  if (pinsAt.has(m) || rescueAt.has(m)) {
    stack.length = 0;
    container = null;
    emitPins(m);
    emitRescues(m);
  }
  if (m === 0 && (fl.placeholder || fr.placeholder || fb.placeholder)) {
    const br = out.createElement("br");
    provenance.set(br, {
      base: fb.placeholder,
      local: fl.placeholder,
      remote: fr.placeholder,
    });
    nodes.push(br);
  }

  // The output text node holding offset `p`: the one containing it, else
  // the one ending at it, else the next one, else the last. The nodes are
  // sorted, non-empty and disjoint, and the callers ask in near order, so a
  // pointer walk replaces three scans per call.
  let ni = 0;
  const nodeAt = (p) => {
    while (ni > 0 && textNodes[ni - 1].me >= p) ni--;
    while (ni < textNodes.length && textNodes[ni].me < p) ni++;
    const t = textNodes[ni];
    if (!t) return textNodes[textNodes.length - 1] || null;
    const next = textNodes[ni + 1];
    return t.me === p && next && next.ms === p ? next : t;
  };

  // Decisions: one text decision per output text node, from the pieces and
  // respellings it holds and the empty pieces (deletions, lost conflicts)
  // at its edges; removed base marks; marks a side moved (its base range
  // deleted, its side range inserted somewhere else).
  const changed = new Map();
  // A change with no output text node to name (the text merged to
  // nothing) is still a text decision, with no node.
  const noNode = {};
  const note = (pos, src, textual) => {
    const t = nodeAt(pos) || (textual ? noNode : null);
    if (!t) return;
    const c = changed.get(t) || { l: false, r: false };
    if (src !== "remote") c.l = true;
    if (src !== "local") c.r = true;
    changed.set(t, c);
  };
  const hasText = (p) => {
    if (p.conflict) return true;
    const t = p.src === "local" ? fl.text : p.src === "remote" ? fr.text : "";
    for (let i = p.from; i < p.to; i++)
      if (t[i] !== ATOM && t[i] !== BREAK) return true;
    return false;
  };
  for (const p of pieces)
    if (p.src !== "base") note(p.ms, p.conflict ? "both" : p.src, hasText(p));
  for (const [b, src] of respelled) if (bToM[b] >= 0) note(bToM[b], src);
  for (const t of textNodes.length ? textNodes : [noNode]) {
    const c = changed.get(t);
    if (c)
      decisions.push({
        kind: "text",
        node: t.node || null,
        source: c.l && c.r ? "both" : c.l ? "local" : "remote",
      });
  }
  // A base mark whose side twin sits outside this segment was moved out by
  // that side, not removed: its destination records the move.
  for (const u of baseUs) {
    if (opened.has(u)) continue;
    const lGone = !u.local && !(byTwin && L.map.get(u.base)),
      rGone = !u.remote && !(byTwin && R.map.get(u.base));
    if (!lGone && !rGone) continue;
    decisions.push({
      kind: "remove",
      source: lGone && rGone ? "both" : lGone ? "local" : "remote",
      base: u.base,
    });
  }
  if (keptByEdit)
    for (const [u, deleted] of keptByEdit)
      if (opened.has(u))
        record(
          {
            kind: "structure",
            el: opened.get(u),
            detail: "edit-beats-delete",
            base: u.base,
          },
          { subject: u.base, deleted },
        );
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
  // The output nodes are sorted, non-empty and disjoint, so at most the
  // first node ending at or after `mp` and the one after it can hold it;
  // `ti` walks with the mapped offsets instead of scanning per character.
  const caretOf = new Map();
  const lastNode = textNodes[textNodes.length - 1] || null;
  let ti = 0;
  for (const ln of fl.nodes) {
    let cur = null;
    for (let k = ln.s; k <= ln.e; k++) {
      const mp = mapLocal(k);
      while (ti > 0 && textNodes[ti - 1].me >= mp) ti--;
      while (ti < textNodes.length && textNodes[ti].me < mp) ti++;
      const holds = (x) =>
        x && mp >= x.ms && mp <= x.me && (mp < x.me || k === ln.e || x === cur);
      const t = holds(textNodes[ti])
        ? textNodes[ti]
        : holds(textNodes[ti + 1])
          ? textNodes[ti + 1]
          : textNodes[ti] || lastNode;
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

  // For apply: the local flat text and nodes this merge read, the output
  // text nodes with their ranges, and the caret map between them. Breaks
  // are not text: the record maps break-free offsets, which is what the
  // live text nodes hold.
  // One record per local block (a break-free stretch of the local flat
  // text), as apply saw them before blocks merged as one sequence: the
  // typing a live text node took after the snapshot is found by diffing
  // that block's text alone, so words on both sides of a break never fuse
  // and an insertion at a block edge belongs to the block it was typed in.
  function segmentRecords() {
    if (!fl.text.includes(BREAK))
      return [
        { flatLocal: fl.text, localNodes: fl.nodes, textNodes, lToM, mapLocal },
      ];
    const records = [];
    let start = 0,
      ni = 0;
    for (let k = 0; k <= fl.text.length; k++) {
      if (k < fl.text.length && fl.text[k] !== BREAK) continue;
      const from = start,
        end = k;
      if (end > from) {
        const localNodes = [];
        while (ni < fl.nodes.length && fl.nodes[ni].e <= from) ni++;
        for (let j = ni; j < fl.nodes.length && fl.nodes[j].s < end; j++) {
          const x = fl.nodes[j];
          const s = Math.max(x.s, from),
            e = Math.min(x.e, end);
          if (s < e)
            localNodes.push({ node: x.node, s: s - from, e: e - from });
        }
        records.push({
          flatLocal: fl.text.slice(from, end),
          localNodes,
          textNodes,
          lToM: lToM.subarray
            ? lToM.subarray(from, end + 1)
            : lToM.slice(from, end + 1),
          mapLocal: (i) =>
            mapLocal(from + Math.max(0, Math.min(i, end - from))),
        });
      }
      start = k + 1;
    }
    return records;
  }

  const outOpts = {
    ...o,
    blocks: blockEls,
    ignored: (n) => pinNodes.has(n) || (o.ignored ? o.ignored(n) : false),
  };
  const ia = o.ignoreAttribute || (() => false);
  const localDiverged =
    flatSig(flatten(nodes, outOpts), ia) !== flatSig(fr, ia);
  if (textMetas.length) {
    // For the conflict report: the output as it will read once applied, an
    // unchanged stand-in read through the remote subtree apply fills it from.
    const standIn = (el) => {
      const p = provenance.get(el);
      return p && p.unchanged ? p.remote : null;
    };
    segMeta.text = text;
    segMeta.textNodes = textNodes;
    segMeta.out = flatten(nodes, { ...outOpts, via: standIn });
  }
  let unitOutputs = null;
  if (o.scopeUnits) {
    unitOutputs = new Map();
    const roots = new Set(nodes);
    const rootOf = (node) => {
      while (node && !roots.has(node)) node = node.parentNode;
      return node;
    };
    const indexes = o.scopeUnits.map((units) => {
      const direct = new Map();
      for (const unit of units) {
        if (unit.nodeType === 1) direct.set(unit, unit);
        else for (const node of unit.nodes) direct.set(node, unit);
      }
      return direct;
    });
    const owner = (node, direct) => {
      while (node && !direct.has(node)) node = node.parentNode;
      return node ? direct.get(node) : null;
    };
    const flatUnits = [fb, fl, fr].map((flat, side) => {
      const at = new Array(flat.text.length);
      for (const range of flat.nodes) {
        const unit = owner(range.node, indexes[side]);
        if (unit) at.fill(unit, range.s, range.e);
      }
      for (const atom of flat.atoms) at[atom.i] = owner(atom.el, indexes[side]);
      return at;
    });
    const claim = (unit, root) => {
      if (!unit || !root) return;
      let held = unitOutputs.get(unit);
      if (!held) unitOutputs.set(unit, (held = new Set()));
      held.add(root);
    };
    for (const root of nodes) {
      const source = provenance.get(root);
      if (!source) continue;
      claim(owner(source.base, indexes[0]), root);
      claim(owner(source.local, indexes[1]), root);
      claim(owner(source.remote, indexes[2]), root);
    }
    for (const range of textNodes) {
      const root = rootOf(range.node);
      for (let i = range.ms; i < range.me; i++) {
        claim(flatUnits[0][ob[i]], root);
        claim(flatUnits[1][ol[i]], root);
        claim(flatUnits[2][or[i]], root);
      }
    }
    const order = new Map(nodes.map((node, i) => [node, i]));
    for (const [unit, held] of unitOutputs)
      unitOutputs.set(
        unit,
        Array.from(held).sort((a, b) => order.get(a) - order.get(b)),
      );
  }

  return {
    unitOutputs,
    nodes,
    text,
    textNodes,
    localDiverged,
    mapLocal,
    conflicts: conflicts.slice(firstConflict),
    granularity: lines ? "line" : "word",
    segments: segmentRecords(),
    localHunks: lh,
    remoteHunks: rh,
    lToM,
  };
}
