import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = fileURLToPath(new URL("../mtg-cn-browser.user.js", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

function makeElement(tagName = "div") {
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id: "",
    className: "",
    style: {},
    children: [],
    parentElement: null,
    textContent: "",
    innerHTML: "",
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
    getAttribute() { return null; },
    setAttribute() {},
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

function loadHooks(apiResponse = {}) {
  const requests = [];
  const body = makeElement("body");
  const head = makeElement("head");
  body.contains = child => body.children.includes(child);
  const document = {
    readyState: "loading",
    body,
    head,
    documentElement: makeElement("html"),
    createElement: makeElement,
    getElementById() { return null; },
    addEventListener() {},
  };
  const window = {
    __MTG_CN_BROWSER_TESTING: true,
    innerWidth: 1280,
    innerHeight: 900,
    location: { hostname: "www.mtggoldfish.com" },
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
    GM_xmlhttpRequest(options) {
      requests.push(options.url);
      const response = new TextEncoder().encode(JSON.stringify(apiResponse)).buffer;
      queueMicrotask(() => options.onload?.({
        status: 200,
        response,
        responseHeaders: "",
      }));
    },
  };
  vm.runInNewContext(SCRIPT, context, { filename: SCRIPT_PATH });
  return { hooks: window.__MTG_CN_BROWSER_TEST_HOOKS, requests, body };
}

test("exact mtgch results preserve translated flavor name and flavor text", async () => {
  const { hooks, requests } = loadHooks({
    name: "Opt",
    atomic_translated_name: "抉择",
    atomic_translated_text: "占卜1。\n抓一张牌。",
    atomic_translated_flavor_name: "先见之明",
    atomic_translated_flavor_text: "洞察未来，方能掌握现在。",
    atomic_translated_type: "瞬间",
  });

  const result = await hooks.fetchExactCard(
    { setCode: "M21", cardNumber: "59" },
    "Opt",
  );

  assert.equal(result.fn, "先见之明");
  assert.equal(result.f, "洞察未来，方能掌握现在。");
  assert.ok(requests.includes("https://mtgch.com/api/v1/card/M21/59"));
});

test("API text fields convert escaped line breaks into real newlines", async () => {
  const { hooks } = loadHooks({
    name: "Opt",
    atomic_translated_name: "抉择",
    atomic_translated_text: "飞行\\n抓一张牌。",
    atomic_translated_flavor_text: "先知一言。\\n后世铭记。",
  });

  const result = await hooks.fetchExactCard(
    { setCode: "M21", cardNumber: "59" },
    "Opt",
  );

  assert.equal(result.t, "飞行\n抓一张牌。");
  assert.equal(result.f, "先知一言。\n后世铭记。");
});

test("local database entries carry flavor fields into display cards", () => {
  const { hooks } = loadHooks();
  const result = hooks.entryToCard({
    n: "抉择",
    t: "抓一张牌。",
    fn: "先见之明",
    f: "洞察未来。",
  }, "local");

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    n: "抉择",
    t: "抓一张牌。",
    fn: "先见之明",
    f: "洞察未来。",
    _src: "local",
  });
});

test("renderPanel shows a flavor section only when flavor text exists", () => {
  const { hooks, body } = loadHooks();
  hooks.ensurePanel();
  hooks.renderPanel({
    n: "抉择",
    t: "抓一张牌。",
    fn: "先见之明",
    f: "洞察未来。",
    _src: "local",
  }, "Opt");

  const panel = body.children.find(child => child.id === "mtg-cn-browser-panel");
  const flavor = panel.children.find(child => child.className === "mtg-cn-browser-flavor");
  assert.ok(flavor);
  assert.match(flavor.innerHTML, /洞察未来/);
  assert.match(flavor.style.cssText, /font-style:italic/);
  assert.match(flavor.style.cssText, /var\(--mtg-cn-browser-flavor-color\)/);
  assert.match(flavor.style.cssText, /var\(--mtg-cn-browser-flavor-size\)/);
});

test("renderPanel converts escaped line breaks in cached card text", () => {
  const { hooks, body } = loadHooks();
  hooks.ensurePanel();
  hooks.renderPanel({
    n: "抉择",
    t: "飞行\\n抓一张牌。",
    f: "先知一言。\\n后世铭记。",
    _src: "local+api",
  }, "Opt");

  const panel = body.children.find(child => child.id === "mtg-cn-browser-panel");
  const rules = panel.children.find(child => child.className === "mtg-cn-browser-rules");
  const flavor = panel.children.find(child => child.className === "mtg-cn-browser-flavor");
  assert.equal(rules.innerHTML, "· 飞行\n· 抓一张牌。");
  assert.equal(flavor.innerHTML, "先知一言。\n后世铭记。");
  assert.doesNotMatch(rules.innerHTML, /\\\\n/);
  assert.doesNotMatch(flavor.innerHTML, /\\\\n/);
});

test("panel CSS exposes independent flavor color and size variables", () => {
  const { hooks } = loadHooks();
  const css = hooks.buildPanelCss({ flavorColor: "#f0c674", flavorSize: 15 });

  assert.match(css, /--mtg-cn-browser-flavor-color:#f0c674;/);
  assert.match(css, /--mtg-cn-browser-flavor-size:15px;/);
});

test("settings dialog includes a flavor text style row", () => {
  const { hooks, body } = loadHooks();
  hooks.openSettings();

  const texts = [];
  const walk = node => {
    if (node.textContent) texts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(body);

  assert.ok(texts.includes("风味文字"));
});
