-- Localization: English base table with zhCN overrides, selected by
-- client locale. WAH.L is the single string authority for all files.

local ADDON_NAME, WAH = ...

local L = {
  -- scanner
  SCAN_OPEN_AH_FIRST = "Open the auction house first, then run /wahscan.",
  SCAN_ALREADY_RUNNING = "A scan is already running.",
  SCAN_THROTTLED = "Auction house query system throttled — wait a moment and try again.",
  SCAN_REPLICATE_START = "Starting full-house replication scan (C_AuctionHouse.ReplicateItems)...",
  SCAN_REPLICATE_COOLDOWN = "Full scan on cooldown (~%d min left). The whole-AH replication runs every 15 min.",
  SCAN_RECEIVED = "Received %d auctions, crunching...",
  SCAN_COMPLETE = "Scan complete: %d auctions -> %d items. Data lands on disk at logout or /reload.",
  SCAN_AUTO_ARMED = " Auto-rescan armed (next full scan in ~15 min).",
  SCAN_ABORTED = "Scan aborted: auction house closed.",
  SCAN_DIAG_THROTTLE = "Diag: IsThrottled=%s before replication.",
  SCAN_NO_REPLICATE = "No replication data within 12s (event never fired). The server may have rejected the request; retry later, or check for errors with /console scriptErrors 1.",
  SCAN_INCOMPLETE = "Replication stream stalled; %d incomplete entries left unrecorded. Next full scan will retry them.",
  SCAN_PROBE = "probe idx0: %d positional values | %s",
  AUTO_ON = "Auto-rescan ON: rescans every ~15 min while the AH is open. (persisted)",
  AUTO_OFF = "Auto-rescan OFF. (persisted)",
  AUTO_TRIGGER = "Auto-rescan: full-scan cooldown elapsed.",
  -- tooltip
  TT_SCAN_HEADER = "This scan (%d min ago)",
  TT_SCAN_STALE = "Scan data outdated — run /wahscan to refresh",
  TT_MIN = "Min",
  TT_SELLP = "Sell front",
  TT_HISTORY_HEADER = "History",
  TT_MED7 = "7d P10 median",
  TT_TREND = "Trend",
  TT_TREND_VS = "%+.0f%% vs 7d P10 median",
  TT_RANGE = "7d range",
  TT_RANGE_NOW = "%s - %s (now at %d%%)",
  TT_SUPPLY = "Supply",
  TT_SUPPLY_FMT = "%d listed / %d auctions",
  CHART_SUBTITLE = "%d scans | now %s",
  CHART_RANGE_3H = "Last 3 hours (P10)",
  CHART_RANGE_48H = "Last 48 hours (P10)",
  CHART_HILO = "H %s  L %s",
  CHART_EMPTY = "not enough scans in this window",
  LOADED = "loaded. %d items in price history. /wahscan to scan, /wah for status.",
  STATUS_FMT = "history: %d items | %s",
  STATUS_NO_SCAN = "no scan stored",
  STATUS_LAST_SCAN = "last scan %s, %d items (lands on disk at logout or /reload)",
  -- trade
  TRADE_TITLE = "Deal radar — scan min price vs 7d P10 median",
  SEARCH = "Search",
  FULL_SCAN = "Full Scan",
  OPTIONS = "Options",
  FIND_DEALS = "Find Deals",
  BUY = "Buy",
  FIND = "Find",
  SEARCH_NEED_TEXT = "Type an item name first, then Search.",
  SEARCH_NONE = "No items named \"%s\" in this scan.",
  BUY_PENDING = "A purchase is being verified — wait for it to finish.",
  BUY_QUERYING = "Verifying live listing for %s...",
  BUY_FAILED = "Could not build an item key for this item — it may have variants.",
  NO_BUYABLE = "No valid buyout listing right now (all bid-only or yours).",
  DEALS_NEED_SCAN = "No scan this session — run Full Scan first, then Find Deals.",
  DEALS_NEED_HISTORY = "No price history yet — scan a couple of times and it accumulates automatically.",
  DEALS_NONE = "No deals: nothing listed 15%%+ below its 7d P10 median right now.",
  DEALS_FOUND = "%d deals found (min price vs 7d P10 median).",
  COL_ITEM = "Item",
  VENDOR_TAG = "NPC",
  COL_DISC = "Disc",
  COL_PROFIT = "Profit",
  COL_REF = "Reference",
  COL_QTY = "Qty",
  COL_UNIT = "Unit",
  COL_TOTAL = "Total",
  COL_P10 = "P10",
  -- Money suffixes and sort markers sit in the locale table because they
  -- are font coverage, not translation: FRIZQT__ has no arrow glyphs
  -- while the zhCN fonts carry the full CJK symbol block.
  MONEY_G = "g",
  MONEY_S = "s",
  MONEY_C = "c",
  SORT_ASC = "^",
  SORT_DESC = "v",
  BOUGHT = "Bought %s x%d for %s.",
  SELL_NO_DATA = "No price data for %s — scan first (/wahscan).",
  SELL_SUGGEST = "Suggested sell price for %s x%d: %s buyout (undercut, %s data).",
  -- settings
  OPT_SUBTITLE = "/wahscan scan now | /wahauto toggle auto-rescan | /wah status",
  OPT_AUTOSCAN = "Auto-rescan at the auction house",
  OPT_AUTOSCAN_TIP = "Rescan automatically every ~15 minutes (full-scan cooldown) while the AH window stays open.",
  OPT_TOOLTIP = "Price info on item tooltips",
  OPT_TOOLTIP_TIP = "Market/min price, averages, trend, range, supply and volatility on every item tooltip.",
  OPT_CHART = "Price chart beside the auction frame",
  OPT_CHART_TIP = "3-hour and 48-hour line charts for the item most recently hovered while the AH is open.",
  OPT_VERBOSE = "Verbose scan progress",
  OPT_VERBOSE_TIP = "Print per-page progress during paged fallback scans."
}

