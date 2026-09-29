// Differential sweep ref (66dcba5) vs cur on ClayJS-shaped merges:
// synthetic ids (full or partial convergence) and default identity,
// clean and dirty (a local text edit), with base twins and remote
// copies, moves, swaps, edits and deletes. Observes bytes, conflict
// kinds, localDiverged, live node destinations and adopted identities.
import { parse, doc } from "../node/lib/dom.js";
import { uniqueAuthored } from "./fast-path-gate.js";

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const pick = (r, l) => l[Math.floor(r() * l.length)];

function page(r) {
  let w = 0,
    aid = 0;
  const words = (n) => Array.from({ length: n }, () => "w" + w++).join(" ");
  const authored = () => (r() < 0.25 ? ` data-id="a${aid++}"` : "");
  const leaf = () => {
    const k = r();
    if (k < 0.2) return `<h2${authored()}>${words(2)}</h2>`;
    if (k < 0.35) return `<p${authored()}><em>${words(2)}</em> ${words(2)}</p>`;
    return `<p${authored()}>${words(3)}</p>`;
  };
  const box = (d) => {
    const tag = ["section", "div", "ul", "article"][Math.floor(r() * 4)];
    const n = 1 + Math.floor(r() * 3);
    let inner = "";
    for (let i = 0; i < n; i++)
      inner +=
        tag === "ul"
          ? `<li${authored()}>${leaf()}</li>`
          : d > 0 && r() < 0.5
            ? box(d - 1)
            : leaf();
    return `<${tag} class="c${Math.floor(r() * 3)}"${authored()}>${inner}</${tag}>`;
  };
  let body = "";
  for (let i = 1 + Math.floor(r() * 3); i > 0; i--) body += box(2);
  body += `<p>tail ${words(2)}</p>`;
  return body;
}
const FLOW = /^(SECTION|DIV|ARTICLE|LI)$/;
const fits = (into, el) =>
  el.tagName === "LI" ? into.tagName === "UL" : FLOW.test(into.tagName);

// Base twins: duplicate one subtree in the base itself (the twin gets its own id).
function twin(r, body) {
  const els = [...body.querySelectorAll("*")];
  const e = pick(r, els);
  const c = e.cloneNode(true);
  for (const x of [c, ...c.querySelectorAll("[data-id]")])
    x.removeAttribute("data-id");
  if (r() < 0.5) e.after(c);
  else {
    const into = pick(
      r,
      els.filter((x) => fits(x, e) && !e.contains(x) && x !== e),
    );
    if (into) into.appendChild(c);
    else e.after(c);
  }
}

function operate(r, body) {
  const els = () => [...body.querySelectorAll("*")];
  const done = [];
  for (let i = 1 + Math.floor(r() * 2); i > 0; i--) {
    const all = els();
    if (!all.length) break;
    const e = pick(r, all);
    const k = r();
    if (k < 0.15) {
      const c = e.cloneNode(true);
      r() < 0.5 ? e.before(c) : e.after(c);
      done.push("dup");
    } else if (k < 0.25) {
      const into = pick(
        r,
        all.filter((x) => fits(x, e) && !e.contains(x)),
      );
      if (into) {
        into.appendChild(e.cloneNode(true));
        done.push("dup-into");
      }
    } else if (k < 0.35) {
      const rep = e.cloneNode(true);
      const slot = pick(
        r,
        [rep, ...rep.querySelectorAll("*")].filter((x) => fits(x, e)),
      );
      if (!slot) continue;
      slot.appendChild(e.cloneNode(true));
      const od = [...e.querySelectorAll("*")];
      if (od.length) {
        const d = pick(r, od);
        const t = [...rep.querySelectorAll("*")].find(
          (x) => x.outerHTML === d.outerHTML && !x.contains(d),
        );
        if (t) t.replaceWith(d);
      }
      e.replaceWith(rep);
      done.push("wrap");
    } else if (k < 0.45) {
      const c = e.cloneNode(true);
      e.after(c);
      const od = [...e.querySelectorAll("*")];
      if (od.length) {
        const j = Math.floor(r() * od.length);
        const cd = c.querySelectorAll("*");
        if (cd[j]) cd[j].replaceWith(od[j]);
      }
      done.push("dup-move");
    } else if (k < 0.6) {
      const into = pick(
        r,
        all.filter((x) => fits(x, e) && !e.contains(x)),
      );
      if (into) {
        r() < 0.5 ? into.appendChild(e) : into.prepend(e);
        done.push("move");
      }
    } else if (k < 0.72) {
      const same = all.filter(
        (x) =>
          x !== e &&
          x.tagName === e.tagName &&
          !x.contains(e) &&
          !e.contains(x),
      );
      const o = pick(r, same);
      if (o) {
        const m = body.ownerDocument.createComment("");
        e.before(m);
        o.before(e);
        m.replaceWith(o);
        done.push("swap");
      }
    } else if (k < 0.87) {
      const t = [e, ...e.querySelectorAll("*")].find(
        (x) => x.firstChild && x.firstChild.nodeType === 3,
      );
      if (t) {
        t.firstChild.nodeValue += " redit";
        done.push("edit");
      }
    } else {
      if (e.parentNode !== body || body.children.length > 2) {
        e.remove();
        done.push("del");
      }
    }
  }
  return done;
}

