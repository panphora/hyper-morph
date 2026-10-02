import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../src/index.js";
import { normalize, runCase } from "../counterexamples/lib/runner.js";

const base = '<div><div><p sid="A"> beta</p> delta</div></div>';
const first = '<div><div><p sid="A"> beta delta</p></div></div>';
const inserted = '<div><div><p sid="B"> beta</p></div></div>';
const remote =
  '<div><div><p sid="B"> beta</p> delta </div></div><div><div><p sid="A"> beta</p></div></div>';

async function merge(
  shape,
  local = first + inserted,
  other = remote,
  options = {},
) {
  return runCase(
    E,
    normalize({ base, local, remote: other, shape, identity: "clay", options }),
  );
}

function assertOwners(obs, shape) {
  const { p, report, liveRoot } = obs.raw;
  const expected = shape === "pure" ? p.sidCap : p.sidL;
  for (const [source, id] of expected) {
    const outputs =
      shape === "pure"
        ? [...liveRoot.body.querySelectorAll("*")].filter(
            (node) => report.provenance.get(node)?.local === source,
          )
        : [...liveRoot.body.querySelectorAll("*")].filter(
            (node) => node === source,
          );
    assert.equal(outputs.length, 1, `${id} must retain exactly one owner`);
  }
  assert.equal(liveRoot.body.querySelectorAll("p").length, 2);
}

for (const shape of ["dirty", "pure"]) {
  test(`abandoned echo scaffolds disappear from original join structure (${shape})`, async () => {
    const obs = await merge(shape);
    const body = obs.raw.liveRoot.body;
    assert.equal(body.children.length, 2);
    assert.equal(body.querySelectorAll("div").length, 4);
    assert.ok([...body.children].every((node) => node.querySelector("p")));
    assertOwners(obs, shape);
  });

  test(`abandoned echo scaffolds disappear when the loose source is unchanged (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + inserted,
      remote.replace(" delta ", " delta"),
    );
    assert.equal(
      obs.raw.liveRoot.body.innerHTML,
      "<div><div><p> beta</p></div></div><div><div><p> beta delta</p></div></div>",
    );
    assertOwners(obs, shape);
  });

  test(`an independently inserted empty div survives echo removal (${shape})`, async () => {
    const obs = await merge(shape, first + inserted + "<div></div>");
    const body = obs.raw.liveRoot.body;
    assert.equal(body.children.length, 3);
    assert.equal(
      [...body.children].filter((node) => !node.firstChild).length,
      1,
    );
    assertOwners(obs, shape);
  });

  test(`an independently inserted empty div chain survives echo removal (${shape})`, async () => {
    const obs = await merge(shape, first + inserted + "<div><div></div></div>");
    const body = obs.raw.liveRoot.body;
    assert.equal(body.children.length, 3);
    assert.equal(
      [...body.children].filter((node) => node.innerHTML === "<div></div>")
        .length,
      1,
    );
    assertOwners(obs, shape);
  });

  test(`an attributed insertion owner survives echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<div class="keep"><div><p sid="B"> beta</p></div></div>',
    );
    assert.ok(obs.raw.liveRoot.body.querySelector("div.keep"));
    assertOwners(obs, shape);
  });

  test(`an identified insertion owner survives echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<div sid="shell"><div><p sid="B"> beta</p></div></div>',
    );
    assert.equal(obs.raw.liveRoot.body.children.length, 3);
    assertOwners(obs, shape);
  });

  test(`a semantic insertion owner survives echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<section><div><p sid="B"> beta</p></div></section>',
    );
    assert.ok(obs.raw.liveRoot.body.querySelector("section"));
    assertOwners(obs, shape);
  });

  test(`independent insertion text survives echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<div>keep<div><p sid="B"> beta</p></div></div>',
    );
    assert.equal(obs.raw.liveRoot.body.children.length, 3);
    assert.ok(
      [...obs.raw.liveRoot.body.children].some(
        (node) => node.textContent === "keep",
      ),
    );
    assertOwners(obs, shape);
  });

  test(`an independent insertion branch survives echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<div><div><p sid="B"> beta</p></div><aside>keep</aside></div>',
    );
    const body = obs.raw.liveRoot.body;
    assert.equal(body.children.length, 3);
    assert.equal(body.querySelectorAll("aside").length, 1);
    assert.equal(body.querySelector("aside").textContent, "keep");
    assertOwners(obs, shape);
  });

  test(`an ignored sibling retains its insertion wrapper after echo removal (${shape})`, async () => {
    const obs = await merge(
      shape,
      first + '<div><p sid="B"> beta</p><span class="pin">keep</span></div>',
      remote,
      { ignore: ".pin" },
    );
    const { p, report, liveRoot } = obs.raw;
    const source = p.cap.body.children[1];
    assert.equal(liveRoot.body.children.length, 3);
    if (shape === "pure") {
      const wrappers = [...liveRoot.body.children].filter(
        (node) => report.provenance.get(node)?.local === source,
      );
      assert.equal(wrappers.length, 1);
      assert.equal(source.querySelector(".pin").textContent, "keep");
    } else {
      const pin = p.capToLive.get(source.querySelector(".pin"));
      assert.ok(liveRoot.body.contains(pin));
      assert.equal(pin.textContent, "keep");
      assert.equal(pin.parentNode, p.capToLive.get(source));
    }
    assertOwners(obs, shape);
  });
}
