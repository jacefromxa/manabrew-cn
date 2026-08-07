// ==UserScript==
// @name         Manabrew 简体中文卡牌浮窗
// @name:zh-CN   Manabrew 简体中文卡牌浮窗
// @name:en      Manabrew Simplified Chinese Card Tooltip
// @namespace    https://play.manabrew.app/
// @version      0.9.3
// @description  在 Manabrew 悬停 MTG 卡牌时显示简体中文翻译浮窗——卡名、类别、规则文本、费用、攻防（含 MTG 符号图标）。
// @description:zh-CN 在 Manabrew 悬停万智牌卡牌时显示简体中文翻译浮窗——卡名、类别、规则文本、费用（右上角）、攻防（右下角，*/* 形式），MTG 符号图标。
// @description:en Show Simplified Chinese card info on hover for Manabrew — name, type, cost (top-right), P/T (bottom-right), and MTG mana-symbol icons.
// @author       jacefromxa
// @license      GPL-3.0
// @match        https://play.manabrew.app/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/manabrew-cn.user.js
// @downloadURL  https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/manabrew-cn.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  var root = window;
  var LOG = function () {
    try { console.log.apply(console, ['[manabrew-cn]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  };
  var WARN = function () {
    try { console.warn.apply(console, ['[manabrew-cn]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  };
  // Verbose fiber-introspection diagnostics. Flip on for debugging the hand /
  // stack tooltips (v0.4.0 ships with it enabled; set window.__MBRW_DIAG=false
  // or localStorage['mbrw-cn-diag']='0' to quiet the console).
  var DIAG = function () {
    if (root.__MBRW_DIAG !== false) {
      try { console.log.apply(console, ['[manabrew-cn:diag]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
    }
  };
  try {
    var diagPref = localStorage.getItem('mbrw-cn-diag');
    if (diagPref === '0') root.__MBRW_DIAG = false;
  } catch (_) {}

  var DATA_BASE = 'https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/dist';
  var MANA_CSS_URL = 'https://cdn.jsdelivr.net/npm/mana-font@1.18.0/css/mana.css';
  // v0.9.2: bumped to mbrw-api3- — identity-aware exact-endpoint results should
  // supersede any stale fuzzy name-only entries from before, so old caches are
  // dropped once. (v0.9.1 bumped mbrw-api- → mbrw-api2- for the wrong-card-name
  // leak fix.)
  var API_CACHE_PREFIX = 'mbrw-api3-';

  // --- Settings -----------------------------------------------------------

  var SETTINGS_DEFAULTS = {
    // 底色 / 边框：RGB 三元组（给 rgba() 用）+ 各自透明度
    bgColor: '26, 28, 33',
    bgOpacity: 0.94,
    borderColor: '255, 255, 255',
    borderOpacity: 0.18,
    // 每个文字区块的颜色（hex）与字号（上限 30px）
    nameColor: '#ffad42',
    nameSize: 15,        // 法术力费用与卡名同行，共用此字号
    enNameColor: '#71717a',
    enNameSize: 10,
    typeColor: '#a1a1aa',
    typeSize: 12,
    textColor: '#d4d4d8',
    textSize: 13,
    ptColor: '#d4d4d8',
    ptSize: 12,
    sourceColor: '#52525b',
    sourceSize: 9,
    panelMode: 'follow',
    panelPosition: null,
  };

  var settings = Object.assign({}, SETTINGS_DEFAULTS);

  function loadSettings() {
    try {
      if (typeof GM_getValue === 'function') {
        var raw = GM_getValue('mbrw-cn-settings', null);
        if (raw) {
          // 旧存档只有 bgOpacity/fontSize/panelMode 等字段——用默认值补齐
          // 新版本逐区块字段，避免出现 undefined 样式。
          settings = Object.assign({}, SETTINGS_DEFAULTS, typeof raw === 'string' ? JSON.parse(raw) : raw);
        }
      }
    } catch (_) {}
  }

  function saveSettings() {
    try {
      if (typeof GM_setValue === 'function') GM_setValue('mbrw-cn-settings', JSON.stringify(settings));
    } catch (_) {}
  }

  // 存储的 "R, G, B" 三元组 → #rrggbb（原生颜色选择器只接受 hex）。
  function rgbToHex(rgb) {
    var parts = String(rgb || '').match(/\d+/g) || ['26', '28', '33'];
    var hex = '#';
    for (var i = 0; i < 3; i++) {
      var n = parseInt(parts[i] || 0, 10);
      hex += ('0' + n.toString(16)).slice(-2);
    }
    return hex;
  }

  // #rrggbb → "R, G, B" 三元组（存进设置供 rgba() 使用）。
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (isNaN(n)) return '26, 28, 33';
    return [n >> 16 & 255, n >> 8 & 255, n & 255].join(', ');
  }

  // --- Stylesheet ---------------------------------------------------------

  var styleTag = null;

  function ensureStyleTag() {
    if (styleTag) return;
    styleTag = document.createElement('style');
    styleTag.id = 'mbrw-cn-style';
    document.head.appendChild(styleTag);
    writeStyleTag();
  }

  // 把所有可调样式写成 :root 上的 CSS 变量。浮窗面板与设置弹窗里的预览框
  // 都读同一组变量，因此任何改动立即同时生效（同 talishar-cn 的做法）。
  function applyStyleVariables(vars) {
    if (!styleTag) return;
    styleTag.textContent = ':root {' +
      '--mbrw-bg-color:' + (vars.bgColor || '26, 28, 33') + ';' +
      '--mbrw-bg-opacity:' + (vars.bgOpacity != null ? vars.bgOpacity : 0.94) + ';' +
      '--mbrw-border-color:' + (vars.borderColor || '255, 255, 255') + ';' +
      '--mbrw-border-opacity:' + (vars.borderOpacity != null ? vars.borderOpacity : 0.18) + ';' +
      '--mbrw-name-color:' + (vars.nameColor || '#ffad42') + ';' +
      '--mbrw-name-size:' + (vars.nameSize || 15) + 'px;' +
      '--mbrw-en-name-color:' + (vars.enNameColor || '#71717a') + ';' +
      '--mbrw-en-name-size:' + (vars.enNameSize || 10) + 'px;' +
      '--mbrw-type-color:' + (vars.typeColor || '#a1a1aa') + ';' +
      '--mbrw-type-size:' + (vars.typeSize || 12) + 'px;' +
      '--mbrw-text-color:' + (vars.textColor || '#d4d4d8') + ';' +
      '--mbrw-text-size:' + (vars.textSize || 13) + 'px;' +
      '--mbrw-pt-color:' + (vars.ptColor || '#d4d4d8') + ';' +
      '--mbrw-pt-size:' + (vars.ptSize || 12) + 'px;' +
      '--mbrw-source-color:' + (vars.sourceColor || '#52525b') + ';' +
      '--mbrw-source-size:' + (vars.sourceSize || 9) + 'px;' +
      '}' +
      '#mbrw-cn-panel::-webkit-scrollbar{width:4px}' +
      '#mbrw-cn-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}' +
      // Mana-symbol glyphs (font provided by ensureManaCSS). Slight drop-shadow
      // keeps dark symbols (e.g. {B}) visible on the dark panel.
      '#mbrw-cn-panel .ms{filter:drop-shadow(0 0 0.4px rgba(0,0,0,0.55));}' +
      '#mbrw-cn-panel .mbrw-cost-row .ms{font-size:1.05em;vertical-align:middle;margin-right:2px;}' +
      '#mbrw-cn-panel .mbrw-rules .ms{font-size:0.95em;vertical-align:middle;margin-right:1px;}';
  }

  function writeStyleTag() {
    applyStyleVariables(settings);
  }

  // Inject the official MTG mana font (https://mana.andrewgioia.com). One-time,
  // browser-cached. Without it, .ms spans render empty but the tooltip still works.
  function ensureManaCSS() {
    try {
      if (document.getElementById('mbrw-mana-css')) return;
      var link = document.createElement('link');
      link.id = 'mbrw-mana-css';
      link.rel = 'stylesheet';
      link.href = MANA_CSS_URL;
      (document.head || document.documentElement).appendChild(link);
    } catch (_) {}
  }

  // --- Local database loader -----------------------------------------------

  var zhDB = null;
  var dbLoadDone = false;  // true even on failure (unblocks lookup)
  var dbLoadPromise = null;

  function tryOpenIndexedDB() {
    try {
      if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('manabrew-cn', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('data'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    } catch (e) { return Promise.reject(e); }
  }

  function loadDBFromIndexedDB(idb) {
    return new Promise(function (resolve) {
      try {
        var tx = idb.transaction('data', 'readonly');
        var getVer = tx.objectStore('data').get('version');
        var getData = tx.objectStore('data').get('zhdb');
        tx.oncomplete = function () {
          resolve(getData.result && getVer.result ? { version: getVer.result, data: getData.result } : null);
        };
        tx.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }

  function saveDBToIndexedDB(idb, version, data) {
    return new Promise(function (resolve) {
      try {
        var tx = idb.transaction('data', 'readwrite');
        tx.objectStore('data').put(version, 'version');
        tx.objectStore('data').put(data, 'zhdb');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (_) { resolve(); }
    });
  }

  function dbFromArray(raw) {
    var m = new Map();
    for (var i = 0; i < raw.length; i++) m.set(raw[i][0], raw[i][1]);
    return m;
  }

  function decompressAndParse(stream, version, idb) {
    try {
      var ds = new DecompressionStream('gzip');
      return new Response(stream.pipeThrough(ds)).text().then(function (json) {
        var parsed = JSON.parse(json);
        var cards = parsed.cards || {};
        zhDB = new Map(Object.entries(cards));
        LOG('DB loaded from network (' + zhDB.size + ' cards)');
        return saveDBToIndexedDB(idb, version, Array.from(zhDB.entries()));
      });
    } catch (e) {
      WARN('DecompressionStream not available, using raw JSON fallback');
      // Fallback: try as plain JSON
      return new Response(stream).text().then(function (json) {
        var parsed = JSON.parse(json);
        zhDB = new Map(Object.entries(parsed.cards || {}));
        LOG('DB loaded (no decompress) (' + zhDB.size + ' cards)');
      });
    }
  }

  function fetchAndLoadDB() {
    if (dbLoadPromise) return dbLoadPromise;

    var DB_PATH;
    try {
      DB_PATH = (localStorage.getItem('mbrw-cn-data-url') || '').trim() || (DATA_BASE + '/en2zhs.json.gz');
    } catch (_) {
      DB_PATH = DATA_BASE + '/en2zhs.json.gz';
    }

    dbLoadPromise = tryOpenIndexedDB().then(function (idb) {
      return loadDBFromIndexedDB(idb).then(function (cached) {
        return fetch(DB_PATH).then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          var etag = resp.headers.get('etag') || 'live';
          if (cached && cached.version === etag) {
            zhDB = dbFromArray(cached.data);
            LOG('DB from IndexedDB cache (' + zhDB.size + ' cards)');
            dbLoadDone = true;
            return;
          }
          var body = resp.body;
          if (body) return decompressAndParse(body, etag, idb).then(function () { dbLoadDone = true; });
          return resp.arrayBuffer().then(function (buf) {
            var blob = new Blob([buf]);
            return decompressAndParse(blob.stream(), etag, idb).then(function () { dbLoadDone = true; });
          });
        }).catch(function (err) {
          WARN('DB fetch failed:', err.message || err);
          if (cached) {
            zhDB = dbFromArray(cached.data);
            LOG('Falling back to cached DB (' + zhDB.size + ' cards)');
            dbLoadDone = true;
            return;
          }
          dbLoadDone = true; // unblock lookup even on failure
          WARN('No DB available — will use API fallback for all cards');
        });
      });
    }).catch(function (err) {
      WARN('IndexedDB unavailable:', err.message || err);
      // Try to fetch DB without caching
      return fetch(DB_PATH).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var body = resp.body;
        var p = body ? Promise.resolve(body) : resp.arrayBuffer().then(function (b) { return new Blob([b]).stream(); });
        return p.then(function (stream) {
          try {
            var ds = new DecompressionStream('gzip');
            return new Response(stream.pipeThrough(ds)).text();
          } catch (e2) {
            return new Response(stream).text();
          }
        }).then(function (json) {
          zhDB = new Map(Object.entries((JSON.parse(json)).cards || {}));
          LOG('DB loaded without IndexedDB (' + zhDB.size + ' cards)');
          dbLoadDone = true;
        });
      }).catch(function (err2) {
        WARN('DB fetch also failed:', err2.message || err2);
        dbLoadDone = true;
      });
    });

    return dbLoadPromise;
  }

  // --- mtgch API fallback -------------------------------------------------

  var apiCache = new Map();
  var apiQueue = new Map();
  var API_CACHE_MAX = 500;

  function loadApiCache() {
    try {
      var raw = localStorage.getItem(API_CACHE_PREFIX + 'cache');
      if (raw) JSON.parse(raw).forEach(function (e) { apiCache.set(e[0], e[1]); });
    } catch (_) {}
  }

  function persistApiCache() {
    try {
      localStorage.setItem(API_CACHE_PREFIX + 'cache',
        JSON.stringify(Array.from(apiCache.entries()).slice(-API_CACHE_MAX)));
    } catch (_) {}
  }

  // One exact request to the deterministic /api/v1/card/{SET}/{CN} endpoint —
  // the same "set + collector number" lookup the Scryfall-zhs plugin uses.
  // Returns null when the print isn't found (mtgch 404s on suffixed numbers
  // like "278s") or its English name doesn't match the hovered card, so the
  // caller falls back to the fuzzy name search rather than leak a wrong card.
  function fetchExactCard(identity, hoveredName) {
    var set = String(identity.setCode || '').trim().toUpperCase();
    var num = String(identity.cardNumber || '').trim();
    if (!/^[A-Z0-9]{2,6}$/.test(set) || !/^[A-Za-z0-9]+$/.test(num)) return Promise.resolve(null);
    return fetch('https://mtgch.com/api/v1/card/' + encodeURIComponent(set) + '/' + encodeURIComponent(num))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.name || j.detail || j.message) return null;
        // Name gate: the exact endpoint must be the card we hovered. A suffixed
        // collector number (e.g. "278s") can resolve to a plain print instead
        // (BLB/278 → Forest) — never let that wrong card's text leak in.
        var hLower = String(hoveredName || '').toLowerCase().trim();
        if (hLower && String(j.name).toLowerCase().trim() !== hLower) return null;
        return {
          n: j.atomic_translated_name || j.zhs_name || j.name,
          t: j.atomic_translated_text || j.zhs_text || undefined,
          y: j.atomic_translated_type || j.zhs_type_line || undefined,
          c: j.mana_cost || undefined,
          p: j.power != null ? j.power : undefined,
          q: j.toughness != null ? j.toughness : undefined,
          l: j.loyalty != null ? j.loyalty : undefined,
          d: j.defense != null ? j.defense : undefined,
          _src: 'api'
        };
      })
      .catch(function () { return null; });
  }

  // Fuzzy name search (2 requests: card-names + result). Kept as the fallback
  // for alt-only paths that have no card identity, and whenever the exact
  // endpoint 404s or mismatches.
  function fuzzyQueryMtgch(name) {
    var enc = encodeURIComponent(name);
    return fetch('https://mtgch.com/api/v1/card-names/?q=' + enc + '&size=1')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
      .then(function (d) {
        // /card-names is a clean name lookup — its top hit is the card we want.
        var zhName = ((d.items || [])[0] || {}).translated_name || null;
        // /result is fuzzy AND paginated: with page_size=1 the first page can
        // be a different card (e.g. "reanimate" → "Madame Hydra, Reanimated"
        // while the real Reanimate sits on a later page). Ask for a large page
        // and scan every item for an exact English-name match. A non-matching
        // card's name/text/cost must never leak into the tooltip — this was
        // why hovering Reanimate showed 复生的九头蛇夫人 (wrong card).
        return fetch('https://mtgch.com/api/v1/result?q=%22' + enc + '%22&unique=oracle_id&page_size=20')
          .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
          .then(function (sd) {
            var nameLower = name.toLowerCase().trim();
            var items = sd.items || [];
            var exact = null;
            for (var i = 0; i < items.length; i++) {
              if (items[i] && String(items[i].name || '').toLowerCase().trim() === nameLower) {
                exact = items[i];
                break;
              }
            }
            if (!exact) {
              // No exact card among the fuzzy results — show the name alone
              // rather than a different card's oracle text.
              return { n: zhName || name, _src: 'api' };
            }
            return {
              n: exact.atomic_translated_name || exact.zhs_name || zhName || name,
              t: exact.atomic_translated_text || exact.zhs_text || undefined,
              y: exact.atomic_translated_type || exact.zhs_type_line || undefined,
              c: exact.mana_cost || undefined,
              p: exact.power || undefined,
              q: exact.toughness || undefined,
              l: exact.loyalty || undefined,
              d: exact.defense || undefined,
              _src: 'api'
            };
          });
      });
  }

  // Public lookup used by the hover paths. `identity` ({setCode, cardNumber})
  // is present on the fiber paths (hand / stack / deck cover / preview) —
  // those get ONE exact request with zero wrong-card risk. Alt-only paths pass
  // no identity and use the fuzzy search. Results cache under the card name.
  function queryMtgch(name, identity) {
    var key = name.toLowerCase();
    var pending = apiQueue.get(key);
    if (pending) return pending;

    pending = new Promise(function (resolve) {
      var runFuzzy = function () {
        fuzzyQueryMtgch(name).then(resolve, function () { resolve({ n: name, _src: 'miss' }); });
      };
      if (identity && identity.setCode && identity.cardNumber) {
        fetchExactCard(identity, name).then(function (r) {
          if (r) resolve(r);
          else runFuzzy();
        });
      } else {
        runFuzzy();
      }
    })
      .catch(function () { return { n: name, _src: 'miss' }; })
      .then(function (r) {
        apiCache.set(key, r);
        if (apiCache.size > API_CACHE_MAX) apiCache.delete(apiCache.keys().next().value);
        persistApiCache();
        apiQueue.delete(key);
        return r;
      });

    apiQueue.set(key, pending);
    return pending;
  }

  // --- Core lookup --------------------------------------------------------

  function lookupCard(cardName, identity) {
    if (!cardName) return Promise.resolve(null);
    var key = cardName.trim().toLowerCase();
    if (!key || key === 'face-down card') return Promise.resolve(null);

    // 1. Local DB (curated, authoritative — checked first so a stale / wrongly
    //    cached mtgch entry can never shadow a correct DB entry)
    if (zhDB) {
      var local = zhDB.get(key);
      if (local) {
        var r = entryToCard(local, 'local');
        return Promise.resolve(r);
      }
    }

    // 2. mtgch cache (fastest for cards not in the DB)
    var cached = apiCache.get(key);
    if (cached) return Promise.resolve(cached);

    // 3. DB still loading — wait, but don't block forever
    if (!dbLoadDone && dbLoadPromise) {
      return dbLoadPromise.then(function () {
        if (zhDB) {
          var l2 = zhDB.get(key);
          if (l2) return entryToCard(l2, 'local');
        }
        return queryMtgch(cardName.trim(), identity);
      });
    }

    // 4. Fallback to API
    return queryMtgch(cardName.trim(), identity);
  }

  // DB entry → display card. New v0.4.0 fields: t=text, y=type, c=mana cost,
  // p/q=power/toughness, l=loyalty, d=defense, o=1 (intentionally textless —
  // no runtime API upgrade needed).
  function entryToCard(local, src) {
    var r = { n: local.n, _src: src };
    if (local.t) r.t = local.t;
    if (local.y) r.y = local.y;
    if (local.c) r.c = local.c;
    if (local.p) r.p = local.p;
    if (local.q) r.q = local.q;
    if (local.l) r.l = local.l;
    if (local.d) r.d = local.d;
    if (local.o) r.o = 1;
    return r;
  }

  // --- Panel creation ------------------------------------------------------

  var panel = null;
  var dragHandle = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'mbrw-cn-panel';
    panel.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;display:none;visibility:hidden;max-width:320px;max-height:50vh;overflow:auto;padding:9px 11px;border:1px solid rgba(var(--mbrw-border-color),var(--mbrw-border-opacity));border-radius:6px;background:rgba(var(--mbrw-bg-color),var(--mbrw-bg-opacity));color:var(--mbrw-text-color);box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:none;font:13px/1.5 system-ui,-apple-system,sans-serif';

    dragHandle = document.createElement('div');
    dragHandle.textContent = '⠯ ⠯ ⠯';
    dragHandle.style.cssText = 'display:none;height:20px;cursor:grab;margin:-9px -11px 6px -11px;border-radius:6px 6px 0 0;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.45);text-align:center;font-size:11px;line-height:20px;letter-spacing:4px;user-select:none;-webkit-user-select:none';
    panel.appendChild(dragHandle);
    document.body.appendChild(panel);
    applyPanelMode();
  }

  function applyPanelMode() {
    if (!panel) return;
    writeStyleTag();
    if (dragHandle) dragHandle.style.display = settings.panelMode === 'fixed' ? 'block' : 'none';
    panel.style.pointerEvents = settings.panelMode === 'fixed' ? 'auto' : 'none';
    if (settings.panelMode === 'fixed' && settings.panelPosition) {
      panel.style.left = settings.panelPosition.left + 'px';
      panel.style.top = settings.panelPosition.top + 'px';
    }
  }

  // --- Drag (fixed mode) ---------------------------------------------------

  var dragState = null;

  function onDragMove(e) {
    if (!dragState) return;
    panel.style.left = (dragState.pL + e.clientX - dragState.sX) + 'px';
    panel.style.top = (dragState.pT + e.clientY - dragState.sY) + 'px';
  }

  function onDragUp() {
    if (!dragState) return;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    dragState = null;
    dragHandle.style.cursor = 'grab';
    settings.panelPosition = { left: parseInt(panel.style.left, 10) || 0, top: parseInt(panel.style.top, 10) || 0 };
    saveSettings();
  }

  // --- Positioning ---------------------------------------------------------

  function getViewport() {
    return { width: Number(root.innerWidth) || 1024, height: Number(root.innerHeight) || 768 };
  }

  function calculatePanelPosition(anchorRect, panelSize, viewport, options) {
    if (!options) options = {};
    var gap = options.gap != null ? options.gap : 12;
    var margin = options.margin != null ? options.margin : 12;
    var w = Math.max(0, panelSize.width || 0);
    var h = Math.max(0, panelSize.height || 0);
    var rightSpace = viewport.width - anchorRect.right;
    var prefSide = rightSpace >= w + gap ? 'right' : anchorRect.left >= w + gap ? 'left' : 'right';
    var prefLeft = prefSide === 'right' ? anchorRect.right + gap : anchorRect.left - w - gap;
    var prefTop = anchorRect.top + (anchorRect.height - h) / 2;
    return {
      left: Math.min(Math.max(prefLeft, margin), Math.max(margin, viewport.width - w - margin)),
      top: Math.min(Math.max(prefTop, margin), Math.max(margin, viewport.height - h - margin)),
    };
  }

  // --- Render --------------------------------------------------------------

  function prefixLines(text) {
    return String(text || '').split('\n').map(function (line) {
      return line.trim() === '' ? line : '· ' + line;
    }).join('\n');
  }

  function renderPanel(card, cardNameEn) {
    clearPanel();
    var doc = document;

    // Header row — card name on the left, mana cost top-right on the same line
    // (classic Magic card layout). The name column shrinks (min-width:0) so a
    // long name wraps instead of pushing the cost off-panel.
    var header = doc.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px';
    var nameCol = doc.createElement('div');
    nameCol.style.cssText = 'min-width:0;flex:1';
    var nameEl = doc.createElement('div');
    nameEl.textContent = card.n;
    nameEl.style.cssText = 'color:var(--mbrw-name-color);font-size:var(--mbrw-name-size);font-weight:700;line-height:1.25';
    nameCol.appendChild(nameEl);
    header.appendChild(nameCol);
    if (card.c) {
      var costEl = doc.createElement('div');
      costEl.className = 'mbrw-cost-row';
      costEl.innerHTML = manaHtml(card.c);
      costEl.style.cssText = 'font-size:var(--mbrw-name-size);line-height:1.25;white-space:nowrap;margin-top:1px';
      header.appendChild(costEl);
    }
    panel.appendChild(header);

    var enEl = doc.createElement('div');
    enEl.textContent = cardNameEn;
    enEl.style.cssText = 'color:var(--mbrw-en-name-color);font-size:var(--mbrw-en-name-size);margin-top:2px';
    panel.appendChild(enEl);

    if (card.y) {
      var typeEl = doc.createElement('div');
      typeEl.textContent = card.y;
      typeEl.style.cssText = 'color:var(--mbrw-type-color);font-size:var(--mbrw-type-size);font-style:italic;font-weight:300;margin-top:3px';
      panel.appendChild(typeEl);
    }

    if (card.t) {
      var textEl = doc.createElement('div');
      textEl.className = 'mbrw-rules';
      // Escape first, then substitute mana symbols with icon spans — the only
      // HTML that reaches innerHTML is the <i class="ms …"> we insert.
      textEl.innerHTML = renderRulesText(prefixLines(card.t));
      textEl.style.cssText = 'color:var(--mbrw-text-color);font-size:var(--mbrw-text-size);font-weight:400;line-height:1.5;margin-top:6px;white-space:pre-wrap';
      panel.appendChild(textEl);
    }

    // P/T footer — bottom-right corner (power/toughness, loyalty, or defense)
    var ptHtml = cardPowerToughness(card);
    if (ptHtml) {
      var ptRow = doc.createElement('div');
      ptRow.className = 'mbrw-pt-row';
      ptRow.innerHTML = ptHtml;
      ptRow.style.cssText = 'color:var(--mbrw-pt-color);font-size:var(--mbrw-pt-size);margin-top:6px;text-align:right;line-height:1.2';
      panel.appendChild(ptRow);
    }

    var srcEl = doc.createElement('div');
    srcEl.textContent = card._src === 'local' ? '📦 本地' : card._src === 'api' ? '🌐 mtgch' : card._src === 'local+api' ? '📦+🌐' : '';
    srcEl.style.cssText = 'color:var(--mbrw-source-color);font-size:var(--mbrw-source-size);margin-top:6px;text-align:right';
    panel.appendChild(srcEl);
  }

  // --- MTG mana-symbol rendering ------------------------------------------
  // Glyphs come from the official Mana font (mana.andrewgioia.com). Known
  // symbol → class map; anything unrecognized stays as literal {…} text.

  var MANA_SPECIAL = {
    't': 'tap', 'q': 'untap', 's': 's', 'x': 'x', 'y': 'y', 'z': 'z',
    'e': 'e', '∞': 'infinity', '½': 'half', '1/2': 'half',
    'chaos': 'chaos', '1000000': '1000000'
  };

  function manaClass(sym) {
    var inner = String(sym || '').replace(/^\{/, '').replace(/\}$/, '').trim().toLowerCase();
    if (!inner) return null;
    if (MANA_SPECIAL[inner]) return 'ms-' + MANA_SPECIAL[inner];
    // Hybrid "w/u", phyrexian "w/p", hybrid-phyrexian "w/u/p", generic hybrid "2/w",
    // numbers "0".."20", "100", and the single colors w/u/b/r/g/c.
    var cleaned = inner.replace(/[^a-z0-9]/g, '');
    if (!cleaned || !/^[0-9wubrgpc]+$/.test(cleaned)) return null;
    return 'ms-' + cleaned;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Turn a mana-cost string ("{2}{W}{W}") into icon spans (boxed, cost style).
  function manaHtml(costText) {
    if (!costText) return '';
    return String(costText).replace(/\{[^}]+\}/g, function (m) {
      var cls = manaClass(m);
      return cls ? '<i class="ms ms-cost ' + cls + '"></i>' : escapeHtml(m);
    });
  }

  // Rules text with inline mana symbols. v1.18.0 of the Mana font ships the
  // glyphs as monochrome font faces; the color version is only reachable through
  // the boxed .ms-cost class (e.g. .ms-cost.ms-w = white circle, .ms-cost.ms-u
  // = blue circle), so rules-text symbols get the same cost treatment as the
  // mana-cost row — which is also what a physical Magic card shows in its text.
  function renderRulesText(text) {
    var esc = escapeHtml(text);
    return esc.replace(/\{[^}]+\}/g, function (m) {
      var cls = manaClass(m);
      return cls ? '<i class="ms ms-cost ' + cls + '"></i>' : m;
    });
  }

  // P/T / loyalty / defense footer as plain text — "2/1", "*/4", "3" — no
  // glyph icons (per user preference; the */* form reads like the card itself).
  function cardPowerToughness(card) {
    if (card.p != null && card.q != null) {
      return escapeHtml(card.p) + '/' + escapeHtml(card.q);
    }
    if (card.l != null) return escapeHtml(card.l);
    if (card.d != null) return escapeHtml(card.d);
    return '';
  }

  function clearPanel() {
    while (panel.lastChild) {
      if (panel.lastChild === dragHandle) break;
      panel.removeChild(panel.lastChild);
    }
  }

  // --- Card hover state ----------------------------------------------------

  var currentAnchor = null;
  var currentCardName = null;
  var currentSerial = 0;
  var currentCard = null;

  function showPanel(anchorEl, card, cardNameEn) {
    currentCard = card;
    renderPanel(card, cardNameEn);
    panel.style.display = 'block';
    panel.style.visibility = 'hidden';
    if (settings.panelMode !== 'fixed') positionPanel(anchorEl);
    panel.style.visibility = 'visible';
    if (settings.panelMode === 'follow') startFollowing();
    try {
      var _r = panel.getBoundingClientRect();
      LOG('Panel shown:', cardNameEn, '@', Math.round(_r.left) + ',' + Math.round(_r.top),
        'size', Math.round(_r.width) + 'x' + Math.round(_r.height),
        'inDoc', document.body.contains(panel));
    } catch (_e) { WARN('Panel diagnostic failed:', _e); }
  }

  // True when the current card is missing info the mtgch API could supply:
  // rules text (and the card isn't an intentionally textless vanilla, o=1), a
  // mana cost on a non-land, or the stat line on a creature / planeswalker
  // (P/T or loyalty). magic-cards-zhs oracle carries no cost/P/T at all, so a
  // creature whose English name failed the MTGJSON faceName match is exactly
  // the case this catches — local data then gets its basic info filled in
  // from mtgch in the background.
  function cardNeedsUpgrade(card) {
    if (!card) return false;
    var y = String(card.y || '');
    var isLand = /地|Land/.test(y);
    var isToken = /衍生/.test(y); // tokens have no mana cost by nature
    var hasStatLine = /生物|Creature|鹏洛客|Planeswalker/.test(y);
    if (!card.t && !card.o) return true; // missing rules text
    if (!card.c && !isLand && !isToken) return true; // missing mana cost on a non-land, non-token
    if (hasStatLine && card.p == null && card.q == null && card.l == null && card.d == null) return true;
    return false;
  }

  // Fill in oracle text / cost / P/T the local DB lacks, in the background.
  // Fires whenever cardNeedsUpgrade() is true, not only for missing text.
  // Only missing fields are merged in (local name/type/text win), so nothing
  // local is ever overwritten. Results are cached, so each card costs the API
  // exactly once across sessions.
  function upgradeCard(cardName, serial, identity) {
    var key = String(cardName || '').trim().toLowerCase();
    if (!key) return;
    var cached = apiCache.get(key);
    var done = function (result) {
      if (!result) return;
      if (currentSerial !== serial || currentCardName !== cardName) return;
      var cur = currentCard || {};
      var merged = Object.assign({}, cur);
      var changed = false;
      if (!merged.t && result.t) { merged.t = result.t; changed = true; }
      if (!merged.y && result.y) { merged.y = result.y; changed = true; }
      if (!merged.c && result.c) { merged.c = result.c; changed = true; }
      if (merged.p == null && result.p != null) { merged.p = result.p; changed = true; }
      if (merged.q == null && result.q != null) { merged.q = result.q; changed = true; }
      if (merged.l == null && result.l != null) { merged.l = result.l; changed = true; }
      if (merged.d == null && result.d != null) { merged.d = result.d; changed = true; }
      if (!merged.n) { merged.n = result.n || cardName; changed = true; }
      if (!changed) return; // API had nothing this card was missing
      merged._src = cur._src === 'local' ? 'local+api' : (result._src || cur._src || '');
      LOG('Upgraded:', merged.n, '(missing fields from mtgch)');
      showPanel(currentAnchor, merged, cardName);
    };
    if (cached) { done(cached); return; }
    setTimeout(function () {
      queryMtgch(cardName, identity).then(done).catch(function () {});
    }, 60); // tiny stagger — the API is shared with the mtgch site
  }

  function hidePanel() {
    // Fixed mode pins the panel: it stays up across hovers and must never be
    // auto-hidden. pointerout, preview teardown, and the fiber poll all call
    // hidePanel — in fixed mode those are no-ops (otherwise the pinned panel
    // vanishes as soon as you stop hovering a card / the preview remounts).
    // It only goes away when the mode is switched back to follow.
    if (settings.panelMode === 'fixed') return;
    stopFollowing();
    panel.style.display = 'none';
    panel.style.visibility = 'hidden';
    currentAnchor = null;
    currentCardName = null;
    currentCard = null;
    panelOwner = null;
  }

  function getAnchorRect(anchor) {
    if (!anchor) return null;
    if (typeof anchor.getBoundingClientRect === 'function') return anchor.getBoundingClientRect();
    // DOMRect-like or {left, top, width, height} (hand-card bounds / mouse point)
    if (typeof anchor.left === 'number' && typeof anchor.top === 'number') {
      var w = anchor.width || 1;
      var h = anchor.height || 1;
      return { left: anchor.left, top: anchor.top, right: anchor.left + w, bottom: anchor.top + h, width: w, height: h };
    }
    return null;
  }

  function positionPanel(anchorEl) {
    var r = getAnchorRect(anchorEl);
    if (!r) return;
    var ps = { width: panel.offsetWidth || 300, height: panel.offsetHeight || 100 };
    var pos = calculatePanelPosition(r, ps, getViewport());
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
  }

  var repositionPanel = function () {
    if (settings.panelMode === 'fixed' || !currentAnchor || panel.style.display === 'none') return;
    positionPanel(currentAnchor);
  };

  // --- rAF following -------------------------------------------------------

  var followId = null;

  function scheduleTick(fn) {
    return typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame(fn) : setTimeout(fn, 16);
  }

  function cancelTick(id) {
    if (id == null) return;
    if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  function startFollowing() {
    stopFollowing();
    (function tick() {
      if (settings.panelMode === 'fixed' || !currentAnchor || panel.style.display === 'none') { stopFollowing(); return; }
      repositionPanel();
      followId = scheduleTick(tick);
    })();
  }

  function stopFollowing() {
    if (followId) { cancelTick(followId); followId = null; }
  }

  // --- DOM card detection --------------------------------------------------

  function isValidCardName(a) {
    if (!a) return false;
    a = a.trim();
    if (!a || a === 'Face-down card') return false;
    if (/^\{[^}]+\}$/.test(a)) return false; // a mana symbol like {T} / {2}{W}
    if (a.length < 2) return false;
    return true;
  }

  function findCardInDOM(target) {
    var el = target;
    for (var d = 0; d < 10 && el && el !== document.body; d++) {
      if (el.nodeType !== 1) { el = el.parentElement; continue; }
      // Direct check: is this element or a child a card image?
      var img;
      if (el.tagName === 'IMG') {
        img = el;
      } else if (el.querySelector) {
        img = el.querySelector('img');
      }
      if (img && img.alt && img.alt !== 'Face-down card' && img.src && img.src.indexOf('scryfall') !== -1) {
        return img;
      }
      // Card container class patterns
      if (el.className && typeof el.className === 'string') {
        var cn = el.className;
        if (cn.indexOf('rounded-lg') !== -1 || cn.indexOf('bg-card') !== -1 || cn.indexOf('DraftCard') !== -1) {
          if (img && img.alt && img.src && img.src.indexOf('scryfall') !== -1) return img;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  // Deck covers on the selection page (/play/offline/constructed) are card
  // images whose alt is the DECK name, not a card name. Resolve the actual
  // cover card (usually the commander) from the React fiber's `cover` prop
  // (DeckCoverImage / DeckSelectionCard memoizedProps) — `resolveCoverCard`
  // picks the commander for commander decks, else the first card. Returns the
  // full identity (name + setCode + cardNumber) so the exact API endpoint can
  // be used for covers that miss the local DB.
  function deckCoverIdentity(el) {
    var f = getFiberFromNode(el);
    var guard = 0;
    while (f && guard++ < 60) {
      var p = f.memoizedProps;
      if (p && typeof p === 'object' && p.cover && p.cover.identity && typeof p.cover.identity.name === 'string') {
        return p.cover.identity;
      }
      f = f.return;
    }
    return null;
  }

  // --- Unified card display ------------------------------------------------

  function presentCard(anchorEl, cardName, identity) {
    currentSerial++;
    var serial = currentSerial;
    currentAnchor = anchorEl;
    currentCardName = cardName;
    panelOwner = 'dom';
    LOG('Lookup:', cardName, identity ? '(' + identity.setCode + '/' + identity.cardNumber + ')' : '');

    lookupCard(cardName, identity).then(function (result) {
      if (!result || currentSerial !== serial) return;
      LOG('Found:', result.n, '(' + (result._src || '?') + ')');
      showPanel(anchorEl, result, cardName);
      if (cardNeedsUpgrade(result)) upgradeCard(cardName, serial, identity);
    }).catch(function (err) {
      WARN('Lookup failed:', err);
    });
  }

  // --- MutationObserver: CardPreview portal --------------------------------

  function startMutationObserver() {
    // Mount/unmount detection for [data-card-preview] portals (battlefield,
    // deck-editor preview rail, selection page). Content changes within a live
    // portal are tracked by attachLivePreviewObserver above — card switches
    // and late image loads — so the tooltip stays in sync with what the
    // preview actually shows.
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];

        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue;
          var preview = (node.matches && node.matches('[data-card-preview]')) ? node
            : (node.querySelector ? node.querySelector('[data-card-preview]') : null);
          if (preview) onPreviewAdded(preview);
        }

        for (var k = 0; k < m.removedNodes.length; k++) {
          var rm = m.removedNodes[k];
          if (rm.nodeType !== 1) continue;
          var lost = (rm.matches && rm.matches('[data-card-preview]')) ? rm
            : (rm.querySelector ? rm.querySelector('[data-card-preview]') : null);
          if (lost) onPreviewRemoved();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    LOG('MutationObserver started on document.body');
  }

  function onPreviewAdded(previewEl) {
    LOG('Preview appeared');
    clearTimeout(hideTimer); // a replacement preview supersedes any pending hide
    // The body-level observer only fires when a [data-card-preview] node is
    // added/removed. manabrew reuses one mounted portal across successive
    // cards (the preview machine instant-switches and React swaps the <img>
    // alt/src in place), so a mount is not enough: also watch the live
    // preview's subtree and re-present whenever the displayed card changes.
    // This likewise catches the card image appearing late (Scryfall faces
    // still loading), which used to fall through the 5×50ms retry window and
    // leave no tooltip at all.
    attachLivePreviewObserver(previewEl);
    onLivePreviewChanged(previewEl);
  }

  var livePreviewObserver = null;

  function attachLivePreviewObserver(previewEl) {
    detachLivePreviewObserver();
    livePreviewObserver = new MutationObserver(function () {
      onLivePreviewChanged(previewEl);
    });
    livePreviewObserver.observe(previewEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['alt', 'src'],
    });
  }

  function detachLivePreviewObserver() {
    if (livePreviewObserver) { livePreviewObserver.disconnect(); livePreviewObserver = null; }
  }

  function onLivePreviewChanged(previewEl) {
    clearTimeout(hideTimer);
    var cardName = extractCardName(previewEl);
    if (!cardName || cardName === 'Face-down card') return; // still loading / facedown — keep current
    if (cardName === currentCardName && panel.style.display !== 'none') return; // no change
    LOG('Preview card → ' + cardName);
    var identity = previewIdentity(previewEl, cardName);
    presentCard(previewEl, cardName, identity);
  }

  function extractCardName(previewEl) {
    // The preview stack renders several <img>s (low-res then high-res); the
    // first may have empty alt. Prefer the img whose alt is a real card name.
    var imgs = previewEl.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var a = imgs[i].getAttribute('alt') || '';
      a = a.trim();
      if (isValidCardName(a)) return a;
    }
    return '';
  }

  // Best-effort: the preview portal's own CardPreview component holds the
  // hovered card in memoizedProps.card.identity. Walking the fiber from the
  // portal up yields setCode + cardNumber, so the exact API endpoint can be
  // used even on battlefield / deck-editor previews. Prefer the identity whose
  // name matches the displayed alt; otherwise take the first one carrying a
  // real set code. Alt-only paths (face-down, name mismatch on a DFC back
  // face) still fall back to the fuzzy name search.
  function previewIdentity(previewEl, altName) {
    var f = getFiberFromNode(previewEl);
    var guard = 0;
    var altLower = String(altName || '').toLowerCase().trim();
    var fallback = null;
    while (f && guard++ < 80) {
      var p = f.memoizedProps;
      if (p && typeof p === 'object' && p.card && p.card.identity) {
        var id = p.card.identity;
        if (id && id.setCode && id.cardNumber) {
          var nm = String(id.name || '').toLowerCase().trim();
          if (altLower && nm === altLower) return id;
          if (!fallback) fallback = id;
        }
      }
      f = f.return;
    }
    return fallback;
  }

  var hideTimer = null;

  function onPreviewRemoved() {
    LOG('Preview removed');
    detachLivePreviewObserver();
    // React re-mounts the preview portal while hovering (image loads, phase
    // transitions). Don't blank the panel on every transient removal — only
    // hide if no new preview replaces it within a short window.
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (panelOwner === 'fiber') return; // the fiber scanner owns the tooltip now
      hidePanel();
    }, 200);
  }

  // --- Pointerover: DOM-rendered cards -------------------------------------

  var hoverTimer = null;
  var HOVER_DELAY_MS = 100;

  function onPointerOver(e) {
    var img = findCardInDOM(e.target);
    if (!img) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      var cardName = img.alt.trim();
      // Deck cover images carry the DECK name as alt; resolve the actual
      // cover card (commander) from React props when available. The full
      // identity (setCode + cardNumber) feeds the exact API endpoint.
      var identity = deckCoverIdentity(img);
      if (identity && identity.name) {
        cardName = identity.name;
        LOG('Deck cover → ' + cardName);
      }
      if (!isValidCardName(cardName)) return;
      presentCard(img, cardName, identity);
    }, HOVER_DELAY_MS);
  }

  function onPointerOut(e) {
    clearTimeout(hoverTimer);
    if (!currentAnchor) return;
    if (settings.panelMode === 'fixed') return;
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    // Only hide when the pointer actually leaves a DOM card; stray pointerout
    // events (moving across the PixiJS canvas, preview churn) must not dismiss
    // the panel.
    var img = findCardInDOM(e.target);
    if (!img) return;
    hidePanel();
  }

  // --- React fiber introspection: hand + battlefield-stack hover ------------
  // Battlefield cards surface through the [data-card-preview] portal. Hand cards
  // (HandController) and battlefield-stack cards (StackLayer) never render that
  // portal, but manabrew still tracks them in React state: BoardCanvas's
  // handHover useState holds the hovered hand card ({card, bounds}) and the
  // useStackUIStore / BoardOverlayCanvas state hold the hovered stack object id.
  // We read those by walking the React fiber tree. Best-effort: if the fiber
  // layout changes in a future build these two tooltips silently stop while the
  // DOM paths keep working.

  var lastMouse = { x: 0, y: 0 };
  var panelOwner = null; // 'dom' = MutationObserver / pointerover, 'fiber' = this scanner
  var FIBER_SCAN_MS = 150;
  var cachedGameViewNode = null;
  var lastGvScan = 0;
  var lastGvRescan = 0;

  function getFiberFromNode(el) {
    if (!el) return null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      // React <18: __reactFiber$ / __reactInternalInstance$. React 19: the root
      // container exposes __reactContainer$ pointing straight at the HostRootFiber.
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0 || k.indexOf('__reactContainer$') === 0) {
        return el[k];
      }
    }
    return null;
  }

  function getFiberRoot() {
    var rootEl = document.querySelector('#root');
    if (!rootEl || !rootEl.firstElementChild) rootEl = document.body;
    var f = getFiberFromNode(rootEl) || getFiberFromNode(rootEl.firstElementChild);
    // Fall back to the container key if the element probe missed it.
    if (!f && rootEl) {
      var ckeys = Object.keys(rootEl);
      for (var i = 0; i < ckeys.length && !f; i++) {
        if (ckeys[i].indexOf('__reactContainer$') === 0) f = rootEl[ckeys[i]];
      }
    }
    var guard = 0;
    while (f && f.return && guard++ < 2000) f = f.return;
    if (!f) DIAG('getFiberRoot: no React fiber found (is the game mounted?)');
    else DIAG('getFiberRoot: ok (top ' + (f.tag != null ? 'tag ' + f.tag : '?') + ')');
    return f;
  }

  function walkFibers(root, visit, budget) {
    if (!root) return false;
    var stack = [root];
    var count = 0;
    var limit = budget || 150000;
    while (stack.length && count < limit) {
      var f = stack.pop();
      count++;
      if (visit(f) === true) return true;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return false;
  }

  function hookCandidates(hook) {
    var v = hook && hook.memoizedState;
    if (v == null) return [];
    var out = [v];
    // useState → [value, dispatch]; unwrap the value
    if (Array.isArray(v) && v.length >= 2 && typeof v[1] === 'function') out.push(v[0]);
    // useRef → { current }; unwrap for good measure
    if (v && typeof v === 'object' && typeof v.current === 'object') out.push(v.current);
    return out;
  }

  // BoardCanvas's handHover useState holds the hovered hand card as
  // { card, bounds }, fed by HandController.onHoverHandCard. It is the only
  // React-visible hand signal: the CardPreviewMachine itself dismisses on hand
  // hover (screenBounds has no `buttons`, so useCardPreview treats it as a
  // drag and never opens), so a preview snapshot with zoneId "hand" never
  // appears — we must read the handHover state instead.
  function isHandHoverState(v) {
    return !!v && typeof v === 'object' &&
      !!v.card && !!v.card.identity && typeof v.card.identity.name === 'string' &&
      !!v.bounds && typeof v.bounds.x === 'number' && typeof v.bounds.y === 'number' &&
      typeof v.bounds.width === 'number' && typeof v.bounds.height === 'number';
  }

  function isGameView(v) {
    return !!v && typeof v === 'object' &&
      Array.isArray(v.players) && Array.isArray(v.stack) && Array.isArray(v.battlefield);
  }

  function getGameView() {
    var now = Date.now();
    // Re-anchor the cache to the current tree every 5s: a game→menu→game cycle
    // remounts the Game component with a fresh fiber, orphaning our cached hook.
    // Without this, the orphaned hook keeps serving the previous game's view and
    // stack tooltips silently stop matching in the new game.
    if (cachedGameViewNode && now - lastGvRescan > 5000) {
      cachedGameViewNode = null;
      lastGvRescan = now;
      lastGvScan = 0; // bypass the 2s backoff so the re-anchor walk runs now
    }
    if (cachedGameViewNode) {
      var c0 = hookCandidates(cachedGameViewNode);
      for (var i0 = 0; i0 < c0.length; i0++) if (isGameView(c0[i0])) return c0[i0];
      cachedGameViewNode = null; // hook chain changed shape — rescan
    }
    if (now - lastGvScan < 2000) return null; // back off rescans while not in a game
    lastGvScan = now;
    lastGvRescan = now; // any walk refreshes the re-anchor clock
    var root = getFiberRoot();
    if (!root) return null;
    walkFibers(root, function (f) {
      var h = f.memoizedState, d = 0;
      while (h && d < 80) {
        var c = hookCandidates(h);
        for (var j = 0; j < c.length; j++) {
          if (isGameView(c[j])) { cachedGameViewNode = h; return true; }
        }
        h = h.next; d++;
      }
      return false;
    });
    if (cachedGameViewNode) {
      var c1 = hookCandidates(cachedGameViewNode);
      for (var i1 = 0; i1 < c1.length; i1++) if (isGameView(c1[i1])) return c1[i1];
    }
    return null;
  }

  // Single walk: find a hovered hand card (BoardCanvas handHover state) or a
  // hovered stack object (a hook string matching a stack object id — the id is
  // a plain string in the useStackUIStore / BoardOverlayCanvas hooks). Stack
  // card resolution falls back to the stackSpec prop's resolved cards when
  // gameView is momentarily unavailable (getGameView's 2s backoff).
  function scanFiberHover(gameView) {
    var stackIndex = null;
    if (gameView && Array.isArray(gameView.stack) && gameView.stack.length) {
      stackIndex = {};
      for (var i = 0; i < gameView.stack.length; i++) {
        var so = gameView.stack[i];
        if (!so) continue;
        if (so.id) stackIndex[so.id] = so;
        if (so.sourceId) stackIndex[so.sourceId] = so;
      }
    }
    var root = getFiberRoot();
    if (!root) return null;
    var result = null;
    walkFibers(root, function (f) {
      // Game.tsx passes stackSpec (resolved CardDtos) down to GameBoard /
      // BoardOverlayCanvas, which also holds the hovered stack id — so a fiber
      // with memoizedProps.stackSpec lets us resolve the hovered card directly.
      var specCards = null;
      if (f.memoizedProps && f.memoizedProps.stackSpec && Array.isArray(f.memoizedProps.stackSpec.cards)) {
        specCards = f.memoizedProps.stackSpec.cards;
      }
      var h = f.memoizedState, d = 0;
      while (h && d < 80) {
        var c = hookCandidates(h);
        for (var j = 0; j < c.length; j++) {
          var v = c[j];
          if (isHandHoverState(v)) {
            result = { hand: { card: v.card, bounds: v.bounds } };
            return true;
          }
          if (typeof v === 'string') {
            if (stackIndex && stackIndex[v]) { result = { stack: stackIndex[v] }; return true; }
            if (specCards) {
              for (var k = 0; k < specCards.length; k++) {
                if (specCards[k] && specCards[k].id === v && specCards[k].card) {
                  result = { stack: specCards[k].card };
                  return true;
                }
              }
            }
          }
        }
        h = h.next; d++;
      }
      return false;
    });
    if (result) DIAG('scan → ' + (result.hand ? 'HAND ' + result.hand.card.identity.name : 'STACK ' + ((result.stack.identity && result.stack.identity.name) || result.stack.id || '?')));
    return result;
  }

  function rectFromPoint(x, y) {
    return { left: x, top: y, width: 1, height: 1 };
  }

  function presentFiberCard(cardName, rect, identity) {
    currentSerial++;
    var serial = currentSerial;
    currentAnchor = rect;
    currentCardName = cardName;
    panelOwner = 'fiber';
    clearTimeout(hideTimer);
    LOG('Lookup [fiber]:', cardName, identity ? '(' + identity.setCode + '/' + identity.cardNumber + ')' : '');
    lookupCard(cardName, identity).then(function (result) {
      if (!result || currentSerial !== serial) return;
      LOG('Found:', result.n, '(' + (result._src || '?') + ')', '[fiber]');
      showPanel(rect, result, cardName);
      if (cardNeedsUpgrade(result)) upgradeCard(cardName, serial, identity);
    }).catch(function (err) {
      WARN('Fiber lookup failed:', err);
    });
  }

  function handRectFromBounds(hb) {
    // handHover.bounds is in board-canvas coordinates; convert to viewport by
    // adding the offset of the largest canvas (the board).
    var best = null, bestArea = 0, i;
    var canvases = document.querySelectorAll('canvas');
    for (i = 0; i < canvases.length; i++) {
      var w = canvases[i].width, h = canvases[i].height;
      if (w * h > bestArea) { bestArea = w * h; best = canvases[i]; }
    }
    var r = best ? best.getBoundingClientRect() : null;
    if (r && r.width > 0) {
      return { left: r.left + hb.x, top: r.top + hb.y, width: hb.width, height: hb.height };
    }
    return rectFromPoint(lastMouse.x, lastMouse.y);
  }

  function pollFiberHover() {
    try {
      // When a data-card-preview portal is live, the MutationObserver path owns
      // the tooltip — never race it.
      if (document.querySelector('[data-card-preview]')) {
        if (panelOwner === 'fiber') hidePanel();
        return true;
      }

      var gv = getGameView();
      var scan = scanFiberHover(gv);

      if (scan && scan.hand && scan.hand.card && scan.hand.card.identity && scan.hand.card.identity.name) {
        var hname = scan.hand.card.identity.name;
        var hrect = handRectFromBounds(scan.hand.bounds);
        if (panelOwner === 'fiber' && currentCardName === hname && currentAnchor) currentAnchor = hrect;
        else { DIAG('poll: HAND hover → ' + hname); presentFiberCard(hname, hrect, scan.hand.card.identity); }
        return true;
      }

      if (scan && scan.stack) {
        var so = scan.stack;
        var sname = (so.identity && so.identity.name) || (so.card && so.card.identity && so.card.identity.name);
        if (sname) {
          var srect = rectFromPoint(lastMouse.x, lastMouse.y);
          if (panelOwner === 'fiber' && currentCardName === sname && currentAnchor) currentAnchor = srect;
          else { DIAG('poll: STACK hover → ' + sname); presentFiberCard(sname, srect, so.identity || (so.card && so.card.identity)); }
          return true;
        }
      }

      if (panelOwner === 'fiber') { DIAG('poll: no hand/stack — hiding'); hidePanel(); }
      return !!gv;
    } catch (_err) {
      // Fiber introspection is best-effort — never break the DOM paths.
      return true;
    }
  }

  function startFiberPolling() {
    setTimeout(function tick() {
      var active = pollFiberHover();
      setTimeout(tick, active ? FIBER_SCAN_MS : 800);
    }, 800);
  }

  // --- Settings dialog ----------------------------------------------------

  var settingsOverlay = null;

  function openSettings() {
    if (settingsOverlay) closeSettings();
    var doc = document;

    settingsOverlay = doc.createElement('div');
    settingsOverlay.id = 'mbrw-cn-settings-overlay';
    settingsOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    settingsOverlay.addEventListener('click', function (e) { if (e.target === settingsOverlay) closeSettings(); });

    var box = doc.createElement('div');
    box.id = 'mbrw-cn-settings-dialog';
    box.style.cssText = 'background:#1a1d24;color:#e0e0e0;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:14px 16px;width:340px;max-width:calc(100vw - 20px);max-height:90vh;overflow-y:auto;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5)';
    box.addEventListener('click', function (e) { e.stopPropagation(); });

    // --- 标题 + 实时预览框（与浮窗共用同一组 CSS 变量） ---

    var title = doc.createElement('div');
    title.textContent = '⚙ Manabrew CN 设置';
    title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:10px;color:#ffad42;';
    box.appendChild(title);

    var previewLabel = doc.createElement('div');
    previewLabel.textContent = '效果预览';
    previewLabel.style.cssText = 'font-size:11px;font-weight:600;color:#888;margin-bottom:4px;';
    box.appendChild(previewLabel);

    var preview = doc.createElement('div');
    preview.id = 'mbrw-cn-preview-box';
    preview.style.cssText = 'margin-bottom:10px;padding:8px 10px;border-radius:6px;border:1px solid rgba(var(--mbrw-border-color),var(--mbrw-border-opacity));background:rgba(var(--mbrw-bg-color),var(--mbrw-bg-opacity));color:var(--mbrw-text-color);';

    var previewHeader = doc.createElement('div');
    previewHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;';
    var previewName = doc.createElement('div');
    previewName.textContent = '中文卡名';
    previewName.style.cssText = 'min-width:0;flex:1;color:var(--mbrw-name-color);font-size:var(--mbrw-name-size);font-weight:700;line-height:1.25;';
    var previewCost = doc.createElement('div');
    previewCost.className = 'mbrw-cost-row';
    previewCost.innerHTML = manaHtml('{2}{W}{W}');
    previewCost.style.cssText = 'font-size:var(--mbrw-name-size);line-height:1.25;white-space:nowrap;';
    previewHeader.appendChild(previewName);
    previewHeader.appendChild(previewCost);
    preview.appendChild(previewHeader);

    var previewEn = doc.createElement('div');
    previewEn.textContent = 'English Card Name';
    previewEn.style.cssText = 'color:var(--mbrw-en-name-color);font-size:var(--mbrw-en-name-size);margin-top:2px;';
    preview.appendChild(previewEn);

    var previewType = doc.createElement('div');
    previewType.textContent = '生物 ～人类';
    previewType.style.cssText = 'color:var(--mbrw-type-color);font-size:var(--mbrw-type-size);font-style:italic;font-weight:300;margin-top:3px;';
    preview.appendChild(previewType);

    var previewText = doc.createElement('div');
    previewText.textContent = '· 示例效果文本。';
    previewText.style.cssText = 'color:var(--mbrw-text-color);font-size:var(--mbrw-text-size);line-height:1.5;margin-top:4px;white-space:pre-wrap;';
    preview.appendChild(previewText);

    var previewPt = doc.createElement('div');
    previewPt.textContent = '3/3';
    previewPt.style.cssText = 'color:var(--mbrw-pt-color);font-size:var(--mbrw-pt-size);margin-top:4px;text-align:right;';
    preview.appendChild(previewPt);

    var previewSrc = doc.createElement('div');
    previewSrc.textContent = '📦 本地';
    previewSrc.style.cssText = 'color:var(--mbrw-source-color);font-size:var(--mbrw-source-size);margin-top:2px;text-align:right;';
    preview.appendChild(previewSrc);

    box.appendChild(preview);

    // --- 表单控件辅助函数 ---

    function makeRow(label) {
      var row = doc.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;';
      var lbl = doc.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'flex:0 0 auto;font-size:12px;';
      row.appendChild(lbl);
      return row;
    }

    // 原生颜色选择器铺在色块上，点击即弹出取色器；色块实时镜像所选颜色。
    function makeColorSwatch(value, onChange) {
      var wrap = doc.createElement('span');
      wrap.style.cssText = 'position:relative;display:inline-block;width:22px;height:22px;flex:0 0 auto;';
      var swatch = doc.createElement('span');
      swatch.style.cssText = 'position:absolute;inset:0;border-radius:4px;background-color:' + value + ';border:1px solid rgba(255,255,255,.35);pointer-events:none;';
      var input = doc.createElement('input');
      input.type = 'color';
      input.value = value;
      input.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;padding:0;';
      input.addEventListener('input', function () {
        swatch.style.backgroundColor = input.value;
        onChange(input.value);
      });
      wrap.appendChild(swatch);
      wrap.appendChild(input);
      return { wrap: wrap, input: input, swatch: swatch };
    }

    function makeRange(value, onChange) {
      var wrap = doc.createElement('span');
      wrap.style.cssText = 'display:flex;align-items:center;gap:5px;';
      var input = doc.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = String(value);
      input.style.width = '84px';
      var val = doc.createElement('span');
      val.textContent = String(value);
      val.style.cssText = 'font-size:11px;min-width:28px;text-align:right;';
      input.addEventListener('input', function () {
        val.textContent = String(parseFloat(input.value).toFixed(2));
        onChange(parseFloat(input.value));
      });
      wrap.appendChild(input);
      wrap.appendChild(val);
      return { wrap: wrap, input: input };
    }

    // 字号输入：上限 30px（与 talishar-cn 一致）。
    function makeNumber(value, onChange) {
      var wrap = doc.createElement('span');
      wrap.style.cssText = 'display:flex;align-items:center;gap:3px;';
      var input = doc.createElement('input');
      input.type = 'number';
      input.min = '8';
      input.max = '30';
      input.value = String(value);
      input.style.cssText = 'width:50px;background:#2a2d35;color:#e0e0e0;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:2px 5px;font-size:12px;';
      input.addEventListener('input', function () {
        var v = parseInt(input.value, 10);
        if (!isNaN(v)) onChange(Math.min(30, Math.max(8, v)));
      });
      var px = doc.createElement('span');
      px.textContent = 'px';
      px.style.cssText = 'font-size:11px;color:#888;';
      wrap.appendChild(input);
      wrap.appendChild(px);
      return { wrap: wrap, input: input };
    }

    function sectionTitle(text) {
      var t = doc.createElement('div');
      t.textContent = text;
      t.style.cssText = 'font-size:11px;font-weight:600;color:#888;margin:6px 0 4px;';
      return t;
    }

    // --- 底色与边框 ---

    box.appendChild(sectionTitle('底色与边框'));

    var bgRow = makeRow('底色');
    var bgColorField = makeColorSwatch(rgbToHex(settings.bgColor), function () { previewChanges(); });
    var bgOpacityField = makeRange(settings.bgOpacity, function () { previewChanges(); });
    bgRow.appendChild(bgColorField.wrap);
    bgRow.appendChild(bgOpacityField.wrap);

    var borderRow = makeRow('边框');
    var borderColorField = makeColorSwatch(rgbToHex(settings.borderColor), function () { previewChanges(); });
    var borderOpacityField = makeRange(settings.borderOpacity, function () { previewChanges(); });
    borderRow.appendChild(borderColorField.wrap);
    borderRow.appendChild(borderOpacityField.wrap);

    box.appendChild(bgRow);
    box.appendChild(borderRow);

    // --- 每个文字区块：颜色 + 字号 ---

    box.appendChild(sectionTitle('文字区块'));

    function makeFontRow(label, colorValue, sizeValue) {
      var row = makeRow(label);
      var colorField = makeColorSwatch(colorValue, function () { previewChanges(); });
      var sizeField = makeNumber(sizeValue, function () { previewChanges(); });
      row.appendChild(colorField.wrap);
      row.appendChild(sizeField.wrap);
      return { row: row, colorField: colorField, sizeField: sizeField };
    }

    var nameFont = makeFontRow('卡名', settings.nameColor, settings.nameSize);
    var enNameFont = makeFontRow('英文卡名', settings.enNameColor, settings.enNameSize);
    var typeFont = makeFontRow('类别行', settings.typeColor, settings.typeSize);
    var textFont = makeFontRow('规则文本', settings.textColor, settings.textSize);
    var ptFont = makeFontRow('攻防', settings.ptColor, settings.ptSize);
    var sourceFont = makeFontRow('来源脚注', settings.sourceColor, settings.sourceSize);

    box.appendChild(nameFont.row);
    box.appendChild(enNameFont.row);
    box.appendChild(typeFont.row);
    box.appendChild(textFont.row);
    box.appendChild(ptFont.row);
    box.appendChild(sourceFont.row);

    // --- 面板模式提示（唯一开关在脚本菜单里，这里仅展示当前状态） ---

    var modeHint = doc.createElement('div');
    modeHint.style.cssText = 'font-size:11px;color:#888;margin:4px 0 6px;';
    box.appendChild(modeHint);
    function refreshModeHint() {
      modeHint.textContent = '面板模式：' + (settings.panelMode === 'fixed' ? '固定' : '跟随') +
        '（通过脚本菜单的「固定浮窗」开关切换）';
    }
    refreshModeHint();

    // --- 读取当前控件值 → 设置对象 ---

    function readFieldValues() {
      var out = {};
      out.bgColor = hexToRgb(bgColorField.input.value);
      out.borderColor = hexToRgb(borderColorField.input.value);
      out.bgOpacity = parseFloat(bgOpacityField.input.value);
      out.borderOpacity = parseFloat(borderOpacityField.input.value);
      out.nameColor = nameFont.colorField.input.value;
      out.nameSize = parseInt(nameFont.sizeField.input.value, 10);
      out.enNameColor = enNameFont.colorField.input.value;
      out.enNameSize = parseInt(enNameFont.sizeField.input.value, 10);
      out.typeColor = typeFont.colorField.input.value;
      out.typeSize = parseInt(typeFont.sizeField.input.value, 10);
      out.textColor = textFont.colorField.input.value;
      out.textSize = parseInt(textFont.sizeField.input.value, 10);
      out.ptColor = ptFont.colorField.input.value;
      out.ptSize = parseInt(ptFont.sizeField.input.value, 10);
      out.sourceColor = sourceFont.colorField.input.value;
      out.sourceSize = parseInt(sourceFont.sizeField.input.value, 10);
      return out;
    }

    // 实时预览：任何改动立即重写 CSS 变量，浮窗与上面的预览框同时更新。
    function previewChanges() {
      applyStyleVariables(readFieldValues());
    }

    // --- 按钮 ---

    var buttonRow = doc.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:8px;';

    function makeButton(text, primary) {
      var btn = doc.createElement('button');
      btn.textContent = text;
      btn.style.cssText = [
        'padding:5px 12px;border-radius:5px;border:1px solid rgba(255,255,255,.15);',
        'cursor:pointer;font-size:12px;',
        primary
          ? 'background:#ffad42;color:#111;border-color:#ffad42;font-weight:600;'
          : 'background:transparent;color:#ccc;',
      ].join('');
      return btn;
    }

    var resetBtn = makeButton('恢复默认', false);
    var cancelBtn = makeButton('取消', false);
    var saveBtn = makeButton('保存', true);

    buttonRow.appendChild(resetBtn);
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    box.appendChild(buttonRow);

    resetBtn.addEventListener('click', function () {
      settings = Object.assign({}, SETTINGS_DEFAULTS);
      saveSettings();
      applyStyleVariables(settings);
      applyPanelMode();
      closeSettings();
      openSettings(); // 以默认值重新打开
    });

    cancelBtn.addEventListener('click', function () {
      applyStyleVariables(settings); // 还原已保存的样式
      closeSettings();
    });

    saveBtn.addEventListener('click', function () {
      var newVals = readFieldValues();
      // 保留非样式字段（面板模式/位置由脚本菜单控制）
      newVals.panelMode = settings.panelMode;
      newVals.panelPosition = settings.panelPosition;
      settings = newVals;
      saveSettings();
      applyStyleVariables(settings);
      applyPanelMode();
      closeSettings();
    });

    settingsOverlay.appendChild(box);
    doc.body.appendChild(settingsOverlay);

    doc.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeSettings(); doc.removeEventListener('keydown', onEsc); }
    });
  }

  function closeSettings() {
    if (settingsOverlay) { settingsOverlay.remove(); settingsOverlay = null; }
  }

  // --- GM menu commands ----------------------------------------------------
  //
  // 传 `{id}` 而非字符串，Tampermonkey ≥5.0.6189 与 Violentmonkey ≥2.16.0 会原地
  // 更新同 id 的菜单项——之前的字符串写法被当作 accessKey，每次调用都会新增
  // 一条菜单项，于是每次点击开关都会「冒出另一个开关」。现在同 id 覆盖，菜单里
  // 始终只有一条「固定浮窗」开关（唯一的有效开关）。

  function registerMenuCommand(label, handler, id, autoClose) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand(label, handler, {
        id: id,
        autoClose: autoClose !== false,
      });
    } catch (_) { /* GM menu not available */ }
  }

  function updateMenuToggles() {
    registerMenuCommand(
      (settings.panelMode === 'fixed' ? '☑ ' : '☐ ') + '固定浮窗',
      function () {
        settings.panelMode = settings.panelMode === 'fixed' ? 'follow' : 'fixed';
        saveSettings();
        applyPanelMode();
        updateMenuToggles();
      },
      'mbrw-cn-menu-pin',
      false
    );
    registerMenuCommand('⚙ 样式设置', openSettings, 'mbrw-cn-menu-style');
  }

  // --- Init ---------------------------------------------------------------

  function init() {
    loadSettings();
    loadApiCache();
    ensureStyleTag();
    ensureManaCSS();
    ensurePanel();

    panel.addEventListener('mousedown', function (e) {
      if (settings.panelMode !== 'fixed' || e.target !== dragHandle || e.button !== 0) return;
      e.preventDefault();
      dragHandle.style.cursor = 'grabbing';
      dragState = { sX: e.clientX, sY: e.clientY, pL: panel.offsetLeft, pT: panel.offsetTop };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragUp);
    });

    startMutationObserver();
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointermove', function (e) {
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    }, true);

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('resize', repositionPanel);
      root.addEventListener('scroll', repositionPanel, true);
    }

    fetchAndLoadDB();
    startFiberPolling();

    updateMenuToggles();
    LOG('v0.9.3 ready — fixed panel no longer auto-hides + identity-aware exact /card/{SET}/{CN} lookup');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
