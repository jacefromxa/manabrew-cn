import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = fileURLToPath(new URL("../mtg-cn-browser.user.js", import.meta.url));
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");
const PRIMARY_URL = "https://raw.githubusercontent.com/jacefromxa/mtg-cn-browser/main/dist/en2zhs.json.gz";
const MIRROR_URL = "https://fastly.jsdelivr.net/gh/jacefromxa/mtg-cn-browser@main/dist/en2zhs.json.gz";

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

function loadHooks() {
  const requests = [];
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
    __MTG_CN_BROWSER_TESTING: true,
    location: { hostname: "moxfield.com" },
    addEventListener() {},
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
    fetch(url) {
      requests.push({ via: "fetch", url });
      if (url === PRIMARY_URL) return Promise.reject(new TypeError("Failed to fetch"));
      if (url === MIRROR_URL) return Promise.resolve(new Response("gzip database", { status: 200 }));
      return Promise.reject(new Error("Unexpected URL: " + url));
    },
    GM_xmlhttpRequest(options) {
      requests.push({ via: "gm", url: options.url });
      queueMicrotask(() => options.onerror?.());
    },
  };

  vm.runInNewContext(SCRIPT, context, { filename: SCRIPT_PATH });
  return { hooks: window.__MTG_CN_BROWSER_TEST_HOOKS, requests };
}

test("Moxfield retries the bundled translation DB through the CDN mirror", async () => {
  const { hooks, requests } = loadHooks();

  assert.equal(typeof hooks?.fetchDBResponse, "function");
  const response = await hooks.fetchDBResponse(PRIMARY_URL);

  assert.equal(response.status, 200);
  assert.deepEqual(requests.filter((r) => r.via === "fetch").map((r) => r.url), [PRIMARY_URL, MIRROR_URL]);
});
