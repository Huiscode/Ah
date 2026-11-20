// WAHTranscribeDB（旁挂插件前五档存档）结构归一。
//   v1（2026-10 ~ 11-20）：scans[itemId] = { t, market, tiers }——两个市场共用 itemId 键，会互相覆盖
//   v2（2026-11-20 起）：markets[market][itemId] = { t, tiers }
// 插件载入时会把 v1 迁成 v2；导入端两种都认，兼容尚未重新落盘的旧存档。

export type RawTier = { p?: number; q?: number };
export type RawScan = { t?: number; market?: string; tiers?: RawTier[] };
export type TranscriptDb = {
  version?: number;
  scans?: Record<string, RawScan> | unknown[];
  markets?: Record<string, Record<string, RawScan> | unknown[]>;
};

export type Market = "faction" | "neutral";
export type TranscriptEntry = { itemId: number; market: Market; t: number; tiers: Array<{ price: number; qty: number }> };

function toEntry(key: string, scan: RawScan | null | undefined, market: Market): TranscriptEntry | null {
  const itemId = Number(key);
  if (!Number.isInteger(itemId) || !scan || typeof scan.t !== "number") return null;
  const tiers = (scan.tiers ?? []).map((t) => ({ price: Math.round(t.p ?? 0), qty: Math.round(t.q ?? 0) }));
  return { itemId, market, t: scan.t, tiers };
}

// fengari 把空 Lua 表转成 []（数组），按"无条目"处理。
function entriesOf(table: Record<string, RawScan> | unknown[] | undefined): Array<[string, RawScan]> {
  if (!table || Array.isArray(table)) return [];
  return Object.entries(table);
}

export function flattenTranscriptDb(db: TranscriptDb | null | undefined): TranscriptEntry[] {
  if (!db || typeof db !== "object") return [];
  const out: TranscriptEntry[] = [];
  if (db.markets && !Array.isArray(db.markets)) {
    for (const market of ["faction", "neutral"] as const) {
      for (const [key, scan] of entriesOf(db.markets[market])) {
        const entry = toEntry(key, scan, market);
        if (entry) out.push(entry);
      }
    }
    return out;
  }
  for (const [key, scan] of entriesOf(db.scans)) {
    const entry = toEntry(key, scan, scan?.market === "neutral" ? "neutral" : "faction");
    if (entry) out.push(entry);
  }
  return out;
}
