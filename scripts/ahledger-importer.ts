// Fetches the AHledger public AHL1 pricetable for the user's Forever market
// (forever.pvp.alliance.us = PvP Alliance, the single megaserver auction
// house) every 15 minutes and posts each new round to the terminal's
// ahledger import endpoint. Fully independent of the addon channel: own
// process, own log, own state file, own endpoint — the only shared surface
// is the database, where every row is tagged source="ahledger".
//
// Run:        npm run ahledger:sync
// Overrides:  .env  AHL_API_BASE / AHL_MARKET / AHL_SERVER / AHL_FACTION /
//                   AHL_IMPORT_URL / AHL_POLL_SECONDS
//
// AHL1 row format (from https://ahledger.com/developers):
//   header  AHL1|market|unixtime|rowCount
//   row     itemId:median:minBuyout:quantity:median7d:median30d:low30d:high30d
//   empty fields = unknown. The bulk feed carries no per-item auctions count.
import { readFileSync, writeFileSync } from "node:fs";

process.loadEnvFile();

const apiBase = process.env.AHL_API_BASE ?? "https://api.ahledger.com";
const market = process.env.AHL_MARKET ?? "forever.pvp.alliance.us";
const server = process.env.AHL_SERVER ?? "Classic Beta PvP 2"; // matches the addon's own scan identity
const faction = process.env.AHL_FACTION ?? "Alliance";         // matches the addon's own scan identity
const importUrl = process.env.AHL_IMPORT_URL ?? "http://localhost:3000/api/import/ahledger";
const pollSeconds = Number(process.env.AHL_POLL_SECONDS ?? 900) || 900;
const pollMs = pollSeconds * 1000;
// Terminal switch: the web UI toggles this; while disabled the importer
// pauses (checking again every 60s so it resumes promptly after re-enable)
// without touching the addon channel. Fail-open: if the toggle API is
// unreachable the importer keeps polling.
const toggleUrl = new URL("/api/ahledger/toggle", importUrl).toString();
const pausedCheckMs = 60_000;

async function isScanningEnabled(): Promise<boolean> {
  try {
    const res = await fetch(toggleUrl);
    if (!res.ok) return true;
    const json = (await res.json()) as { enabled?: boolean };
    return json.enabled !== false;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Importer restart bookkeeping: remember the last observedAt round so a
// fresh process does not re-POST the same pricetable. The route also
// de-duplicates (timestamp, server, faction, source), so a stale state file
// can never create duplicate rows — only a redundant POST.
const statePath = new URL("./.ahledger-state.json", import.meta.url);
function readState(): { lastObservedAt: number } {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as { lastObservedAt: number };
  } catch {
    return { lastObservedAt: 0 };
  }
}
function writeState(state: { lastObservedAt: number }) {
  writeFileSync(statePath, JSON.stringify(state), "utf8");
}

let state = readState();
let lastObservedAt = state.lastObservedAt ?? 0;

export type PricetableRow = { itemId: number; median: number; minBuyout: number; quantity: number };

export function parsePricetable(source: string): { observedAt: number; marketName: string; rows: PricetableRow[] } {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("AHL1 pricetable: empty response");
  const header = lines[0].split("|");
  if (header[0] !== "AHL1" || header.length < 4) {
    throw new Error(`AHL1 pricetable: bad header "${lines[0]}"`);
  }
  const observedAt = Number(header[2]);
  const rowCount = Number(header[3]);
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    throw new Error(`AHL1 pricetable: bad unixtime "${header[2]}"`);
  }
  const body = lines.slice(1);
  if (!Number.isFinite(rowCount) || rowCount !== body.length) {
    throw new Error(`AHL1 pricetable: header claims ${rowCount} rows but body has ${body.length}`);
  }
  const rows: PricetableRow[] = [];
  for (const line of body) {
    const fields = line.split(":");
    const itemId = Number(fields[0]);
    const median = Number(fields[1]);
    const minBuyout = Number(fields[2]);
    const quantity = Number(fields[3]);
    // Empty fields parse as NaN (unknown). Rows without a usable median and
    // min buyout carry no tradable price and are dropped; unknown quantity
    // is treated as 0.
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (!Number.isFinite(median) || median <= 0) continue;
    if (!Number.isFinite(minBuyout) || minBuyout <= 0) continue;
    rows.push({ itemId, median: Math.round(median), minBuyout: Math.round(minBuyout), quantity: Number.isFinite(quantity) && quantity >= 0 ? Math.round(quantity) : 0 });
  }
  return { observedAt, marketName: header[1], rows };
}

async function syncOnce(): Promise<void> {
  const response = await fetch(`${apiBase}/v1/pricetable/${market}`);
  if (!response.ok) throw new Error(`AHledger pricetable HTTP ${response.status}`);
  const text = await response.text();
  const { observedAt, marketName, rows } = parsePricetable(text);
  if (observedAt <= lastObservedAt) {
    console.log(`${new Date().toISOString()} observedAt ${observedAt} already imported, skipping (rows=${rows.length}).`);
    return;
  }
  if (rows.length === 0) {
    console.log(`${new Date().toISOString()} pricetable for ${marketName} has no importable rows; not advancing state.`);
    return;
  }
  const items = rows.map((row) => ({
    itemId: row.itemId,
    minPrice: row.minBuyout,
    marketPrice: row.median,
    quantity: row.quantity,
    numAuctions: 0
  }));
  const post = await fetch(importUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scannedAt: observedAt, server, faction, items })
  });
  const body = await post.json().catch(() => null);
  if (!post.ok && post.status !== 409) {
    throw new Error(`Import failed (${post.status}): ${JSON.stringify(body)}`);
  }
  lastObservedAt = observedAt;
  writeState({ lastObservedAt });
  console.log(
    `${new Date().toISOString()} imported ${items.length} rows from AHledger round ${new Date(observedAt * 1000).toISOString()} (${marketName})` +
    (post.status === 409 ? " — already imported (409), state advanced." : ".")
  );
}

async function main() {
  console.log(`${new Date().toISOString()} AHledger importer started: market=${market} poll=${pollSeconds}s -> ${importUrl}`);
  while (true) {
    if (!(await isScanningEnabled())) {
      console.log(`${new Date().toISOString()} website scanning disabled via terminal switch; pausing, re-check in 60s.`);
      await sleep(pausedCheckMs);
      continue;
    }
    await syncOnce().catch((error) => console.error(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`));
    await sleep(pollMs);
  }
}

void main();
