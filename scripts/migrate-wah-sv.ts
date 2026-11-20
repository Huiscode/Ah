// 一次性存档迁移（2026-11-20）：WAH* 变量从 Auctionator.lua 搬到旁挂插件存档。
//
// 背景：2026-10-15 ~ 11-20 转录/商人价模块并入了改造版 Auctionator，WAH* SavedVariables
// 由 Auctionator.toc 声明 → 落盘在 Auctionator.lua。现在 Auctionator 恢复原版、WAH* 改由
// 旁挂插件 WoWderhoiAH-Transcript 声明 → 落盘在 WoWderhoiAH-Transcript.lua。
// 不迁移的话，首次用原版 Auctionator 登出时这些表会被丢弃（游戏内商人价、补档队列等）。
//
// 必须在游戏关闭时运行（游戏退出时会用内存里的值覆盖存档）。deploy-addon.ps1 会自动调用。
// 跑法：npx tsx scripts/migrate-wah-sv.ts [--force]
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extractTopLevelVariable } from "@/lib/auctionator-sv";

process.loadEnvFile();

const WAH_VARS = ["WAHTranscribeDB", "WAHTranscribeState", "WAHVendorDB", "WAHReloadOpts", "WAHScanTimes"];
const LIVE_WINDOW_MS = 10 * 60 * 1000;

function main() {
  const legacy = process.env.AQ_AUCTIONATOR_SV_PATH;
  if (!legacy) {
    console.log("未配置 AQ_AUCTIONATOR_SV_PATH，跳过存档迁移。");
    return;
  }
  const target = legacy.replace(/Auctionator\.lua$/i, "WoWderhoiAH-Transcript.lua");
  if (!existsSync(legacy)) {
    console.log(`找不到 ${legacy}，跳过存档迁移。`);
    return;
  }
  const force = process.argv.includes("--force");
  if (!force && existsSync(target) && statSync(target).mtimeMs >= statSync(legacy).mtimeMs - LIVE_WINDOW_MS) {
    console.log(`旁挂插件存档已是最新（${target}），无需迁移。`);
    return;
  }

  // latin1 读写 = 字节保真（存档里可能有任意字节的物品名/CBOR 串）
  const legacySource = readFileSync(legacy, "latin1");
  const targetSource = existsSync(target) ? readFileSync(target, "latin1") : "";
  const blocks: string[] = [];
  const migrated: string[] = [];
  for (const name of WAH_VARS) {
    const fromLegacy = extractTopLevelVariable(legacySource, name);
    const fromTarget = extractTopLevelVariable(targetSource, name);
    const block = fromLegacy ?? fromTarget;
    if (block !== null) {
      blocks.push(`${name} = ${block}`);
      if (fromLegacy !== null) migrated.push(name);
    }
  }
  if (migrated.length === 0) {
    console.log("Auctionator.lua 里没有 WAH* 变量（已迁移过或从未使用），无需迁移。");
    return;
  }
  if (existsSync(target)) {
    const backup = `${target}.bak-${Date.now()}`;
    copyFileSync(target, backup);
    console.log(`已备份旧存档 → ${backup}`);
  }
  writeFileSync(target, `\n${blocks.join("\n")}\n`, "latin1");
  console.log(`✅ 已迁移 ${migrated.join("、")} → ${target}`);
}

main();
