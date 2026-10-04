/**
 * lineage.js — where each watched live element's region went in one apply.
 *
 * Reporting only. The merge records three kinds of evidence while it builds
 * (a proven retag link, an engine removal, an inline merge that decided a
 * node's fate), reads the rest from provenance and segment records once it
 * is done, and apply's caller checks the plan against the live DOM. Nothing
 * here changes what the merge builds or what apply does.
 */

const LOST = Symbol("lost");

export function createLineageRecorder() {
  return {
    links: new Map(),
    removed: new Set(),
    consumed: new Set(),
    link(local, output) {
      this.links.set(local, output);
    },
    remove(unit) {
      if (!unit) return;
      if (unit.nodeType === 1) this.removed.add(unit);
      else for (const n of unit.nodes) this.removed.add(n);
    },
    consume(nodes) {
      for (const n of nodes) this.consumed.add(n);
    },
  };
}

const kidsOf = (n) =>
  n.nodeType === 1 && n.tagName === "TEMPLATE" && n.content ? n.content : n;

/**
 * The merge-side plan for each watched local element: one output element
 * holding every surviving piece of it, its confirmed removal, or unknown.
 */
export function planLineage({
  locals,
  rec,
  root,
  provenance,
  segments,
  ignored,
}) {
  const own = new Map();
  const addOwn = (local, output) => {
    let set = own.get(local);
    if (!set) own.set(local, (set = new Set()));
    set.add(output);
  };

  // Inline reconstruction: exact per-character origins. The caret map and a
  // text node's provenance.local name a nearby node for deleted text, so
  // neither is read for these outputs.
  const segText = new Set();
  const segLocal = new Set();
  for (const seg of segments) {
    const outs = seg.textNodes;
    for (const t of outs) segText.add(t.node);
    for (const ln of seg.localNodes) {
      segLocal.add(ln.node);
      let ti = 0,
        last = null;
      for (let i = ln.s; i < ln.e; i++) {
        const mp = seg.lToM[i];
        if (mp < 0) continue;
        if (!outs[ti] || mp < outs[ti].ms) ti = 0;
        while (ti < outs.length && outs[ti].me <= mp) ti++;
        const t = outs[ti] && outs[ti].ms <= mp ? outs[ti].node : LOST;
        if (t !== last) addOwn(ln.node, t);
        last = t;
      }
    }
  }

  const inTree = new Set();
  const hostOf = new Map();
  const kept = new Set();
  (function walk(m) {
    inTree.add(m);
    const p = provenance.get(m);
    if (m.nodeType === 1) {
      if (p && p.local && p.local.nodeType === 1) {
        addOwn(p.local, m);
        if (p.unchanged) kept.add(p.local);
      }
      if (m.tagName === "TEMPLATE" && m.content) hostOf.set(m.content, m);
    } else if (p && Array.isArray(p.local) && !segText.has(m))
      for (const n of p.local) addOwn(n, m);
    for (let c = kidsOf(m).firstChild; c; c = c.nextSibling) walk(c);
  })(root);

  const carried = new Set();
  for (const [local, output] of rec.links) {
    addOwn(local, output);
    carried.add(local);
  }

  const up = (n) => {
    const p = n.parentNode;
    return p && p.nodeType === 11 ? hostOf.get(p) || null : p;
  };
  const inside = (x, M) => {
    for (let n = x; n; n = up(n)) if (n === M) return true;
    return false;
  };
  const decidedAt = (n) => rec.removed.has(n) || rec.consumed.has(n);
  // A watched node with no output of its own follows its nearest ancestor
  // that has evidence: left alone inside an unchanged output, or decided by
  // a removal or an inline merge. An ancestor merged any other way should
  // have accounted for it, so nothing is concluded.
  const fateAbove = (n) => {
    for (let p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (kept.has(p)) return "kept";
      if (decidedAt(p)) return "decided";
      if (own.has(p)) return null;
    }
    return null;
  };

  const plans = new Map();
  for (const Wl of locals) plans.set(Wl, classify(Wl));
  return plans;

  function classify(Wl) {
    const roots = own.get(Wl);
    if (roots && (roots.size !== 1 || roots.has(LOST)))
      return { kind: "unknown", reason: "several-outputs" };
    const M = roots ? roots.values().next().value : null;
    if (M && (M.nodeType !== 1 || !inTree.has(M)))
      return { kind: "unknown", reason: "output-not-placed" };
    if (!M) {
      const fate = decidedAt(Wl) ? "decided" : fateAbove(Wl);
      // Inside an unchanged output: apply leaves the live subtree alone.
      if (fate === "kept") return { kind: "untouched" };
      if (fate !== "decided") return { kind: "unknown", reason: "unmapped" };
    }
    const owned = [];
    const fail = visit(
      Wl,
      !!M && (kept.has(Wl) || carried.has(Wl)),
      !M || decidedAt(Wl),
    );
    if (fail) return { kind: "unknown", reason: fail };
    return M
      ? { kind: "single", output: M, owned, carried: carried.has(Wl) }
      : { kind: "removed" };

    // Every local node under the watched one is accounted for: its outputs
    // all lie inside M, or a covering ancestor (unchanged output, proven
    // retag) or a decision (removal, inline merge, segment) accounts for it.
    function visit(n, covered, decided) {
      for (let c = kidsOf(n).firstChild; c; c = c.nextSibling) {
        if (
          c.nodeType === 1 ? ignored(c) : c.nodeType !== 3 && c.nodeType !== 8
        )
          continue;
        const outs = own.get(c);
        if (outs) {
          for (const o of outs) {
            if (o === LOST || !inTree.has(o)) return "output-not-placed";
            if (!M) return "survives-elsewhere";
            if (!inside(o, M)) return "escaped";
            owned.push(o);
          }
        } else if (!covered && !decided && !decidedAt(c) && !segLocal.has(c))
          return "unmapped";
        if (c.nodeType === 1) {
          const f = visit(
            c,
            covered || kept.has(c) || carried.has(c),
            decided || decidedAt(c),
          );
          if (f) return f;
        }
      }
      return null;
    }
  }
}

