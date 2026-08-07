# manabrew-cn

> Manabrew 简体中文卡牌悬停翻译浮窗

在 [Manabrew](https://play.manabrew.app/) 悬停万智牌卡牌时，自动在预览大图旁显示简体中文翻译浮窗——卡名、类别、规则文本，并带 **法术力费用**（右上角，与牌名同行）、**攻防**（右下角，`*/*` 文本形式，含忠诚度/防御）和 **彩色 MTG 符号图标**（`{W}`、`{T}`、`{2/W}` 等，正文规则文本同样使用彩色图标）。

覆盖区域：**战场**（`data-card-preview` portal）、**手牌**、**堆叠**（React fiber 状态）、**牌组选择目录页**（`/play/offline/constructed` 等，悬停每个牌组的预览大图即可看到该牌组封面卡/主将）、以及 **牌组编辑器**（`/deck-editor`，悬停列表牌名时浮窗跟随右侧预览图实时切换）。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 点击 [`manabrew-cn.user.js`](manabrew-cn.user.js) → 用户脚本管理器应提示安装
3. 访问 https://play.manabrew.app/play/offline/constructed → 悬停战场/手牌/堆叠卡牌即可看到中文翻译

## 数据来源

本地数据库由四个数据源合并构建（~36,600 条，35,000+ 带完整规则文本）：

| 来源 | 内容 |
|------|------|
| [HeliumOctahelide/magic-cards-zhs](https://github.com/HeliumOctahelide/magic-cards-zhs) `zhs_oracle.json`（发布版 tarball） | 社区简中卡名 + 规则文本 + 类别（~34.6k 面）——即 mtgch.com 所用的 MTGZH 数据，本地化后无需运行时请求 |
| [HeliumOctahelide/magic-cards-zhs](https://github.com/HeliumOctahelide/magic-cards-zhs) `magic-cards-zhs-names.json` | 最广的社区简中卡名（36,484 条） |
| MTGJSON `AtomicCards.json` | 法术力费用、攻防/忠诚度/防御，以及官方中文文本兜底 |
| Scryfall `is:token`（`scripts/fetch-tokens.mjs` 抓取） | 衍生物 token 的攻防/费用（~600 名，构建时一次性；MTGJSON 不含 token） |

少数未翻译卡牌（约 900 张）悬停时回退到 [mtgch.com API](https://mtgch.com/api/v1/docs)，结果自动缓存到本地。v0.9.2 起，能拿到卡牌身份（系列码 + 编号）的路径——手牌、堆叠、牌组封面、预览大图——未命中本地库时优先走 mtgch **精确端点** `/api/v1/card/{SET}/{CN}`：单次请求即返回全部字段，且按身份精确定位，零"按名模糊搜索"的错牌风险（带后缀编号等 404 场景自动回退到模糊搜索兜底）。此外，若某张**本地牌**的规则文本、费用或攻防任一字段缺失（如新系列中 MTGJSON 名称匹配不上的生物），也会在悬停时后台向 mtgch API 补齐缺失字段——本地已有的卡名/文本/类别不会被覆盖，每张牌仅首次请求一次、结果长期缓存。

MTG 符号图标由 [mana-font](https://mana.andrewgioia.com/) 提供（CDN 加载，浏览器缓存）。

## 样式设置

Tampermonkey/Violentmonkey 菜单 → **⚙ 样式设置** 打开设置弹窗，支持：

- **底色 / 边框**：各自独立的颜色（取色器）+ 透明度滑块
- **每个文字区块**：卡名（含同行的法术力费用）、英文卡名、类别行、规则文本、攻防、来源脚注 —— 各自的颜色 + 字号（**上限 30px**），弹窗顶部有实时预览，与浮窗共用同一组样式变量，改动即时生效

面板**跟随/固定**模式由脚本菜单里的唯一开关「**固定浮窗**」控制（勾选 = 固定、可拖动）。设置弹窗只负责样式，不再放第二套模式按钮，避免重复开关。

## 构建数据库（开发用，一般无需）

```bash
# 需要手动准备数据源（data/ 已被 gitignore）：
#   data/magic-cards-zhs-oracle.json   # magic-cards-zhs 发布版 tarball 中的 zhs_oracle.json
#   data/magic-cards-zhs-names.json    # 来自 magic-cards-zhs 仓库
#   data/AtomicCards.json.gz           # 来自 MTGJSON
#   data/scryfall-tokens.json          # node scripts/fetch-tokens.mjs（可选，token 攻防）
node scripts/build-zhs-db.mjs
# → dist/en2zhs.json.gz（提交到仓库，GitHub Raw 提供）
```

## 调试

v0.6.0 默认开启 fiber 扫描诊断日志（`[manabrew-cn:diag]`）。手牌/堆叠浮窗不工作时可看控制台：

- 手牌浮窗读取 BoardCanvas 的 `handHover` state（`{card, bounds}`）；堆叠浮窗读取 `hoveredStackObjectId`，通过 `gameView.stack` / `stackSpec` 解析卡名。诊断日志会打印 `scan → HAND/STACK …` 和 `poll: …`。
- 牌组封面悬停解析：预览图 alt 是牌组名，脚本从 React fiber 的 `cover` prop 取封面卡名（主将），日志打印 `Deck cover → …`。
- 牌组编辑器预览（v0.8.0）：manabrew 复用一个已挂载的 `data-card-preview`，卡牌切换时仅原地换图。脚本用 `live preview observer` 监听其内部变化（卡牌切换、图片晚到均触发），日志打印 `Preview card → …`。
- 控制台设 `localStorage['mbrw-cn-diag']='0'` 可关闭；`window.__MBRW_DIAG=true` 可重新开启。

## 许可

GPL-3.0
