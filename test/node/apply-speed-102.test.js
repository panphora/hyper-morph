// 1.0.2 speed fixes, pinned: identity alignment when base and local are the
// same tree (fix 1) and the cached text twin sets (fix 6). Every expectation
// was taken from 1.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, doc } from "./lib/dom.js";
import {
  mergeDocument,
  createIdentityStore,
  importMap,
} from "../../src/index.js";
import {
  cleanRows,
  lockstepMap,
  survivors,
  tagNodes,
} from "./lib/apply-speed-fuzz.js";

const OPTS = { scripts: { execute: false }, restoreFocus: false };

const jsonScript = (body) =>
  doc(`<script type="application/json" merge="store">${body}</script>`);
const jsonOf = (live) => live.body.querySelector("script").textContent;

const JSON_CASES = [
  {
    name: "top-level key",
    base: '{"a":1,"b":2}',
    remote: '{"a":1}',
    explicit: '{"a":1}',
    implicit: '{"a":1,"b":2}',
  },
  {
    name: "nested key",
    base: '{"a":1,"b":{"c":2,"d":3}}',
    remote: '{"a":1,"b":{"c":2}}',
    explicit: '{"a":1,"b":{"c":2}}',
    implicit: '{"a":1,"b":{"c":2,"d":3}}',
  },
  {
    name: "nested object",
    base: '{"a":1,"b":{"c":2},"e":9}',
    remote: '{"a":1,"e":9}',
    explicit: '{"a":1,"e":9}',
    implicit: '{"a":1,"b":{"c":2},"e":9}',
  },
];

for (const c of JSON_CASES) {
  test(`H102 JSON key deleted, explicit base, ${c.name}: the key stays deleted`, async () => {
    const live = parse(jsonScript(c.base));
    const report = await mergeDocument({
      ...OPTS,
      live,
      base: live,
      remote: parse(jsonScript(c.remote)),
    });
    assert.equal(jsonOf(live), c.explicit);
    assert.equal(report.conflicts.length, 0);
  });

  test(`H102 JSON key deleted, implicit base, ${c.name}: as 1.0.1`, async () => {
    const live = parse(jsonScript(c.base));
    const report = await mergeDocument({
      ...OPTS,
      live,
      remote: parse(jsonScript(c.remote)),
    });
    assert.equal(jsonOf(live), c.implicit);
    assert.equal(report.conflicts.length, 0);
    assert.equal(report.localDiverged, true);
  });
}

const SWAP_BODY =
  "<h1>before</h1><section><p>same words here</p></section><section><p>same words here</p></section>";
const SWAP_REMOTE_BODY = SWAP_BODY.replace("<h1>before</h1>", "<h1>after</h1>");

function elementPaths(root) {
  const list = [];
  const visit = (el, path) => {
    list.push([path, el]);
    for (let i = 0; i < el.children.length; i++)
      visit(el.children[i], path === "" ? String(i) : path + "." + i);
  };
  visit(root, "");
  return list;
}

// Two sections hold one identical paragraph each; the remote swaps the two
// synthetic ids across them and edits the heading. Both live paragraphs must
// stay the nodes they were, whichever slot they land in.
const SWAP_POSITIONS = [
  { preId: "seed:6", index: 1, isConnected: true, idAssigned: "seed:6" },
  { preId: "seed:8", index: 0, isConnected: true, idAssigned: "seed:8" },
];

async function swapCase(dirty) {
  const b = parse(doc(SWAP_BODY));
  const live = parse(doc(SWAP_BODY));
  const remote = parse(doc(SWAP_REMOTE_BODY));
  const paths = elementPaths(b.documentElement);
  const pPaths = paths.filter(([, el]) => el.tagName === "P").map(([p]) => p);
  assert.equal(pPaths.length, 2);
  const store = createIdentityStore("seed");
  const map = store.exportMap(b.documentElement, (n) => n);
  const remoteMap = Object.assign({}, map);
  remoteMap[pPaths[0]] = map[pPaths[1]];
  remoteMap[pPaths[1]] = map[pPaths[0]];
  const spec = (m) => ({ map: m, first: () => null });
  const livePs = Array.from(live.querySelectorAll("p"));
  const preIds = importMap(live.documentElement, map);
  const pre = livePs.map((p) => preIds.get(p) || null);
  if (dirty) livePs[0].textContent = "LOCAL same words here";
  const report = await mergeDocument({
    ...OPTS,
    live,
    base: b,
    remote,
    identity: { base: spec(map), local: spec(map), remote: spec(remoteMap) },
  });
  const nowPs = Array.from(live.querySelectorAll("p"));
  const idAt = (node) => {
    const hit = (report.identities || []).find(([el]) => el === node);
    return hit ? hit[1] : null;
  };
  return {
    html: live.body.innerHTML,
    equalsRemote: live.body.innerHTML === remote.body.innerHTML,
    conflicts: report.conflicts.map((c) => c.kind),
    positions: livePs.map((p, i) => ({
      preId: pre[i],
      index: nowPs.indexOf(p),
      isConnected: p.isConnected,
      idAssigned: idAt(p),
    })),
  };
}