function inTemplateContents(el, root) {
  if (!root) return false;
  const templates =
    root.nodeType === 1 && root.tagName === "TEMPLATE"
      ? [root, ...root.querySelectorAll("template")]
      : [...root.querySelectorAll("template")];
  for (const template of templates) {
    if (
      template.content.contains(el) ||
      inTemplateContents(el, template.content)
    )
      return true;
  }
  return false;
}

export function validateLineage(spec, doc) {
  if (
    !spec ||
    typeof spec !== "object" ||
    typeof spec.onResult !== "function" ||
    !spec.elements ||
    !Number.isSafeInteger(spec.elements.length) ||
    spec.elements.length < 0
  )
    throw new TypeError("lineage must be { elements, onResult }");
  const watched = [];
  const seen = new Set();
  for (const el of Array.from(spec.elements)) {
    if (
      !el ||
      el.nodeType !== 1 ||
      (el.ownerDocument !== doc && !inTemplateContents(el, doc.documentElement))
    )
      throw new TypeError(
        "lineage.elements must be elements of the live document",
      );
    if (!seen.has(el)) {
      seen.add(el);
      watched.push(el);
    }
  }
  return watched;
}

const initialEvidence = new WeakMap();

function captureRegionEvidence(watched) {
  const evidence = new Map();
  for (const element of watched) {
    const nodes = [];
    let opaque = false;
    (function walk(node) {
      if (
        node.nodeType === 1 &&
        node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
        node.localName === "template"
      ) {
        opaque = true;
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        nodes.push(child);
        if (child.nodeType === 1) walk(child);
      }
    })(element);
    evidence.set(element, { nodes, opaque });
  }
  return evidence;
}

/**
 * The failure boundary every public apply call shares: once valid lineage is
 * requested and its watched list is frozen, any synchronous throw that has
 * not already delivered a result reports one incomplete one.
 */
export function guardLineage(options, root, invoke) {
  if (options.lineage === undefined) return invoke(options);
  if (!root || root.nodeType !== 1)
    throw new TypeError("lineage requires an element root");
  const spec = options.lineage;
  const watched = validateLineage(spec, root.ownerDocument);
  let delivered = false;
  const tracked = {
    ...options,
    lineage: {
      elements: watched,
      onResult(result, report) {
        if (delivered) return;
        delivered = true;
        return spec.onResult(result, report);
      },
    },
  };
  try {
    initialEvidence.set(tracked.lineage, captureRegionEvidence(watched));
    return invoke(tracked);
  } catch (error) {
    if (!delivered) {
      delivered = true;
      try {
        spec.onResult(
          {
            version: 1,
            root,
            status: "incomplete",
            entries: watched.map(unknown),
          },
          null,
        );
      } catch {
        // The application error is the one to propagate.
      }
    }
    throw error;
  }
}

/**
 * The live side: watched elements, their local twins, the pre-apply
 * descendants, and the final check of each plan against the DOM.
 */
