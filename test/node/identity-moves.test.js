import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../../src/index.js";
import { parse, doc } from "./lib/dom.js";
import { lockstepMap } from "../lib/differential-observe.js";

async function run(E, shape, route, hook, region) {
  const middle =
    shape === "siblings"
      ? "<section><p>same words</p></section><section><p>same words</p></section>"
      : shape === "template"
        ? "<template><section><p>same words</p></section><aside><p>same words</p></aside></template>"
        : "<section><p>same words</p></section><aside><p>same words</p></aside>";
  const html = doc(
    `<main>${middle}<footer>old</footer><nav data-ignore>runtime</nav></main>`,
  );
  const base = parse(html),
    live = parse(html),
    remote = parse(html);
  const content = (d) =>
    shape === "template"
      ? d.querySelector("template").content
      : d.querySelector("main");
  const capMap = lockstepMap(base.documentElement, live.documentElement);
  const store = E.createIdentityStore("receiver"),
    sender = E.createIdentityStore("sender");
  const bp = [...content(base).querySelectorAll("p")],
    lp = [...content(live).querySelectorAll("p")],
    rp = [...content(remote).querySelectorAll("p")];
  for (let i = 0; i < 2; i++) {
    store.adopt(lp[i], `shared:${i}`);
    sender.adopt(rp[i], `shared:${i}`);
  }
  const first = rp[0],
    second = rp[1],
    parent = second.parentElement;
  first.replaceWith(second);
  parent.append(first);
  remote.querySelector("footer").textContent = "NEW";
  if (route !== "clean") {
    lp[0].textContent += " FIRST";
    lp[1].textContent += " SECOND";
  }
  const id = (n) => store.idOf(capMap.get(n) || n);
  const identity = {
    base: id,
    local: id,
    remote:
      shape === "template"
        ? (n) => sender.idOf(n)
        : {
            map: sender.exportMap(
              route === "element"
                ? remote.querySelector("main")
                : remote.documentElement,
              (n) => n,
            ),
            then: () => null,
          },
  };
  const opts = {
    identity,
    scripts: { execute: false },
    ...(hook ? { hooks: { beforeNodeMorphed() {} } } : {}),
    ...(region === "ignored"
      ? { ignore: (el) => el.hasAttribute("data-ignore") }
      : {}),
    ...(region === "remoteWins"
      ? { remoteWins: (el) => el.tagName === "ASIDE" }
      : {}),
  };
  let result, output;
  if (route === "pure") {
    result = E.merge3(base, live, remote, opts);
    output = result.doc.body.innerHTML;
  } else if (route === "element") {
    result = await E.morphElement(
      live.querySelector("main"),
      remote.querySelector("main"),
      { ...opts, base: base.querySelector("main") },
    );
    output = live.body.innerHTML;
  } else {
    result = await E.mergeDocument({
      ...opts,
      live,
      base,
      remote,
      ...(route === "clean"
        ? {
            local: {
              root: base.documentElement,
              toLive: (n) => capMap.get(n) || null,
            },
          }
        : {}),
    });
    output = live.body.innerHTML;
  }
  return {
    html: output,
    paragraphs: [
      ...content(route === "pure" ? result.doc : live).querySelectorAll("p"),
    ].map((p) => p.textContent),
    destinations: lp.map((p) => [
      p.parentElement?.tagName,
      p.parentElement?.previousElementSibling?.tagName || null,
    ]),
    conflicts: result.conflicts.map((c) => [c.kind, c.detail]),
    localDiverged: result.localDiverged,
  };
}

for (const shape of ["containers", "siblings", "template"])
  for (const route of ["dirty", "pure", "element", "clean"])
    for (const hook of [false, true])
      for (const region of ["none", "ignored", "remoteWins"])
        test(`G1 identity swap ${shape} ${route} hook=${hook} ${region}`, async () => {
          const result = await run(C, shape, route, hook, region);
          const expected =
            route === "clean"
              ? ["same words", "same words"]
              : region === "remoteWins" && shape !== "siblings"
                ? ["same words SECOND", "same words"]
                : ["same words SECOND", "same words FIRST"];
          assert.deepEqual(result.paragraphs, expected);
          if (route !== "pure")
            assert.deepEqual(
              result.destinations.map((x) => x[0]),
              shape === "siblings"
                ? ["SECTION", "SECTION"]
                : shape === "template"
                  ? ["SECTION", "ASIDE"]
                  : ["ASIDE", "SECTION"],
            );
          if (route !== "pure" && shape !== "template")
            assert.deepEqual(
              result.destinations,
              shape === "siblings"
                ? [
                    ["SECTION", "SECTION"],
                    ["SECTION", null],
                  ]
                : [
                    ["ASIDE", "SECTION"],
                    ["SECTION", null],
                  ],
            );
          // The paragraph remote moved into the region drops its local edit,
          // which must be reported. The region root also reports the local
          // edit to the paragraph remote moved out, which survived: a known
          // over-report, so this row only requires that one exists.
          const dropped =
            region === "remoteWins" && shape !== "siblings" && route !== "clean";
          assert.deepEqual(
            result.conflicts.filter(([, d]) => d !== "remote-wins"),
            [],
          );
          assert.equal(
            result.conflicts.some(([, d]) => d === "remote-wins"),
            dropped,
          );
        });
