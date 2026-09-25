import { parse, doc } from "./dom.js";
import { merge3 } from "../../../src/merge.js";
import { makeIgnore } from "../../../src/ignore.js";
import { defaultIdentity } from "../../../src/identity.js";

/** Run merge3 on three body strings; return the merged body innerHTML and the result. */
export function mergeBodies(base, local, remote, opts = {}) {
  const b = parse(doc(base, opts.baseHead || "")),
    l = parse(doc(local, opts.localHead || "")),
    r = parse(doc(remote, opts.remoteHead || ""));
  const res = merge3(b, l, r, {
    identity: {
      base: opts.idOf || defaultIdentity,
      local: opts.idOf || defaultIdentity,
      remote: opts.idOf || defaultIdentity,
    },
    ignored: makeIgnore(opts.ignore),
    remoteWins: makeIgnore(opts.remoteWins),
    ignoreAttribute: opts.ignoreAttribute || (() => false),
    conflicts: opts.conflicts || "remote",
    mergeTags: opts.mergeTags || [],
    baseURI: "http://localhost/page.html",
    localIsBase: opts.localIsBase || false,
  });
  return {
    html: res.doc.body.innerHTML,
    head: res.doc.head.innerHTML,
    res,
    b,
    l,
    r,
  };
}