export function startLineage(spec, { liveRoot, localRoot, toLive }) {
  const watched = validateLineage(spec, liveRoot.ownerDocument);
  const inLive = (n) => n === liveRoot || liveRoot.contains(n);
  const localOf = new Map();
  const left = new Set(watched.filter(inLive));
  if (left.size && localRoot === liveRoot)
    for (const w of left) localOf.set(w, w);
  else if (left.size)
    (function walk(n) {
      const lv = toLive(n);
      if (left.delete(lv)) localOf.set(lv, n);
      for (
        let c = n.firstElementChild;
        c && left.size;
        c = c.nextElementSibling
      )
        walk(c);
    })(localRoot);

  const state = {
    spec,
    watched,
    root: liveRoot,
    locals: Array.from(new Set(localOf.values())),
    before: initialEvidence.get(spec) || captureRegionEvidence(watched),
    delivered: false,
    result: null,
    finish(plans, resolve) {
      this.resolve = resolve;
      this.plans = plans;
      this.result = {
        version: 1,
        root: this.root,
        status: "complete",
        entries: watched.map((w) =>
          entryFor(w, localOf.get(w), plans, resolve, this),
        ),
      };
      return this.result;
    },
    recheck() {
      return this.finish(this.plans, this.resolve);
    },
    remapRoot(oldEl, fresh) {
      this.root = fresh;
      const resolve = this.resolve;
      const remapped = (m) => {
        const v = resolve(m);
        return v === oldEl ? fresh : v;
      };
      const result = this.finish(this.plans, remapped);
      return result;
    },
    deliver(report) {
      if (this.delivered) return;
      this.delivered = true;
      spec.onResult(this.result, report);
    },
  };
  return state;
}

const unknown = (from) => ({ from, to: [], kind: "unknown", complete: false });

function entryFor(w, Wl, plans, resolve, state) {
  const root = state.root;
  const inRoot = (n) => !!n && (n === root || root.contains(n));
  const plan = Wl && plans ? plans.get(Wl) : null;
  if (!plan || plan.kind === "unknown") return unknown(w);
  const evidence = state.before.get(w);
  if (!evidence || evidence.opaque) return unknown(w);
  const before = evidence.nodes;
  const survives = (node) =>
    inRoot(node) ||
    !!(
      node &&
      node.ownerDocument === root.ownerDocument &&
      root.ownerDocument.documentElement?.contains(node)
    );
  if (plan.kind === "untouched") {
    if (!inRoot(w)) return unknown(w);
    for (const d of before)
      if (survives(d) && !w.contains(d)) return unknown(w);
    return { from: w, to: [w], kind: "retained", complete: true };
  }
  if (plan.kind === "removed") {
    if (survives(w) || before.some(survives)) return unknown(w);
    return { from: w, to: [], kind: "removed", complete: true };
  }
  const target = resolve(plan.output);
  if (!target || target.nodeType !== 1 || !inRoot(target)) return unknown(w);
  if (target !== w && survives(w)) return unknown(w);
  for (const d of before)
    if (survives(d) && !target.contains(d)) return unknown(w);
  for (const o of plan.owned) {
    const live = resolve(o);
    const nodes = Array.isArray(live) ? live : [live];
    for (const n of nodes)
      if (!n || !inRoot(n) || !target.contains(n)) return unknown(w);
  }
  if (plan.carried && !sameShape(target, plan.output, resolve))
    return unknown(w);
  return {
    from: w,
    to: [target],
    kind: target === w ? "retained" : "replaced",
    complete: true,
  };
}

// A proven retag's whole merged subtree must have landed inside the target:
// each merged node resolves to a live node under it.
function sameShape(target, output, resolve) {
  for (let c = output.firstChild; c; c = c.nextSibling) {
    const live = resolve(c);
    const nodes = Array.isArray(live) ? live : [live];
    for (const n of nodes) if (!n || !target.contains(n)) return false;
    if (c.nodeType === 1 && !sameShape(target, c, resolve)) return false;
  }
  return true;
}

/** A call that applied nothing (an ignored root, a vetoed tag swap): every
 * watched element is reported unknown, and the callback still runs once. */
export function idleLineage(spec, root, report) {
  const state = startLineage(spec, {
    liveRoot: root,
    localRoot: root,
    toLive: (n) => n,
  });
  state.result = {
    version: 1,
    root,
    status: "complete",
    entries: state.watched.map((w) => unknown(w)),
  };
  report.lineage = state.result;
  return state;
}
