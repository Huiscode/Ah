// Backfill Item.category (and subCategory where available) for rows the
// importers had to create without metadata ("unknown").
//
// Source: the AHledger tooltip endpoint returns itemClass for up to 100
// items per call; the single-item endpoint additionally returns
// itemSubclass + vendorSell. The tooltip batch is the primary fill (it is
// fast and matches the whole priced universe); any item the batch misses
// falls back to one-by-one lookups.
//
// Run:        npx tsx scripts/backfill-item-categories.ts
// Re-runs:    idempotent — only rows still "unknown" are touched, so it is
//             safe to re-run after new items arrive on either channel.
import { DatabaseSync } from "node:sqlite";

process.loadEnvFile();

const apiBase = process.env.AHL_API_BASE ?? "https://api.ahledger.com";
const market = process.env.AHL_MARKET ?? "forever.pvp.alliance.us";
const BATCH = 100;

const db = new DatabaseSync("prisma/dev.db");

const unknown = db.prepare(
  "SELECT item_id, name FROM Item WHERE category = 'unknown' ORDER BY item_id"
).all() as Array<{ item_id: number; name: string }>;
console.log(`items with category=unknown: ${unknown.length}`);

const update = db.prepare(
  "UPDATE Item SET category = ?, sub_category = ?, updated_at = ? WHERE item_id = ? AND category = 'unknown'"
);

let filled = 0;
let stillUnknown = 0;

async function fillBatch(ids: number[]): Promise<void> {
  const url = `${apiBase}/v1/tooltip/${market}?items=${ids.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tooltip HTTP ${res.status} for ${ids.length} items`);
  const json = (await res.json()) as { items?: Array<{ id: number; itemClass?: string }> };
  const byId = new Map((json.items ?? []).map((it) => [it.id, it]));
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit && typeof hit.itemClass === "string" && hit.itemClass !== "") {
      update.run(hit.itemClass, "unknown", Date.now(), id);
      filled += 1;
    } else {
      stillUnknown += 1;
    }
  }
  // Respect the 300 req/min free limit with a wide margin.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

for (let i = 0; i < unknown.length; i += BATCH) {
  const ids = unknown.slice(i, i + BATCH).map((row) => row.item_id);
  await fillBatch(ids);
  console.log(`batch ${i / BATCH + 1}/${Math.ceil(unknown.length / BATCH)}: filled so far ${filled}`);
}

const remains = db.prepare("SELECT COUNT(*) n FROM Item WHERE category = 'unknown'").get() as { n: number };
console.log(`done: filled ${filled}, batch-missed ${stillUnknown}, still unknown total ${remains.n}`);
if (remains.n > 0) {
  console.log("tip: unlisted items have no tooltip price; they keep 'unknown' until the market prices them.");
}
