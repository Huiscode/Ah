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
  SCAN_AUTOSAVE_ARMED = " Auto-save in 1 min (UI reload, data to disk + terminal).",
  AUTOSAVE_RELOAD = "Auto-save: reloading the UI to write the scan to disk.",
  AUTOSAVE_COMBAT = "In combat — auto-save deferred 1 min.",
  AUTOSAVE_CYCLE_RESUME = "Auto-save cycle: reopened the auction house — rescanning when the cooldown ends.",
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
  OPT_AUTOSAVE = "Auto-save after each scan",
  OPT_AUTOSAVE_TIP = "One minute after each completed scan, reload the UI so the data is written to disk and synced to the desktop terminal; the AH reopens and the next scan starts on its own. Leave this on overnight with the monitor off; turn it off while you are actively playing.",
  OPT_TOOLTIP = "Price info on item tooltips",
  OPT_TOOLTIP_TIP = "Market/min price, averages, trend, range, supply and volatility on every item tooltip.",
  OPT_CHART = "Price chart beside the auction frame",
  OPT_CHART_TIP = "3-hour and 48-hour line charts for the item most recently hovered while the AH is open.",
  OPT_VERBOSE = "Verbose scan progress",
  OPT_VERBOSE_TIP = "Print per-page progress during paged fallback scans.",
  -- radar tunables (route 2: the in-game panel is the authority)
  OPT_RADAR_HEADER = "Deal radar thresholds (applied immediately)",
  OPT_RADAR_NOTE = "Enter to commit a number; toggles apply at once. Saved on logout/reload and synced to the terminal with the next scan.",
  OPT_R_SUPPLYSHRINK = "A: supply-shrink gate",
  OPT_R_SUPPLYSHRINK_TIP = "Require the last four scans' listed quantity to have shrunk by the threshold below — the supply is being bought up (fast turnover), not sitting on the board. Off = no requirement.",
  OPT_R_SHRINK = "A threshold (negative change, e.g. -0.15)",
  OPT_R_SHRINK_TIP = "Net change over the last four scans' listed quantity, as a fraction. -0.15 means supply must shrink by at least 15% to pass. Enter a negative number; positives are flipped.",
  OPT_R_CAP = "C: supply cap (0 = off)",
  OPT_R_CAP_TIP = "Exclude items whose latest listed quantity exceeds this — oversupplied goods are a hoarding risk. 0 disables the cap.",
  OPT_R_MINPROFIT = "minProfit (copper)",
  OPT_R_MINPROFIT_TIP = "Absolute profit floor in copper: below this the spread is noise, not a deal. Early-server economy: 30c is a good dust floor.",
  OPT_R_RATIO = "minProfitRatio (0-1)",
  OPT_R_RATIO_TIP = "Profit must also be at least this fraction of the 7d P10 median, so the floor scales with the economy. 0.25 = profit >= 25% of med7.",
  OPT_R_MAXDISC = "maxDiscount (0-1)",
  OPT_R_MAXDISC_TIP = "Deepest discount the radar trusts: past this the reference is broken, not the listing cheap. 0.75 allows up to -75% off med7.",
  OPT_R_MINAUC = "minAuctions",
  OPT_R_MINAUC_TIP = "Minimum listing count for a real market: fewer sellers = no market to buy into. 3 = default.",
  OPT_R_DISTINCT = "minMed7Distinct",
  OPT_R_DISTINCT_TIP = "Distinct 7d P10 values required: a flat series is one camper's ask, not a market. 2 = default.",
  OPT_R_HISTORY = "minHistory",
  OPT_R_HISTORY_TIP = "Scans inside the 7d window before the median means anything. 3 = default.",
  SETTINGS_AH_RESTORED = "Settings closed - auction house restored. Run /wahscan to rescan."
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
  L.SCAN_AUTOSAVE_ARMED = " 将于 1 分钟后自动重载保存（数据写入磁盘并同步网页终端）。"
  L.AUTOSAVE_RELOAD = "自动保存：正在重载界面，将本次扫描写入磁盘。"
  L.AUTOSAVE_COMBAT = "战斗中 — 自动保存推迟 1 分钟。"
  L.AUTOSAVE_CYCLE_RESUME = "自动保存循环：已重新打开拍卖行 — 冷却结束后自动重扫。"
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
  L.OPT_AUTOSAVE = "每次扫描后自动保存"
  L.OPT_AUTOSAVE_TIP = "每次扫描完成 1 分钟后自动重载界面，把数据写入磁盘并同步到网页终端；重载后自动重开拍卖行、冷却结束自动继续下一轮。夜里挂机/关显示器时开启；白天自己操作时请关闭。"
  L.OPT_TOOLTIP = "物品提示框显示价格信息"
  L.OPT_TOOLTIP_TIP = "在每个物品提示框显示市价/最低价、均价、趋势、区间、供给与波动率。"
  L.OPT_CHART = "拍卖行旁显示价格图表"
  L.OPT_CHART_TIP = "拍卖行开着时，为最近悬停的物品显示 3 小时与 48 小时折线图。"
  L.OPT_VERBOSE = "详细扫描进度"
  L.OPT_VERBOSE_TIP = "逐页降级扫描时每页播报进度。"
  L.OPT_RADAR_HEADER = "捡漏雷达参数（改动立即生效）"
  L.OPT_RADAR_NOTE = "数字回车提交；开关即时生效。小退或 /reload 后保存，并随下次扫描同步到网页终端。"
  L.OPT_R_SUPPLYSHRINK = "供给收缩"
  L.OPT_R_SUPPLYSHRINK_TIP = "要求最近 4 次扫描的在售量按下方阈值收缩——说明供给在被买走（周转快），而不是压在货架上。关闭则不要求。"
  L.OPT_R_SHRINK = "供给收缩阈值（负数，如 -0.15）"
  L.OPT_R_SHRINK_TIP = "最近 4 次扫描在售量的净变化比例。-0.15 表示在售量至少收缩 15% 才算通过。输入负数；正数会自动取负。"
  L.OPT_R_CAP = "供给量上限（0=关闭）"
  L.OPT_R_CAP_TIP = "排除最新在售量超过该上限的物品——供给过剩的商品有囤积风险。0 表示不设上限。"
  L.OPT_R_MINPROFIT = "绝对利润下限（铜）"
  L.OPT_R_MINPROFIT_TIP = "绝对利润下限（铜）：低于此价差的都是噪音而非机会。开服初期经济下 30 铜是合适的灰尘下限。"
  L.OPT_R_RATIO = "相对利润下限（0-1）"
  L.OPT_R_RATIO_TIP = "利润还须达到 7 日P10中位的这一比例，让下限随物价缩放。0.25 = 利润不低于中位的 25%。"
  L.OPT_R_MAXDISC = "最大折扣（0-1）"
  L.OPT_R_MAXDISC_TIP = "雷达信任的最大折扣：超过此深度说明参考价已失效，而不是挂单便宜。0.75 允许低于中位最多 75%。"
  L.OPT_R_MINAUC = "最低挂单数"
  L.OPT_R_MINAUC_TIP = "构成真实市场所需的最低挂单数：挂单太少就没有可买入的市场。3=默认。"
  L.OPT_R_DISTINCT = "中位去重样本"
  L.OPT_R_DISTINCT_TIP = "要求的 7 日 P10 去重样本数：完全平坦的序列是一个蹲守卖家的报价，不是市场。2=默认。"
  L.OPT_R_HISTORY = "历史样本数"
  L.OPT_R_HISTORY_TIP = "7 日窗口内中位有效所需的最少扫描次数。3=默认。"
  L.SETTINGS_AH_RESTORED = "设置已关闭，已恢复拍卖行。请运行 /wahscan 重新扫描。"
end

WAH.L = L
