// Watches the WoW SavedVariables file written by the WoWderhoiAH addon
// and posts each new scan to the terminal import endpoint. Also polls the
// web terminal for radar rule changes and writes them back to SavedVariables
// so the user can tune thresholds from the browser.
import { readFileSync, writeFileSync, watchFile } from "node:fs";
import { parseSavedVariables } from "@/lib/addon-scan";
import { SCAN_PIPELINE_VERSION } from "@/lib/market-rules";

process.loadEnvFile();

const savedVarsPath = process.env.AQT_SAVEDVARS_PATH;
if (!savedVarsPath) throw new Error("AQT_SAVEDVARS_PATH not set");
const importUrl = process.env.AQT_IMPORT_URL ?? "http://localhost:3000/api/import/addon-scan";
const rulesUrl = importUrl.replace(/\/addon-scan\/?$/, "/rules");
const ledgerUrl = (process.env.AQT_IMPORT_URL ?? "http://localhost:3000/api/import/addon-scan").replace(/\/addon-scan\/?$/, "/ledger");

const statePath = new URL("./.watch-state.json", import.meta.url);
function readState(): { lastImportedScanAt: number } {
  try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return { lastImportedScanAt: 0 }; }
}
function writeState(state: { lastImportedScanAt: number }) { writeFileSync(statePath, JSON.stringify(state), "utf8"); }

let state = readState();
let lastImportedScanAt = state.lastImportedScanAt ?? 0;
let lastSentRulesJson = "";
let lastWebRulesJson = "";

async function syncRulesIfChanged(parsed: Record<string, unknown>) {
  const db = parsed.WoWderhoiAHDB as Record<string, unknown> | undefined;
  const settings = db?.settings as Record<string, unknown> | undefined;
  const radarRules = settings?.radar;
  if (radarRules === undefined) return;
  const json = JSON.stringify(radarRules);
  if (json === lastSentRulesJson) return;
  try {
    const res = await fetch(rulesUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
    if (res.ok) { lastSentRulesJson = json; console.log("Radar rules synced (game → web)."); }
  } catch {}
}

// Write web rules back to the Lua SavedVariables file by replacing the
// ["radar"] = { ... } block inside WoWderhoiAHDB.settings.
function writeRulesBackToLua(webRules: Record<string, unknown>) {
  const text = readFileSync(savedVarsPath!, "utf8");
  // Build the new radar block in WoW Lua syntax.
  const lines = Object.entries(webRules).map(([k, v]) => {
    if (typeof v === "boolean") return `      ["${k}"] = ${v ? "true" : "false"},`;
    if (typeof v === "number") return `      ["${k}"] = ${v},`;
    return `      ["${k}"] = "${v}",`;
  });
  const newBlock = `["radar"] = {\n${lines.join("\n")}\n    }`;
  // Match existing ["radar"] = { ... } (up to the closing brace at 4-space indent).
  const re = /\["radar"\] = \{[\s\S]*?\n  \},?/;
  if (re.test(text)) {
    const updated = text.replace(re, newBlock);
    writeFileSync(savedVarsPath!, updated, "utf8");
    console.log("Radar rules written back to SavedVariables (web → game). /reload in game.");
  }
}

async function pullWebRules(parsed: Record<string, unknown>) {
  try {
    const res = await fetch(rulesUrl);
    if (!res.ok) return;
    const webRules = await res.json();
    if (!webRules || Object.keys(webRules).length === 0) return;
    const webJson = JSON.stringify(webRules);
    if (webJson === lastWebRulesJson) return;
    lastWebRulesJson = webJson;
    // Compare with what's in the SV; if different, write back.
    const db = parsed.WoWderhoiAHDB as Record<string, unknown> | undefined;
    const gameRules = (db?.settings as Record<string, unknown> | undefined)?.radar;
    if (JSON.stringify(gameRules) !== webJson) {
      writeRulesBackToLua(webRules);
    }
  } catch {}
}

async function importLatestScan() {
  const parsed = parseSavedVariables(readFileSync(savedVarsPath!, "utf8"));
  await pullWebRules(parsed);
  await syncRulesIfChanged(parsed);

  const scan = (parsed.WoWderhoiAH_ScanData ??
    (parsed.WoWderhoiAHDB as Record<string, unknown> | undefined)?.scanData) as
    { scannedAt?: number; dataVersion?: number } | undefined;
  if (!scan || typeof scan.scannedAt !== "number") return;
  if (scan.dataVersion !== SCAN_PIPELINE_VERSION) return;
  if (scan.scannedAt <= lastImportedScanAt) return;

  const db = parsed.WoWderhoiAHDB as Record<string, unknown> | undefined;
  const settings = db?.settings as Record<string, unknown> | undefined;
  const radarRules = settings?.radar;
  const points = db?.points;
  const recipes = db?.recipes;

  const response = await fetch(importUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...scan,
      ...(radarRules !== undefined ? { rules: radarRules } : {}),
      ...(points !== undefined ? { points } : {}),
      ...(recipes !== undefined ? { recipes } : {}),
      after: lastImportedScanAt
    })
  });
  const body = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(`Import failed: ${JSON.stringify(body)}`);
  lastImportedScanAt = scan.scannedAt;
  writeState({ lastImportedScanAt });
  if (radarRules !== undefined) lastSentRulesJson = JSON.stringify(radarRules);
  console.log(`Imported ${body.imported} items from scan ${body.scannedAt}.`);
}

// Upload the trading ledger (Stage D). It rides on every watch tick so a buy
// recorded between scans still reaches the terminal promptly.
async function uploadLedger() {
  try {
    const parsed = parseSavedVariables(readFileSync(savedVarsPath!, "utf8"));
    const db = parsed.WoWderhoiAHDB as Record<string, unknown> | undefined;
    const ledger = db?.ledger;
    if (!Array.isArray(ledger) || ledger.length === 0) return;
    const res = await fetch(ledgerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledger })
    });
    if (!res.ok) return;
    const out = (await res.json()) as { imported?: number; skipped?: number };
    if (out.imported) console.log(`Ledger uploaded: ${out.imported} new records.`);
  } catch {}
}

async function main() {
  console.log(`Watching ${savedVarsPath}`);
  await importLatestScan().catch(console.error);
  watchFile(savedVarsPath!, { interval: 5000 }, () => {
    void importLatestScan().catch(console.error);
    void uploadLedger().catch(console.error);
  });
  // Periodically pull web rules even when the game hasn't scanned, so a web
  // save reaches the SV file without waiting for the next scan.
  setInterval(() => {
    const parsed = parseSavedVariables(readFileSync(savedVarsPath!, "utf8"));
    void pullWebRules(parsed).catch(console.error);
  }, 5000);
}

void main();
