// ==UserScript==
// @name         Manabrew 简体中文卡牌浮窗
// @name:zh-CN   Manabrew 简体中文卡牌浮窗
// @name:en      Manabrew Simplified Chinese Card Tooltip
// @namespace    https://play.manabrew.app/
// @version      0.3.0
// @description  在 Manabrew 悬停 MTG 卡牌时显示简体中文翻译浮窗
// @description:zh-CN 在 Manabrew 悬停万智牌卡牌时显示简体中文翻译浮窗——卡名、类别、规则文本。
// @description:en Show Simplified Chinese card info on hover for Manabrew — card name, type, and rules text.
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

  var DATA_BASE = 'https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/dist';
  var API_CACHE_PREFIX = 'mbrw-api-';

  // --- Settings -----------------------------------------------------------

  var SETTINGS_DEFAULTS = {
    bgOpacity: 0.94,
    fontSize: 13,
    panelMode: 'follow',
    panelPosition: null,
  };

  var settings = Object.assign({}, SETTINGS_DEFAULTS);

  function loadSettings() {
    try {
      if (typeof GM_getValue === 'function') {
        var raw = GM_getValue('mbrw-cn-settings', null);
        if (raw) Object.assign(settings, typeof raw === 'string' ? JSON.parse(raw) : raw);
      }
    } catch (_) {}
  }

  function saveSettings() {
    try {
      if (typeof GM_setValue === 'function') GM_setValue('mbrw-cn-settings', JSON.stringify(settings));
    } catch (_) {}
  }

  function resetSettings() {
    settings = Object.assign({}, SETTINGS_DEFAULTS);
    saveSettings();
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

  function writeStyleTag() {
    if (!styleTag) return;
    styleTag.textContent = ':root {' +
      '--mbrw-bg-opacity:' + settings.bgOpacity + ';' +
      '--mbrw-border:rgba(255,255,255,0.18);' +
      '--mbrw-text-color:#d4d4d8;' +
      '--mbrw-name-color:#ffad42;' +
      '--mbrw-type-color:#a1a1aa;' +
      '--mbrw-en-name-color:#71717a;' +
      '--mbrw-source-color:#52525b;' +
      '--mbrw-font-size:' + settings.fontSize + 'px;' +
      '}' +
      '#mbrw-cn-panel::-webkit-scrollbar{width:4px}' +
      '#mbrw-cn-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}';
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

  function queryMtgch(name) {
    var key = name.toLowerCase();
    var pending = apiQueue.get(key);
    if (pending) return pending;

    pending = new Promise(function (resolve) {
      var enc = encodeURIComponent(name);
      fetch('https://mtgch.com/api/v1/card-names/?q=' + enc + '&size=1')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (d) {
          var zhName = ((d.items || [])[0] || {}).translated_name || null;
          return fetch('https://mtgch.com/api/v1/result?q=%22' + enc + '%22&unique=oracle_id&page_size=1')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
            .then(function (sd) {
              var item = (sd.items || [])[0] || {};
              return { n: zhName || name, t: item.zhs_text || undefined, y: item.zhs_type_line || undefined, _src: 'api' };
            });
        })
        .catch(function () { return { n: name, _src: 'miss' }; })
        .then(function (r) {
          apiCache.set(key, r);
          if (apiCache.size > API_CACHE_MAX) apiCache.delete(apiCache.keys().next().value);
          persistApiCache();
          apiQueue.delete(key);
          resolve(r);
        });
    });

    apiQueue.set(key, pending);
    return pending;
  }

  // --- Core lookup --------------------------------------------------------

  function lookupCard(cardName) {
    if (!cardName) return Promise.resolve(null);
    var key = cardName.trim().toLowerCase();
    if (!key || key === 'face-down card') return Promise.resolve(null);

    // 1. mtgch cache (fastest)
    var cached = apiCache.get(key);
    if (cached) return Promise.resolve(cached);

    // 2. Local DB (if loaded)
    if (zhDB) {
      var local = zhDB.get(key);
      if (local) {
        var r = { n: local.n, _src: 'local' };
        if (local.t) r.t = local.t;
        if (local.y) r.y = local.y;
        return Promise.resolve(r);
      }
    }

    // 3. DB still loading — wait, but don't block forever
    if (!dbLoadDone && dbLoadPromise) {
      return dbLoadPromise.then(function () {
        if (zhDB) {
          var l2 = zhDB.get(key);
          if (l2) {
            var r2 = { n: l2.n, _src: 'local' };
            if (l2.t) r2.t = l2.t;
            if (l2.y) r2.y = l2.y;
            return r2;
          }
        }
        return queryMtgch(cardName.trim());
      });
    }

    // 4. Fallback to API
    return queryMtgch(cardName.trim());
  }

  // --- Panel creation ------------------------------------------------------

  var panel = null;
  var dragHandle = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'mbrw-cn-panel';
    panel.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;display:none;visibility:hidden;max-width:320px;max-height:50vh;overflow:auto;padding:9px 11px;border:1px solid var(--mbrw-border);border-radius:6px;background:rgba(26,28,33,var(--mbrw-bg-opacity));color:var(--mbrw-text-color);box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:none;font:13px/1.5 system-ui,-apple-system,sans-serif';

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

    var nameEl = doc.createElement('div');
    nameEl.textContent = card.n;
    nameEl.style.cssText = 'color:var(--mbrw-name-color);font-size:' + (settings.fontSize + 2) + 'px;font-weight:700';
    panel.appendChild(nameEl);

    var enEl = doc.createElement('div');
    enEl.textContent = cardNameEn;
    enEl.style.cssText = 'color:var(--mbrw-en-name-color);font-size:' + (settings.fontSize - 3) + 'px;margin-top:1px';
    panel.appendChild(enEl);

    if (card.y) {
      var typeEl = doc.createElement('div');
      typeEl.textContent = card.y;
      typeEl.style.cssText = 'color:var(--mbrw-type-color);font-size:' + (settings.fontSize - 1) + 'px;font-style:italic;font-weight:300;margin-top:3px';
      panel.appendChild(typeEl);
    }

    if (card.t) {
      var textEl = doc.createElement('div');
      textEl.textContent = prefixLines(card.t);
      textEl.style.cssText = 'font-size:var(--mbrw-font-size);font-weight:400;line-height:1.5;margin-top:6px;white-space:pre-wrap';
      panel.appendChild(textEl);
    }

    var srcEl = doc.createElement('div');
    srcEl.textContent = card._src === 'local' ? '📦 本地' : card._src === 'api' ? '🌐 mtgch' : '';
    srcEl.style.cssText = 'color:var(--mbrw-source-color);font-size:9px;margin-top:6px;text-align:right';
    panel.appendChild(srcEl);
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

  function showPanel(anchorEl, card, cardNameEn) {
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

  function hidePanel() {
    stopFollowing();
    panel.style.display = 'none';
    panel.style.visibility = 'hidden';
    currentAnchor = null;
    currentCardName = null;
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

  // --- Unified card display ------------------------------------------------

  function presentCard(anchorEl, cardName) {
    currentSerial++;
    var serial = currentSerial;
    currentAnchor = anchorEl;
    currentCardName = cardName;
    panelOwner = 'dom';
    LOG('Lookup:', cardName);

    lookupCard(cardName).then(function (result) {
      if (!result || currentSerial !== serial) return;
      LOG('Found:', result.n, '(' + (result._src || '?') + ')');
      showPanel(anchorEl, result, cardName);
    }).catch(function (err) {
      WARN('Lookup failed:', err);
    });
  }

  // --- MutationObserver: CardPreview portal --------------------------------

  function startMutationObserver() {
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
    tryShowFromPreview(previewEl, ++currentSerial, 0);
  }

  function tryShowFromPreview(previewEl, serial, attempt) {
    if (currentSerial !== serial) return;

    var cardName = extractCardName(previewEl);
    LOG('tryShow attempt', attempt, 'cardName:', cardName || '(none)');

    if (!cardName && attempt < 5) {
      setTimeout(function () { tryShowFromPreview(previewEl, serial, attempt + 1); }, 50);
      return;
    }
    if (!cardName || cardName === 'Face-down card') { LOG('No valid card name, skipping'); return; }

    presentCard(previewEl, cardName);
  }

  function extractCardName(previewEl) {
    // The preview stack renders several <img>s (low-res then high-res); the
    // first may have empty alt. Prefer the img whose alt is a real card name.
    var imgs = previewEl.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var a = imgs[i].getAttribute('alt') || '';
      a = a.trim();
      if (a && a !== 'Face-down card') return a;
    }
    return '';
  }

  var hideTimer = null;

  function onPreviewRemoved() {
    LOG('Preview removed');
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
      if (!cardName || cardName === 'Face-down card') return;
      presentCard(img, cardName);
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
  // portal, but manabrew still tracks them in React state: the useCardPreview
  // machine snapshot holds hand cards (zoneId "hand", skipped by Game.tsx's
  // render) and useStackUIStore holds the hovered stack object id. We read those
  // by walking the React fiber tree. Best-effort: if the fiber layout changes in
  // a future build these two tooltips silently stop while the DOM paths keep
  // working.

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
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
        return el[k];
      }
    }
    return null;
  }

  function getFiberRoot() {
    var rootEl = document.querySelector('#root');
    if (!rootEl || !rootEl.firstElementChild) rootEl = document.body;
    var f = getFiberFromNode(rootEl) || getFiberFromNode(rootEl.firstElementChild);
    var guard = 0;
    while (f && f.return && guard++ < 2000) f = f.return;
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

  function isPreviewSnapshot(v) {
    return !!v && typeof v === 'object' && typeof v.phase === 'string' &&
      'card' in v && !!v.mousePos && typeof v.mousePos.x === 'number' &&
      'anchorRect' in v && 'placement' in v;
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

  // Single walk: find a hovered hand card (preview snapshot) or a hovered stack
  // object id (a hook string matching gameView.stack ids), whichever comes first.
  function scanFiberHover(gameView) {
    var ids = null;
    if (gameView && Array.isArray(gameView.stack) && gameView.stack.length) {
      ids = new Set();
      for (var i = 0; i < gameView.stack.length; i++) {
        if (gameView.stack[i] && gameView.stack[i].id) ids.add(gameView.stack[i].id);
      }
    }
    var root = getFiberRoot();
    if (!root) return null;
    var result = null;
    walkFibers(root, function (f) {
      var h = f.memoizedState, d = 0;
      while (h && d < 80) {
        var c = hookCandidates(h);
        for (var j = 0; j < c.length; j++) {
          var v = c[j];
          if (isPreviewSnapshot(v) && v.card && v.card.zoneId === 'hand') {
            result = { hand: v };
            return true;
          }
          if (ids && typeof v === 'string' && ids.has(v)) {
            result = { stackId: v };
            return true;
          }
        }
        h = h.next; d++;
      }
      return false;
    });
    return result;
  }

  function rectFromPoint(x, y) {
    return { left: x, top: y, width: 1, height: 1 };
  }

  function presentFiberCard(cardName, rect) {
    currentSerial++;
    var serial = currentSerial;
    currentAnchor = rect;
    currentCardName = cardName;
    panelOwner = 'fiber';
    clearTimeout(hideTimer);
    LOG('Lookup [fiber]:', cardName);
    lookupCard(cardName).then(function (result) {
      if (!result || currentSerial !== serial) return;
      LOG('Found:', result.n, '(' + (result._src || '?') + ')', '[fiber]');
      showPanel(rect, result, cardName);
    }).catch(function (err) {
      WARN('Fiber lookup failed:', err);
    });
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
        var hrect = scan.hand.anchorRect || rectFromPoint(scan.hand.mousePos.x, scan.hand.mousePos.y);
        if (panelOwner === 'fiber' && currentCardName === hname && currentAnchor) currentAnchor = hrect;
        else presentFiberCard(hname, hrect);
        return true;
      }

      if (scan && scan.stackId && gv && Array.isArray(gv.stack)) {
        for (var i = 0; i < gv.stack.length; i++) {
          var o = gv.stack[i];
          if (o && o.id === scan.stackId && o.identity && o.identity.name) {
            var sname = o.identity.name;
            var srect = rectFromPoint(lastMouse.x, lastMouse.y);
            if (panelOwner === 'fiber' && currentCardName === sname && currentAnchor) currentAnchor = srect;
            else presentFiberCard(sname, srect);
            return true;
          }
        }
      }

      if (panelOwner === 'fiber') hidePanel();
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
    settingsOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    settingsOverlay.addEventListener('click', function (e) { if (e.target === settingsOverlay) closeSettings(); });

    var box = doc.createElement('div');
    box.style.cssText = 'background:#1e1f24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:340px;width:90%;color:#d4d4d8;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5)';

    box.innerHTML = [
      '<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:#ffad42;">⚙ Manabrew CN 设置</div>',
      '<div id="mbrw-cn-preview-box" style="padding:8px 10px;margin-bottom:14px;border-radius:6px;',
      'background:rgba(26,28,33,' + settings.bgOpacity + ');border:1px solid rgba(255,255,255,0.18);',
      'font-size:' + settings.fontSize + 'px;">',
      '<div style="color:#ffad42;font-size:' + (settings.fontSize + 2) + 'px;font-weight:700;">中文卡名</div>',
      '<div style="color:#71717a;font-size:' + (settings.fontSize - 3) + 'px;">English Card Name</div>',
      '<div style="color:#a1a1aa;font-size:' + (settings.fontSize - 1) + 'px;font-style:italic;">生物 ～人类</div>',
      '<div style="margin-top:4px;">· 示例效果文本。</div>',
      '</div>',
      '<label style="display:block;margin-bottom:10px;">',
      '<span>背景透明度: <span id="mbrw-cn-opacity-val">' + Math.round(settings.bgOpacity * 100) + '</span>%</span>',
      '<input type="range" id="mbrw-cn-opacity" min="20" max="100" value="' + Math.round(settings.bgOpacity * 100) + '" style="width:100%;margin-top:2px;">',
      '</label>',
      '<label style="display:block;margin-bottom:14px;">',
      '<span>字体大小: <span id="mbrw-cn-fontsize-val">' + settings.fontSize + '</span>px</span>',
      '<input type="range" id="mbrw-cn-fontsize" min="10" max="20" value="' + settings.fontSize + '" style="width:100%;margin-top:2px;">',
      '</label>',
      '<div style="margin-bottom:14px;">',
      '<span style="margin-right:8px;">面板模式:</span>',
      '<button id="mbrw-cn-mode-follow" style="margin-right:4px;padding:4px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);',
      'background:' + (settings.panelMode === 'follow' ? '#3a3d45' : 'transparent') + ';color:#d4d4d8;cursor:pointer;">跟随</button>',
      '<button id="mbrw-cn-mode-fixed" style="padding:4px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);',
      'background:' + (settings.panelMode === 'fixed' ? '#3a3d45' : 'transparent') + ';color:#d4d4d8;cursor:pointer;">固定</button>',
      '</div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end;">',
      '<button id="mbrw-cn-reset" style="padding:6px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#a1a1aa;cursor:pointer;">默认</button>',
      '<button id="mbrw-cn-cancel" style="padding:6px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#d4d4d8;cursor:pointer;">取消</button>',
      '<button id="mbrw-cn-save" style="padding:6px 16px;border-radius:4px;border:none;background:#ffad42;color:#1a1c21;font-weight:600;cursor:pointer;">保存</button>',
      '</div>',
    ].join('\n');

    settingsOverlay.appendChild(box);
    doc.body.appendChild(settingsOverlay);

    var opacitySlider = doc.getElementById('mbrw-cn-opacity');
    var opacityVal = doc.getElementById('mbrw-cn-opacity-val');
    var fontSizeSlider = doc.getElementById('mbrw-cn-fontsize');
    var fontSizeVal = doc.getElementById('mbrw-cn-fontsize-val');
    var previewBox = doc.getElementById('mbrw-cn-preview-box');

    function updatePreview() {
      var op = parseInt(opacitySlider.value, 10) / 100;
      var fs = parseInt(fontSizeSlider.value, 10);
      opacityVal.textContent = Math.round(op * 100);
      fontSizeVal.textContent = fs;
      previewBox.style.background = 'rgba(26,28,33,' + op + ')';
      previewBox.style.fontSize = fs + 'px';
    }

    opacitySlider.addEventListener('input', updatePreview);
    fontSizeSlider.addEventListener('input', updatePreview);

    doc.getElementById('mbrw-cn-mode-follow').addEventListener('click', function () {
      doc.getElementById('mbrw-cn-mode-follow').style.background = '#3a3d45';
      doc.getElementById('mbrw-cn-mode-fixed').style.background = 'transparent';
    });
    doc.getElementById('mbrw-cn-mode-fixed').addEventListener('click', function () {
      doc.getElementById('mbrw-cn-mode-fixed').style.background = '#3a3d45';
      doc.getElementById('mbrw-cn-mode-follow').style.background = 'transparent';
    });

    doc.getElementById('mbrw-cn-reset').addEventListener('click', function () {
      resetSettings();
      applyPanelMode();
      closeSettings();
    });
    doc.getElementById('mbrw-cn-cancel').addEventListener('click', closeSettings);
    doc.getElementById('mbrw-cn-save').addEventListener('click', function () {
      var followBtn = doc.getElementById('mbrw-cn-mode-follow');
      settings.bgOpacity = parseInt(opacitySlider.value, 10) / 100;
      settings.fontSize = parseInt(fontSizeSlider.value, 10);
      settings.panelMode = followBtn.style.background === 'transparent' ? 'fixed' : 'follow';
      saveSettings();
      applyPanelMode();
      updateMenuToggles();
      closeSettings();
    });

    doc.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeSettings(); doc.removeEventListener('keydown', onEsc); }
    });
  }

  function closeSettings() {
    if (settingsOverlay) { settingsOverlay.remove(); settingsOverlay = null; }
  }

  // --- GM menu commands ----------------------------------------------------

  function updateMenuToggles() {
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(
          (settings.panelMode === 'fixed' ? '☑' : '☐') + ' 固定浮窗',
          function () {
            settings.panelMode = settings.panelMode === 'fixed' ? 'follow' : 'fixed';
            saveSettings();
            applyPanelMode();
            updateMenuToggles();
          },
          'mbrw-cn-menu-pin'
        );
        GM_registerMenuCommand('⚙ 样式设置', openSettings, 'mbrw-cn-menu-style');
      }
    } catch (_) {}
  }

  // --- Init ---------------------------------------------------------------

  function init() {
    loadSettings();
    loadApiCache();
    ensureStyleTag();
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
    LOG('v0.3.0 ready — MutationObserver + pointerover + fiber scan');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