test("H102 swap across sections with a heading change, clean: as 1.0.1", async () => {
  const got = await swapCase(false);
  assert.equal(
    got.html,
    "<h1>after</h1><section><p>same words here</p></section><section><p>same words here</p></section>",
  );
  assert.equal(got.equalsRemote, true);
  assert.deepEqual(got.conflicts, []);
  assert.deepEqual(got.positions, SWAP_POSITIONS);
});

test("H102 swap across sections with a heading change, dirty: as 1.0.1", async () => {
  const got = await swapCase(true);
  assert.equal(
    got.html,
    "<h1>after</h1><section><p>same words here</p></section><section><p>LOCAL same words here</p></section>",
  );
  assert.equal(got.equalsRemote, false);
  assert.deepEqual(got.conflicts, []);
  assert.deepEqual(got.positions, SWAP_POSITIONS);
});

const PRICING_BASE =
  '<main><section class="left"><article><h3>Pricing</h3><video src="a.mp4"></video></article><article><h3>About</h3></article></section><section class="right"><article><h3>Team</h3></article></section></main>';
const PRICING_MOVED =
  '<main><section class="left"><article><h3>About</h3></article></section><section class="right"><article><h3>Team</h3></article><article><h3>Pricing</h3><video src="a.mp4"></video></article></section></main>';
const findPricingArticle = (d) =>
  Array.from(d.querySelectorAll("article")).find((a) =>
    /Pricing/.test(a.textContent),
  ) || null;

test("H102 pricing card moved between columns, full merge: the live nodes move", async () => {
  const live = parse(doc(PRICING_BASE));
  const article = findPricingArticle(live);
  const video = live.querySelector("video");
  const report = await mergeDocument({
    ...OPTS,
    live,
    base: doc(PRICING_BASE),
    remote: doc(PRICING_MOVED),
  });
  assert.equal(findPricingArticle(live), article);
  assert.equal(live.querySelector("video"), video);
  assert.equal(article.isConnected, true);
  assert.equal(video.isConnected, true);
  assert.equal(live.body.innerHTML, parse(doc(PRICING_MOVED)).body.innerHTML);
  assert.deepEqual(report.conflicts, []);
});

const card = (t) =>
  `<div class="card"><h3>${t}</h3><p>Body text of the card.</p></div>`;
const SYNC_BODY = `<section class="a">${card("One")}${card("Two")}</section><section class="b"></section>`;

const SYNC = {
  S1: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One")}</section>`,
    movedPath: ["1.0.0", "1.1.0"],
    survivors: "0,1,2,3,N,N,N,N,N,9,10,11,12,13,14,4,5,6,7,8",
  },
  S2: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One edited")}</section>`,
    movedPath: ["1.0.0", "1.1.0"],
    survivors: "0,1,2,3,N,N,N,N,N,9,10,11,12,13,14,4,5,6,7,8",
  },
  S3: {
    remote: `<section class="a">${card("One")}${card("Two")}</section><section class="b">${card("One")}</section>`,
    movedPath: null,
    survivors: "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,N,N,N,N,N",
  },
  S4: {
    remote: SYNC_BODY,
    permute: true,
    survivors: "0,1,2,3,9,10,11,12,13,4,5,6,7,8,14",
  },
};

const authored = (el) =>
  el.getAttribute("data-id") || el.getAttribute("id") || null;

// The sender mints its own map for the remote tree, then shares every id with
// the receiver except the one it re-minted, so a copy left in place and a move
// are the same bytes: only the ids tell them apart.
async function syncCase({ remote: remoteHtml, movedPath, permute }) {
  const live = parse(doc(SYNC_BODY)),
    cap = parse(doc(SYNC_BODY)),
    remote = parse(doc(remoteHtml));
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  const store = createIdentityStore("t");
  const capMap = store.exportMap(cap.documentElement, (n) => n);
  const senderStore = createIdentityStore("t");
  const map = senderStore.exportMap(remote.documentElement, (n) => n);
  for (const k of Object.keys(map))
    if (k !== "~" && k !== "^" && capMap[k]) map[k] = capMap[k];
  if (movedPath) {
    const [from, to] = movedPath;
    map[to] = capMap[from];
    map[from] = "t:copy";
    for (const k of Object.keys(map))
      if (k.startsWith(from + ".")) map[k] = "t:copy" + k.slice(from.length);
    for (const k of Object.keys(capMap))
      if (k.startsWith(from + ".")) map[to + k.slice(from.length)] = capMap[k];
  } else if (permute) {
    const one = capMap["1.0.0"];
    for (const k of Object.keys(map)) {
      if (k === "1.0.0" || k.startsWith("1.0.0.")) map[k] = "t:new" + k;
      else if (k === "1.0.1" || k.startsWith("1.0.1."))
        map[k] = k === "1.0.1" ? one : capMap["1.0.0" + k.slice(5)];
    }
  } else {
    for (const k of Object.keys(map))
      if (k.startsWith("1.1.0")) map[k] = "t:copy" + k.slice(5);
  }
  const ids = tagNodes(live.documentElement);
  const localId = (el) => authored(el) || store.idOf(el) || null;
  const report = await mergeDocument({
    ...OPTS,
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote,
    identity: {
      base: localId,
      local: localId,
      remote: { first: authored, map, then: authored },
    },
  });
  return {
    html: live.body.innerHTML,
    frame: parse(doc(remoteHtml)).body.innerHTML,
    survivors: survivors(live.documentElement, ids),
    conflicts: report.conflicts.map((c) => c.kind),
  };
}

