import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = fileURLToPath(new URL("../manabrew-cn.user.js", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");
const CACHE_KEY = "mbrw-api5-cache";
const DAY_MS = 24 * 60 * 60 * 1000;

function makeElement(tagName = "div") {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    contains() { return false; },
    getAttribute() { return null; },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
  };
}

function loadHooks(initialStore, now) {
  const store = new Map(initialStore);
  const reads = [];
  const body = makeElement("body");
  const document = {
    readyState: "loading",
    body,
    head: makeElement("head"),
    documentElement: makeElement("html"),
    createElement: makeElement,
    getElementById() { return null; },
    addEventListener() {},
  };
  const window = {
    __MBRW_TESTING: true,
    location: { hostname: "www.mtggoldfish.com" },
    addEventListener() {},
  };
  const localStorage = {
    getItem(key) { reads.push(key); return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); },
  };
  const FakeDate = class extends Date {
    static now() { return now; }
  };

  const context = {
    window,
    location: window.location,
    document,
    localStorage,
    console: { log() {}, warn() {} },
    Promise,
    Map,
    Response,
    TextEncoder,
    ArrayBuffer,
    Date: FakeDate,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(SCRIPT, context, { filename: SCRIPT_PATH });
  return { hooks: window.__MBRW_TEST_HOOKS, store, reads };
}

test("name-only API cache entries expire after seven days while translations stay cached", () => {
  const now = 1_800_000_000_000;
  const { hooks, store, reads } = loadHooks([
    [CACHE_KEY, JSON.stringify([
      ["new spoiler", { n: "新预览牌", _src: "api", _cacheAt: now - 8 * DAY_MS }],
      ["old untranslated", { n: "旧未译牌", _src: "api" }],
      ["translated card", { n: "已译牌", t: "规则文本", _src: "api", _cacheAt: now - 60 * DAY_MS }],
      ["flavor missing", { n: "缺风味牌", t: "规则文本", _src: "api", _flavorChecked: true, _cacheAt: now - 8 * DAY_MS }],
      ["flavor cached", { n: "有风味牌", t: "规则文本", f: "风味文字", _src: "api", _flavorChecked: true, _cacheAt: now - 60 * DAY_MS }],
    ])],
  ], now);

  assert.equal(typeof hooks?.loadApiCache, "function");
  assert.equal(typeof hooks?.getCachedApiResult, "function");
  hooks.loadApiCache();

  assert.ok(reads.includes(CACHE_KEY));
  assert.equal(hooks.getCachedApiResult("new spoiler"), null);
  assert.equal(hooks.getCachedApiResult("old untranslated"), null);
  assert.equal(hooks.getCachedApiResult("translated card").t, "规则文本");
  assert.equal(hooks.getCachedApiResult("flavor missing"), null);
  assert.equal(hooks.getCachedApiResult("flavor cached").f, "风味文字");
  assert.deepEqual(
    JSON.parse(store.get(CACHE_KEY)).map(([name]) => name),
    ["translated card", "flavor cached"],
  );
});
