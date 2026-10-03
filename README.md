# 万智牌中文悬浮翻译助手（manabrew-cn）

> 万智牌简体中文卡牌悬停翻译浮窗，支持 Manabrew / MTGGoldfish / MTGDecks.net / Scryfall / EDHREC / Moxfield / MTGTop8 / CubeCobra 八个站点

在 [Manabrew](https://play.manabrew.app/)、[MTGGoldfish](https://www.mtggoldfish.com/)、[MTGDecks.net](https://mtgdecks.net/)、[Scryfall](https://scryfall.com/)、[EDHREC](https://edhrec.com/)、[Moxfield](https://moxfield.com/)、[MTGTop8](https://www.mtgtop8.com/) 与 [CubeCobra](https://cubecobra.com/) 悬停万智牌卡牌时，自动在预览大图旁显示简体中文翻译浮窗——卡名、类别、规则文本、风味文字，并带 **法术力费用**（右上角，与牌名同行）、**攻防**（右下角，`*/*` 文本形式，含忠诚度/防御）和 **彩色 MTG 符号图标**（`{W}`、`{T}`、`{2/W}` 等，正文与风味文字同样使用彩色图标）。

## 支持站点

| 站点 | 悬停方式 | 说明 |
|------|---------|------|
| [Manabrew](https://play.manabrew.app/) | 战场（`data-card-preview` portal）、手牌、堆叠（React fiber 状态）、牌组选择目录页（`/play/offline/constructed` 等）、牌组编辑器（`/deck-editor`） | 原有站点，行为不变 |
| [MTGGoldfish](https://www.mtggoldfish.com/) | 悬停卡名链接（`data-card-id`）或**纯卡图**（Visual 牌组视图、文章卡图瓦片、价格页，取 `alt` 卡名） | 卡名链接可解析出系列码 + 编号，未命中本地库时走 mtgch 精确端点；有原生卡图弹层，浮窗锚定弹层摆放在其右侧（空间不足换左侧/上下） |
| [MTGDecks.net](https://mtgdecks.net/) | 悬停卡名链接（`image` 属性）、卡图瓦片或瓦片下方卡名 | 从卡图 URL 解析系列码 + 编号；浮窗先右后左 |
| [Scryfall](https://scryfall.com/) | 悬停卡页大图（`img.card`，alt 如 `Name (Set #Num)`）、卡名标题（`h1.card-text-title`）、列表链接 | 卡页 URL `/card/{set}/{num}/` 直接提供系列码 + 编号 |
| [EDHREC](https://edhrec.com/) | 悬停卡名链接（`/cards/{slug}`）、卡图（`card-images.edhrec.com`）、卡页标题、**文章内嵌卡名**（`Card_name__*` 与 `fake-link`） | — |
| [Moxfield](https://moxfield.com/) | 悬停牌组列表卡名（`a.table-deck-row-link`）或卡图（`assets.moxfield.net/cards`） | 浮窗**跟随鼠标**，优先鼠标右侧、空间不足换左侧 |
| [MTGTop8](https://www.mtgtop8.com/) | 悬停牌组列表行（`.deck_line` / `AffCard(V)` 行） | 从 `AffCard(V)` 参数解析系列码 + 编号（带数字系列码如 MH2 靠 mtgch 名字门禁兜底） |
| [CubeCobra](https://cubecobra.com/) | 悬停牌组/列表卡名行（`.list-group-card`）、卡图（`assets.cubecobra.com/cardimages`）、搜索页卡图 | 有原生悬停弹层（`#autocardPopup`），浮窗锚定弹层摆放在其右侧（空间不足换左侧/上下） |

八个站点共用同一套翻译数据库、mtgch API 回退、样式设置与固定浮窗开关。浮窗统一遵循**先右后左**规范：默认显示在锚点（卡牌/卡图/鼠标）**右侧**，空间不足换左侧；Moxfield 浮窗跟随鼠标；有原生卡图弹层的站点（MTGGoldfish / CubeCobra）锚定弹层，绝不遮挡卡图。跨站请求走 `GM_xmlhttpRequest`（无则回退 `fetch`），不受站点 Content-Security-Policy（如 Scryfall 的严格 `connect-src`）限制。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 点击 [`manabrew-cn.user.js`](manabrew-cn.user.js) → 用户脚本管理器应提示安装
3. 访问 https://play.manabrew.app/play/offline/constructed → 悬停战场/手牌/堆叠卡牌即可看到中文翻译；或访问 https://www.mtggoldfish.com/ 、https://mtgdecks.net/ 、https://scryfall.com/ 、https://edhrec.com/ 、https://moxfield.com/ 、https://www.mtgtop8.com/ 悬停任意卡名/卡图

## 数据来源

本地数据库当前快照由四个数据源合并构建（37,082 条，35,504 条带规则文本；翻译源版本 `data-2026-09-27`）：

| 来源 | 内容 |
|------|------|
| [HeliumOctahelide/magic-cards-zhs](https://github.com/HeliumOctahelide/magic-cards-zhs) `zhs_oracle.json`（发布版 tarball） | 社区简中卡名 + 规则文本 + 类别（34,949 个英文牌名）——即 mtgch.com 所用的 MTGZH 数据，本地化后无需运行时请求 |
| 社区名称映射 + 当前 `zhs_oracle.json` 中的新译名 | 最广的社区简中卡名（36,987 条） |
| MTGJSON `AtomicCards.json`（当前快照 `2026-10-02`） | 法术力费用、攻防/忠诚度/防御，以及官方中文文本兜底 |
| Scryfall `is:token`（`scripts/fetch-tokens.mjs` 抓取） | 衍生物 token 的攻防/费用（634 个名称，构建时一次性；MTGJSON 不含 token） |

少数未翻译卡牌悬停时回退到 [mtgch.com API](https://mtgch.com/api/v1/docs)，结果自动缓存到本地。能拿到卡牌身份（系列码 + 编号）的路径——Manabrew 手牌、堆叠、牌组封面、预览大图，MTGGoldfish 的 `data-card-id` + `/price/` href，MTGDecks 的卡图 URL，Scryfall 卡页 URL `/card/{set}/{num}/`，MTGTop8 的 `AffCard(V)` 参数——未命中本地库时优先走 mtgch **精确端点** `/api/v1/card/{SET}/{CN}`：单次请求即返回全部字段，且按身份精确定位，零"按名模糊搜索"的错牌风险（带后缀编号等 404 场景自动回退到模糊搜索兜底）。该接口的中文风味名和风味文字也会在浮窗中显示；本地数据库命中但缺少风味文字时，同样会按印刷版本在后台补齐。本地已有的卡名/文本/类别不会被覆盖；缺少规则或风味译文的 API 结果缓存 7 天后会重查，避免新补上的译文一直被旧缓存挡住。精确查询的缓存键包含系列码和编号，避免同名重印牌的风味文字串牌。

MTG 符号图标由 [mana-font](https://mana.andrewgioia.com/) 提供（CDN 加载，浏览器缓存）。

## 样式设置

Tampermonkey/Violentmonkey 菜单 → **⚙ 样式设置** 打开设置弹窗，支持：

- **底色 / 边框**：各自独立的颜色（取色器）+ 透明度滑块
- **文字区块样式**：卡名（含同行的法术力费用）、英文卡名、类别行、规则文本、风味文字、攻防、来源脚注各自有颜色 + 字号（**上限 30px**）；风味文字默认使用与规则文本相同的样式并以斜体显示，弹窗顶部有实时预览，与浮窗共用同一组样式变量，改动即时生效

面板**跟随/固定**模式由脚本菜单里的唯一开关「**固定浮窗**」控制（勾选 = 固定、可拖动）。固定模式下浮窗**永不自动隐藏**：鼠标移开后仍保持上次悬停的卡牌翻译，直到下一个悬停动作刷新内容；只有取消固定模式才关闭。设置弹窗只负责样式，不再放第二套模式按钮，避免重复开关。

## 构建数据库（开发用，一般无需）

```bash
# 需要手动准备数据源（data/ 已被 gitignore）：
#   data/magic-cards-zhs-oracle.json   # magic-cards-zhs 最新发布版 tarball 中的 zhs_oracle.json
#   data/magic-cards-zhs-names.json    # 广覆盖名称映射，并并入当前 oracle 的新译名
#   data/AtomicCards.json.gz           # 来自 MTGJSON；与翻译源分别更新
#   data/scryfall-tokens.json          # node scripts/fetch-tokens.mjs（可选，token 攻防）
node scripts/build-zhs-db.mjs
# → dist/en2zhs.json.gz（提交到仓库，GitHub Raw 提供）
```

## 调试

v0.6.0 默认开启 fiber 扫描诊断日志（`[mtg-cn:diag]`）。手牌/堆叠浮窗不工作时可看控制台：

- 手牌浮窗读取 BoardCanvas 的 `handHover` state（`{card, bounds}`）；堆叠浮窗读取 `hoveredStackObjectId`，通过 `gameView.stack` / `stackSpec` 解析卡名。诊断日志会打印 `scan → HAND/STACK …` 和 `poll: …`。
- 牌组封面悬停解析：预览图 alt 是牌组名，脚本从 React fiber 的 `cover` prop 取封面卡名（主将），日志打印 `Deck cover → …`。
- 牌组编辑器预览（v0.8.0）：manabrew 复用一个已挂载的 `data-card-preview`，卡牌切换时仅原地换图。脚本用 `live preview observer` 监听其内部变化（卡牌切换、图片晚到均触发），日志打印 `Preview card → …`。
- MTGGoldfish / MTGDecks（v1.0.0）、Scryfall / EDHREC / Moxfield / MTGTop8（v1.1.0）：悬停卡名/卡图时日志打印 `Site card → 卡名 (SET/编号)`，未解析出身份时只打印卡名（走模糊搜索兜底）。
- 控制台设 `localStorage['mbrw-cn-diag']='0'` 可关闭；`window.__MBRW_DIAG=true` 可重新开启。

## 许可

GPL-3.0
