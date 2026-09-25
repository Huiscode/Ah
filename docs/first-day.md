# 第一天上手教程

从零开始，30 分钟内让第一条价格曲线出现在终端里。

## 前置条件

- Windows + 魔兽世界无限服（WoW: Forever / Infinite）Beta 客户端（1.60.1，客户端目录为 `_classic_beta_`）
- Node.js 20+

## 第 1 步：启动 web 终端（约 5 分钟）

```powershell
cd <项目目录>  # 例如 X:\path\to\wowderhoi-ah
Copy-Item .env.example .env
npm install
npm run db:push
npm run dev
```

打开 `http://localhost:3000`。此时市场是空的——真实数据在第 4 步接入后出现。

## 第 2 步：安装游戏内插件（约 2 分钟）

把 `addon\WoWderhoiAH` 整个文件夹复制到游戏插件目录：

```text
<游戏安装目录>\_classic_beta_\Interface\AddOns\WoWderhoiAH
```

复制后目录里应直接可见 `WoWderhoiAH.toc`（不能多套一层文件夹）。如果游戏已经开着，需要重新登录角色（或 `/reload`）才会加载插件。

## 第 3 步：第一次扫描（约 5–15 分钟，取决于拍卖行体量）

1. 进游戏，走到拍卖师面前打开拍卖行。
2. 聊天框输入 `/wahscan`。
3. 插件发起全量复制扫描（`C_AuctionHouse.ReplicateItems`），数据跨帧流式到达，聊天框会滚动显示进度。全量扫描共享约 15 分钟的服务器冷却——若提示冷却中，等冷却结束或稍后再试。
4. 看到 `Scan complete: N items recorded` 即扫描完成。
5. **小退到角色选择界面或 `/reload`** —— 这一步是必须的：魔兽客户端只在退出/重载时才把数据写入磁盘。

## 第 4 步：接通数据管道（约 3 分钟）

找到你的 SavedVariables 文件。无限服 Beta 客户端的目录是 `_classic_beta_`，插件数据写在账号级 SavedVariables 里，路径形如（注意：该客户端按**插件名**落盘，文件名是 `WoWderhoiAH.lua`，不是变量名）：

```text
<游戏安装目录>\_classic_beta_\WTF\Account\<你的账号ID>\SavedVariables\WoWderhoiAH.lua
```

写进 `.env`：

```ini
AQT_SAVEDVARS_PATH="<游戏安装目录>\\_classic_beta_\\WTF\\Account\\<你的账号ID>\\SavedVariables\\WoWderhoiAH.lua"
```

保持 `npm run dev` 运行，另开一个终端：

```powershell
npm run addon:watch
```

看到 `Imported N items from scan ...` 就说明第一批快照已入库。刷新 `http://localhost:3000`，市场总览已经是你服务器的真实行情。

## 日常循环

之后每天只需要：开拍卖行 → `/wahscan` → 小退或 `/reload`（全量扫描有约 15 分钟冷却，扫完一次稍等再扫）。`addon:watch` 会自动发现新扫描并入库；同一次扫描不会重复导入。快照积累两天以上后，商品详情页的价格曲线和均线开始有意义。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 插件列表里没有 WoWderhoiAH | `.toc` 不在文件夹第一层，或没重新登录 |
| `/wahscan` 提示先开拍卖行 | 必须站在拍卖师面前且拍卖行窗口开着 |
| watcher 报 `AQT_SAVEDVARS_PATH is not set` | `.env` 里没配路径，或路径带引号错误 |
| watcher 一直没反应 | 忘了小退/`/reload`，数据还没写到磁盘 |
| 导入报 409 | 同一次扫描已导入过，正常现象 |
| 每次 reload 后数据变 0，文件被清空 | 覆盖新插件文件后必须**完全退出游戏重开**（/reload 不会重新读取 TOC 声明，会读不到旧数据并在退出时把空数据写盘覆盖） |
