export {
  createIdentityStore,
  importMap,
  tieredIdentity,
  type IdentityStore,
} from "./index.js";

export const SHAPE_KEY: "~";
export const TAGS_KEY: "^";
export const defaultIdentity: (el: Element) => string | null;
export function indexByIdentity(
  root: Element,
  idOf: (el: Element) => string | null,
  ignored: (n: Node) => boolean,
  fastSelector?: string | null,
  dropped?: Set<string> | null,
): Map<string, Element>;
export function warnDuplicate(id: string): void;
