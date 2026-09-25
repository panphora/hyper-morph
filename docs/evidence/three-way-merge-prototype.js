// PROTOTYPE three-way HTML merge (base, local, remote) — proof of architecture.
// Not production code: O(n*m) LCS, no caching, simplified conflict policy.

// ---------- character-level diff3 ----------
function charHunks(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = []; let i = 0, j = 0, cur = null;
  const open = () => { if (!cur) cur = { bs: i, be: i, text: "" }; };
  const close = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { close(); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { open(); cur.text += b[j]; j++; }
    else { open(); cur.be = ++i; }
  }
  close(); return hunks;
}
function merge3Text(base, local, remote) {
  if (local === remote) return { text: local, conflict: false };
  if (local === base) return { text: remote, conflict: false };
  if (remote === base) return { text: local, conflict: false };
  const L = charHunks(base, local), R = charHunks(base, remote);
  let out = "", pos = 0, li = 0, ri = 0, conflict = false;
  while (li < L.length || ri < R.length) {
    const l = L[li], r = R[ri];
    const takeL = l && (!r || l.bs < r.bs || (l.bs === r.bs && l.be <= r.be));
    const h = takeL ? l : r, other = takeL ? r : l;
    if (other && other.bs < h.be && h.bs < other.be) {
      // overlapping edits: remote wins the region, local hunk dropped
      const rh = takeL ? other : h;
      out += base.slice(pos, rh.bs) + rh.text; pos = rh.be; conflict = true; li++; ri++; continue;
    }
    out += base.slice(pos, h.bs) + h.text; pos = h.be;
    if (takeL) li++; else ri++;
  }
  return { text: out + base.slice(pos), conflict };
}

// ---------- tree alignment (base vs one side) ----------
const isEl = (n) => n.nodeType === 1, isText = (n) => n.nodeType === 3;
const sig = (el) => el.tagName + "|" + [...el.classList].sort().join(" ") + "|" + ["href", "src", "name", "type", "role"].map((a) => el.getAttribute(a) || "").join("|");
const hint = (n) => (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 64);
const exactKey = (n) => (isEl(n) ? "E" + n.outerHTML : (isText(n) ? "T" : "C") + n.nodeValue);

const similarEl = (a, b) => {
  const x = hint(a), y = hint(b); if (!x && !y) return true; if (!x || !y) return false;
  const h = charHunks(x, y); const changed = h.reduce((n, k) => n + (k.be - k.bs) + k.text.length, 0);
  return changed <= Math.max(x.length, y.length);
};
function uniquePairs(bs, ss, keyOf, map, used) {
  const cb = new Map(), cs = new Map();
  for (const b of bs) { const k = keyOf(b); if (k != null) cb.set(k, (cb.get(k) || 0) + 1); }
  for (const s of ss) { const k = keyOf(s); if (k != null) cs.set(k, (cs.get(k) || 0) + 1); }
  for (const b of bs) {
    const k = keyOf(b);
    if (k != null && cb.get(k) === 1 && cs.get(k) === 1) { const s = ss.find((x) => keyOf(x) === k); map.set(b, s); used.add(s); }
  }
}
function alignKids(bKids, sKids, map, used) {
  const rem = () => [bKids.filter((b) => !map.has(b)), sKids.filter((s) => !used.has(s))];
  let [rb, rs] = rem(); uniquePairs(rb, rs, exactKey, map, used);
  [rb, rs] = rem(); uniquePairs(rb, rs, (n) => (isEl(n) ? sig(n) + "|" + hint(n) : null), map, used);
  [rb, rs] = rem();
  const similar = (a, b) => { // LCS ratio on text hints; empty-vs-empty counts as similar
    const x = hint(a), y = hint(b); if (!x && !y) return true; if (!x || !y) return false;
    const h = charHunks(x, y); const changed = h.reduce((n, k) => n + (k.be - k.bs) + k.text.length, 0);
    return changed <= Math.max(x.length, y.length);
  };
  for (const b of rb) {
    if (!isEl(b)) continue;
    const c = rs.filter((s) => isEl(s) && !used.has(s) && sig(s) === sig(b) && similar(b, s));
    if (!c.length) continue;
    const bi = bKids.indexOf(b);
    c.sort((x, y) => Math.abs(sKids.indexOf(x) - bi) - Math.abs(sKids.indexOf(y) - bi));
    map.set(b, c[0]); used.add(c[0]);
  }
  [rb, rs] = rem();
  let cursor = 0;
  for (const b of rb) for (let i = cursor; i < rs.length; i++) {
    const s = rs[i];
    if (used.has(s) || b.nodeType !== s.nodeType || (isEl(b) && s.tagName !== b.tagName)) continue;
    if (isEl(b) && !similar(b, s)) continue;
    map.set(b, s); used.add(s); cursor = i + 1; break;
  }
}
function alignTree(bRoot, sRoot) {
  const map = new Map([[bRoot, sRoot]]), used = new Set([sRoot]);
  const walk = (b, s) => {
    alignKids([...b.childNodes], [...s.childNodes], map, used);
    for (const bk of b.childNodes) if (map.has(bk) && isEl(bk)) walk(bk, map.get(bk));
  };
  walk(bRoot, sRoot);
  // cross-parent moves: unmatched base elements vs unmatched side elements
  const del = [...bRoot.querySelectorAll("*")].filter((e) => !map.has(e));
  const ins = [...sRoot.querySelectorAll("*")].filter((e) => !used.has(e));
  const moved = new Set();
  uniquePairs(del, ins, (n) => sig(n) + "|" + hint(n), map, used);
  const del2 = del.filter((e) => !map.has(e)), ins2 = ins.filter((e) => !used.has(e));
  for (const d of del2) {
    const c = ins2.filter((s) => !used.has(s) && sig(s) === sig(d) && similarEl(d, s));
    if (c.length === 1) { map.set(d, c[0]); used.add(c[0]); }
  }
  for (const d of del) if (map.has(d)) { moved.add(d); walk(d, map.get(d)); }
  return { map, used, moved };
}