for (const [name, c] of Object.entries(SYNC)) {
  test(`H102 sync ${name}: bytes equal the frame, as 1.0.1`, async () => {
    const got = await syncCase(c);
    assert.equal(got.html, got.frame);
    assert.equal(got.survivors, c.survivors);
    assert.deepEqual(got.conflicts, []);
  });
}

test("H102 clean tab never reports a conflict across fuzz seeds 1-300", async () => {
  const rows = await cleanRows(1, 300);
  assert.equal(rows.length, 300);
  assert.deepEqual(
    rows.filter((r) => r.conflicts.length),
    [],
  );
  assert.deepEqual(
    rows.filter((r) => r.html !== r.frame),
    [],
  );
});

const LOSS_BASE =
  "<section><div><p>A</p><p>B</p></div><div><p>C</p><p>D</p></div></section>";
const LOSS_LOCAL = LOSS_BASE.replace("<p>D</p>", "<p>D local</p>");
const LOSS_MAP = {
  "1.0": "section",
  "1.0.0": "left",
  "1.0.1": "right",
  "1.0.0.0": "a",
  "1.0.0.1": "b",
  "1.0.1.0": "c",
  "1.0.1.1": "d",
};
// The remote keeps the element that moved as a copy where it was, so the two
// paragraphs the ids pair are A/B in one container and C/D local in the other.
const LOSS_REMOTE_MAP = {
  "1.0": "section",
  "1.0.0": "new-left",
  "1.0.1": "new-right",
  "1.0.0.0": "a",
  "1.0.0.1": "new-b",
  "1.0.1.0": "b",
  "1.0.1.1": "d",
};

test("H102 identity moved across sibling containers keeps every local paragraph, as 1.0.1", async () => {
  const live = parse(doc(LOSS_LOCAL));
  await mergeDocument({
    ...OPTS,
    live,
    base: parse(doc(LOSS_BASE)),
    remote: parse(doc(LOSS_BASE)),
    identity: {
      base: { first: () => null, map: LOSS_MAP },
      local: { first: () => null, map: LOSS_MAP },
      remote: { first: () => null, map: LOSS_REMOTE_MAP },
    },
  });
  assert.equal(live.body.innerHTML, LOSS_LOCAL);
});

// A paragraph whose <b> text the browser had already split in two when the
// snapshot was taken; after the snapshot the user types into one half.
async function textTwin(bodyHtml, remoteBody, splitAt, type) {
  const live = parse(doc(bodyHtml));
  const b = live.querySelector("b");
  b.firstChild.splitText(splitAt);
  const cap = live.cloneNode(true);
  const toLive = lockstepMap(cap.documentElement, live.documentElement);
  type(live);
  const report = await mergeDocument({
    ...OPTS,
    live,
    base: cap,
    local: { root: cap.documentElement, toLive: (n) => toLive.get(n) || null },
    remote: doc(remoteBody),
  });
  return { html: live.body.innerHTML, conflicts: report.conflicts.length };
}

const TEXT_TWIN_CASES = [
  {
    name: "typed into the first half",
    body: "<p>one <b>two three</b> four</p>",
    remote: "<p>one <b>two three</b> four five</p>",
    splitAt: 4,
    edit: (live) => {
      live.querySelector("b").firstChild.nodeValue = "twoZ ";
    },
    html: "<p>one <b>twoZ three</b> four five</p>",
    conflicts: 0,
  },
  {
    name: "typed into the second half",
    body: "<p>one <b>two three</b> four</p>",
    remote: "<p>one <b>two three</b> four five</p>",
    splitAt: 4,
    edit: (live) => {
      live.querySelector("b").lastChild.nodeValue = "threeZ";
    },
    html: "<p>one <b>two threeZ</b> four five</p>",
    conflicts: 0,
  },
  {
    name: "typed into a text node before the split one",
    body: "<p>one <b>two three</b> four</p><p>six</p>",
    remote: "<p>one <b>two three</b> four five</p><p>six</p>",
    splitAt: 4,
    edit: (live) => {
      live.querySelector("p").firstChild.nodeValue = "oneZ ";
    },
    html: "<p>oneZ <b>two three</b> four five</p><p>six</p>",
    conflicts: 0,
  },
];

for (const c of TEXT_TWIN_CASES) {
  test(`H102 text twin, ${c.name}: as 1.0.1`, async () => {
    const got = await textTwin(c.body, c.remote, c.splitAt, c.edit);
    assert.equal(got.html, c.html);
    assert.equal(got.conflicts, c.conflicts);
  });
}
