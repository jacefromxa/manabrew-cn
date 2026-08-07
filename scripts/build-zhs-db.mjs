import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const DATA_DIR = path.join(ROOT, "data");

// --- Data sources (data/ is gitignored; see README for how to refresh) -----
//   A. magic-cards-zhs-oracle.json — community MTGZH translations (names +
//      full rules text + type) for ~34.5k oracle faces. This is the same source
//      mtgch.com serves; baking it in removes almost all runtime API lookups.
//      Pulled from the HeliumOctahelide/magic-cards-zhs release tarball
//      (zhs_oracle.json). Newlines are double-escaped (see unescapeZhsText).
//   B. magic-cards-zhs-names.json — community zh names, widest name coverage
//      (36,484). Kept as the base name map.
//   C. AtomicCards.json.gz — MTGJSON. Supplies mana cost / power / toughness /
//      loyalty / defense, plus official WotC Chinese text as a fallback for
//      the handful of faces oracle.json has no text for.
//   D. scryfall-tokens.json — Scryfall token cards (scripts/fetch-tokens.mjs).
//      AtomicCards excludes tokens, so without this the local DB has token
//      names + text but no P/T. Tiny (~600 names) and build-time only.
const ORACLE_PATH = path.join(DATA_DIR, "magic-cards-zhs-oracle.json");
const NAMES_PATH = path.join(DATA_DIR, "magic-cards-zhs-names.json");
const ATOMIC_PATH = path.join(DATA_DIR, "AtomicCards.json.gz");
const TOKENS_PATH = path.join(DATA_DIR, "scryfall-tokens.json");
const OUT_PATH = path.join(DIST_DIR, "en2zhs.json.gz");

// magic-cards-zhs double-escapes line breaks: the JSON carries the two
// characters backslash backslash before 'n', meaning the source generator
// stringified the text twice. Undo that to get real newlines.
function unescapeZhsText(text) {
  if (!text) return text;
  return text.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
}

function score(entry) {
  return (entry.zhName ? 1 : 0) + (entry.zhText ? 2 : 0);
}

// A: zhs_oracle.json — JSONL, one face per line.
function loadOracle() {
  const raw = readFileSync(ORACLE_PATH, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const map = new Map();
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const key = String(o.name || "").toLowerCase().trim();
    if (!key) continue;
    // An empty English oracle_text means the card genuinely has no rules text
    // (vanilla creatures, basic lands) — no runtime API upgrade can help. Cards
    // with oracle text that simply aren't translated yet still get upgraded.
    const noText = !o.oracle_text;
    const entry = {
      zhName: o.translated_name || undefined,
      zhText: noText ? undefined : unescapeZhsText(o.translated_text) || undefined,
      zhType: o.translated_type || undefined,
      noText,
    };
    const prev = map.get(key);
    if (!prev || score(entry) > score(prev)) map.set(key, entry);
  }
  console.log(`[oracle] ${map.size} unique names loaded`);
  return map;
}

// B: magic-cards-zhs-names.json — { source, release, names: {en: zh} }
async function loadNames() {
  const raw = await readFile(NAMES_PATH, "utf-8");
  const data = JSON.parse(raw);
  const names = data.names ?? {};
  console.log(`[names] ${Object.keys(names).length} entries (source: ${data.source}, release: ${data.release})`);
  return { names, release: data.release };
}

// C: MTGJSON AtomicCards — per-face printings carry cost / P/T / loyalty /
//    defense and (sometimes) official Chinese text.
async function loadAtomic() {
  const { gunzip } = await import("node:zlib");
  const { promisify } = await import("node:util");
  const gunzipAsync = promisify(gunzip);

  const compressed = await readFile(ATOMIC_PATH);
  const data = JSON.parse((await gunzipAsync(compressed)).toString("utf-8"));
  const cards = data.data ?? {};

  const faces = new Map();
  for (const [key, printings] of Object.entries(cards)) {
    if (!Array.isArray(printings)) continue;
    for (const printing of printings) {
      const faceName = printing.faceName || printing.name;
      const lower = String(faceName || "").toLowerCase().trim();
      if (!lower) continue;
      const zh = (printing.foreignData || []).find((f) => f.language === "Chinese Simplified");
      const entry = {
        zhName: (zh && zh.name) || undefined,
        zhText: (zh && zh.text) || undefined,
        zhType: (zh && zh.type) || undefined,
        c: printing.manaCost || undefined,
        p: printing.power || undefined,
        q: printing.toughness || undefined,
        l: printing.loyalty || undefined,
        d: printing.defense || undefined,
      };
      const prev = faces.get(lower);
      if (!prev || score(entry) > score(prev)) {
        faces.set(lower, entry);
      } else {
        // Keep the higher-scoring entry but fill any fields the weak one has.
        if (!prev.c && entry.c) prev.c = entry.c;
        if (!prev.p && entry.p) prev.p = entry.p;
        if (!prev.q && entry.q) prev.q = entry.q;
        if (!prev.l && entry.l) prev.l = entry.l;
        if (!prev.d && entry.d) prev.d = entry.d;
      }
    }
  }
  console.log(`[atomic] ${faces.size} faces indexed`);
  return faces;
}

function copyStats(at, entry) {
  if (at) {
    if (at.c) entry.c = at.c;
    if (at.p) entry.p = at.p;
    if (at.q) entry.q = at.q;
    if (at.l) entry.l = at.l;
    if (at.d) entry.d = at.d;
  }
}

