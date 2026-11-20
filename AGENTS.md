# AGENTS.md

AI 接手必读上下文：[docs/AI.md](docs/AI.md)（产品全貌、数据链路、拍板口径、坑、协作纪律、命令速查）。

关键纪律速记：
- 回复用中文；不主动 git 提交/推送（用户说"提交/推"才动）。
- 本机常驻 `npm run watch` 与网页服务，别乱杀进程；服务用 `C:\Program Files\nodejs\node.exe`。
- 改游戏插件只改 `addon-auctionator\` 受控副本再同步；数据严禁混市场槽。
- 网页双语（英文默认）：文案用 `L(lang, "EN", "中文")` 内联双语；物品显示名用 `displayName(name, nameEn, lang)`。
- 改含中文的文件勿用 PowerShell 5.1 文本读写（ANSI 编码坑，见 docs/AI.md §6.12）。
