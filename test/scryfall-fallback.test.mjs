import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = fileURLToPath(new URL("../mtg-cn-browser.user.js", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

function makeElement(tagName = "div") {
  const attrs = new Map();
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    parentElement: null,
    textContent: "",
    appendChild(child) {
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index >= 0) el.children.splice(index, 1);
      child.parentElement = null;
      return child;
    },
    addEventListener() {},
    contains(child) { return child === el || el.children.includes(child); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    },
  };
  return el;
}

function loadHooks(scryfallCard) {
  const requests = [];
  const body = makeElement("body");
  body.contains = () => true;
  const head = makeElement("head");
  const document = {
    readyState: "complete",
    body,
    head,
    documentElement: makeElement("html"),
    createElement: makeElement,
    getElementById() { return null; },
    addEventListener() {},
  };
  const localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  const window = {
    __MTG_CN_BROWSER_TESTING: true,
    location: { hostname: "www.mtggoldfish.com" },
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener() {},
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
  };

  const context = {
    window,
    location: window.location,
    document,
    localStorage,
    console: { log() {}, warn() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Response,
    TextEncoder,
    ArrayBuffer,
    GM_getValue() { return null; },
    GM_setValue() {},
    GM_registerMenuCommand() {},
    GM_addStyle() { return makeElement("style"); },
    GM_xmlhttpRequest(options) {
      requests.push(options.url);
      if (options.url.includes("raw.githubusercontent.com")) {
        queueMicrotask(() => options.onerror?.());
        return;
      }
      const bodyBytes = new TextEncoder().encode(JSON.stringify(scryfallCard)).buffer;
      queueMicrotask(() => options.onload?.({
        status: 200,
        response: bodyBytes,
        responseHeaders: "",
      }));
    },
  };
  vm.runInNewContext(SCRIPT, context, { filename: SCRIPT_PATH });
  return { hooks: window.__MTG_CN_BROWSER_TEST_HOOKS, requests };
}

test("Scryfall fallback resolves a card by set and collector number", async () => {
  const { hooks, requests } = loadHooks({
    name: "Bard, King of Dale",
    set: "hob",
    collector_number: "144",
    mana_cost: "{4}{W}{U}",
    power: "3",
    toughness: "5",
  });

  assert.equal(typeof hooks?.fetchScryfallCard, "function");
  const result = await hooks.fetchScryfallCard(
    { setCode: "HOB", cardNumber: "144" },
    "Bard, King of Dale",
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    n: "Bard, King of Dale",
    c: "{4}{W}{U}",
    p: "3",
    q: "5",
    _src: "scryfall",
  });
  assert.ok(requests.includes("https://api.scryfall.com/cards/HOB/144"));
});
