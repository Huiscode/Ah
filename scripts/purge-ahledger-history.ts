// One-off purge: removes every row the removed AHledger website channel
// wrote into the store, then drops placeholder Item rows that only that
// channel ever created (name "Item {id}", no addon snapshot, and not
// referenced by watchlist/alerts). Idempotent: re-running finds nothing.
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("prisma/dev.db");

const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

const beforeSnap = count(`SELECT COUNT(*) c FROM "AuctionSnapshot" WHERE source = 'ahledger'`);
const beforeDaily = count(`SELECT COUNT(*) c FROM "DailySummary" WHERE source = 'ahledger'`);
const beforeItems = count(`SELECT COUNT(*) c FROM "Item"`);

// 1. Snapshot + daily rows from the removed channel (cascade-safe: Item FK
//    is on the Item side, so deleting snapshots never touches Items).
db.exec(`DELETE FROM "AuctionSnapshot" WHERE source = 'ahledger'`);
db.exec(`DELETE FROM "DailySummary" WHERE source = 'ahledger'`);

// 2. Placeholder Items that only ahledger ever created: name "Item {id}",
//    no addon snapshot anywhere, and not watched / alerted. A real-name row
//    or one with addon data is never touched.
db.exec(`
  DELETE FROM "Item" WHERE id IN (
    SELECT i.id FROM "Item" i
    WHERE i.name = 'Item ' || i.item_id
      AND NOT EXISTS (SELECT 1 FROM "AuctionSnapshot" s WHERE s.item_id = i.item_id)
      AND NOT EXISTS (SELECT 1 FROM "DailySummary" d WHERE d.item_id = i.item_id)
      AND NOT EXISTS (SELECT 1 FROM "Watchlist" w WHERE w.item_id = i.item_id)
      AND NOT EXISTS (SELECT 1 FROM "AlertRule" a WHERE a.item_id = i.item_id)
  )
`);

// 3. The website toggle key is dead config now.
db.exec(`DELETE FROM "AppState" WHERE key = 'ahledgerEnabled'`);

const afterSnap = count(`SELECT COUNT(*) c FROM "AuctionSnapshot" WHERE source = 'ahledger'`);
const afterDaily = count(`SELECT COUNT(*) c FROM "DailySummary" WHERE source = 'ahledger'`);
const afterItems = count(`SELECT COUNT(*) c FROM "Item"`);
const placeholderRemoved = beforeItems - afterItems;

console.log(JSON.stringify({
  ahledgerSnapshotsRemoved: beforeSnap - afterSnap,
  ahledgerDailiesRemoved: beforeDaily - afterDaily,
  placeholderItemsRemoved: placeholderRemoved,
  remainingAhledgerSnapshots: afterSnap,
  remainingAhledgerDailies: afterDaily,
  itemTotalBefore: beforeItems,
  itemTotalAfter: afterItems
}, null, 2));
