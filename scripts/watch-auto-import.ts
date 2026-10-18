// M4.2：常驻自动导入（全自动，等价老插件 addon:watch 体验）。
//
//   npm run watch   启动后常驻：每 2 秒检查存档 mtime，检测到更新即自动导入，
//                   导入完继续监视，不退出。极轻量（statSync ×2 / 2s，~40MB）。
//                   游戏内"全量扫描 → 2 秒自动重载落盘"后，网页自动同步，
//                   全程无需任何手动操作。
//
// 双服务器（2026-10-18，用户拍板 A 方案）：
//   主服（欧服，key="eu"）= 现有 AQ_* 配置，存档路径缺省回退默认路径；
//   第二服（中国服，key="cn"）= .env 里给出 AQ_AUCTIONATOR_SV_PATH_2 才启用，
//   transcript 存档路径缺省从 Auctionator 路径同目录推导，可用
//   AQ_TRANSCRIPT_SV_PATH_2 覆盖。每个服务器独立监视、独立导入（AQ_SERVER_KEY +
//   对应存档路径注入子进程），server 列打标隔离，严禁混服。
//
// 检测依据：每组 (Auctionator.lua, WoWderhoiAH-Transcript.lua) 的
//   (mtimeMs, size) 相对上次导入是否有变化。导入 = 顺序执行
//   auctionator:import + transcript:import + vendor:import（三者均幂等），
//   全部完成后更新 .sync-last.json，继续监视。
import { execSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transcriptSvPath, loadVendorGamePrices } from "@/lib/vendor-sv";

process.loadEnvFile();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
const STATE_FILE = join(ROOT, "scripts", ".sync-last.json");
const DEFAULT_AUCTIONATOR_SV = "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\Auctionator.lua";
const POLL_MS = 2000;

type ServerWatch = {
  key: string; // 服务器短标识（server 列值，如 "eu" / "cn"）
  auctionatorSv: string;
  transcriptSv: string;
};

/** Auctionator.lua 路径 → 同目录 WoWderhoiAH-Transcript.lua（第二服缺省推导）。 */
function siblingTranscriptPath(auctionatorSv: string): string {
  return auctionatorSv.replace(/Auctionator\.lua$/, "WoWderhoiAH-Transcript.lua");
}

function serverWatches(): ServerWatch[] {
  const out: ServerWatch[] = [{
    key: process.env.AQ_SERVER_KEY ?? "eu",
    auctionatorSv: process.env.AQ_AUCTIONATOR_SV_PATH ?? DEFAULT_AUCTIONATOR_SV,
    transcriptSv: transcriptSvPath()
  }];
  const cnAuctionator = process.env.AQ_AUCTIONATOR_SV_PATH_2;
  if (cnAuctionator) {
    out.push({
      key: process.env.AQ_SERVER_KEY_2 ?? "cn",
      auctionatorSv: cnAuctionator,
      transcriptSv: process.env.AQ_TRANSCRIPT_SV_PATH_2 ?? siblingTranscriptPath(cnAuctionator)
    });
  }
  return out;
}

function filesOf(watches: ServerWatch[]): string[] {
  return watches.flatMap((w) => [w.auctionatorSv, w.transcriptSv]);
}

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
  for (const f of filesOf(serverWatches())) {
    const sig = sigOf(f);
    if (sig) state[f] = sig;
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** 相对上次导入有变化的存档路径集合（含首跑：存档存在即视为需要导入）。 */
function diffChanged(prev: Record<string, FileSig> | null): Set<string> {
  const changed = new Set<string>();
  for (const f of filesOf(serverWatches())) {
    const cur = sigOf(f);
    const old = prev?.[f];
    if (cur && (!old || old.mtimeMs !== cur.mtimeMs || old.size !== cur.size)) changed.add(f);
  }
  return changed;
}

function importServer(sw: ServerWatch): void {
  console.log(`── 检测到【${sw.key}】存档更新，开始导入 ──`);
  // 注入本服务器的标识与存档路径，子进程导入落 server 标签、读对应存档。
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AQ_SERVER_KEY: sw.key,
    AQ_AUCTIONATOR_SV_PATH: sw.auctionatorSv,
    AQ_TRANSCRIPT_SV_PATH: sw.transcriptSv
  };
  execSync("npm run auctionator:import", { cwd: ROOT, shell: SHELL, stdio: "inherit", env });
  execSync("npm run transcript:import", { cwd: ROOT, shell: SHELL, stdio: "inherit", env });
  if (loadVendorGamePrices(sw.transcriptSv)) {
    execSync("npm run vendor:import", { cwd: ROOT, shell: SHELL, stdio: "inherit", env });
  } else {
    console.log("（游戏内商人价暂无数据，跳过 vendor:import——打开商人窗口后会自动记录）");
  }
}

function importAll(changed: Set<string>): void {
  for (const sw of serverWatches()) {
    const files = [sw.auctionatorSv, sw.transcriptSv];
    if (files.some((f) => changed.has(f))) {
      importServer(sw);
    }
  }
  saveState();
  console.log("✅ 导入完成，继续监视。");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const watches = serverWatches();
  console.log(`📡 常驻自动导入已启动（每 2 秒检查存档；监视服务器：${watches.map((w) => w.key).join("、")}）。`);
  const prev = loadState();
  const first = diffChanged(prev);
  if (first.size > 0) {
    console.log("检测到存档已有更新，先导入一次。");
    importAll(first);
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_MS);
    const changed = diffChanged(loadState());
    if (changed.size > 0) {
      try {
        importAll(changed);
      } catch (e) {
        console.error(`导入失败（继续监视）：${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
