// Route-2 tunables: the in-game options panel owns the deal-radar
// thresholds. These tests pin (a) the three optional liquidity gates
// A/B/C behaving identically in Lua (Trade.lua) and TS (analytics.ts),
// and (b) the settings panel persisting into WAH.settings.radar and
// applying to WAH.RADAR immediately.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";
import { buildDealRadar, buildMarketSignal } from "@/lib/analytics";
import { dealRadarRules, type DealRadarRules } from "@/lib/market-rules";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-24T12:00:00Z");
const VENDOR_TAG = " [NPC必赚]";

type Candidate = {
  itemId: number;
  name: string;
  minPrice: number;
  numAuctions: number;
  quantity?: number;
  closes: number[]; // P10 series, oldest first, one per scan
  qs?: number[]; // listed quantity per scan, feeds gate A
};

// Control: moving reference, live book, shrinking supply, well under cap.
const CLEAN: Candidate = {
  itemId: 1, name: "Clean", minPrice: 8000, numAuctions: 6, quantity: 100,
  closes: [10000, 11000, 12000, 11000], qs: [100, 95, 90, 80]
};

function addonWith(candidates: Candidate[], rules: Partial<DealRadarRules>): WowLua {
  const lua = loadAddon();
  lua.setScan(candidates.map((candidate) => ({
    itemId: candidate.itemId,
    name: candidate.name,
    minPrice: candidate.minPrice,
    vendorP: 0,
    numAuctions: candidate.numAuctions,
    quantity: candidate.quantity ?? 100
  })));
  lua.setPoints(candidates.map(({ itemId, closes, qs }) => ({ itemId, closes, qs })));
  lua.openTab();
  for (const [key, value] of Object.entries(rules)) {
    lua.exec(`WowTest.ns.RADAR.${key} = ${JSON.stringify(value)}`);
  }
  lua.findDeals();
  return lua;
}

function addonNames(lua: WowLua): string[] {
  return lua.names().map((name) => name.replace(VENDOR_TAG, ""));
}

function webWith(candidates: Candidate[], rules: Partial<DealRadarRules>): string[] {
  const signals = candidates.map((candidate) => {
    const last = candidate.closes.length - 1;
    return buildMarketSignal({
      itemId: candidate.itemId,
      name: candidate.name,
      quality: "common",
      category: "商品",
      subCategory: "其他",
      icon: null,
      vendorPrice: 0,
      snapshots: candidate.closes.map((price, index) => ({
        timestamp: new Date(NOW.getTime() - (last - index) * DAY),
        server: "TestRealm",
        faction: "Alliance",
        marketPrice: price,
        minPrice: index === last ? candidate.minPrice : price,
        quantity: candidate.qs ? candidate.qs[index] : candidate.quantity ?? 100,
        numAuctions: index === last ? candidate.numAuctions : 10
      })),
      dailySummaries: []
    }, NOW);
  });
  return buildDealRadar(signals, { ...dealRadarRules, ...rules }).map((row) => row.name);
}

describe("liquidity gate A (supply shrink)", () => {
  const INFLATED: Candidate = {
    itemId: 2, name: "Piling Up", minPrice: 8000, numAuctions: 6, quantity: 130,
    closes: [10000, 11000, 12000, 11000], qs: [100, 110, 120, 130]
  };
  const RULES = { supplyShrink: true, supplyShrinkMax: -0.15 } as const;

  it("admits a shrinking supply and rejects a piling one, identically in Lua and TS", () => {
    expect(addonNames(addonWith([CLEAN, INFLATED], RULES))).toEqual(["Clean"]);
    expect(webWith([CLEAN, INFLATED], RULES)).toEqual(["Clean"]);
  });

  it("gate A is inert while switched off", () => {
    expect(addonNames(addonWith([CLEAN, INFLATED], {}))).toEqual(["Clean", "Piling Up"]);
    expect(webWith([CLEAN, INFLATED], {})).toEqual(["Clean", "Piling Up"]);
  });
});

describe("liquidity gate C (supply cap)", () => {
  const OVERSOLD: Candidate = {
    itemId: 4, name: "Oversold", minPrice: 8000, numAuctions: 6, quantity: 1000,
    closes: [10000, 11000, 12000, 11000], qs: [1100, 1050, 1000, 1000]
  };
  const RULES = { supplyCap: 500 } as const;

  it("excludes an oversupplied listing, identically in Lua and TS", () => {
    expect(addonNames(addonWith([CLEAN, OVERSOLD], RULES))).toEqual(["Clean"]);
    expect(webWith([CLEAN, OVERSOLD], RULES)).toEqual(["Clean"]);
  });

  it("cap 0 disables the gate", () => {
    expect(addonNames(addonWith([CLEAN, OVERSOLD], { supplyCap: 0 }))).toEqual(["Clean", "Oversold"]);
    expect(webWith([CLEAN, OVERSOLD], { supplyCap: 0 })).toEqual(["Clean", "Oversold"]);
  });
});

describe("settings panel (in-game authority)", () => {
  it("initializes settings.radar from the compiled defaults on ADDON_LOADED", () => {
    const lua = loadAddon();
    expect(lua.eval("WowTest.ns.settings.radar.minProfit")).toBe(dealRadarRules.minProfit);
    expect(lua.eval("WowTest.ns.settings.radar.supplyShrinkMax")).toBe(dealRadarRules.supplyShrinkMax);
    expect(lua.eval("WowTest.ns.settings.radar.supplyShrink")).toBe(false);
  });

  it("committing a number in the panel updates settings.radar and the live rules at once", () => {
    const lua = loadAddon();
    lua.exec(`
      local panel = _G.WoWderhoiAHSettingsPanel
      panel:Show()
      local box = panel.radarBoxes[1]
      box:SetText("50")
      box._scripts.OnEnterPressed(box)
    `);
    expect(lua.eval("WowTest.ns.settings.radar.minProfit")).toBe(50);
    expect(lua.eval("WowTest.ns.RADAR.minProfit")).toBe(50);
  });

  it("rejects non-numeric input without touching the stored value", () => {
    const lua = loadAddon();
    lua.exec(`
      local panel = _G.WoWderhoiAHSettingsPanel
      panel:Show()
      local box = panel.radarBoxes[1]
      box:SetText("abc")
      box._scripts.OnEnterPressed(box)
    `);
    expect(lua.eval("WowTest.ns.settings.radar.minProfit")).toBe(dealRadarRules.minProfit);
    expect(lua.eval("WowTest.ns.RADAR.minProfit")).toBe(dealRadarRules.minProfit);
  });

  it("toggling the A checkbox applies immediately", () => {
    const lua = loadAddon();
    lua.exec(`
      local panel = _G.WoWderhoiAHSettingsPanel
      panel:Show()
      local check = panel.radarChecks[1]
      check:SetChecked(true)
      check._scripts.OnClick(check)
    `);
    expect(lua.eval("WowTest.ns.settings.radar.supplyShrink")).toBe(true);
    expect(lua.eval("WowTest.ns.RADAR.supplyShrink")).toBe(true);
  });

  it("applyRadarSettings is public so any writer can re-apply persisted tunables", () => {
    const lua = loadAddon();
    lua.exec("WowTest.ns.settings.radar.maxDiscount = 0.9");
    lua.exec("WowTest.ns.applyRadarSettings()");
    expect(lua.eval("WowTest.ns.RADAR.maxDiscount")).toBe(0.9);
  });
});