// ---------- three-way merge ----------
function merge3(baseDoc, localDoc, remoteDoc) {
  const out = document.implementation.createHTMLDocument("");
  const L = alignTree(baseDoc.body, localDoc.body), R = alignTree(remoteDoc.body ? baseDoc.body : baseDoc.body, remoteDoc.body);
  const conflicts = [];
  const changed = (b, s) => !s || (isEl(b) ? b.outerHTML !== s.outerHTML : b.nodeValue !== s.nodeValue);
  const inParent = (side, b, parentSide) => { const s = side.map.get(b); return s && s.parentNode === parentSide ? s : null; };

  function mergeAttrs(b, l, r, el) {
    const names = new Set([...b.attributes, ...(l ? l.attributes : []), ...(r ? r.attributes : [])].map((a) => a.name));
    for (const n of names) {
      const bv = b.getAttribute(n), lv = l ? l.getAttribute(n) : bv, rv = r ? r.getAttribute(n) : bv;
      let v;
      if (lv === rv) v = lv; else if (lv === bv) v = rv; else if (rv === bv) v = lv; else { v = rv; conflicts.push("attr " + n); }
      if (v != null) el.setAttribute(n, v);
    }
  }
  function mergeNode(b, l, r) {
    if (isText(b)) {
      const m = merge3Text(b.nodeValue, l ? l.nodeValue : b.nodeValue, r ? r.nodeValue : b.nodeValue);
      if (m.conflict) conflicts.push("text");
      return out.createTextNode(m.text);
    }
    if (!isEl(b)) return out.importNode(r || l || b, true);
    const el = out.createElement(b.tagName);
    mergeAttrs(b, l, r, el);
    for (const c of mergeChildren(b, l, r)) el.appendChild(c);
    return el;
  }
  function mergeChildren(b, l, r) {
    const bKids = [...b.childNodes];
    const lKids = l ? [...l.childNodes] : [], rKids = r ? [...r.childNodes] : [];
    // which side supplies the order of kept children? a side that reordered them
    const orderOf = (side, kids) => kids.filter((k) => side.rev.has(k) && side.rev.get(k).parentNode === b).map((k) => bKids.indexOf(side.rev.get(k)));
    const mono = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
    const lReordered = l && !mono(orderOf(L, lKids)), rReordered = r && !mono(orderOf(R, rKids));
    const O = rReordered ? { side: R, kids: rKids, other: L, otherKids: lKids } : lReordered ? { side: L, kids: lKids, other: R, otherKids: rKids } : { side: R, kids: rKids, other: L, otherKids: lKids };
    const result = [];
    const emitted = new Set();
    const emitBase = (bk) => {
      if (emitted.has(bk)) return; emitted.add(bk);
      const lk = L.map.get(bk), rk = R.map.get(bk);
      const lHere = lk && lk.parentNode === (l || null) || (lk && !l && false), rHere = rk && rk.parentNode === (r || null);
      const lMovedOut = lk && l && lk.parentNode !== l, rMovedOut = rk && r && rk.parentNode !== r;
      if (lMovedOut || rMovedOut) return; // emitted at its destination
      const lDel = !lk, rDel = !rk;
      if (lDel && rDel) return;
      if (lDel && !changed(bk, rk)) return; // local deleted, remote untouched
      if (rDel && !changed(bk, lk)) return; // remote deleted, local untouched
      const merged = mergeNode(bk, lk || null, rk || null); merged.__bk = bk; result.push(merged);
    };
    const emitSideNode = (side, sk) => {
      const bk = side.rev.get(sk);
      if (bk) {
        if (bk.parentNode === b) return emitBase(bk);
        // moved in from another parent
        if (emitted.has(bk)) return; emitted.add(bk);
        result.push(mergeNode(bk, L.map.get(bk) || null, R.map.get(bk) || null));
        return;
      }
      result.push(out.importNode(sk, true)); // pure insertion
    };
    // walk order side; interleave other side's insertions anchored after their preceding base sibling
    const otherInsertsAfter = new Map(); let anchor = null;
    for (const sk of O.otherKids) {
      const bk = O.other.rev.get(sk);
      if (bk && bk.parentNode === b) { anchor = bk; continue; }
      if (bk) { /* moved-in on other side */ }
      if (!otherInsertsAfter.has(anchor)) otherInsertsAfter.set(anchor, []);
      otherInsertsAfter.get(anchor).push(sk);
    }
    for (const sk of otherInsertsAfter.get(null) || []) emitSideNode(O.other, sk);
    for (const sk of O.kids) {
      emitSideNode(O.side, sk);
      const bk = O.side.rev.get(sk);
      if (bk && otherInsertsAfter.has(bk)) for (const x of otherInsertsAfter.get(bk)) emitSideNode(O.other, x);
    }
    // base children the order side deleted but the other side edited: keep
    // them after the nearest preceding base sibling that survived
    for (let i = 0; i < bKids.length; i++) {
      const bk = bKids[i];
      if (emitted.has(bk)) continue;
      const before = result.length;
      emitBase(bk);
      if (result.length === before) continue;
      const node = result.pop();
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const idx = result.findIndex((n) => n.__bk === bKids[j]); if (idx >= 0) { at = idx + 1; break; } }
      node.__bk = bk; result.splice(at, 0, node);
    }
    return result;
  }
  for (const side of [L, R]) { side.rev = new Map(); for (const [b, s] of side.map) side.rev.set(s, b); }
  const body = mergeNode(baseDoc.body, localDoc.body, remoteDoc.body);
  return { html: body.innerHTML, conflicts };
}

