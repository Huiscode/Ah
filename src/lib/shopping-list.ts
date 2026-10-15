// 购物清单：Auctionator 可导入文本的生成与解析、随机前缀基础名提取。
//
// 只支持"新版"格式（Auctionator 8.3+ 标准导出格式，也是游戏内 Export 与
// 网页"复制导入文本"的默认格式）：
//   每行一个清单："清单名^物品1^物品2"，^ 分隔，换行分隔多个清单。
// 旧版（* 分隔）与 TSM（逗号 itemID）格式按用户拍板移除（v3.4 修订）。

export type ParsedImportList = {
  name: string;
  names: string[]; // 搜索词（物品名）
};

// 随机前缀剥离：WoW 经典随机前缀掉落名形如"孤狼之轻身法杖"，同 itemId 的
// 全部前缀变体在 AH 按同一 id 挂单，Auctionator 用基础名搜索一次命中全部。
// 取"之"后部分；无"之"或"之"在首尾时保留原名（"河爪之斧"这类固定名会退化
// 为基础词，属已知取舍）。
export function baseNameOf(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return trimmed;
  const i = trimmed.indexOf("之");
  if (i > 0 && i < trimmed.length - 1) {
    return trimmed.slice(i + 1).trim() || trimmed;
  }
  return trimmed;
}

// 生成新版导入文本："清单名^物品1^物品2"。物品用基础名（搜索词）。
export function buildListImportText(listName: string, itemNames: string[]): string {
  const cleaned = listName.trim().replace(/[\n^]/g, "");
  const names = itemNames.map((n) => baseNameOf(n).replace(/[\n^]/g, "")).filter(Boolean);
  return [cleaned, ...names].join("^");
}

// 解析新版导入文本，返回清单列表。无法识别返回空数组。
export function parseImportText(text: string): ParsedImportList[] {
  if (!text || typeof text !== "string") return [];
  const input = text.replace(/\r\n/g, "\n");

  if (!input.includes("^")) return [];

  const lists: ParsedImportList[] = [];
  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, ...names] = trimmed.split("^");
    if (name && names.length > 0) {
      lists.push({ name: name.trim(), names: names.map((n) => n.trim()).filter(Boolean) });
    }
  }
  return lists;
}
