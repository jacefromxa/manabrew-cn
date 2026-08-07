import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");

// Resolve data sources directly from mtg-primer-app (adjacent sibling repo)
const PRIMER_ROOT = path.resolve(ROOT, "..", "mtg-primer-app");
const NAMES_PATH = path.join(PRIMER_ROOT, "data", "magic-cards-zhs-names.json");
const ATOMIC_PATH = path.join(PRIMER_ROOT, "data", "mtgjson", "AtomicCards.json.gz");
const OUT_PATH = path.join(DIST_DIR, "en2zhs.json.gz");

async function loadNames() {
  const raw = await readFile(NAMES_PATH, "utf-8");
  const data = JSON.parse(raw);
  const names = data.names ?? {};
  console.log(`[names] Loaded ${Object.keys(names).length} entries (source: ${data.source}, release: ${data.release})`);
  return { names, release: data.release };
}

async function loadAtomicTexts() {
  const { gunzip } = await import("node:zlib");
  const { promisify } = await import("node:util");
  const gunzipAsync = promisify(gunzip);

  const compressed = await readFile(ATOMIC_PATH);
  const decompressed = await gunzipAsync(compressed);
  const data = JSON.parse(decompressed.toString("utf-8"));
  const cards = data.data ?? {};

  // Build lookup: englishName (lowercase) → { zhName, zhText, zhType }
  const texts = new Map();
  let total = 0;
  let withZh = 0;

  for (const [name, printings] of Object.entries(cards)) {
    if (!Array.isArray(printings)) continue;
    total++;
    for (const printing of printings) {
      const fdList = printing.foreignData;
      if (!Array.isArray(fdList)) continue;
      const zh = fdList.find((f) => f.language === "Chinese Simplified");
      if (!zh || !zh.name) continue;
      texts.set(name.toLowerCase(), {
        zhName: zh.name,
        zhText: zh.text || undefined,
        zhType: zh.type || undefined,
      });
      withZh++;
      break; // first printing with zh is enough
    }
  }
  console.log(`[atomic] ${total} unique names, ${withZh} with Chinese foreignData`);
  return texts;
}

function merge(names, release, atomicTexts) {
  let withText = 0;
  let nameOnly = 0;
  const merged = {};

  for (const [enName, zhName] of Object.entries(names)) {
    const key = enName.toLowerCase();
    const atomic = atomicTexts.get(key);
    const entry = { n: zhName };
    if (atomic?.zhText) {
      entry.t = atomic.zhText;
      if (atomic.zhType) entry.y = atomic.zhType;
      withText++;
    } else {
      nameOnly++;
    }
    merged[key] = entry;
  }

  // Also include cards that are in atomicTexts but NOT in names (rare edge case)
  for (const [key, atomic] of atomicTexts) {
    if (!merged[key]) {
      const e = { n: atomic.zhName };
      if (atomic.zhText) e.t = atomic.zhText;
      if (atomic.zhType) e.y = atomic.zhType;
      merged[key] = e;
      nameOnly++;
    }
  }

  return {
    _meta: { source: "HeliumOctahelide/magic-cards-zhs ⊕ MTGJSON foreignData", release, total: Object.keys(merged).length },
    cards: merged,
    stats: { withText, nameOnly },
  };
}

async function main() {
  await mkdir(DIST_DIR, { recursive: true });

  console.log("Building zh database…\n");
  const [{ names, release }, atomicTexts] = await Promise.all([
    loadNames(),
    loadAtomicTexts(),
  ]);

  const db = merge(names, release, atomicTexts);
  console.log(
    `[merge] ${Object.keys(db.cards).length} total entries: ` +
    `${db.stats.withText} with text+type, ${db.stats.nameOnly} name-only`
  );

  // Write compact JSON through gzip
  const json = JSON.stringify(db);
  console.log(`[write] JSON ${(json.length / 1024 / 1024).toFixed(2)} MB`);

  await mkdir(DIST_DIR, { recursive: true });
  // Write uncompressed first for size check
  const rawPath = path.join(DIST_DIR, "en2zhs.json");
  await writeFile(rawPath, json);
  console.log(`[write] Uncompressed: ${(json.length / 1024 / 1024).toFixed(2)} MB`);

  // Gzip compress
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
