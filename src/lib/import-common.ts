// Shared import pipeline for both data channels. The addon-scan route
// (game plugin) and the ahledger route (AHledger public API) both land here;
// `source` is stamped on every AuctionSnapshot/DailySummary row so the two
// channels stay separate price metrics (addon P10 vs ahledger median) and
// can never pollute each other's med7 window or OHLCV row. Dedupe, item-row
// backfill, history-point fencing and the daily fold are identical for both.
import type { PrismaPromise } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffScanItems, type ExistingItemRow, type ItemUpdateData } from "@/lib/scan-import";
import { mergePointsIntoDailySummaries, mergeScanIntoDailySummaries } from "@/lib/daily-summary";
import type { AddonRadarRules, AddonRecipe, AddonRecipeMaterial } from "@/lib/addon-scan";
import type { SnapshotSource } from "@/lib/market-data";

export type ImportScanItem = {
  itemId: number;
  // addon scans carry the full metadata; ahledger rows only carry prices,
  // so name/quality/category/subCategory/vendorPrice are optional here and
  // the ahledger channel creates placeholder Item rows instead.
  name?: string;
  quality?: string;
  category?: string;
  subCategory?: string;
  vendorPrice?: number;
  icon?: string; // in-game icon texture name from addon scans; absent for ahledger rows
  minPrice: number;
  marketPrice: number;
  quantity: number;
  numAuctions: number;
  ladder?: Array<{ price: number; count: number }>;
};

export type ImportPoint = { itemId: number; timestamp: Date; marketPrice: number; quantity: number };

export type ImportPayload = {
  source: SnapshotSource;
  scannedAt: Date;
  server: string;
  faction: string;
  items: ImportScanItem[];
  // addon-only: the accumulated in-game 7-day point series riding along
  // with the snapshot; ahledger imports have no history points.
  points?: ImportPoint[];
  // addon-only: deprecated — the watcher still sends it, but the import no
  // longer trusts it as "already imported" (see the self-healing fence below).
  after?: number;
  // addon-only: replay of the in-game radar thresholds (route-2 authority).
  rules?: AddonRadarRules;
  // addon-only: crafting recipes dumped by /wahrecipes (P0-B). Upserted in
  // the same transaction, keyed by (name, profession).
  recipes?: AddonRecipe[];
};

// Thrown when the exact (timestamp, server, faction, source) snapshot row
// already exists; the caller maps this to HTTP 409, never a 500.
export class ImportConflictError extends Error {}

export type ImportResult = { imported: number; points: number; scannedAt: string };

// createMany with tens of thousands of rows (an overnight auto-scan session
// ships a 7-day point series of ~100k+ rows) blows the statement parameter
// budget and the V8 stack on SQLite. Split every bulk insert into bounded
// batches so the import stays flat regardless of how much history rode along.
function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
const BULK_CHUNK = 3000;

// P0-B seed migration: the seeded library (now the wx-wow.com 无限服 library)
// and in-game /wahrecipes dumps can carry different names for the same craft
// (different locales or a recipe the seed missed). Identity here is the craft
// itself: same profession and the same sorted (itemId, quantity) signature for
// outputs and reagents. When an incoming dump matches an existing craft row
// under a different name, the old row is scheduled for deletion and the dump
// upserts under its own name. Same-name matches are plain upserts (no delete
// needed). Only "craft" rows are migration candidates — merchant-favor
// exchanges ("merchant") have a different cost structure (favor currency) and
// must never be swept away by a craft scan.
export function recipeIdentitySignature(recipe: AddonRecipe): string {
  const sig = (list: AddonRecipeMaterial[]) =>
    list.map((material) => `${material.itemId}x${material.quantity}`).sort().join(",");
  return `${sig(recipe.outputs)}|${sig(recipe.reagents)}`;
}

export function planRecipeMigrations(
  existing: Array<{ id: string; name: string; profession: string; reagents: unknown; outputs: unknown }>,
  incoming: AddonRecipe[]
): string[] {
  const bySig = new Map<string, AddonRecipe>();
  for (const recipe of incoming) bySig.set(recipeIdentitySignature(recipe), recipe);
  const deletes: string[] = [];
  for (const row of existing) {
    const recipe: AddonRecipe = {
      name: row.name,
      profession: row.profession,
      skillLevel: 0,
      reagents: row.reagents as AddonRecipeMaterial[],
      outputs: row.outputs as AddonRecipeMaterial[]
    };
    const sig = recipeIdentitySignature(recipe);
    const incomingRecipe = bySig.get(sig);
    if (incomingRecipe && incomingRecipe.profession === row.profession && incomingRecipe.name !== row.name) {
      deletes.push(row.id);
    }
  }
  return deletes;
}

