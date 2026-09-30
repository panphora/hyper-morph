import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

// Engines by name: `cur` is this tree's src/, `ref` the frozen reference
// (HM_REFERENCE_ENTRY), anything else a directory holding src/ under
// HM_ENGINES (a git revision is extracted there on first use, from
// HM_GIT_DIR or this repository).

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
export const ENGINES_DIR =
  process.env.HM_ENGINES || path.join(repo, "..", "hm-engines");

export function entryOf(name) {
  if (name === "cur") return path.join(repo, "src/index.js");
  if (name === "ref") {
    if (process.env.HM_REFERENCE_ENTRY) return process.env.HM_REFERENCE_ENTRY;
    name = process.env.HM_REFERENCE_REV || "66dcba5";
  }
  if (name.endsWith(".js")) return path.resolve(name);
  const dir = path.join(ENGINES_DIR, name);
  const entry = path.join(dir, "src/index.js");
  if (!existsSync(entry)) {
    mkdirSync(dir, { recursive: true });
    const git = process.env.HM_GIT_DIR || repo;
    const tar = execFileSync("git", ["-C", git, "archive", name, "src"]);
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
  }
  return entry;
}

const cache = new Map();
export async function engine(name) {
  const entry = entryOf(name);
  if (!cache.has(entry)) cache.set(entry, import(pathToFileURL(entry).href));
  return cache.get(entry);
}
