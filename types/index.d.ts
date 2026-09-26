// Type declarations for hyper-morph 1.x. The contract is docs/api.md.

export type Side = "local" | "remote" | "both";

export type IdOf = (el: Element) => string | null | undefined;

/**
 * A function returning an element's identity, or a path-keyed id map
 * ("" for the root, "0.2.1" for root > child 0 > child 2 > child 1, element
 * children only) applied after the side is parsed, with `then` answering
 * for elements the map does not name.
 */
export type IdentitySpec =
  | IdOf
  | { map: Record<string, string>; first?: IdOf; then?: IdOf };

export interface MergeTagRecognizer {
  /** Does this recognizer claim the script? */
  match: (el: Element) => boolean;
  /** The script's merge identity. */
  identity: (el: Element) => string | null | undefined;
  /** Dialect parser; must throw on invalid input. Default: parseJsonRelaxed. */
  parse?: (text: string) => any;
}

export interface Hooks {
  beforeNodeAdded?: (node: Node) => boolean | void;
  afterNodeAdded?: (node: Node) => void;
  beforeNodeRemoved?: (node: Node) => boolean | void;
  afterNodeRemoved?: (node: Node) => void;
  beforeNodeMorphed?: (live: Node, merged: Node) => boolean | void;
  afterNodeMorphed?: (live: Node, merged: Node) => void;
  beforeAttributeUpdated?: (
    name: string,
    el: Element,
    kind: "update" | "remove",
  ) => boolean | void;
}

export interface CommonOptions {
  identity?: {
    base?: IdentitySpec;
    local?: IdentitySpec;
    remote?: IdentitySpec;
  };
  /** Regions never touched, never read, never indexed. Ancestor-aware. */
  ignore?: (el: Element) => boolean;
  /** Regions where local edits do not count; remote lands unchanged. */
  remoteWins?: (el: Element) => boolean;
  /** Attributes left out of the merge and of every report. */
  ignoreAttribute?: (el: Element, name: string) => boolean;
  /** Resolution for overlapping edits. "both" is text only. Default "remote". */
  conflicts?: "remote" | "local" | "both";
  /** Keep the focused input's or textarea's value. Default true. */
  protectFocusedValue?: boolean;
  /** How form control state is synced. Default "attribute". */
  formState?: "attribute" | "property";
  head?: {
    /** Resolve the Promise after inserted stylesheets load. Default false. */
    awaitLoads?: boolean;
    /** A live head child this approves is never removed. */
    preserve?: (el: Element) => boolean;
  };
  scripts?: {
    /** Run scripts new to the page after apply. Default true. */
    execute?: boolean;
    /** Three-way merge of JSON data scripts. Default true. */
    merge?: boolean;
    /** Extra merge-tag recognizers, tried after merge="<name>". */
    mergeTags?: MergeTagRecognizer[];
  };
  hooks?: Hooks;
  /** Called with the merged document before any live mutation. */
  beforeApply?: (mergedDoc: Document) => void;
}

export interface MergeDocumentOptions extends CommonOptions {
  live: Document;
  /** The document both sides started from; null, undefined or "" for two-way. */
  base: string | Document | null | undefined;
  remote: string | Document;
  /** The local side when it is not the live DOM: a snapshot clone plus provenance. */
  local?: { root: Element; toLive: (n: Node) => Node | null };
}

export type MorphDocumentOptions = CommonOptions;

export type ElementContent =
  | string
  | Element
  | Document
  | DocumentFragment
  | NodeList
  | ArrayLike<Node>
  | null
  | undefined;

export interface MorphElementOptions extends CommonOptions {
  /** Merge the element's children only. */
  children?: boolean;
  /** Base for a three-way merge of this element. */
  base?: ElementContent;
}

export type Applied =
  | { kind: "text"; node: Text | Element; before: string; after: string }
  | {
      kind: "attr";
      el: Element;
      name: string;
      before: string | null;
      after: string | null;
    }
  | { kind: "insert"; node: Node; parent: Node }
  | { kind: "remove"; node: Node; parent: Node | null }
  | { kind: "move"; el: Element; from: Node; to: Node };

export type Decision =
  | {
      kind: "text";
      node: Text | Element | null;
      source: Side;
      applied: boolean;
    }
  | {
      kind: "attr";
      el: Element | null;
      name: string;
      source: Side;
      applied: boolean;
    }
  | { kind: "insert"; el: Element | null; source: Side; applied: boolean }
  | { kind: "remove"; source: Side; applied: boolean; base: Element }
  | { kind: "move"; el: Element | null; source: Side; applied: boolean };

export type StructureDetail =
  | "both-reordered"
  | "both-moved"
  | "edit-beats-delete"
  | "move-beats-delete"
  | "insert-collision";

export type Conflict =
  | {
      kind: "text";
      /** The block element for a conflict in its inline content. */
      node: Text | Element | null;
      base: string;
      local: string;
      remote: string;
      resolved: string;
      /** Inline content: the resolved region in the segment's merged text, atoms one character each. */
      range?: [number, number];
    }
  | {
      kind: "attr";
      el: Element | null;
      name: string;
      base: string | null;
      local: string | null;
      remote: string | null;
      resolved: string | null;
    }
  | {
      kind: "structure";
      el: Element | null;
      detail: StructureDetail;
      base?: Element;
    };

