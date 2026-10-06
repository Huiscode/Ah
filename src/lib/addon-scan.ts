// Parses WoW SavedVariables Lua files and validates addon scan payloads.
// Single validation authority for addon-sourced scans: the watcher and the
// import route both rely on normalizeAddonScan, never on ad-hoc checks.
import { SCAN_PIPELINE_VERSION } from "@/lib/market-rules";

// Quality index -> name mapping shared with the perf fixtures generator.
export const QUALITY_NAMES = ["poor", "common", "uncommon", "rare", "epic", "legendary"] as const;

export type AddonScanItem = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  subCategory: string;
  icon?: string; // in-game icon texture name, e.g. "inv_staff_13"; absent when the client had no cache entry
  minPrice: number;
  marketPrice: number; // quantity-weighted P10 unit price, copper
  p50?: number; // quantity-weighted P50 unit price, copper; display-only curve on the item page
  quantity: number;
  numAuctions: number;
  vendorPrice: number; // NPC sell price in copper; 0 = unsellable to vendors
  ladder?: Array<{ price: number; count: number }>; // bottom-5 price tiers
};

// Route-2 authority mirror: the in-game options panel owns these values and
// each scan import replays them so the terminal renders deals with the same
// rules the addon used. Every field is optional; absent fields fall back to
// the compiled defaults in market-rules.ts.
export type AddonRadarRules = {
  minProfit?: number;
  minProfitRatio?: number;
  discount?: number;
  minAuctions?: number;
  minHistory?: number;
  minMed7Distinct?: number;
  maxDiscount?: number;
  supplyCap?: number;
  minPrice?: number;
  maxPrice?: number;
  gapFilterOn?: boolean;
  gap1Pct?: number;
  gap2Pct?: number;
};

export type AddonScan = {
  scannedAt: Date;
  server: string;
  faction: string;
  // 市场标识："faction"（主城阵营市场，唯一进入联盟分析的通道）或
  // "neutral"（中立地精市场）。插件按扫描挂单总数判定；未知/缺省按
  // faction 兜底（旧版本扫描均为联盟主城数据）。
  market?: "faction" | "neutral";
  items: AddonScanItem[];
  rules?: AddonRadarRules;
};

// One accumulated in-game history point: the P10 close (c) of a completed
// scan, the P50 close (c50) of the same scan, and the listed quantity (q)
// at that scan. The addon appends a point per item on every scan and keeps
// a rolling 7-day window, so a night of auto-rescans carries the full
// per-round price series to the terminal in one import — no per-round disk
// flush required. c remains the only field any chart or median reads; c50
// feeds the display-only P50 curve.
export type AddonPoint = {
  itemId: number;
  timestamp: Date; // seconds -> epoch ms at normalization
  marketPrice: number; // P10 close, copper
  p50?: number; // P50 close, copper; absent on points predating the P50 curve
  quantity: number; // listed quantity at that scan; 0 when absent
};

// One recipe dumped by /wahrecipes (P0-B). The client never exposes a spell
// id, so (name, profession) is the identity — re-scans upsert over it. Each
// material/product carries the vendor floor the addon dumped alongside, the
// side effect that completes the Forever-only floor-price dictionary.
export type AddonRecipeMaterial = {
  itemId: number;
  name: string;
  quantity: number;
  vendorPrice?: number; // NPC SellPrice in copper, dumped by /wahrecipes
};

export type AddonRecipe = {
  name: string;
  profession: string;
  skillLevel: number; // skill level required to learn/use the recipe
  reagents: AddonRecipeMaterial[];
  outputs: AddonRecipeMaterial[];
};

// The client localizes profession names (zhCN: 锻造/制皮/…). Recipe rows —
// both the classic seed (English canonical names) and in-game dumps — must
// share one namespace for the (name, profession) key and the panel's
// profession filter, so dump professions are normalized to the canonical
// English names. Unknown names pass through untouched.
export const PROFESSION_ZH_TO_EN: Record<string, string> = {
  "锻造": "Blacksmithing",
  "制皮": "Leatherworking",
  "裁缝": "Tailoring",
  "炼金术": "Alchemy",
  "工程学": "Engineering",
  "烹饪": "Cooking",
  "急救": "First Aid",
  "采矿": "Mining",
  "附魔": "Enchanting",
  "钓鱼": "Fishing",
  "草药学": "Herbalism",
  "剥皮": "Skinning"
};

