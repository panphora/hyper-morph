// Real-world collaboration scenarios run against the CURRENT library.
// Pipeline mirrors hyperclay live-sync: live doc, base = last synced HTML,
// remote = incoming HTML. "splice" = findChangedRoots + spliceProtected + morph.
function syncSplice(live, baseHtml, remoteHtml) {
  const base = parseHTML(baseHtml);
  const incoming = parseHTML(remoteHtml);
  const { entries } = HyperMorph.findChangedRoots(
    live.documentElement,
    base.documentElement,
  );
  const res = HyperMorph.spliceProtected(incoming, entries);
  if (!res.ok)
    return {
      held: true,
      heldOn: res.held && res.held.el && res.held.el.tagName,
      entries: entries.map((e) => e.type + ":" + e.el.tagName),
    };
  HyperMorph.morph(live.documentElement, incoming.documentElement);
  return {
    held: false,
    entries: entries.map((e) => e.type + ":" + e.el.tagName),
  };
}
function syncPlain(live, remoteHtml) {
  HyperMorph.morph(live.documentElement, parseHTML(remoteHtml).documentElement);
}
const doc = (body) => `<html><head></head><body>${body}</body></html>`;
const log = (...a) => console.log("SCENARIO", ...a);

describe("SCENARIOS against current library", function () {
  it("S1 concurrent edits in the same paragraph", function () {
    const base = doc(`<p>The quick brown fox jumps over the lazy dog.</p>`);
    const remote = doc(`<p>The quick brown fox jumps over the sleepy dog.</p>`);
    let live = parseHTML(base);
    live.querySelector("p").firstChild.nodeValue =
      "Note: The quick brown fox jumps over the lazy dog.";
    syncPlain(live, remote);
    log("S1 plain  ->", live.body.innerHTML);
    live = parseHTML(base);
    live.querySelector("p").firstChild.nodeValue =
      "Note: The quick brown fox jumps over the lazy dog.";
    const r = syncSplice(live, base, remote);
    log("S1 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S2 local reorders a keyless list while remote edits one item", function () {
    const base = doc(
      `<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>`,
    );
    const remote = doc(
      `<ul><li>Apples</li><li>Bananas (organic)</li><li>Cherries</li></ul>`,
    );
    let live = parseHTML(base);
    let ul = live.querySelector("ul");
    ul.insertBefore(ul.lastElementChild, ul.firstElementChild);
    const cherries = live.querySelector("li");
    syncPlain(live, remote);
    log(
      "S2 plain  ->",
      live.body.innerHTML,
      "| cherries node kept:",
      cherries.isConnected,
    );
    live = parseHTML(base);
    ul = live.querySelector("ul");
    ul.insertBefore(ul.lastElementChild, ul.firstElementChild);
    const r = syncSplice(live, base, remote);
    log("S2 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S3 local drags a card to another column while remote edits its title", function () {
    const base = doc(
      `<div class="col"><div class="card"><h3>Pricing</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`,
    );
    const remote = doc(
      `<div class="col"><div class="card"><h3>Pricing plans</h3><video src="a.mp4"></video></div><div class="card"><h3>About</h3></div></div><div class="col"><div class="card"><h3>Team</h3></div></div>`,
    );
    let live = parseHTML(base);
    let card = live.querySelector(".card");
    const video = card.querySelector("video");
    live.querySelectorAll(".col")[1].appendChild(card);
    syncPlain(live, remote);
    log(
      "S3 plain  ->",
      live.body.innerHTML,
      "| video node kept:",
      video.isConnected,
    );
    live = parseHTML(base);
    card = live.querySelector(".card");
    live.querySelectorAll(".col")[1].appendChild(card);
    const r = syncSplice(live, base, remote);
    log("S3 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S4 both users append to the same list", function () {
    const base = doc(`<ul><li>Apples</li><li>Bananas</li></ul>`);
    const remote = doc(
      `<ul><li>Apples</li><li>Bananas</li><li>Elderberries</li></ul>`,
    );
    let live = parseHTML(base);
    live.querySelector("ul").insertAdjacentHTML("beforeend", "<li>Dates</li>");
    syncPlain(live, remote);
    log("S4 plain  ->", live.body.innerHTML);
    live = parseHTML(base);
    live.querySelector("ul").insertAdjacentHTML("beforeend", "<li>Dates</li>");
    const r = syncSplice(live, base, remote);
    log("S4 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S5 attribute edits on different elements", function () {
    const base = doc(`<section class="hero"><h1>Hi</h1></section>`);
    const remote = doc(`<section class="hero compact"><h1>Hi</h1></section>`);
    let live = parseHTML(base);
    live.querySelector("h1").setAttribute("style", "color:red");
    syncPlain(live, remote);
    log("S5 plain  ->", live.body.innerHTML);
    live = parseHTML(base);
    live.querySelector("h1").setAttribute("style", "color:red");
    const r = syncSplice(live, base, remote);
    log("S5 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S6 same element, different attributes edited by each side", function () {
    const base = doc(`<div class="box" data-x="1">t</div>`);
    const remote = doc(`<div class="box" data-x="2">t</div>`);
    let live = parseHTML(base);
    live.querySelector("div").setAttribute("class", "box open");
    syncPlain(live, remote);
    log("S6 plain  ->", live.body.innerHTML);
    live = parseHTML(base);
    live.querySelector("div").setAttribute("class", "box open");
    const r = syncSplice(live, base, remote);
    log("S6 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S7 remote deletes a paragraph the local user is editing, and adds one", function () {
    const base = doc(`<article><p>One</p><p>Two</p><p>Three</p></article>`);
    const remote = doc(`<article><p>One</p><p>Three</p><p>Four</p></article>`);
    let live = parseHTML(base);
    live.querySelectorAll("p")[1].firstChild.nodeValue = "Two, edited locally";
    syncPlain(live, remote);
    log("S7 plain  ->", live.body.innerHTML);
    live = parseHTML(base);
    live.querySelectorAll("p")[1].firstChild.nodeValue = "Two, edited locally";
    const r = syncSplice(live, base, remote);
    log("S7 splice ->", JSON.stringify(r), "|", live.body.innerHTML);
  });

  it("S8 typing in a contenteditable while a remote edit lands elsewhere", function () {
    const wa = document.getElementById("work-area");
    wa.innerHTML = `<article><p contenteditable id="a">Hello world</p><p>Other</p></article>`;
    const p = wa.querySelector("#a");
    p.focus();
    p.firstChild.nodeValue = "Hello brave world";
    const sel = window.getSelection();
    const rng = document.createRange();
    rng.setStart(p.firstChild, 11);
    rng.collapse(true);
    sel.removeAllRanges();
    sel.addRange(rng);
    HyperMorph.morph(
      wa,
      `<pre id="work-area" hx-ext="morph"><article><p contenteditable id="a">Hello world</p><p>Other edited</p></article></pre>`,
    );
    const s = window.getSelection();
    log(
      "S8 plain  ->",
      wa.innerHTML,
      "| active:",
      document.activeElement && document.activeElement.id,
      "| caret:",
      s.rangeCount ? s.getRangeAt(0).startOffset : "none",
    );
  });

  it("S9 page with doctype, whole-document sync", function () {
    const live = parseHTML(`<!DOCTYPE html>` + doc(`<p>a</p>`));
    let err = null;
    try {
      HyperMorph.morph(live, `<!DOCTYPE html>` + doc(`<p>b</p>`));
    } catch (e) {
      err = String(e);
    }
    log("S9 plain  ->", err || live.body.innerHTML);
  });
});
