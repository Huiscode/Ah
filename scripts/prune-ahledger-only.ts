// P50-only policy cleanup: the website channel is only a reference for
// items the in-game scanner has actually seen. This script removes every
// AHledger snapshot/daily-summary whose item has NO addon snapshot at all,
// then drops those orphan placeholder Item rows (they were created by the
// ahledger import and carry no usable name) unless a watchlist or alert
// still references them — those keep the Item but lose the P50 data.
//
// Run:      npx tsx scripts/prune-ahledger-only.ts
// Re-runs:  idempotent — after the first pass there is nothing left to prune.
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("prisma/dev.db");

const addonIds = new Set(
  db.prepare("SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon'").all().map((r) => Number(r.item_id))
);

const orphanItems = db
  .prepare(
    "SELECT DISTINCT item_id FROM Item WHERE item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')"
  )
  .all()
  .map((r) => ({ item_id: Number(r.item_id) }));

const snapshots = db.prepare("SELECT COUNT(*) n FROM AuctionSnapshot WHERE source='ahledger' AND item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')").get() as { n: number };
const dailies = db.prepare("SELECT COUNT(*) n FROM DailySummary WHERE source='ahledger' AND item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')").get() as { n: number };
console.log(`orphan items: ${orphanItems.length}, ahl snapshots: ${snapshots.n}, ahl dailySummaries: ${dailies.n}`);

const watched = new Set(
  db.prepare("SELECT item_id FROM Watchlist WHERE item_id IN (" + orphanItems.map(() => "?").join(",") + ")").all(...orphanItems.map((r) => r.item_id)).map((r) => Number(r.item_id))
);
const alerted = new Set(
  db.prepare("SELECT item_id FROM AlertRule WHERE item_id IN (" + orphanItems.map(() => "?").join(",") + ")").all(...orphanItems.map((r) => r.item_id)).map((r) => Number(r.item_id))
);
const referenced = [...new Set([...watched, ...alerted])];
console.log(`referenced by watchlist/alert: ${referenced.length}`);

const dropSnapshots = db.prepare("DELETE FROM AuctionSnapshot WHERE source='ahledger' AND item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')");
const dropDailies = db.prepare("DELETE FROM DailySummary WHERE source='ahledger' AND item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')");
const safeIds = orphanItems.filter((r) => !referenced.includes(r.item_id));
const dropItems = safeIds.length > 0
  ? db.prepare("DELETE FROM Item WHERE item_id IN (" + safeIds.map(() => "?").join(",") + ")")
  : null;

db.exec("BEGIN");
const s1 = dropSnapshots.run().changes;
const s2 = dropDailies.run().changes;
const s3 = dropItems ? dropItems.run(...safeIds.map((r) => r.item_id)).changes : 0;
db.exec("COMMIT");

console.log(`deleted ahl snapshots: ${s1}, ahl dailies: ${s2}, orphan items: ${s3}`);
const remain = db.prepare("SELECT COUNT(*) n FROM Item WHERE item_id NOT IN (SELECT DISTINCT item_id FROM AuctionSnapshot WHERE source='addon')").get() as { n: number };
console.log(`items with no addon data after cleanup: ${remain.n}`);