type LuaValue = string | number | boolean | null | { [key: string]: LuaValue };

// SavedVariables files are machine-written by the WoW client in a fixed shape:
// `GlobalName = { ["key"] = value, [123] = { ... }, }` — a recursive-descent
// parser over that grammar is sufficient; this is not a general Lua parser.
export function parseSavedVariables(source: string): Record<string, LuaValue> {
  const parser = new SavedVariablesParser(source);
  return parser.parseFile();
}

class SavedVariablesParser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parseFile(): Record<string, LuaValue> {
    const globals: Record<string, LuaValue> = {};
    this.skipWhitespace();
    while (this.pos < this.source.length) {
      const name = this.readIdentifier();
      this.expect("=");
      globals[name] = this.readValue();
      this.skipWhitespace();
    }
    return globals;
  }

  private readValue(): LuaValue {
    this.skipWhitespace();
    const char = this.source[this.pos];
    if (char === "{") return this.readTable();
    if (char === '"') return this.readString();
    if (this.source.startsWith("true", this.pos)) { this.pos += 4; return true; }
    if (this.source.startsWith("false", this.pos)) { this.pos += 5; return false; }
    if (this.source.startsWith("nil", this.pos)) { this.pos += 3; return null; }
    return this.readNumber();
  }

  private readTable(): { [key: string]: LuaValue } {
    this.expect("{");
    const table: { [key: string]: LuaValue } = {};
    let arrayIndex = 1;
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) {
        throw new Error(`SavedVariables parse error: unterminated table at end of input`);
      }
      if (this.source[this.pos] === "}") { this.pos += 1; break; }
      let key: string;
      if (this.source[this.pos] === "[") {
        this.pos += 1;
        this.skipWhitespace();
        key = this.source[this.pos] === '"' ? this.readString() : String(this.readNumber());
        this.expect("]");
        this.expect("=");
      } else {
        // Positional array entry, e.g. `{ 1, 2, 3 }`.
        key = String(arrayIndex);
        arrayIndex += 1;
      }
      table[key] = this.readValue();
      this.skipWhitespace();
      if (this.source[this.pos] === ",") this.pos += 1;
    }
    return table;
  }

  private readString(): string {
    this.expect('"');
    let value = "";
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === "\\") {
        const escaped = this.source[this.pos + 1];
        value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        this.pos += 2;
      } else {
        value += this.source[this.pos];
        this.pos += 1;
      }
    }
    this.expect('"');
    return value;
  }

  private readNumber(): number {
    const match = /^-?\d+(?:\.\d+)?(?:e-?\d+)?/.exec(this.source.slice(this.pos));
    if (!match) {
      throw new Error(`SavedVariables parse error: expected value at offset ${this.pos}`);
    }
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private readIdentifier(): string {
    this.skipWhitespace();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.pos));
    if (!match) {
      throw new Error(`SavedVariables parse error: expected identifier at offset ${this.pos}`);
    }
    this.pos += match[0].length;
    return match[0];
  }

  private expect(token: string) {
    this.skipWhitespace();
    if (!this.source.startsWith(token, this.pos)) {
      throw new Error(`SavedVariables parse error: expected "${token}" at offset ${this.pos}`);
    }
    this.pos += token.length;
  }

  private skipWhitespace() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) this.pos += 1;
  }
}

function requirePositiveInt(value: unknown, field: string, itemId: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Addon scan item ${itemId}: ${field} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return Math.round(value);
}

