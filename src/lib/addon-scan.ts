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
  minPrice: number;
  marketPrice: number; // quantity-weighted P10 unit price, copper
  quantity: number;
  numAuctions: number;
  vendorPrice: number; // NPC sell price in copper; 0 = unsellable to vendors
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
  supplyShrink?: boolean;
  supplyShrinkMax?: number;
  minAuctionsBoost?: boolean;
  minAuctionsFloor?: number;
  supplyCap?: number;
};

export type AddonScan = {
  scannedAt: Date;
  server: string;
  faction: string;
  items: AddonScanItem[];
  rules?: AddonRadarRules;
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
  "minMed7Distinct", "maxDiscount", "supplyShrinkMax", "minAuctionsFloor", "supplyCap"
] as const;
const RULE_BOOL_FIELDS = ["supplyShrink", "minAuctionsBoost"] as const;

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
        minPrice: requirePositiveInt(entry.minPrice, "minPrice", key),
        marketPrice: requirePositiveInt(entry.marketPrice, "marketPrice", key),
        quantity: requirePositiveInt(entry.quantity, "quantity", key),
        numAuctions: requirePositiveInt(entry.numAuctions, "numAuctions", key),
        vendorPrice: normalizeVendorPrice(entry.vendorP, key)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (items.length === 0) {
    throw new Error("Addon scan items contained no usable entries after filtering empty names");
  }

  return {
    scannedAt: new Date(scan.scannedAt * 1000),
    server: scan.server,
    faction: scan.faction,
    items,
    ...(normalizeRadarRules(scan.rules) !== undefined
      ? { rules: normalizeRadarRules(scan.rules) }
      : {})
  };
}
