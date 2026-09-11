export const WRAPPER_CODE = `
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
export const findChangedRoots = HyperMorph.findChangedRoots;
export const spliceProtected = HyperMorph.spliceProtected;
export default HyperMorph;
`;

export function buildVendor(distText) {
  return distText.trim() + '\n' + WRAPPER_CODE;
}