// vendorP is absent on scans predating the vendor-arbitrage radar and on
// items GetItemInfo had not cached yet; absent means "no vendor price".
function normalizeVendorPrice(value: unknown, itemId: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Addon scan item ${itemId}: vendorP must be a non-negative number, got ${JSON.stringify(value)}`);
  }
  return Math.round(value);
}

// Radar rules are auxiliary data: a malformed field must never reject a
// good scan. Each field is validated in isolation and dropped on failure;
// if nothing survives, rules is omitted entirely and the terminal falls
// back to its compiled defaults.
const RULE_NUMBER_FIELDS = [
  "minProfit", "minProfitRatio", "discount", "minAuctions", "minHistory",
  "minMed7Distinct", "maxDiscount", "supplyCap",
  "minPrice", "maxPrice", "gap1Pct", "gap2Pct"
] as const;
const RULE_BOOL_FIELDS = ["gapFilterOn"] as const;

export function normalizeRadarRules(raw: unknown): AddonRadarRules | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const rules: AddonRadarRules = {};
  for (const key of RULE_NUMBER_FIELDS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) rules[key] = value;
  }
  for (const key of RULE_BOOL_FIELDS) {
    const value = source[key];
    if (typeof value === "boolean") rules[key] = value;
  }
  return Object.keys(rules).length > 0 ? rules : undefined;
}

export function normalizeAddonScan(raw: unknown): AddonScan {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Addon scan payload must be an object, got ${JSON.stringify(raw)}`);
  }
  const scan = raw as Record<string, unknown>;
  // Pipeline version gate: v1 scans carry mean-polluted prices and v2 scans
  // carry a P50 marketPrice, which this realm's thin upper book made
  // unusable. Only v3 (P10 marketPrice) may enter the store.
  if (scan.dataVersion !== SCAN_PIPELINE_VERSION) {
    throw new Error(`Addon scan dataVersion must be ${SCAN_PIPELINE_VERSION} (P10 pricing pipeline), got ${JSON.stringify(scan.dataVersion)} — rescan in game with the current addon`);
  }
  if (typeof scan.scannedAt !== "number" || scan.scannedAt <= 0) {
    throw new Error(`Addon scan scannedAt must be a positive epoch, got ${JSON.stringify(scan.scannedAt)}`);
  }
  if (typeof scan.server !== "string" || scan.server === "") {
    throw new Error(`Addon scan server must be a non-empty string, got ${JSON.stringify(scan.server)}`);
  }
  if (typeof scan.faction !== "string" || scan.faction === "") {
    throw new Error(`Addon scan faction must be a non-empty string, got ${JSON.stringify(scan.faction)}`);
  }
  if (typeof scan.items !== "object" || scan.items === null || Object.keys(scan.items).length === 0) {
    throw new Error("Addon scan items must be a non-empty table of itemId entries");
  }

  const items = Object.entries(scan.items as Record<string, unknown>)
    .map(([key, value]) => {
      const itemId = Number(key);
      if (!Number.isInteger(itemId) || itemId <= 0) {
        throw new Error(`Addon scan item key must be a positive itemId, got ${JSON.stringify(key)}`);
      }
      if (typeof value !== "object" || value === null) {
        throw new Error(`Addon scan item ${key} must be a table, got ${JSON.stringify(value)}`);
      }
      const entry = value as Record<string, unknown>;
      // A few replicate listings carry an empty name on the Forever client
      // (placeholder rows still streaming in). They are unusable for display
      // and price math, so skip them instead of rejecting the whole scan.
      if (typeof entry.name !== "string" || entry.name === "") {
        return null;
      }
      const qualityIndex = typeof entry.quality === "number" ? entry.quality : -1;
      return {
        itemId,
        name: entry.name,
        quality: QUALITY_NAMES[qualityIndex] ?? "unknown",
        category: typeof entry.itemClass === "string" && entry.itemClass !== "" ? entry.itemClass : "unknown",
        subCategory: typeof entry.itemSubClass === "string" && entry.itemSubClass !== "" ? entry.itemSubClass : "unknown",
        ...(typeof entry.icon === "string" && entry.icon !== "" ? { icon: entry.icon } : {}),
        minPrice: requirePositiveInt(entry.minPrice, "minPrice", key),
        marketPrice: requirePositiveInt(entry.marketPrice, "marketPrice", key),
        // P50 rides along as an auxiliary display curve (never a reference):
        // a malformed or absent value must never reject a good scan.
        ...(() => {
          const raw = entry.p50;
          if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return {};
          return { p50: Math.round(raw) };
        })(),
        quantity: requirePositiveInt(entry.quantity, "quantity", key),
        numAuctions: requirePositiveInt(entry.numAuctions, "numAuctions", key),
        vendorPrice: normalizeVendorPrice(entry.vendorP, key),
        ...(() => {
          const raw = entry.ladder as any;
          if (!raw || typeof raw !== 'object') return {};
          const arr = Array.isArray(raw) ? raw : Object.values(raw);
          const ladder = arr.filter((l: any) => l && typeof l.price === 'number' && typeof l.count === 'number');
          return ladder.length > 0 ? { ladder } : {};
        })()
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    scannedAt: new Date(scan.scannedAt * 1000),
    server: scan.server,
    faction: scan.faction,
    market: scan.market === "neutral" ? ("neutral" as const) : ("faction" as const),
    items,
    ...(normalizeRadarRules(scan.rules) !== undefined
      ? { rules: normalizeRadarRules(scan.rules) }
      : {})
  };
}

// In-game recipe dumps are auxiliary to the scan snapshot: a malformed or
// empty payload must never reject the good scan it rides with. Each recipe
// is validated in isolation and dropped on failure; entries without any
// product are useless to the profit engine and are dropped too. If nothing
// survives, the whole payload is omitted and the terminal keeps its stored
// recipes. Field names mirror the addon's Lua output (vendorP, not
// vendorPrice).
function normalizeMaterialList(raw: unknown): AddonRecipeMaterial[] {
  if (!Array.isArray(raw)) return [];
  const out: AddonRecipeMaterial[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const itemId = typeof entry.itemId === "number" && Number.isInteger(entry.itemId) && entry.itemId > 0 ? entry.itemId : NaN;
    if (!Number.isFinite(itemId)) continue;
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : `Item ${itemId}`;
    const quantity = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) && entry.quantity > 0 ? Math.round(entry.quantity) : 1;
    const material: AddonRecipeMaterial = { itemId, name, quantity };
    if (typeof entry.vendorP === "number" && Number.isFinite(entry.vendorP) && entry.vendorP > 0) {
      material.vendorPrice = Math.round(entry.vendorP);
    }
    out.push(material);
  }
  return out;
}

