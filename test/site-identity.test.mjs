import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = fileURLToPath(new URL("../manabrew-cn.user.js", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

function makeElement(tagName, attrs = {}) {
  const attributes = new Map(Object.entries(attrs));
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    src: attrs.src || "",
    alt: attrs.alt || "",
    style: {},
    children: [],
    parentElement: null,
    textContent: attrs.textContent || "",
    appendChild(child) {
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    querySelector(selector) {
      const queue = [...el.children];
      while (queue.length) {
        const child = queue.shift();
        if (selector === "[data-card-url]" && child.getAttribute("data-card-url")) return child;
        queue.push(...child.children);
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    contains(child) { return child === el || el.children.includes(child); },
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    },
  };
  return el;
}

function loadHooks(hostname, pathname) {
  const body = makeElement("body");
  const head = makeElement("head");
  body.contains = child => body.children.includes(child);
  const document = {
    readyState: "loading",
    body,
    head,
    documentElement: makeElement("html"),
    createElement: tagName => makeElement(tagName),
    getElementById() { return null; },
    addEventListener() {},
  };
  const window = {
    __MBRW_TESTING: true,
    innerWidth: 1280,
    innerHeight: 900,
    location: { hostname, pathname },
    addEventListener() {},
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
  };
  const context = {
    window,
    location: window.location,
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { log() {}, warn() {} },
    Promise,
    Map,
    Response,
    TextEncoder,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    GM_addStyle() { return makeElement("style"); },
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest() {},
  };
  vm.runInNewContext(SCRIPT, context, { filename: SCRIPT_PATH });
  return window.__MBRW_TEST_HOOKS;
}

test("Scryfall card images inherit identity from singular /card/ links on search pages", () => {
  const hooks = loadHooks("scryfall.com", "/search");
  const link = makeElement("a", { href: "https://scryfall.com/card/tdc/158/opt" });
  const image = makeElement("img", {
    src: "https://cards.scryfall.io/grid/front/example.webp",
    alt: "Opt (Tarkir: Dragonstorm Commander #158)",
  });
  link.appendChild(image);

  const hit = hooks.findSiteCard(image);

  assert.equal(hit.name, "Opt");
  assert.deepEqual(JSON.parse(JSON.stringify(hit.identity)), { setCode: "TDC", cardNumber: "158" });
});

test("Scryfall identity accepts suffixed collector numbers", () => {
  const hooks = loadHooks("scryfall.com", "/card/unf/209a/drop-tower");

  assert.deepEqual(JSON.parse(JSON.stringify(hooks.scryfallIdentity())), { setCode: "UNF", cardNumber: "209a" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.parseScryfallIdentityFromHref("/card/unf/209a/drop-tower"))),
    { setCode: "UNF", cardNumber: "209a" },
  );
});

test("Scryfall image names strip suffixed collector annotations", () => {
  const hooks = loadHooks("scryfall.com", "/search");
  const link = makeElement("a", { href: "https://scryfall.com/card/unf/209a/drop-tower" });
  const image = makeElement("img", {
    src: "https://cards.scryfall.io/grid/front/example.webp",
    alt: "Drop Tower (Unfinity #209a)",
  });
  link.appendChild(image);

  const hit = hooks.findSiteCard(image);

  assert.equal(hit.name, "Drop Tower");
  assert.deepEqual(JSON.parse(JSON.stringify(hit.identity)), { setCode: "UNF", cardNumber: "209a" });
});

test("MTGGoldfish card images inherit set and number from card metadata", () => {
  const hooks = loadHooks("www.mtggoldfish.com", "/price/foundations/512/opt");
  const container = makeElement("div");
  const image = makeElement("img", {
    src: "https://cards.mtggoldfish.com/images/uuid/variants/265/370/card_image.webp",
    alt: "Opt [FDN]",
  });
  const metadata = makeElement("span", { "data-card-url": "/price/foundations/512/opt" });
  container.appendChild(image);
  container.appendChild(metadata);

  const hit = hooks.findSiteCard(image);

  assert.equal(hit.name, "Opt");
  assert.deepEqual(JSON.parse(JSON.stringify(hit.identity)), { setCode: "FDN", cardNumber: "512" });
});
