/**
 * head-merge.js — identity for <head> children.
 *
 * Head elements rarely carry ids, but each has a natural key: a stylesheet
 * is its URL, a meta is its name, the title is the title. During alignment
 * these keys act as the identity of head children, so a changed <title> is
 * a text edit and a changed stylesheet href is a replacement.
 */

import { scriptSignature } from "./scripts.js";

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/**
 * Absolute URL without its fragment, resolved against a base URI. The query
 * string is kept: cache busters are significant.
 * @param {string} url
 * @param {string} baseURI
 */
export function absoluteWithoutHash(url, baseURI) {
  try {
    const u = new URL(url, baseURI);
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * @param {Element} el
 * @param {string} baseURI
 * @returns {string}
 */
export function headSignature(el, baseURI) {
  const tag = el.tagName;
  if (tag === "TITLE" || tag === "BASE") return tag;
  if (tag === "SCRIPT") return scriptSignature(el, baseURI);
  if (tag === "LINK") {
    const href = el.getAttribute("href");
    if (href) return "link|" + (el.getAttribute("rel") || "") + "|" + absoluteWithoutHash(href, baseURI);
    return el.outerHTML;
  }
  if (tag === "META") {
    for (const name of ["charset", "name", "property", "http-equiv", "itemprop"]) {
      if (el.hasAttribute(name)) return "meta|" + name + "=" + el.getAttribute(name);
    }
    return el.outerHTML;
  }
  if (tag === "STYLE") return "style|" + hash(el.textContent);
  return el.outerHTML;
}
