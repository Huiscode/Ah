// M4.2：常驻自动导入（全自动，等价老插件 addon:watch 体验）。
//
//   npm run watch   启动后常驻：每 2 秒检查存档 mtime，检测到更新即自动导入，
//                   导入完继续监视，不退出。极轻量（statSync ×2 / 2s，~40MB）。
//                   游戏内"全量扫描 → 2 秒自动重载落盘"后，网页自动同步，
//                   全程无需任何手动操作。
//
// 检测依据：Auctionator.lua 与 WoWderhoiAH-Transcript.lua 两个存档的
//   (mtimeMs, size) 相对上次导入是否有变化。导入 = 顺序执行
//   auctionator:import + transcript:import + vendor:import（三者均幂等），
//   全部完成后更新 .sync-last.json，继续监视。
import { execSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { transcriptSvPath, loadVendorGamePrices } from "@/lib/vendor-sv";

process.loadEnvFile();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
const STATE_FILE = join(ROOT, "scripts", ".sync-last.json");
const AUCTIONATOR_SV = process.env.AQ_AUCTIONATOR_SV_PATH
  ?? "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\Auctionator.lua";
const TRANSCRIPT_SV = transcriptSvPath();
const FILES = [AUCTIONATOR_SV, TRANSCRIPT_SV];
const POLL_MS = 2000;

type FileSig = { mtimeMs: number; size: number };

function sigOf(p: string): FileSig | null {
  try {
    const s = statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

function loadState(): Record<string, FileSig> | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveState(): void {
  const state: Record<string, FileSig> = {};
  for (const f of FILES) {
    const sig = sigOf(f);
    if (sig) state[f] = sig;
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** 任一存档相对上次导入有变化（含首跑：存档存在即视为需要导入）。 */
function hasChanged(prev: Record<string, FileSig> | null): boolean {
  for (const f of FILES) {
    const cur = sigOf(f);
    const old = prev?.[f];
    if (cur && (!old || old.mtimeMs !== cur.mtimeMs || old.size !== cur.size)) return true;
  }
  return false;
}

function importAll(): void {
  console.log("── 检测到存档更新，开始导入 ──");
  execSync("npm run auctionator:import", { cwd: ROOT, shell: SHELL, stdio: "inherit" });
  execSync("npm run transcript:import", { cwd: ROOT, shell: SHELL, stdio: "inherit" });
  if (loadVendorGamePrices()) {
    execSync("npm run vendor:import", { cwd: ROOT, shell: SHELL, stdio: "inherit" });
  } else {
    console.log("（游戏内商人价暂无数据，跳过 vendor:import——打开商人窗口后会自动记录）");
  }
  saveState();
  console.log("✅ 导入完成，继续监视。");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("📡 常驻自动导入已启动（每 2 秒检查存档；扫描完成自动同步网页，无需任何操作）。");
  const prev = loadState();
  if (hasChanged(prev)) {
    console.log("检测到存档已有更新，先导入一次。");
    importAll();
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_MS);
    if (hasChanged(loadState())) {
      try {
        importAll();
      } catch (e) {
        console.error(`导入失败（继续监视）：${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
