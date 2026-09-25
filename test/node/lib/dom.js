import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", { url: "http://localhost/page.html" });
export const window = dom.window;
export const document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

export function parse(html) {
  return new dom.window.DOMParser().parseFromString(html, "text/html");
}

export const doc = (body, head = "") => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