const lockstep = (a, b, m = new Map()) => {
  m.set(a, b);
  for (
    let p = a.firstChild, q = b.firstChild;
    p && q;
    p = p.nextSibling, q = q.nextSibling
  )
    lockstep(p, q, m);
  return m;
};
const elsOf = (d) => [
  d.documentElement,
  ...d.documentElement.querySelectorAll("*"),
];

export async function identityOracle(E, seed, idMode, dirty, fastPath) {
  const r = rng(
    seed * 2654435761 +
      (idMode === "default" ? 7 : idMode === "leaves" ? 13 : 0),
  );
  const b0 = parse(doc(page(r), "<title>t</title>"));
  if (r() < 0.6) twin(r, b0.body);
  if (r() < 0.3) twin(r, b0.body);
  const B = "<!DOCTYPE html>" + b0.documentElement.outerHTML;
  const base = parse(B),
    live = parse(B),
    senderDoc = parse(B);
  // node labels on live
  let n = 0;
  for (const el of elsOf(live)) el.__n = ++n;
  // ids
  const store = E.createIdentityStore("t");
  const bl = lockstep(base.documentElement, live.documentElement);
  const conv = (el) =>
    idMode !== "leaves" ||
    el.children.length === 0 ||
    /^(H2|P|EM|LI)$/.test(el.tagName);
  const senderOrigin = lockstep(
    senderDoc.documentElement,
    live.documentElement,
  );
  for (const el of elsOf(live)) if (conv(el)) store.ensure(el);
  for (const el of elsOf(base)) {
    const id = store.idOf(bl.get(el));
    if (id) store.adopt(el, id);
  }
  // remote ops on the sender
  const ops = operate(r, senderDoc.body);
  const out = E.createIdentityStore("s");
  for (const el of elsOf(senderDoc)) {
    const o = senderOrigin.get(el);
    if (o && store.idOf(o)) out.adopt(el, store.idOf(o));
  }
  const R = "<!DOCTYPE html>" + senderDoc.documentElement.outerHTML;
  const liveToSender = new Map();
  for (const el of elsOf(senderDoc)) {
    const o = senderOrigin.get(el);
    if (o && o.nodeType === 1) liveToSender.set(o, el);
  }
  if ("<!DOCTYPE html>" + parse(R).documentElement.outerHTML !== R) return null;
  const map = out.exportMap(senderDoc.documentElement, (x) => x);
  // local edit on the live page
  let localWord = null,
    intent = null;
  if (dirty) {
    const tw = live.createTreeWalker(live.body, 4),
      texts = [];
    for (let t = tw.nextNode(); t; t = tw.nextNode())
      if (/w\d/.test(t.nodeValue)) texts.push(t);
    const t = texts[Math.floor(r() * texts.length)];
    const before = t.nodeValue;
    t.nodeValue += " LOCAL";
    localWord = t.nodeValue;
    const pe = t.parentNode,
      idx = [...pe.childNodes].indexOf(t);
    const se = liveToSender.get(pe);
    if (
      se &&
      se.isConnected &&
      se.childNodes[idx] &&
      se.childNodes[idx].nodeType === 3 &&
      se.childNodes[idx].nodeValue === before
    ) {
      const old = se.childNodes[idx].nodeValue;
      se.childNodes[idx].nodeValue = localWord;
      intent = "<!DOCTYPE html>" + senderDoc.documentElement.outerHTML;
      se.childNodes[idx].nodeValue = old;
    }
  }
  const cap = parse("<!DOCTYPE html>" + live.documentElement.outerHTML);
  const cl = lockstep(cap.documentElement, live.documentElement);
  const toLive = (x) => cl.get(x) || null;
  let identity;
  if (idMode !== "default" && idMode !== "authored") {
    const authored = uniqueAuthored();
    const local = (el) => authored(el) || store.idOf(toLive(el) || el) || null;
    identity = {
      base: dirty ? (el) => authored(el) || store.idOf(el) || null : local,
      local,
      remote: { first: authored, map, then: authored },
    };
  }
  if (idMode === "authored")
    identity = {
      base: uniqueAuthored(),
      local: uniqueAuthored(),
      remote: uniqueAuthored(),
    };
  const opts = {
    live,
    base: dirty ? base : cap,
    local: { root: cap.documentElement, toLive },
    remote: R,
    scripts: { execute: false },
    ...(identity ? { identity } : {}),
    ...(fastPath === undefined ? {} : { fastPath }),
  };
  const w = console.warn;
  console.warn = () => {};
  let rep;
  try {
    rep = await E.mergeDocument(opts);
  } finally {
    console.warn = w;
  }
  const html = "<!DOCTYPE html>" + live.documentElement.outerHTML;
  const dest = elsOf(live)
    .map((e) => e.__n ?? "+")
    .join(",");
  const ids = (rep.identities || [])
    .map(([el, id]) => `${el.__n ?? "+"}=${id}`)
    .sort()
    .join(",");
  return {
    B,
    R,
    intent: dirty ? intent : R,
    html,
    ops,
    dest,
    ids,
    conflicts: rep.conflicts
      .map((c) => `${c.kind}:${c.detail || ""}`)
      .sort()
      .join("|"),
    ld: rep.localDiverged,
    stats: rep.stats,
  };
}