export function normalizeAddonRecipes(raw: unknown): AddonRecipe[] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const recipes: AddonRecipe[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.name !== "string" || entry.name === "") continue;
    const reagents = normalizeMaterialList(entry.reagents);
    const outputs = normalizeMaterialList(entry.outputs);
    if (outputs.length === 0) continue;
    recipes.push({
      name: entry.name,
      profession: typeof entry.profession === "string"
        ? PROFESSION_ZH_TO_EN[entry.profession] ?? entry.profession
        : "",
      skillLevel: typeof entry.skillLevel === "number" && Number.isFinite(entry.skillLevel)
        ? Math.max(0, Math.round(entry.skillLevel))
        : 0,
      reagents,
      outputs
    });
  }
  return recipes.length > 0 ? recipes : undefined;
}

// In-game price history is auxiliary to the scan snapshot: a malformed or
// empty points table must never reject the import. Each item's points are
// validated in isolation and dropped on failure; if nothing survives the
// whole points payload is omitted. Points are appended by the addon on
// every completed scan and pruned to the last 7 days (192 points max).
export function normalizeAddonPoints(raw: unknown): AddonPoint[] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const points: AddonPoint[] = [];
  for (const [key, value] of Object.entries(source)) {
    const itemId = Number(key);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (typeof value !== "object" || value === null) continue;
    // Lua array of point tables -> parser keys them "1", "2", ...
    for (const pointValue of Object.values(value as Record<string, unknown>)) {
      if (typeof pointValue !== "object" || pointValue === null) continue;
      const point = pointValue as Record<string, unknown>;
      if (typeof point.t !== "number" || !Number.isFinite(point.t) || point.t <= 0) continue;
      if (typeof point.c !== "number" || !Number.isFinite(point.c) || point.c <= 0) continue;
      const quantity = typeof point.q === "number" && Number.isFinite(point.q) && point.q >= 0 ? Math.round(point.q) : 0;
      // c50 is the display-only P50 close; absent on old points, and a bad
      // value must not reject the good P10 point it rides with.
      const p50 = typeof point.c50 === "number" && Number.isFinite(point.c50) && point.c50 > 0 ? Math.round(point.c50) : undefined;
      points.push({
        itemId,
        timestamp: new Date(point.t * 1000),
        marketPrice: Math.round(point.c),
        ...(p50 !== undefined ? { p50 } : {}),
        quantity
      });
    }
  }
  return points.length > 0 ? points : undefined;
}
