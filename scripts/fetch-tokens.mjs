// Fetch all MTG token cards from Scryfall (build-time only — not used at
// runtime) and write a compact { name: { c, p, q, l, d } } map to
// data/scryfall-tokens.json. MTGJSON's AtomicCards excludes tokens, so the
// local DB has token names + text (from the MTGZH oracle) but no P/T — this
// fills that gap so 1/1 Soldier tokens etc. show their stats locally instead of
// falling back to the mtgch API.
//
// Run: node scripts/fetch-tokens.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "scryfall-tokens.json");

const PAGE_SIZE = 175;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function faceOf(card) {
  // DFC tokens (e.g. "Melissa, Deleted // Un-Person") put their fields on faces.
  if (card.card_faces && card.card_faces.length) {
    return card.card_faces[0];
  }
  return card;
}

async function fetchAll() {
  const byName = new Map();
  let page = 1;
  let total = 0;
  for (;;) {
    const url =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent("is:token")}` +
      `&unique=cards&include_extras=true&page=${page}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "manabrew-cn build script (https://github.com/jacefromxa/manabrew-cn)" },
    });
    if (!resp.ok) {
      console.error(`HTTP ${resp.status} — aborting at page ${page}`);
      process.exit(1);
    }
    const data = await resp.json();
    total = data.total_cards;
    const cards = data.data || [];
    for (const card of cards) {
      if (card.layout === "emblem" || card.layout === "vanguard") continue;
      const fc = faceOf(card);
      const key = String(fc.name || card.name || "").toLowerCase().trim();
      if (!key) continue;
      const entry = {
        c: fc.mana_cost || card.mana_cost || undefined,
        p: fc.power ?? card.power ?? undefined,
        q: fc.toughness ?? card.toughness ?? undefined,
        l: fc.loyalty ?? card.loyalty ?? undefined,
        d: fc.defense ?? card.defense ?? undefined,
      };
      const prev = byName.get(key);
      // Prefer the printing that actually has stats (some token variants are
      // textless/statless shells); merge across variants.
      if (!prev) {
        byName.set(key, entry);
      } else {
        if (!prev.c && entry.c) prev.c = entry.c;
        if (prev.p == null && entry.p != null) prev.p = entry.p;
        if (prev.q == null && entry.q != null) prev.q = entry.q;
        if (prev.l == null && entry.l != null) prev.l = entry.l;
        if (prev.d == null && entry.d != null) prev.d = entry.d;
      }
    }
    console.log(`page ${page}: ${cards.length} cards (${total} total, ${byName.size} unique names so far)`);
    if (!data.has_more || page > 60) break;
    page++;
    await sleep(110); // Scryfall throttle
  }
  return byName;
}

const byName = await fetchAll();
const cards = {};
for (const [key, entry] of byName) cards[key] = entry;
await writeFile(OUT_PATH, JSON.stringify({ source: "Scryfall is:token", count: Object.keys(cards).length, cards }, null, 0));
console.log(`\nWrote ${Object.keys(cards).length} token names → ${OUT_PATH}`);

// Sanity
for (const k of ["soldier", "goblin", "treasure", "beast", "elemental", "spirit", "copy"]) {
  const e = cards[k];
  console.log(`  ${k.padEnd(10)} ${e ? `p=${e.p} q=${e.q} c=${e.c || "-"}` : "MISSING"}`);
}