// D: scryfall-tokens.json — { source, count, cards: { name: {c,p,q,l,d} } }
function loadTokens() {
  try {
    const raw = readFileSync(TOKENS_PATH, "utf-8");
    const data = JSON.parse(raw);
    const tokens = data.cards ?? {};
    console.log(`[tokens] ${Object.keys(tokens).length} token names loaded`);
    return tokens;
  } catch (_) {
    console.log("[tokens] scryfall-tokens.json missing — token P/T skipped");
    return {};
  }
}

function merge(names, release, oracle, atomic, tokens) {
  let withText = 0;
  let nameOnly = 0;
  const merged = {};

  for (const [enName, zhName] of Object.entries(names)) {
    const key = enName.toLowerCase();
    const or = oracle.get(key);
    const at = atomic.get(key);
    const entry = { n: zhName };

    if (or && or.zhText) {
      entry.t = or.zhText;
      withText++;
    } else if (at && at.zhText) {
      entry.t = at.zhText;
      withText++;
    } else {
      nameOnly++;
      if (or && or.noText) entry.o = 1; // genuinely textless (vanilla) — no API upgrade
    }

    if (or && or.zhType) entry.y = or.zhType;
    else if (at && at.zhType) entry.y = at.zhType;

    copyStats(at, entry);
    merged[key] = entry;
  }

  // Faces present in oracle/atomic but missing from the names map.
  for (const [key, or] of oracle) {
    if (merged[key]) continue;
    const at = atomic.get(key);
    const entry = { n: or.zhName || (at && at.zhName) || key };
    if (or.zhText) {
      entry.t = or.zhText;
      withText++;
    } else if (at && at.zhText) {
      entry.t = at.zhText;
      withText++;
    } else {
      nameOnly++;
      if (or.noText) entry.o = 1;
    }
    if (or.zhType) entry.y = or.zhType;
    else if (at && at.zhType) entry.y = at.zhType;
    copyStats(at, entry);
    merged[key] = entry;
  }

  // MTGJSON-only faces (e.g. some tokens) — name may fall back to English.
  for (const [key, at] of atomic) {
    if (merged[key]) continue;
    const entry = { n: at.zhName || key };
    if (at.zhText) {
      entry.t = at.zhText;
      withText++;
    } else {
      nameOnly++;
    }
    if (at.zhType) entry.y = at.zhType;
    copyStats(at, entry);
    merged[key] = entry;
  }

  // Scryfall token stats — fill in P/T / cost for token names (Soldier, Goblin,
  // Beast, …) that AtomicCards doesn't carry. Only ever adds missing fields; a
  // name that is also a real card keeps its AtomicCards data.
  let tokenEnriched = 0;
  for (const [key, tk] of Object.entries(tokens || {})) {
    const e = merged[key];
    if (!e) continue;
    let changed = false;
    if (!e.c && tk.c) { e.c = tk.c; changed = true; }
    if (e.p == null && tk.p != null) { e.p = tk.p; changed = true; }
    if (e.q == null && tk.q != null) { e.q = tk.q; changed = true; }
    if (e.l == null && tk.l != null) { e.l = tk.l; changed = true; }
    if (e.d == null && tk.d != null) { e.d = tk.d; changed = true; }
    if (changed) tokenEnriched++;
  }
  console.log(`[tokens] enriched ${tokenEnriched} DB entries with token stats`);

  return {
    _meta: {
      source: "HeliumOctahelide/magic-cards-zhs (oracle ⊕ names) ⊕ MTGJSON AtomicCards",
      release,
      total: Object.keys(merged).length,
    },
    cards: merged,
    stats: { withText, nameOnly },
  };
}

async function main() {
  await mkdir(DIST_DIR, { recursive: true });

  console.log("Building zh database (v2 — oracle ⊕ names ⊕ atomic ⊕ tokens)…\n");
  const [{ names, release }, oracle, atomic] = await Promise.all([
    loadNames(),
    Promise.resolve(loadOracle()),
    loadAtomic(),
  ]);
  const tokens = loadTokens();

  const db = merge(names, release, oracle, atomic, tokens);
  console.log(
    `[merge] ${Object.keys(db.cards).length} entries: ` +
      `${db.stats.withText} with text, ${db.stats.nameOnly} name-only`
  );

  // Sanity check a few name-only cards from v1 that should now have text.
  for (const probe of ["black lotus", "savannah lions", "tarmogoyf", "delver of secrets", "insectile aberration", "soldier", "goblin", "treasure"]) {
    const e = db.cards[probe];
    console.log(`  ${probe.padEnd(22)} ${e ? (e.t ? "TEXT " + e.n : "name-only " + e.n) : "MISSING"}${e && e.c ? " | cost " + e.c : ""}${e && e.p != null ? " | " + e.p + "/" + e.q : ""}`);
  }
  // Verify newline unescaping on a multi-paragraph card.
  const rs = db.cards["rocksteady, mutant marauder"];
  if (rs && rs.t) {
    console.log("  newline check:", JSON.stringify(rs.t.slice(rs.t.indexOf("牌库"), rs.t.indexOf("牌库") + 26)));
  }

  const json = JSON.stringify(db);
  console.log(`[write] JSON ${(json.length / 1024 / 1024).toFixed(2)} MB`);

  const rawPath = path.join(DIST_DIR, "en2zhs.json");
  await writeFile(rawPath, json);
  await pipeline(
    createReadStream(rawPath),
    createGzip({ level: 9 }),
    createWriteStream(OUT_PATH),
  );
  const { stat } = await import("node:fs/promises");
  const gzStat = await stat(OUT_PATH);
  console.log(`[write] Gzipped: ${(gzStat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nDone → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
