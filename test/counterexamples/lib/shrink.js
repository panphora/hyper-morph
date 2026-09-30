import { parse, doc } from "../../node/lib/dom.js";
import { SID } from "./runner.js";

// Greedy shrinking of a case: try one smaller edit of the three sides at a
// time and keep it when `holds(case)` still says the counterexample is
// there, until no edit is kept in a full pass. Edits act on all three sides
// at once where an element is the same element on each (same sid, or the
// same tag at the same child path), so an edit rarely turns the case into a
// different merge.

const SIDES = ["base", "local", "remote"];
const esc = (s) => s.replace(/["\\]/g, "\\$&");
const whole = (html) => /^\s*<(!doctype|html)/i.test(html);

function load(c) {
  const out = {};
  for (const s of SIDES) {
    const html = c[s] ?? c.base;
    out[s] = { whole: whole(html), d: parse(whole(html) ? html : doc(html)) };
  }
  return out;
}

function dump(c, sides) {
  const n = { ...c };
  for (const s of SIDES) {
    const { whole: w, d } = sides[s];
    n[s] = w
      ? "<!DOCTYPE html>" + d.documentElement.outerHTML
      : d.body.innerHTML;
  }
  if (c.local === undefined && n.local === n.base) delete n.local;
  return n;
}

const pathOf = (el, root) => {
  const p = [];
  for (let x = el; x && x !== root; x = x.parentElement)
    p.unshift([...x.parentElement.children].indexOf(x));
  return p;
};
const atPath = (root, p) => {
  let x = root;
  for (const i of p) {
    x = x && x.children[i];
    if (!x) return null;
  }
  return x;
};

function sidsOf(sides) {
  const ids = new Set();
  for (const s of SIDES)
    for (const el of sides[s].d.querySelectorAll(`[${SID}]`))
      ids.add(el.getAttribute(SID));
  return [...ids];
}

/** Candidate edits of a case, largest first. Each returns a new case or null. */
function* edits(c) {
  const sides = load(c);
  const ids = sidsOf(sides);
  const bySid = (op) => (id) => {
    const s2 = load(c);
    let hit = 0;
    for (const s of SIDES)
      for (const el of [...s2[s].d.querySelectorAll(`[${SID}="${esc(id)}"]`)])
        if (el.parentNode) {
          op(el);
          hit++;
        }
    return hit ? dump(c, s2) : null;
  };
  for (const id of ids) yield () => bySid((el) => el.remove())(id);
  const body = sides.base.d.body;
  const paths = [...body.querySelectorAll("*")]
    .map((el) => pathOf(el, body))
    .sort((a, b) => a.length - b.length);
  for (const p of paths)
    yield () => {
      const s2 = load(c);
      const els = SIDES.map((s) => atPath(s2[s].d.body, p));
      if (els.some((e) => !e) || new Set(els.map((e) => e.tagName)).size > 1)
        return null;
      els.forEach((e) => e.remove());
      return dump(c, s2);
    };
  for (const s of SIDES) {
    const n = sides[s].d.body.querySelectorAll("*").length;
    for (let i = n - 1; i >= 0; i--)
      yield () => {
        const s2 = load(c);
        const el = s2[s].d.body.querySelectorAll("*")[i];
        if (!el) return null;
        el.remove();
        return dump(c, s2);
      };
  }
  for (const id of ids)
    yield () =>
      bySid((el) => {
        el.replaceWith(...el.childNodes);
      })(id);
  for (const id of ids) yield () => bySid((el) => el.removeAttribute(SID))(id);
  const words = new Set();
  for (const s of SIDES)
    for (const w of (sides[s].d.body.textContent || "").split(/\s+/))
      if (w) words.add(w);
  for (const w of words)
    yield () => {
      const s2 = load(c);
      let hit = 0;
      for (const s of SIDES) {
        const walk = s2[s].d.createTreeWalker(s2[s].d.body, 4);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          const parts = t.nodeValue.split(/(\s+)/);
          const kept = parts.filter((x) => x !== w);
          if (kept.length !== parts.length) {
            t.nodeValue = kept.join("").replace(/\s+/g, " ");
            hit++;
          }
        }
      }
      return hit ? dump(c, s2) : null;
    };
  const attrs = new Set();
  for (const s of SIDES)
    for (const el of sides[s].d.body.querySelectorAll("*"))
      for (const a of el.attributes) if (a.name !== SID) attrs.add(a.name);
  for (const name of attrs)
    yield () => {
      const s2 = load(c);
      let hit = 0;
      for (const s of SIDES)
        for (const el of s2[s].d.body.querySelectorAll(`[${name}]`)) {
          el.removeAttribute(name);
          hit++;
        }
      return hit ? dump(c, s2) : null;
    };
}

const size = (c) => SIDES.reduce((n, s) => n + (c[s] ?? c.base).length, 0);

/**
 * Shrink `c` while `holds` (async, case -> boolean) stays true. Stops after
 * `budget` ms or `maxTrials` predicate calls. Returns the smallest case and
 * the trial count.
 */
export async function shrink(
  c,
  holds,
  { budget = 20000, maxTrials = 2000 } = {},
) {
  const start = performance.now();
  let best = c,
    trials = 0,
    changed = true;
  while (changed) {
    changed = false;
    for (const make of edits(best)) {
      if (performance.now() - start > budget || trials >= maxTrials)
        return { case: best, trials, stopped: "budget" };
      let next;
      try {
        next = make();
      } catch {
        continue;
      }
      if (!next || size(next) >= size(best)) continue;
      trials++;
      let ok = false;
      try {
        ok = await holds(next);
      } catch {
        ok = false;
      }
      if (ok) {
        best = next;
        changed = true;
        break;
      }
    }
  }
  return { case: best, trials, stopped: "fixpoint" };
}