export interface MergeReport {
  /** What apply did to the live DOM, in order. */
  applied: Applied[];
  /** Every merge decision that differs from base, with the side that caused it. */
  decisions: Decision[];
  conflicts: Conflict[];
  /** The merged document differs from the remote one: relay or save it. */
  localDiverged: boolean;
  /** Live elements paired with an identified remote element. */
  identities: Array<[Element, string]>;
  /** Live elements whose parent changed. */
  moved: Element[];
  /** Nodes created because nothing live matched them. */
  replaced: Node[];
}

export interface Provenance {
  base: any;
  local: Node | Node[] | null;
  remote: Node | Node[] | null;
  /** Subtree identical on every side; the output element has no children. */
  unchanged?: true;
  /** Inline merge: the offsets of each local text node that landed in this output text node. */
  caret?: Array<{ node: Text; from: number; to: number; flatStart: number }>;
  /** Inline merge: a local text node claimed here also has characters in another output node. */
  partial?: boolean;
  /** Inline merge: a placeholder for an ignored live element, positioned and never synced. */
  pinned?: true;
}

export interface TextMapper {
  /** Caret offset in the local run to an offset in this output node. */
  (localOffset: number): number;
  /** Inline merge: an offset in the segment's flattened local text to an offset in this node. */
  flat?: (flatOffset: number) => number;
}

export interface MergeResult {
  doc: Document;
  root: Element;
  provenance: WeakMap<Node, Provenance>;
  textMappers: WeakMap<Node, TextMapper>;
  decisions: Decision[];
  conflicts: Conflict[];
  localDiverged: boolean;
  mergedScripts: Set<Element>;
  remoteIdOf: (el: Element) => string | null;
  customIdentity: boolean;
}

export interface Merge3Options extends CommonOptions {
  children?: boolean;
}

export function mergeDocument(
  options: MergeDocumentOptions,
): Promise<MergeReport>;
export function morphDocument(
  live: Document,
  remote: string | Document,
  options?: MorphDocumentOptions,
): Promise<MergeReport>;
export function morphElement(
  oldEl: Element,
  content: ElementContent,
  options?: MorphElementOptions,
): Promise<MergeReport>;
export function merge3(
  base: Document | Element | null | undefined,
  local: Document | Element,
  remote: Document | Element,
  options?: Merge3Options,
): MergeResult;

// Text merge

export interface TextHunk {
  /** Start offset in the base, inclusive. */
  bs: number;
  /** End offset in the base, exclusive. */
  be: number;
  /** Replacement for base[bs, be). */
  text: string;
}

export interface TextMergeResult {
  text: string;
  conflicts: Array<{
    bs: number;
    be: number;
    local: string;
    remote: string;
    resolved: string;
  }>;
  /** Caret offset in the local text to the merged text. */
  mapLocalOffset: (localOffset: number) => number;
  granularity: "word" | "line";
}

export function merge3Text(
  base: string,
  local: string,
  remote: string,
  policy?: "remote" | "local" | "both",
): TextMergeResult;
export function diff(base: string, side: string, maxEdits?: number): TextHunk[];

// Identity helpers

export interface IdentityStore {
  idOf: (el: Element) => string | null;
  ensure: (el: Element) => string;
  adopt: (el: Element, id: string) => void;
  exportMap: (
    cloneRoot: Element,
    toLive: (n: Node) => Node | null,
  ) => Record<string, string>;
}

export function createIdentityStore(clientId: string): IdentityStore;
export function importMap(
  root: Element,
  map: Record<string, string> | null | undefined,
): WeakMap<Element, string>;
export function tieredIdentity(tiers: IdOf[]): (el: Element) => string | null;

// JSON merge

export interface JsonMergeOptions {
  /** Field names tried, in order, as the identity key of object-element arrays. */
  keyCandidates?: string[];
  /** Parser for mergeScriptText; must throw on invalid input. */
  parse?: (text: string) => any;
}

export function mergeJson(
  base: any,
  local: any,
  remote: any,
  options?: JsonMergeOptions,
): any;
export function mergeScriptText(
  baseText: string | null | undefined,
  localText: string,
  remoteText: string,
  options?: JsonMergeOptions,
): { text: string; warnings: string[] };
export function parseJsonRelaxed(text: string): any;
export function parseRulesRelaxed(text: string): any;

// Parse cache

export function createParseCache(
  ownerDoc: Document,
): (lane: string, input: string | Document) => Document;

// Legacy splice (0.5.x), removed in 2.0

export interface ChangedRoot {
  type: "subtree" | "attrs" | "deletion" | "head";
  el: Element;
  base?: Element | null;
  names?: string[];
}

export function findChangedRoots(
  localRoot: Element,
  baseRoot: Element,
  options?: {
    skip?: (el: Element) => boolean;
    ignoreAttr?: (el: Element, name: string) => boolean;
    tiers?: Array<(el: Element) => string | null>;
  },
): { entries: ChangedRoot[] };
export function spliceProtected(
  targetDoc: Document,
  entries: ChangedRoot[],
  options?: { tiers?: Array<(el: Element) => string | null> },
): {
  ok: boolean;
  placed: Array<{ entry: ChangedRoot; imported: Element }>;
  held: ChangedRoot | null;
  skippedAttrs: number;
};

declare const HyperMorph: {
  mergeDocument: typeof mergeDocument;
  morphDocument: typeof morphDocument;
  morphElement: typeof morphElement;
  merge3: typeof merge3;
  morph: typeof morph;
};
export default HyperMorph;

/**
 * @deprecated The 0.5.x surface, kept for existing callers. Use mergeDocument,
 * morphDocument or morphElement. See docs/api.md, "Compatibility: morph()".
 */
export function morph(
  oldNode: Element | Document,
  newContent: string | Element | Document,
  config?: Record<string, unknown>,
): Promise<MergeReport>;
