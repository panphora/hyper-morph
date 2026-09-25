// The vendored copy is the IIFE build plus an ES module wrapper. The IIFE sets
// a global `HyperMorph` (the module namespace, so HyperMorph.morph,
// HyperMorph.mergeDocument and HyperMorph.default all exist); the wrapper
// re-exports it for `import` and publishes the old window globals.
export const WRAPPER_CODE = `
var morph = HyperMorph.morph;

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
export const findChangedRoots = HyperMorph.findChangedRoots;
export const spliceProtected = HyperMorph.spliceProtected;
export default HyperMorph;
`;

export function buildVendor(distText) {
  return distText.trim() + "\n" + WRAPPER_CODE;
}
