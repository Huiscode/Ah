// Watches the WoW SavedVariables file written by the WoWderhoiAH addon
// and posts each new scan to the terminal import endpoint. In-game
// history accumulates inside the addon itself (WoWderhoiAH_Points); the
// whole 7-day point series rides along with each import so an overnight
// auto-rescan session (monitor off, no reload) lands every round in the
// terminal in one shot when the player next logs out. Run alongside the
// game client:  npm run addon:watch
import { readFileSync, writeFileSync, watchFile } from "node:fs";
import { parseSavedVariables } from "@/lib/addon-scan";
import { SCAN_PIPELINE_VERSION } from "@/lib/market-rules";

// Nothing else in this process loads .env (the Prisma import that did so
// as a side effect is gone), so load it explicitly before reading config.
process.loadEnvFile();

const savedVarsPath = process.env.AQT_SAVEDVARS_PATH;
if (!savedVarsPath) {
  throw new Error(
    "AQT_SAVEDVARS_PATH is not set. Point it at the WoW SavedVariables file, e.g. " +
      "<WoW install dir>\\_classic_beta_\\WTF\\Account\\<ACCOUNT>\\SavedVariables\\WoWderhoiAH.lua " +
      "(the WoW: Forever Beta client uses the _classic_beta_ layout and names the file after the addon, " +
      "not after the variable — confirmed on a live install)"
  );
}
const importUrl = process.env.AQT_IMPORT_URL ?? "http://localhost:3000/api/import/addon-scan";

// Watcher restart bookkeeping: remember the last imported scan timestamp so
// a fresh process does not re-import the whole 7-day point history. The
// state file lives next to this script and is gitignored.
const statePath = new URL("./.watch-state.json", import.meta.url);
function readState(): { lastImportedScanAt: number } {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as { lastImportedScanAt: number };
  } catch {
    return { lastImportedScanAt: 0 };
  }
}
function writeState(state: { lastImportedScanAt: number }) {
  writeFileSync(statePath, JSON.stringify(state), "utf8");
}

let state = readState();
let lastImportedScanAt = state.lastImportedScanAt ?? 0;


async function importLatestScan() {
  const parsed = parseSavedVariables(readFileSync(savedVarsPath!, "utf8"));
  // v0.3.1+ persists everything under the single WoWderhoiAHDB variable
  // (the Forever beta refuses multi-variable TOC declarations); older scans
  // used the standalone WoWderhoiAH_ScanData global. Accept both.
  const scan = (parsed.WoWderhoiAH_ScanData ??
    (parsed.WoWderhoiAHDB as Record<string, unknown> | undefined)?.scanData) as
    { scannedAt?: number; dataVersion?: number } | undefined;
  if (!scan || typeof scan.scannedAt !== "number") {
    console.log("No WoWderhoiAH_ScanData in SavedVariables yet; waiting for the first /wahscan.");
    return;
  }
  if (scan.dataVersion !== SCAN_PIPELINE_VERSION) {
    console.log("Stale scan from an old addon version on disk — rescan in game (/wahscan) to produce current-pipeline data.");
    return;
  }
  if (scan.scannedAt <= lastImportedScanAt) return;

  // Route 2: the in-game options panel is the authority for radar rules.
  // Ride the current settings.radar along with the scan so the terminal
  // keeps rendering deals with exactly the thresholds the addon uses.
  const db = parsed.WoWderhoiAHDB as Record<string, unknown> | undefined;
  const settings = db?.settings as Record<string, unknown> | undefined;
  const radarRules = settings?.radar;
  // In-game history points, one per item per completed scan (7-day window).
  // Sent raw; the import route validates and de-duplicates them.
  const points = db?.points;

  const response = await fetch(importUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...scan,
      ...(radarRules !== undefined ? { rules: radarRules } : {}),
      ...(points !== undefined ? { points } : {}),
      after: lastImportedScanAt
    })
  });
  const body = await response.json();
  if (!response.ok && response.status !== 409) {
    throw new Error(`Import failed (${response.status}): ${JSON.stringify(body)}`);
  }
  lastImportedScanAt = scan.scannedAt;
  writeState({ lastImportedScanAt });
  console.log(
    response.status === 409
      ? `Scan ${new Date(scan.scannedAt * 1000).toISOString()} already imported, skipping.`
      : `Imported ${body.imported} items + ${body.points ?? 0} history points from scan ${body.scannedAt}.`
  );
}

async function main() {
  console.log(`Watching ${savedVarsPath}`);
  console.log(`Posting new scans to ${importUrl}`);
  await importLatestScan().catch((error) => console.error(error));
  // WoW rewrites SavedVariables on logout//reload; mtime polling is enough.
  watchFile(savedVarsPath!, { interval: 5000 }, () => {
    void importLatestScan().catch((error) => console.error(error));
  });
}

void main();
