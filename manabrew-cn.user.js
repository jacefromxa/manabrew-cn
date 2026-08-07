// ==UserScript==
// @name         Manabrew 简体中文卡牌浮窗
// @name:zh-CN   Manabrew 简体中文卡牌浮窗
// @name:en      Manabrew Simplified Chinese Card Tooltip
// @namespace    https://play.manabrew.app/
// @version      0.2.0
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
  var DATA_BASE = 'https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/dist';
  var API_CACHE_PREFIX = 'mbrw-api-';

  // --- Settings -----------------------------------------------------------

  var SETTINGS_DEFAULTS = {
    bgOpacity: 0.94,
    fontSize: 13,
    panelMode: 'follow',   // 'follow' | 'fixed'
    panelPosition: null,   // { left, top }
  };

  var settings = Object.assign({}, SETTINGS_DEFAULTS);

  function loadSettings() {
    try {
      if (typeof GM_getValue === 'function') {
        var raw = GM_getValue('mbrw-cn-settings', null);
        if (raw) {
          var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          Object.assign(settings, parsed);
        }
      }
    } catch (_) { /* ignore */ }
  }

  function saveSettings() {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue('mbrw-cn-settings', JSON.stringify(settings));
      }
    } catch (_) { /* ignore */ }
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
    styleTag.textContent = [
      ':root {',
      '--mbrw-bg-opacity: ' + settings.bgOpacity + ';',
      '--mbrw-border: rgba(255,255,255,0.18);',
      '--mbrw-text-color: #d4d4d8;',
      '--mbrw-name-color: #ffad42;',
      '--mbrw-type-color: #a1a1aa;',
      '--mbrw-en-name-color: #71717a;',
      '--mbrw-source-color: #52525b;',
      '--mbrw-font-size: ' + settings.fontSize + 'px;',
      '}',
      '#mbrw-cn-panel::-webkit-scrollbar { width: 4px; }',
      '#mbrw-cn-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }',
    ].join('\n');
  }

  // --- Local database loader -----------------------------------------------

  var zhDB = null;
  var dbLoadPromise = null;

  function openIndexedDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('manabrew-cn', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('data'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function loadDBFromIndexedDB(idb) {
    return new Promise(function (resolve) {
      var tx = idb.transaction('data', 'readonly');
      var getVer = tx.objectStore('data').get('version');
      var getData = tx.objectStore('data').get('zhdb');
      tx.oncomplete = function () {
        resolve(getData.result && getVer.result
          ? { version: getVer.result, data: getData.result }
          : null);
      };
    });
  }

  function saveDBToIndexedDB(idb, version, data) {
    return new Promise(function (resolve) {
      var tx = idb.transaction('data', 'readwrite');
      tx.objectStore('data').put(version, 'version');
      tx.objectStore('data').put(data, 'zhdb');
      tx.oncomplete = function () { resolve(); };
    });
  }

  function dbFromArray(raw) {
    var m = new Map();
    for (var i = 0; i < raw.length; i++) m.set(raw[i][0], raw[i][1]);
    return m;
  }

  function dbToArray(db) {
    return Array.from(db.entries());
  }

  function decompressAndParse(stream, version, idb) {
    var ds = new DecompressionStream('gzip');
    return new Response(stream.pipeThrough(ds)).text().then(function (json) {
      var parsed = JSON.parse(json);
      var cards = parsed.cards || {};
      zhDB = new Map(Object.entries(cards));
      console.log('[manabrew-cn] DB loaded (' + zhDB.size + ' cards)');
      return saveDBToIndexedDB(idb, version, dbToArray(zhDB));
    });
  }

  function fetchAndLoadDB() {
    if (dbLoadPromise) return dbLoadPromise;

    var DB_PATH;
    try {
      DB_PATH = (localStorage.getItem('mbrw-cn-data-url') || '').trim() || (DATA_BASE + '/en2zhs.json.gz');
    } catch (_) {
      DB_PATH = DATA_BASE + '/en2zhs.json.gz';
    }

    dbLoadPromise = openIndexedDB().then(function (idb) {
      return loadDBFromIndexedDB(idb).then(function (cached) {
        return fetch(DB_PATH, { cache: 'no-cache' })
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var etag = resp.headers.get('etag') || 'live';
            if (cached && cached.version === etag) {
              zhDB = dbFromArray(cached.data);
              console.log('[manabrew-cn] DB from cache (' + zhDB.size + ' cards)');
              return;
            }
            var body = resp.body;
            if (!body) {
              return resp.arrayBuffer().then(function (buf) {
                return decompressAndParse(new Blob([buf]).stream(), etag, idb);
              });
            }
            return decompressAndParse(body, etag, idb);
          })
          .catch(function () {
            if (cached) {
              zhDB = dbFromArray(cached.data);
              console.warn('[manabrew-cn] Network fail, cached DB (' + zhDB.size + ' cards)');
              return;
            }
            throw new Error('No local DB available');
          });
      });
    });
    return dbLoadPromise;
  }

  function loadDB() {
    return dbLoadPromise || fetchAndLoadDB();
  }

  // --- mtgch API fallback -------------------------------------------------

  var apiCache = new Map();
  var apiQueue = new Map();
  var API_CACHE_MAX = 500;

  function loadApiCache() {
    try {
      var raw = localStorage.getItem(API_CACHE_PREFIX + 'cache');
      if (raw) {
        JSON.parse(raw).forEach(function (e) { apiCache.set(e[0], e[1]); });
      }
    } catch (_) { /* ignore */ }
  }

  function persistApiCache() {
    try {
      var entries = Array.from(apiCache.entries()).slice(-API_CACHE_MAX);
      localStorage.setItem(API_CACHE_PREFIX + 'cache', JSON.stringify(entries));
    } catch (_) { /* ignore */ }
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
              return {
                n: zhName || name,
                t: item.zhs_text || undefined,
                y: item.zhs_type_line || undefined,
                _src: 'api',
              };
            });
        })
        .then(function (r) {
          apiCache.set(key, r);
          if (apiCache.size > API_CACHE_MAX) apiCache.delete(apiCache.keys().next().value);
          persistApiCache();
          return r;
        })
        .catch(function () {
          return { n: name, _src: 'miss' };
        })
        .then(function (r) { apiQueue.delete(key); return r; });
    });

    apiQueue.set(key, pending);
    return pending;
  }

  // --- Core lookup --------------------------------------------------------

  function lookupCard(cardName) {
    if (!cardName) return Promise.resolve(null);
    var key = cardName.trim().toLowerCase();
    if (!key || key === 'face-down card') return Promise.resolve(null);

    var cached = apiCache.get(key);
    if (cached) return Promise.resolve(cached);

    return loadDB().then(function () {
      if (zhDB) {
        var local = zhDB.get(key);
        if (local) {
          var r = { n: local.n, _src: 'local' };
          if (local.t) r.t = local.t;
          if (local.y) r.y = local.y;
          return r;
        }
      }
      return queryMtgch(cardName.trim());
    });
  }

  // --- Panel creation ------------------------------------------------------

  var panel = null;
  var dragHandle = null;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'mbrw-cn-panel';
    panel.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'z-index:2147483647',
      'display:none', 'visibility:hidden',
      'max-width:320px', 'max-height:50vh', 'overflow:auto',
      'padding:9px 11px',
      'border:1px solid var(--mbrw-border)',
      'border-radius:6px',
      'background:rgba(26,28,33,var(--mbrw-bg-opacity))',
      'color:var(--mbrw-text-color)',
      'box-shadow:0 4px 18px rgba(0,0,0,.45)',
      'pointer-events:none',
      'font:13px/1.5 system-ui,-apple-system,sans-serif',
    ].join(';');

    dragHandle = document.createElement('div');
    dragHandle.textContent = '⠯ ⠯ ⠯';
    dragHandle.style.cssText = [
      'display:none', 'height:20px', 'cursor:grab',
      'margin:-9px -11px 6px -11px',
      'border-radius:6px 6px 0 0',
      'background:rgba(255,255,255,0.06)',
      'color:rgba(255,255,255,0.45)',
      'text-align:center', 'font-size:11px', 'line-height:20px',
      'letter-spacing:4px', 'user-select:none',
      '-webkit-user-select:none',
    ].join(';');
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

  panel && panel.addEventListener('mousedown', function (e) {
    if (settings.panelMode !== 'fixed' || e.target !== dragHandle || e.button !== 0) return;
    e.preventDefault();
    dragHandle.style.cursor = 'grabbing';
    dragState = {
      sX: e.clientX, sY: e.clientY,
      pL: panel.offsetLeft, pT: panel.offsetTop,
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  });

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
    settings.panelPosition = {
      left: parseInt(panel.style.left, 10) || 0,
      top: parseInt(panel.style.top, 10) || 0,
    };
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
    nameEl.style.cssText = [
      'color:var(--mbrw-name-color)',
      'font-size:' + (settings.fontSize + 2) + 'px',
      'font-weight:700',
    ].join(';');
    panel.appendChild(nameEl);

    var enEl = doc.createElement('div');
    enEl.textContent = cardNameEn;
    enEl.style.cssText = [
      'color:var(--mbrw-en-name-color)',
      'font-size:' + (settings.fontSize - 3) + 'px',
      'margin-top:1px',
    ].join(';');
    panel.appendChild(enEl);

    if (card.y) {
      var typeEl = doc.createElement('div');
      typeEl.textContent = card.y;
      typeEl.style.cssText = [
        'color:var(--mbrw-type-color)',
        'font-size:' + (settings.fontSize - 1) + 'px',
        'font-style:italic', 'font-weight:300', 'margin-top:3px',
      ].join(';');
      panel.appendChild(typeEl);
    }

    if (card.t) {
      var textEl = doc.createElement('div');
      textEl.textContent = prefixLines(card.t);
      textEl.style.cssText = [
        'font-size:var(--mbrw-font-size)', 'font-weight:400',
        'line-height:1.5', 'margin-top:6px', 'white-space:pre-wrap',
      ].join(';');
      panel.appendChild(textEl);
    }

    var srcEl = doc.createElement('div');
    srcEl.textContent = card._src === 'local' ? '📦 MTGJSON'
      : card._src === 'api' ? '🌐 mtgch' : '';
    srcEl.style.cssText = [
      'color:var(--mbrw-source-color)', 'font-size:9px',
      'margin-top:6px', 'text-align:right',
    ].join(';');
    panel.appendChild(srcEl);
  }

  function clearPanel() {
    while (panel.lastChild) {
      if (panel.lastChild === dragHandle) break;
      panel.removeChild(panel.lastChild);
    }
  }

  // --- Card hover state ----------------------------------------------------

  var currentAnchor = null;     // the DOM element we anchor to
  var currentCardName = null;   // english card name currently shown
  var currentSerial = 0;        // increment to cancel stale promises

  function showPanel(anchorEl, card, cardNameEn) {
    renderPanel(card, cardNameEn);
    panel.style.display = 'block';
    panel.style.visibility = 'hidden';
    if (settings.panelMode !== 'fixed') positionPanel(anchorEl);
    panel.style.visibility = 'visible';
    if (settings.panelMode === 'follow') startFollowing();
  }

  function hidePanel() {
    stopFollowing();
    panel.style.display = 'none';
    panel.style.visibility = 'hidden';
    currentAnchor = null;
    currentCardName = null;
  }

  function positionPanel(anchorEl) {
    if (typeof anchorEl.getBoundingClientRect !== 'function') return;
    var r = anchorEl.getBoundingClientRect();
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
    return typeof root.requestAnimationFrame === 'function'
      ? root.requestAnimationFrame(fn) : setTimeout(fn, 16);
  }

  function cancelTick(id) {
    if (id == null) return;
    if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  function startFollowing() {
    stopFollowing();
    (function tick() {
      if (settings.panelMode === 'fixed' || !currentAnchor || panel.style.display === 'none') {
        stopFollowing(); return;
      }
      repositionPanel();
      followId = scheduleTick(tick);
    })();
  }

  function stopFollowing() {
    if (followId) { cancelTick(followId); followId = null; }
  }

  // --- MutationObserver: CardPreview portal --------------------------------

  function startMutationObserver() {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];

        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue;
          var preview = null;
          if (node.matches && node.matches('[data-card-preview]')) {
            preview = node;
          } else if (node.querySelector) {
            preview = node.querySelector('[data-card-preview]');
          }
          if (preview) onPreviewAdded(preview);
        }

        for (var k = 0; k < m.removedNodes.length; k++) {
          var rm = m.removedNodes[k];
          if (rm.nodeType !== 1) continue;
          var lost = null;
          if (rm.matches && rm.matches('[data-card-preview]')) {
            lost = rm;
          } else if (rm.querySelector) {
            lost = rm.querySelector('[data-card-preview]');
          }
          if (lost) onPreviewRemoved();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function onPreviewAdded(previewEl) {
    currentSerial++;
    var serial = currentSerial;
    currentAnchor = previewEl;

    // No delay — React already committed the DOM with alt text.
    // But PreviewImageStack may swap images; try immediately, retry once.
    tryShowFromPreview(previewEl, serial, 0);
  }

  function tryShowFromPreview(previewEl, serial, attempt) {
    if (currentSerial !== serial) return; // stale

    var img = previewEl.querySelector('img');
    var cardName = img && img.alt ? img.alt.trim() : '';
    if (!cardName && attempt < 3) {
      // Image may not be rendered yet by PreviewImageStack
      setTimeout(function () { tryShowFromPreview(previewEl, serial, attempt + 1); }, 80);
      return;
    }
    if (!cardName || cardName === 'Face-down card') return;
    currentCardName = cardName;

    lookupCard(cardName).then(function (result) {
      if (!result || currentSerial !== serial) return;
      showPanel(previewEl, result, cardName);
    });
  }

  function onPreviewRemoved() {
    hidePanel();
  }

  // --- Pointerover: DOM-rendered cards (deck editor, zone viewer, etc.) ----

  var hoverTimer = null;
  var HOVER_DELAY_MS = 120;

  function findDOMCardAnchor(target) {
    // Walk up from the hover target looking for an element that contains
    // a card-suggesting <img> (Scryfall image with alt text).
    var el = target;
    for (var depth = 0; depth < 8 && el && el !== document.body; depth++) {
      if (el.querySelector) {
        var img = el.querySelector('img');
        if (img && img.alt && img.alt !== 'Face-down card') {
          // Check if this looks like a card image (scryfall URL)
          if (img.src && img.src.indexOf('scryfall') !== -1) return img;
          // Or: a card container by class
          if (el.className && typeof el.className === 'string' &&
              (el.className.indexOf('rounded-lg') !== -1 || el.className.indexOf('bg-card') !== -1)) {
            return img;
          }
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function onPointerOver(e) {
    if (panel.style.display !== 'none' && currentAnchor &&
        currentAnchor.contains && currentAnchor.contains(e.target)) {
      return; // already showing for this card
    }

    var img = findDOMCardAnchor(e.target);
    if (!img) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      currentSerial++;
      var serial = currentSerial;
      currentAnchor = img;
      var cardName = img.alt.trim();
      if (!cardName || cardName === 'Face-down card') return;
      currentCardName = cardName;

      lookupCard(cardName).then(function (result) {
        if (!result || currentSerial !== serial) return;
        showPanel(img, result, cardName);
      });
    }, HOVER_DELAY_MS);
  }

  function onPointerLeave(e) {
    clearTimeout(hoverTimer);
    // If the cursor moved to the tooltip panel and panel is not interactive,
    // or left the card entirely, hide.
    if (!currentAnchor) return;
    // Don't hide if panel is fixed mode
    if (settings.panelMode === 'fixed') return;
    // Don't hide if mouse is now over panel
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    hidePanel();
  }

  // --- Settings dialog ----------------------------------------------------

  var settingsOverlay = null;

  function openSettings() {
    if (settingsOverlay) closeSettings();
    var doc = document;

    settingsOverlay = doc.createElement('div');
    settingsOverlay.id = 'mbrw-cn-settings-overlay';
    settingsOverlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    settingsOverlay.addEventListener('click', function (e) {
      if (e.target === settingsOverlay) closeSettings();
    });

    var box = doc.createElement('div');
    box.style.cssText = [
      'background:#1e1f24', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px', 'padding:20px 24px', 'max-width:340px', 'width:90%',
      'color:#d4d4d8', 'font:13px/1.5 system-ui,sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)',
    ].join(';');

    box.innerHTML = [
      '<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:#ffad42;">⚙ Manabrew CN 设置</div>',

      // Preview box
      '<div id="mbrw-cn-preview-box" style="padding:8px 10px;margin-bottom:14px;border-radius:6px;',
      'background:rgba(26,28,33,' + settings.bgOpacity + ');border:1px solid rgba(255,255,255,0.18);',
      'font-size:' + settings.fontSize + 'px;">',
      '<div style="color:#ffad42;font-size:' + (settings.fontSize + 2) + 'px;font-weight:700;">中文卡名</div>',
      '<div style="color:#71717a;font-size:' + (settings.fontSize - 3) + 'px;">English Card Name</div>',
      '<div style="color:#a1a1aa;font-size:' + (settings.fontSize - 1) + 'px;font-style:italic;">生物 ～人类</div>',
      '<div style="margin-top:4px;">· 示例效果文本。</div>',
      '</div>',

      // Opacity
      '<label style="display:block;margin-bottom:10px;">',
      '<span>背景透明度: <span id="mbrw-cn-opacity-val">' + Math.round(settings.bgOpacity * 100) + '</span>%</span>',
      '<input type="range" id="mbrw-cn-opacity" min="20" max="100" value="' + Math.round(settings.bgOpacity * 100) + '" style="width:100%;margin-top:2px;">',
      '</label>',

      // Font size
      '<label style="display:block;margin-bottom:14px;">',
      '<span>字体大小: <span id="mbrw-cn-fontsize-val">' + settings.fontSize + '</span>px</span>',
      '<input type="range" id="mbrw-cn-fontsize" min="10" max="20" value="' + settings.fontSize + '" style="width:100%;margin-top:2px;">',
      '</label>',

      // Panel mode
      '<div style="margin-bottom:14px;">',
      '<span style="margin-right:8px;">面板模式:</span>',
      '<button id="mbrw-cn-mode-follow" style="margin-right:4px;padding:4px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);',
      'background:' + (settings.panelMode === 'follow' ? '#3a3d45' : 'transparent') + ';color:#d4d4d8;cursor:pointer;">跟随</button>',
      '<button id="mbrw-cn-mode-fixed" style="padding:4px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);',
      'background:' + (settings.panelMode === 'fixed' ? '#3a3d45' : 'transparent') + ';color:#d4d4d8;cursor:pointer;">固定</button>',
      '</div>',

      // Buttons
      '<div style="display:flex;gap:8px;justify-content:flex-end;">',
      '<button id="mbrw-cn-reset" style="padding:6px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#a1a1aa;cursor:pointer;">默认</button>',
      '<button id="mbrw-cn-cancel" style="padding:6px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#d4d4d8;cursor:pointer;">取消</button>',
      '<button id="mbrw-cn-save" style="padding:6px 16px;border-radius:4px;border:none;background:#ffad42;color:#1a1c21;font-weight:600;cursor:pointer;">保存</button>',
      '</div>',
    ].join('\n');

    settingsOverlay.appendChild(box);
    doc.body.appendChild(settingsOverlay);

    // Wire up events
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
    if (settingsOverlay) {
      settingsOverlay.remove();
      settingsOverlay = null;
    }
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
        GM_registerMenuCommand(
          '⚙ 样式设置',
          openSettings,
          'mbrw-cn-menu-style'
        );
      }
    } catch (_) { /* ignore */ }
  }

  // --- Init ---------------------------------------------------------------

  function init() {
    loadSettings();
    loadApiCache();
    ensureStyleTag();
    ensurePanel();

    // Drag — bind after panel exists
    panel.addEventListener('mousedown', function (e) {
      if (settings.panelMode !== 'fixed' || e.target !== dragHandle || e.button !== 0) return;
      e.preventDefault();
      dragHandle.style.cursor = 'grabbing';
      dragState = {
        sX: e.clientX, sY: e.clientY,
        pL: panel.offsetLeft, pT: panel.offsetTop,
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragUp);
    });

    startMutationObserver();

    // Pointerover for DOM-rendered cards
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerLeave);

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('resize', repositionPanel);
      root.addEventListener('scroll', repositionPanel, true);
    }

    // Preload DB in background
    loadDB();

    updateMenuToggles();
    console.log('[manabrew-cn] v0.2.0 ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