if GetLocale() == "zhCN" then
  L.SCAN_OPEN_AH_FIRST = "请先打开拍卖行，再运行 /wahscan。"
  L.SCAN_ALREADY_RUNNING = "已有扫描正在进行。"
  L.SCAN_THROTTLED = "拍卖行查询系统被节流 — 稍等片刻再试。"
  L.SCAN_REPLICATE_START = "开始全量复制扫描（C_AuctionHouse.ReplicateItems）..."
  L.SCAN_REPLICATE_COOLDOWN = "全量扫描冷却中（约剩 %d 分钟）。整个拍卖行的复制扫描每 15 分钟一次。"
  L.SCAN_RECEIVED = "已接收 %d 条拍卖，处理中..."
  L.SCAN_COMPLETE = "扫描完成：%d 条拍卖 -> %d 种商品。小退或 /reload 后写入磁盘。"
  L.SCAN_AUTO_ARMED = " 自动重扫已就绪（约 15 分钟后下一次全量扫描）。"
  L.SCAN_ABORTED = "扫描中止：拍卖行已关闭。"
  L.SCAN_DIAG_THROTTLE = "诊断：发起复制前 IsThrottled=%s。"
  L.SCAN_NO_REPLICATE = "12 秒内未收到复制数据（事件未触发）。服务器可能拒绝了复制请求；可稍后重试，或用 /console scriptErrors 1 查看是否有报错。"
  L.SCAN_INCOMPLETE = "复制数据流停滞；%d 条不完整条目未记录。下次全量扫描会重试。"
  L.SCAN_PROBE = "探针 idx0：%d 个位置值 | %s"
  L.AUTO_ON = "自动重扫已开启：拍卖行开着时每约 15 分钟重扫一次。（已保存）"
  L.AUTO_OFF = "自动重扫已关闭。（已保存）"
  L.AUTO_TRIGGER = "自动重扫：全量扫描冷却结束。"
  L.TT_SCAN_HEADER = "本次扫描（%d 分钟前）"
  L.TT_SCAN_STALE = "扫描数据已过期 — 请 /wahscan 重新扫描"
  L.TT_MIN = "最低价"
  L.TT_SELLP = "建议卖价"
  L.TT_HISTORY_HEADER = "历史"
  L.TT_MED7 = "7日P10中位"
  L.TT_TREND = "趋势"
  L.TT_TREND_VS = "%+.0f%% 相对7日P10中位"
  L.TT_RANGE = "7日区间"
  L.TT_RANGE_NOW = "%s - %s（当前位于 %d%%）"
  L.TT_SUPPLY = "供给"
  L.TT_SUPPLY_FMT = "在售 %d 件 / %d 笔拍卖"
  L.CHART_SUBTITLE = "%d 次扫描 | 现价 %s"
  L.CHART_RANGE_3H = "最近 3 小时（P10 低位价）"
  L.CHART_RANGE_48H = "最近 48 小时（P10 低位价）"
  L.CHART_HILO = "高 %s  低 %s"
  L.CHART_EMPTY = "该时间窗内扫描次数不足"
  L.LOADED = "已加载。价格历史 %d 种商品。/wahscan 扫描，/wah 查看状态。"
  L.STATUS_FMT = "历史：%d 种商品 | %s"
  L.STATUS_NO_SCAN = "尚无扫描记录"
  L.STATUS_LAST_SCAN = "上次扫描 %s，%d 种商品（小退或 /reload 后写入磁盘）"
  L.TRADE_TITLE = "捡漏雷达 — 扫描最低价 vs 7日P10中位"
  L.SEARCH = "搜索"
  L.FULL_SCAN = "全量扫描"
  L.OPTIONS = "设置"
  L.FIND_DEALS = "找便宜"
  L.BUY = "购买"
  L.FIND = "查找"
  L.SEARCH_NEED_TEXT = "请先输入物品名称，再点搜索。"
  L.SEARCH_NONE = "本次扫描中没有名为 \"%s\" 的物品。"
  L.BUY_PENDING = "正在核验购买 — 请等待完成。"
  L.BUY_QUERYING = "正在核验 %s 的实时挂单..."
  L.BUY_FAILED = "无法构造该物品的 itemKey — 可能带随机属性变体。"
  L.NO_BUYABLE = "当前没有有效的一口价挂单（全部仅竞拍或为本人挂单）。"
  L.DEALS_NEED_SCAN = "本次会话尚未扫描 — 先点全量扫描，再点找便宜。"
  L.DEALS_NEED_HISTORY = "还没有价格历史 — 多扫几次会自动积累。"
  L.DEALS_NONE = "暂无便宜货：当前没有低于 7 日P10中位 15%% 以上的挂单。"
  L.DEALS_FOUND = "发现 %d 个捡漏机会（最低价 vs 7日P10中位）。"
  L.COL_ITEM = "物品"
  L.VENDOR_TAG = "NPC必赚"
  L.COL_DISC = "折扣"
  L.COL_PROFIT = "利润"
  L.COL_REF = "参考价"
  L.COL_QTY = "数量"
  L.COL_UNIT = "单价"
  L.COL_TOTAL = "总价"
  L.COL_P10 = "P10"
  L.MONEY_G = "金"
  L.MONEY_S = "银"
  L.MONEY_C = "铜"
  L.SORT_ASC = "▲"
  L.SORT_DESC = "▼"
  L.BOUGHT = "已购买 %s x%d，花费 %s。"
  L.SELL_NO_DATA = "%s 没有价格数据 — 请先扫描（/wahscan）。"
  L.SELL_SUGGEST = "%s x%d 建议卖价：一口价 %s（压价，%s 数据）。"
  L.OPT_SUBTITLE = "/wahscan 立即扫描 | /wahauto 切换自动重扫 | /wah 查看状态"
  L.OPT_AUTOSCAN = "拍卖行自动重扫"
  L.OPT_AUTOSCAN_TIP = "拍卖行开着时每约 15 分钟（全量扫描冷却）自动重扫。"
  L.OPT_TOOLTIP = "物品提示框显示价格信息"
  L.OPT_TOOLTIP_TIP = "在每个物品提示框显示市价/最低价、均价、趋势、区间、供给与波动率。"
  L.OPT_CHART = "拍卖行旁显示价格图表"
  L.OPT_CHART_TIP = "拍卖行开着时，为最近悬停的物品显示 3 小时与 48 小时折线图。"
  L.OPT_VERBOSE = "详细扫描进度"
  L.OPT_VERBOSE_TIP = "逐页降级扫描时每页播报进度。"
end

WAH.L = L
