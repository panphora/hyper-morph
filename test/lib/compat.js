/**
 * Test shim: the shipped compat `morph` plus the globals the old suites read.
 */
import * as HM from "/src/index.js";

export const morph = HM.morph;

const HyperMorph = { ...HM };
window.HyperMorph = HyperMorph;
window.HyperMatch = HyperMorph;
window.Idiomorph = HyperMorph;
