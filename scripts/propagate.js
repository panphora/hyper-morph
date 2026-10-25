#!/usr/bin/env node

// Copies the current build into every vendored copy in the workspace (today
// only ClayJS). `--only <client>` narrows to one client; `--check` writes
// nothing and exits 1 naming every destination that is missing or stale.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import * as esbuild from "esbuild";

import { buildVendor } from "./vendor-format.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const workspace = path.join(rootDir, "..");

const distFile = path.join(rootDir, "dist", "hyper-morph.min.js");
const version = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
).version;

function buildCurrentVendor() {
  return buildVendor(fs.readFileSync(distFile, "utf8"));
}

function buildIdentityVendor() {
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(rootDir, "src", "identity.js")],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
  });
  const header = `/* hyper-morph identity (src/identity.js), version ${version}. Generated; do not edit. */\n`;
  return header + outputFiles[0].text.trim() + "\n";
}

const DESTINATIONS = [
  {
    client: "clayjs",
    path: "clayjs/src/vendor/hyper-morph.vendor.js",
    build: buildCurrentVendor,
  },
  {
    client: "clayjs",
    path: "clayjs/src/vendor/hyper-morph-identity.vendor.js",
    build: buildIdentityVendor,
  },
];

const args = process.argv.slice(2);
const isCheck = args.includes("--check");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

const clients = [
  ...new Set(DESTINATIONS.map((destination) => destination.client)),
];

if (onlyIndex !== -1 && !only) {
  console.error(
    `Error: --only needs a client name. Known clients: ${clients.join(", ")}.`,
  );
  process.exit(1);
}

const targets = only
  ? DESTINATIONS.filter((destination) => destination.client === only)
  : DESTINATIONS;

if (!targets.length) {
  console.error(
    `Error: no destination for client "${only}". Known clients: ${clients.join(", ")}.`,
  );
  process.exit(1);
}

if (!fs.existsSync(distFile)) {
  console.error(
    'Error: dist/hyper-morph.min.js not found. Run "npm run build" first.',
  );
  process.exit(1);
}

if (isCheck) {
  const stale = targets.filter((destination) => {
    const file = path.join(workspace, destination.path);
    if (!fs.existsSync(file)) return true;
    return fs.readFileSync(file, "utf8") !== destination.build();
  });
  stale.forEach((destination) => {
    const file = path.join(workspace, destination.path);
    console.error(
      `✗ ${fs.existsSync(file) ? "stale" : "missing"}: ${destination.path}`,
    );
  });
  if (stale.length) process.exit(1);
  targets.forEach((destination) =>
    console.log(`✓ in sync ${destination.path}`),
  );
  process.exit(0);
}

const missing = targets.filter(
  (destination) =>
    !fs.existsSync(path.dirname(path.join(workspace, destination.path))),
);
if (missing.length) {
  missing.forEach((destination) => {
    console.error(
      `Error: destination folder not found at ${path.dirname(path.join(workspace, destination.path))}`,
    );
  });
  console.error(`Every destination is resolved against ${workspace}.`);
  process.exit(1);
}

targets.forEach((destination) => {
  fs.writeFileSync(
    path.join(workspace, destination.path),
    destination.build(),
    "utf8",
  );
  console.log(`✓ Updated ${destination.path}`);
});
