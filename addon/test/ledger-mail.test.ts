// The mailbox scan feeds the trading ledger ("成交账本"): a money-only mail
// from the auction house is a completed sale, a mail with returned items is an
// expired lot, and won/bought mails are skipped (buys are already recorded at
// purchase-success time).
//
// The Forever client prepends an extra value to the classic GetInboxHeaderInfo
// return list, shifting every field by one. The addon must locate the fields by
// content (the sender name anchors the subject/money/itemCount), not by
// position, or a 3s sale would be misparsed into a garbage "expired" record and
// never appear in the ledger at all.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

const BOMB = 4370; // 大型铜壳炸弹

function page(): WowLua {
  const lua = loadAddon();
  // The scan cache is what itemIdFromSubject resolves names against.
  lua.setScan([{ itemId: BOMB, name: "大型铜壳炸弹", minPrice: 300, numAuctions: 1 }]);
  return lua;
}

describe("mailbox scan on the Forever-shifted header layout", () => {
  it("records a money-only sale as sell and a returned lot as expired", () => {
    const lua = page();
    lua.setInbox([
      { id: 133890, itemCount: 0, sender: "联盟拍卖行", subject: "拍卖成功：大型铜壳炸弹", money: 300 },
      { id: 133907, itemCount: 2, sender: "联盟拍卖行", subject: "拍卖已到期：石鳞鳕鱼(2)", money: 0 },
      { id: 133912, itemCount: 1, sender: "联盟拍卖行", subject: "竞拍获胜：美味鼠尾鱼", money: 0 }
    ]);
    lua.fireMailUpdate();
    lua.flushQueries(); // C_Timer.After(0.2) -> scanInbox
    const ledger = lua.ledger();
    expect(ledger.filter((r) => r.kind === "sell")).toEqual([
      expect.objectContaining({ kind: "sell", itemId: BOMB, qty: 1, unitPrice: 300, total: 300 })
    ]);
    expect(ledger.filter((r) => r.kind === "expired")).toEqual([
      expect.objectContaining({ kind: "expired", itemId: 0, qty: 2, unitPrice: 0, total: 0 })
    ]);
    expect(ledger.filter((r) => r.kind === "buy")).toHaveLength(0);
  });

  it("does not re-record the same mails when the inbox is re-scanned", () => {
    const lua = page();
    lua.setInbox([
      { id: 133890, itemCount: 0, sender: "联盟拍卖行", subject: "拍卖成功：大型铜壳炸弹", money: 300 },
      { id: 133907, itemCount: 2, sender: "联盟拍卖行", subject: "拍卖已到期：石鳞鳕鱼(2)", money: 0 }
    ]);
    lua.fireMailUpdate();
    lua.flushQueries();
    // MAIL_SHOW fires again on every mailbox open; the scan must not duplicate.
    lua.fireMailUpdate();
    lua.flushQueries();
    const ledger = lua.ledger();
    expect(ledger.filter((r) => r.kind === "sell")).toHaveLength(1);
    expect(ledger.filter((r) => r.kind === "expired")).toHaveLength(1);
  });

  it("records twin sale mails individually (same item, same price)", () => {
    const lua = page();
    lua.setInbox([
      { id: 133890, itemCount: 0, sender: "联盟拍卖行", subject: "拍卖成功：大型铜壳炸弹", money: 300 },
      { id: 133898, itemCount: 0, sender: "联盟拍卖行", subject: "拍卖成功：大型铜壳炸弹", money: 300 }
    ]);
    lua.fireMailUpdate();
    lua.flushQueries();
    expect(lua.ledger().filter((r) => r.kind === "sell")).toHaveLength(2);
  });

  it("still parses the classic header order when no extra value is present", () => {
    const lua = page();
    lua.setInbox(
      [
        { itemCount: 0, sender: "联盟拍卖行", subject: "拍卖成功：大型铜壳炸弹", money: 300 },
        { itemCount: 1, sender: "联盟拍卖行", subject: "物品购入：亚麻布", money: 0 }
      ],
      true
    );
    lua.fireMailUpdate();
    lua.flushQueries();
    const ledger = lua.ledger();
    expect(ledger.filter((r) => r.kind === "sell")).toHaveLength(1);
    expect(ledger.filter((r) => r.kind === "buy")).toHaveLength(0);
  });
});