export async function importSnapshot(payload: ImportPayload): Promise<ImportResult> {
  const { source, scannedAt, server, faction, rules } = payload;
  let items = payload.items;
  const points = payload.points ?? [];

  // Channel-scoped dedupe: the same wall-clock timestamp can legitimately
  // exist once per source (a game scan and an ahledger round are different
  // observations even at the same minute), so source joins the key.
  const duplicate = await prisma.auctionSnapshot.findFirst({
    where: { timestamp: scannedAt, server, faction, source },
    select: { id: true }
  });
  if (duplicate) {
    throw new ImportConflictError(`Scan at ${scannedAt.toISOString()} already imported`);
  }

  // P50-only policy: the website channel is only a reference for items the
  // in-game scanner has actually seen. An item that exists solely on the
  // website cannot be bought in game, so it is filtered out at the door -
  // the terminal never prices something the game cannot list. Items that
  // are scanned later automatically enter the P50 channel on the next
  // ahledger round.
  if (source === "ahledger") {
    const addonItemIds = await prisma.auctionSnapshot.findMany({ where: { source: "addon" }, distinct: ["itemId"], select: { itemId: true } });
    const known = new Set(addonItemIds.map((row) => row.itemId));
    items = items.filter((item) => known.has(item.itemId));
  }

  // In-game history points (one per item per completed scan, 7-day window).
  // The snapshot import is the anchor: points at or after this scan are
  // dropped because the snapshot rows themselves cover the scan's timestamp.
  // The old `after` fence (skip everything <= last imported scan) is
  // deliberately NOT trusted: a watcher that was down, or an import that
  // failed while the watcher advanced its state, leaves gaps that the fence
  // would skip forever (observed: whole evening scans missing from the DB).
  // Every point below the scan time is therefore probed against the database
  // and only genuinely missing (itemId, timestamp) pairs are inserted — the
  // import is self-healing and the next scan after downtime backfills
  // everything the plugin's point series carries.
  const scannedAtSec = Math.floor(scannedAt.getTime() / 1000);
  const candidates = points.filter((point) => Math.floor(point.timestamp.getTime() / 1000) < scannedAtSec);
  let freshPoints = candidates;
  if (candidates.length > 0) {
    // Iterative min: an overnight session ships a 7-day point series of
    // 100k+ rows, and Math.min(...points.map(...)) would blow the V8 stack
    // by spreading every timestamp as an argument (RangeError: Maximum call
    // stack size exceeded). The loop costs the same but stays flat.
    let minTsMs = Infinity;
    for (const point of candidates) {
      const ts = point.timestamp.getTime();
      if (ts < minTsMs) minTsMs = ts;
    }
    const minTs = new Date(minTsMs);
    const existing = await prisma.auctionSnapshot.findMany({
      where: { server, faction, source, timestamp: { gte: minTs } },
      select: { itemId: true, timestamp: true }
    });
    const seen = new Set(existing.map((row) => `${row.itemId}|${row.timestamp.getTime()}`));
    freshPoints = candidates.filter((point) => !seen.has(`${point.itemId}|${point.timestamp.getTime()}`));
  }

  // Full-table reads instead of `in` filters: the item table is small and
  // this keeps the statements clear of SQLite's bound-parameter limit even
  // at 100x-scale scans.
  const existingItems = await prisma.item.findMany({ select: { itemId: true, name: true, quality: true, category: true, subCategory: true, vendorPrice: true, icon: true } });
  const existingItemIdSet = new Set(existingItems.map((row) => row.itemId));

  // Item-table policy differs by channel:
  // - addon: create missing rows with real metadata and backfill name/
  //   quality/vendorPrice changes (diffScanItems).
  // - ahledger: rows carry no metadata, so they may only create placeholder
  //   Item rows (name "Item {id}", unknown quality) for items the store has
  //   never seen; they must never overwrite a real name the addon recorded.
  //   The next addon scan backfills placeholders via diffScanItems.
  const creates: Array<{ itemId: number; name: string; quality: string; category: string; subCategory: string; vendorPrice: number; icon?: string }> = [];
  const updates: Array<{ itemId: number; data: ItemUpdateData }> = [];
  if (source === "addon") {
    const diff = diffScanItems(items as Parameters<typeof diffScanItems>[0], existingItems as ExistingItemRow[]);
    creates.push(...diff.creates);
    updates.push(...diff.updates);
  } else {
    for (const item of items) {
      if (!existingItemIdSet.has(item.itemId)) {
        creates.push({
          itemId: item.itemId,
          name: `Item ${item.itemId}`,
          quality: "unknown",
          category: "unknown",
          subCategory: "unknown",
          vendorPrice: 0
        });
      }
    }
  }

  // History points can reference items that were listed in an earlier round
  // but had expired before this scan and are unknown to the store. Their
  // AuctionSnapshot rows would violate the Item FK, so create placeholder
  // Item rows for exactly those ids (same convention as above).
  const scanItemIdSet = new Set(items.map((item) => item.itemId));
  const pointOnlyItemIds = [...new Set(freshPoints.map((point) => point.itemId))]
    .filter((itemId) => !existingItemIdSet.has(itemId) && !scanItemIdSet.has(itemId));
  for (const itemId of pointOnlyItemIds) {
    creates.push({ itemId, name: `Item ${itemId}`, quality: "unknown", category: "unknown", subCategory: "unknown", vendorPrice: 0 });
  }

  // Daily OHLCV: fold history points first (they carry the whole night's
  // per-round prices, possibly across midnight), then fold the snapshot so
  // the day's close/high/low/volume land on the latest scan and the day's
  // open stays the first observed round. Rows are scoped by source so the
  // two channels keep independent candles.
  const affectedDates = new Set<number>([
    new Date(Date.UTC(scannedAt.getUTCFullYear(), scannedAt.getUTCMonth(), scannedAt.getUTCDate())).getTime()
  ]);
  for (const point of freshPoints) {
    affectedDates.add(new Date(Date.UTC(point.timestamp.getUTCFullYear(), point.timestamp.getUTCMonth(), point.timestamp.getUTCDate())).getTime());
  }
  const existingDayRows = await prisma.dailySummary.findMany({
    where: { source, date: { in: Array.from(affectedDates).map((ms) => new Date(ms)) } },
    select: { itemId: true, date: true, openPrice: true, closePrice: true, highPrice: true, lowPrice: true }
  });
  // BigInt price columns come back as BigInt; coerce to number for the
  // daily-summary merge arithmetic.
  const existingDayRowsNum: Array<{ itemId: number; date: Date; openPrice: number; closePrice: number; highPrice: number; lowPrice: number }> =
    existingDayRows.map((row) => ({
      itemId: row.itemId, date: row.date,
      openPrice: Number(row.openPrice), closePrice: Number(row.closePrice),
      highPrice: Number(row.highPrice), lowPrice: Number(row.lowPrice)
    }));
  const pointDayResult = mergePointsIntoDailySummaries(freshPoints, existingDayRowsNum, source);
  const dayProbe = mergeScanIntoDailySummaries(items, scannedAt, [], source);
  // Rows the points pass will create count as existing for the snapshot fold
  // ONLY when they belong to the snapshot's own day — points that fell on an
  // earlier day (a scan just after midnight) are separate rows the snapshot
  // must not update.
  const dayMs = dayProbe.date.getTime();
  const effectiveExisting = [
    ...existingDayRowsNum.filter((row) => row.date.getTime() === dayMs),
    ...pointDayResult.creates.filter((row) => row.date.getTime() === dayMs)
  ];
  const { date, creates: dayCreates, updates: dayUpdates } = mergeScanIntoDailySummaries(items, scannedAt, effectiveExisting, source);

  // Route 2: replay the in-game radar rules (single authority row id=1) in
  // the same commit as the scan, so the terminal's deal radar can never
  // drift from what the addon is actually using. Only the addon channel has
  // a game panel; ahledger imports leave the stored rules untouched.
  const rulesPayload = source === "addon" && rules !== undefined
    ? [prisma.radarRule.upsert({
        where: { id: 1 },
        update: { rules: rules as object },
        create: { id: 1, rules: rules as object }
      })]
    : [];

  // P0-B: /wahrecipes dumps ride along with the scan. Each recipe is
  // upserted on (name, profession, category="craft") so a re-scan overwrites
  // the same-name recipe instead of duplicating it; recipes are addon-channel
  // only and never touch "merchant" rows (merchant-favor exchanges).
  // Before that, seed migration deletes craft rows whose identity (same
  // outputs/reagents/profession) arrives under a different name.
  const recipeMigrations: PrismaPromise<unknown>[] = [];
  if (source === "addon" && payload.recipes !== undefined && payload.recipes.length > 0) {
    const existingRecipes = await prisma.recipe.findMany({
      where: { category: "craft" },
      select: { id: true, name: true, profession: true, reagents: true, outputs: true }
    });
    const deleteIds = planRecipeMigrations(existingRecipes, payload.recipes);
    if (deleteIds.length > 0) {
      recipeMigrations.push(prisma.recipe.deleteMany({ where: { id: { in: deleteIds } } }));
    }
  }
  const recipePayload = source === "addon" && payload.recipes !== undefined && payload.recipes.length > 0
    ? payload.recipes.map((recipe) => prisma.recipe.upsert({
        where: { name_profession_category: { name: recipe.name, profession: recipe.profession, category: "craft" } },
        update: { skillLevel: recipe.skillLevel, reagents: recipe.reagents as object, outputs: recipe.outputs as object },
        create: { name: recipe.name, profession: recipe.profession, skillLevel: recipe.skillLevel, reagents: recipe.reagents as object, outputs: recipe.outputs as object }
      }))
    : [];

  // One transaction for the whole import: a single commit instead of one
  // autocommit fsync per row, and everything lands all-or-nothing. The bulk
  // inserts are chunked (see chunk above) so a 100k-point history rides in
  // without exceeding SQLite's parameter limit or the V8 stack.
  await prisma.$transaction([
    ...(creates.length > 0 ? [prisma.item.createMany({ data: creates })] : []),
    ...updates.map((update) => prisma.item.update({ where: { itemId: update.itemId }, data: update.data })),
    ...chunk(items, BULK_CHUNK).map((slice) =>
      prisma.auctionSnapshot.createMany({
        data: slice.map((item) => ({
          itemId: item.itemId,
          timestamp: scannedAt,
          server,
          faction,
          source,
          minPrice: item.minPrice,
          marketPrice: item.marketPrice,
          quantity: item.quantity,
          numAuctions: item.numAuctions,
          ...(item.ladder ? { rawPayload: { ladder: item.ladder } } : {})
        }))
      })),
    ...chunk(freshPoints, BULK_CHUNK).map((slice) =>
      prisma.auctionSnapshot.createMany({
        data: slice.map((point) => ({
          itemId: point.itemId,
          timestamp: point.timestamp,
          server,
          faction,
          source,
          // History points only carry the P10 close; mirror it into
          // minPrice so the column stays populated. The radar reads
          // minPrice from the latest snapshot row (this scan), never from
          // these older points.
          minPrice: point.marketPrice,
          marketPrice: point.marketPrice,
          quantity: point.quantity,
          numAuctions: 0
        }))
      })
    ),
    ...(pointDayResult.creates.length > 0
      ? chunk(pointDayResult.creates, BULK_CHUNK).map((slice) => prisma.dailySummary.createMany({ data: slice }))
      : []),
    ...pointDayResult.updates.map((update) => prisma.dailySummary.update({
      where: { itemId_date_source: { itemId: update.itemId, date: update.date, source } },
      data: update.data
    })),
    ...(dayCreates.length > 0
      ? chunk(dayCreates, BULK_CHUNK).map((slice) => prisma.dailySummary.createMany({ data: slice }))
      : []),
    ...dayUpdates.map((update) => prisma.dailySummary.update({
      where: { itemId_date_source: { itemId: update.itemId, date, source } },
      data: update.data
    })),
    ...rulesPayload,
    ...recipeMigrations,
    ...recipePayload
  ]);

  return { imported: items.length, points: freshPoints.length, scannedAt: scannedAt.toISOString() };
}