// ---------- scenarios ----------
const doc = (b) => `<html><head></head><body>${b}</body></html>`;
const run = (name, base, local, remote) => {
  const r = merge3(parseHTML(doc(base)), parseHTML(doc(local)), parseHTML(doc(remote)));
  console.log("PROTO", name, "->", r.html, r.conflicts.length ? "| conflicts: " + r.conflicts.join(",") : "");
};

describe("PROTOTYPE three-way merge on the same scenarios", function () {
  it("runs", function () {
    run("S1", `<p>The quick brown fox jumps over the lazy dog.</p>`,
             `<p>Note: The quick brown fox jumps over the lazy dog.</p>`,
             `<p>The quick brown fox jumps over the sleepy dog.</p>`);
    run("S1b (same word)", `<p>the lazy dog</p>`, `<p>the LAZY dog</p>`, `<p>the sleepy dog</p>`);
    run("S2", `<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>`,
             `<ul><li>Cherries</li><li>Apples</li><li>Bananas</li></ul>`,
             `<ul><li>Apples</li><li>Bananas (organic)</li><li>Cherries</li></ul>`);
    run("S3", `<div class="col"><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`,
             `<div class="col"><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div></div>`,
             `<div class="col"><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`);
    run("S4", `<ul><li>Apples</li><li>Bananas</li></ul>`,
             `<ul><li>Apples</li><li>Bananas</li><li>Dates</li></ul>`,
             `<ul><li>Apples</li><li>Bananas</li><li>Elderberries</li></ul>`);
    run("S5", `<section class="hero"><h1>Hi</h1></section>`,
             `<section class="hero"><h1 style="color:red">Hi</h1></section>`,
             `<section class="hero compact"><h1>Hi</h1></section>`);
    run("S6", `<div class="box" data-x="1">t</div>`, `<div class="box open" data-x="1">t</div>`, `<div class="box" data-x="2">t</div>`);
    run("S7", `<article><p>One</p><p>Two</p><p>Three</p></article>`,
             `<article><p>One</p><p>Two, edited locally</p><p>Three</p></article>`,
             `<article><p>One</p><p>Three</p><p>Four</p></article>`);
    run("S10 (remote deletes untouched para, local edits another)", `<article><p>One</p><p>Two</p></article>`,
             `<article><p>One!</p><p>Two</p></article>`, `<article><p>One</p></article>`);
  });
});
