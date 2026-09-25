// Folds one addon scan into the day's OHLCV rows. The import route is the
// single caller and writer; DailySummary feeds every chart, moving average,
// and seasonality view, so scans must land here or the terminal stays empty.

type ScanPriceRow = { itemId: number; marketPrice: number; quantity: number };
type ExistingDayRow = { itemId: number; highPrice: number; lowPrice: number };

export function mergeScanIntoDailySummaries(items: ScanPriceRow[], scannedAt: Date, existing: ExistingDayRow[]) {
  const date = new Date(Date.UTC(scannedAt.getUTCFullYear(), scannedAt.getUTCMonth(), scannedAt.getUTCDate()));
  const existingByItemId = new Map(existing.map((row) => [row.itemId, row]));
  const creates: Array<{ itemId: number; date: Date; openPrice: number; closePrice: number; highPrice: number; lowPrice: number; volume: number }> = [];
  const updates: Array<{ itemId: number; data: { closePrice: number; highPrice: number; lowPrice: number; volume: number } }> = [];
  for (const item of items) {
    const current = existingByItemId.get(item.itemId);
    if (!current) {
      creates.push({
        itemId: item.itemId,
        date,
        openPrice: item.marketPrice,
        closePrice: item.marketPrice,
        highPrice: item.marketPrice,
        lowPrice: item.marketPrice,
        // volume proxies listed supply from the latest scan; true traded
        // volume needs sale tracking the AH API does not expose.
        volume: item.quantity
      });
    } else {
      updates.push({
        itemId: item.itemId,
        data: {
          closePrice: item.marketPrice,
          highPrice: Math.max(current.highPrice, item.marketPrice),
          lowPrice: Math.min(current.lowPrice, item.marketPrice),
          volume: item.quantity
        }
      });
    }
  }
  return { date, creates, updates };
}

// Folds accumulated in-game history points into their per-day OHLCV rows,
// across however many days the points span (a night of auto-rescans crosses
// midnight). Only the snapshot import (the caller) filters which points are
// new; this function upserts whatever it is given. openPrice is only set on
// creation — an existing day keeps its first-observed open across imports —
// while close/high/low/volume are merged with the latest points.
export function mergePointsIntoDailySummaries(
  points: Array<{ itemId: number; timestamp: Date; marketPrice: number; quantity: number }>,
  existing: Array<{ itemId: number; date: Date; highPrice: number; lowPrice: number }>
) {
  // Group point prices per (itemId, UTC date), preserving time order.
  const groups = new Map<string, Array<{ t: number; price: number; q: number }>>();
  const dayByKey = new Map<string, Date>();
  for (const point of points) {
    const date = new Date(Date.UTC(point.timestamp.getUTCFullYear(), point.timestamp.getUTCMonth(), point.timestamp.getUTCDate()));
    const key = `${point.itemId}|${date.getTime()}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      dayByKey.set(key, date);
    }
    bucket.push({ t: point.timestamp.getTime(), price: point.marketPrice, q: point.quantity });
  }
  const existingByKey = new Map(existing.map((row) => [`${row.itemId}|${row.date.getTime()}`, row]));
  const creates: Array<{ itemId: number; date: Date; openPrice: number; closePrice: number; highPrice: number; lowPrice: number; volume: number }> = [];
  const updates: Array<{ itemId: number; date: Date; data: { closePrice: number; highPrice: number; lowPrice: number; volume: number } }> = [];
  for (const [key, bucket] of groups) {
    bucket.sort((left, right) => left.t - right.t);
    const open = bucket[0].price;
    const close = bucket[bucket.length - 1].price;
    let high = open;
    let low = open;
    for (const point of bucket) {
      if (point.price > high) high = point.price;
      if (point.price < low) low = point.price;
    }
    const volume = bucket[bucket.length - 1].q;
    const current = existingByKey.get(key);
    if (!current) {
      creates.push({ itemId: Number(key.split("|")[0]), date: dayByKey.get(key)!, openPrice: open, closePrice: close, highPrice: high, lowPrice: low, volume });
    } else {
      updates.push({
        itemId: current.itemId,
        date: current.date,
        data: {
          closePrice: close, // latest points are newer than what the day had
          highPrice: Math.max(current.highPrice, high),
          lowPrice: Math.min(current.lowPrice, low),
          volume
        }
      });
    }
  }
  return { creates, updates };
}
