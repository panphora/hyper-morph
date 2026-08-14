#!/usr/bin/env node

// Every copy of hyper-morph in the workspace, in one table. This script used to
// be copy-to-hyperclayjs.js and wrote a single destination, while
// clayjs/src/vendor/hyper-morph.vendor.js stayed byte-identical to the
// hyperclayjs copy by hand rather than by design — correct only while somebody
// remembered it existed. One table makes a forgotten destination structurally
// impossible: a missing path is a failure, not a destination to skip quietly.
//
// `--only <client>` narrows the table to one client's destinations; `--check`
// writes nothing and exits 1 naming every destination that is missing or stale.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const workspace = path.join(rootDir, '..');

const distFile = path.join(rootDir, 'dist', 'hyper-morph.min.js');

// Both clients import their copy as ESM and both honor
// window.__hyperclayNoAutoExport, so the two files are the same bytes. One
// builder rather than two so a change to the wrapper cannot reach one client
// and silently miss the other.
const WRAPPER_CODE = `
// Convenience morph wrapper with data-id support
var morph = function(oldEl, newEl, options = {}) {
    return HyperMorph.morph(oldEl, newEl, {
        key: (el) => (el.getAttribute && el.getAttribute('data-id')) || el.id || null,
        ...options
    });
};

// Auto-export to window unless suppressed by loader
if (!window.__hyperclayNoAutoExport) {
  window.hyperclay = window.hyperclay || {};
  window.hyperclay.HyperMorph = HyperMorph;
  window.hyperclay.morph = morph;
  window.HyperMorph = HyperMorph;
  window.morph = morph;
  window.h = window.hyperclay;
}

export { HyperMorph, morph };
export default HyperMorph;
`;

function buildVendor() {
  return fs.readFileSync(distFile, 'utf8').trim() + '\n' + WRAPPER_CODE;
}

const DESTINATIONS = [
  { client: 'hyperclayjs', path: 'hyperclayjs/src/vendor/hyper-morph.vendor.js', build: buildVendor },
  { client: 'clayjs', path: 'clayjs/src/vendor/hyper-morph.vendor.js', build: buildVendor }
];

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

const clients = [...new Set(DESTINATIONS.map(destination => destination.client))];

if (onlyIndex !== -1 && !only) {
  console.error(`Error: --only needs a client name. Known clients: ${clients.join(', ')}.`);
  process.exit(1);
}

const targets = only ? DESTINATIONS.filter(destination => destination.client === only) : DESTINATIONS;

if (!targets.length) {
  console.error(`Error: no destination for client "${only}". Known clients: ${clients.join(', ')}.`);
  process.exit(1);
}

if (!fs.existsSync(distFile)) {
  console.error('Error: dist/hyper-morph.min.js not found. Run "npm run build" first.');
  process.exit(1);
}

if (isCheck) {
  const stale = targets.filter(destination => {
    const file = path.join(workspace, destination.path);
    if (!fs.existsSync(file)) return true;
    return fs.readFileSync(file, 'utf8') !== destination.build();
  });
  stale.forEach(destination => {
    const file = path.join(workspace, destination.path);
    console.error(`✗ ${fs.existsSync(file) ? 'stale' : 'missing'}: ${destination.path}`);
  });
  if (stale.length) process.exit(1);
  targets.forEach(destination => console.log(`✓ in sync ${destination.path}`));
  process.exit(0);
}

const missing = targets.filter(
  destination => !fs.existsSync(path.dirname(path.join(workspace, destination.path)))
);
if (missing.length) {
  missing.forEach(destination => {
    console.error(
      `Error: destination folder not found at ${path.dirname(path.join(workspace, destination.path))}`
    );
  });
  console.error(`Every destination is resolved against ${workspace}.`);
  process.exit(1);
}

targets.forEach(destination => {
  fs.writeFileSync(path.join(workspace, destination.path), destination.build(), 'utf8');
  console.log(`✓ Updated ${destination.path}`);
});
