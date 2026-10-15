// 修复：Item.vendor_price 全量重核——foreverchanges 物品页区分"经典旧世
// (CLASSIC ERA)"与"无限服 (FOREVER BETA)"两版属性，差异行标 it-del / it-add。
// 原抓取（m1b / vendor-price-audit）取到的是**第一个"卖价"= 经典版**，无限服
// 修改过收购价的物品全部抓错（如强效魔法杖：经典 15银35铜 vs 无限服 2银）。
//
// 本脚本以 it-add 行"卖价"（无限服版）为权威，重抓 Item 表全部物品并覆盖
// vendor_price。用户拍板（2026-10-15）：快跑不限速（M1B_INTERVAL_MS=0），
// 403 自动退避。断点续跑：scripts/.vendor-forever-fix-progress.json。
//
// 跑法：M1B_INTERVAL_MS=0 npx tsx scripts/fix-vendor-forever.ts
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS = join(__dirname, ".vendor-forever-fix-progress.json");
const INTERVAL_MS = Number(process.env.M1B_INTERVAL_MS ?? 2500);
const RETRY_DELAY_MS = 15000;

const G: Record<string, number> = { 金: 10000, 银: 100, 铜: 1 };

function parseVendorPrice(html: string): number | null {
  const addM = html.match(/class="it-line[^"]*it-add[^"]*"[^>]*>卖价[：:]\s*([^<\n]+)/);
  const m = addM ?? html.match(/卖价[：:]\s*([^<\n]+)/);
  if (!m) return null;
  const s = m[1];
  const total = (s.match(/(\d+)(金|银|铜)/g) ?? []).reduce((sum, p) => {
    const v = parseInt(p, 10);
    return sum + v * (G[p.slice(-1)] ?? 1);
  }, 0);
  return s.includes("金") || s.includes("银") || s.includes("铜") ? total : 0;
}

async function fetchText(url: string, retries = 3): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9"
        }
      });
      if (res.status === 403) {
        console.log(`403 on ${url} — 退避 ${RETRY_DELAY_MS / 1000}s`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      if (!res.ok) { console.log(`HTTP ${res.status} on ${url}`); return null; }
      return await res.text();
    } catch (e) {
      console.log(`fetch error ${url}: ${(e as Error).message.slice(0, 80)}`);
      return null;
    }
  }
  console.log(`仍 403/失败，跳过 ${url}`);
  return null;
}

async function main() {
  const p = new PrismaClient();
  const items = await p.item.findMany({ select: { itemId: true } });
  const ids = items.map((i) => i.itemId).filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const done = new Set<number>(existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, "utf8")) : []);
  const remaining = ids.filter((id) => !done.has(id));
  console.log(`Item 全部 ${ids.length}，已完成 ${done.size}，本次续跑 ${remaining.length}（间隔 ${INTERVAL_MS}ms）`);

  let ok = 0, zero = 0, noSell = 0, fail = 0;
  for (const itemId of remaining) {
    const html = await fetchText(`https://foreverchanges.pro/zh-cn/item/${itemId}`);
    if (html === null) {
      // 网站无此物品（404 等）：vendor 价无权威来源，清除脏值（勿保留
      // Auctionator 缓存时代的失真价，否则"必赚"面板会依据无来源价格误报）。
      await p.item.update({ where: { itemId }, data: { vendorPrice: 0 } });
      fail++;
    }
    else {
      const v = parseVendorPrice(html);
      if (v === null) { noSell++; }
      else {
        await p.item.update({ where: { itemId }, data: { vendorPrice: v } });
        if (v > 0) ok++; else zero++;
      }
    }
    done.add(itemId);
    writeFileSync(PROGRESS, JSON.stringify([...done]));
    if (done.size % 100 === 0 || done.size === ids.length) {
      console.log(`进度 ${done.size}/${ids.length} 更新 ${ok} 置0 ${zero} 无卖价 ${noSell} 失败 ${fail}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log(`完成: 更新 ${ok} 置0 ${zero} 无卖价 ${noSell} 失败 ${fail}`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
