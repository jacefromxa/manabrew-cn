# HANDOFF — 万智牌中文悬浮翻译助手（manabrew-cn）

> 交接文档。脚本当前版本 **v1.4.5**，支持 **8 个站点**。
> 最后更新：2026-10-02。数据库翻译源为 `data-2026-09-27`，MTGJSON 快照为 `2026-10-02`。

---

## 一、项目概况

油猴用户脚本：悬停 MTG 卡牌（卡名链接或卡图）时显示简体中文翻译浮窗——卡名、类别、规则文本、费用（右上角）、攻防（*/*，含忠诚度/防御）、彩色 MTG 符号图标。本地数据库（37,082 卡，35,504 条规则文本）优先，mtgch.com API 精确端点回退；缺少规则译文的 API 缓存 7 天后重查。跨站请求通过 `GM_xmlhttpRequest` 或页面 fetch 完成。

- **脚本名**：`万智牌中文悬浮翻译助手`（`@namespace` 仍为 `https://play.manabrew.app/`）
- **仓库**：`github.com/jacefromxa/manabrew-cn`（分支 `main`）
- **Greasy Fork**：`https://greasyfork.org/zh-CN/scripts/591633`（旧脚本 590313「Manabrew 简体中文卡牌浮窗」已于本会话删除并重定向到新脚本）

## 二、支持站点（8 个）与检测要点

| 站点 | 卡名检测 | 卡图检测 | 原生弹层锚定 | 身份(系列码+编号) |
|---|---|---|---|---|
| Manabrew | `data-card-preview` portal + React fiber（手牌/堆叠/封面） | Scryfall src 卡图 | — | fiber `identity` |
| MTGGoldfish | `a[data-card-id]` | 纯卡图 `alt`（`cards.mtggoldfish.com/images/`，排除卡背） | `.popover-card.popover.show` | `data-card-id` `[SET]` + `/price/` href 编号 |
| MTGDecks.net | `a[image]`、瓦片、瓦片下方卡名 | `img[src*="/img/card/"]` | — | 卡图 URL `{SET}/{num}` |
| Scryfall | `h1.card-text-title`、`a[href*="/cards/"]` | `img.card`（alt `Name (Set #Num)`） | — | 卡页 URL `/card/{set}/{num}/` |
| EDHREC | `/cards/{slug}` 链接、卡页标题、**文章内嵌卡名**（`span.Card_name__*`、`span.fake-link`） | `card-images.edhrec.com` | — | — |
| Moxfield | `a.table-deck-row-link` | `assets.moxfield.net/cards`（排除 DFC Front/Back/Transform） | **无**（浮窗跟随鼠标） | — |
| MTGTop8 | `.deck_line` / `AffCard(V)` 行 | — | — | `AffCard(V)` 参数（靠名字门禁兜底） |
| CubeCobra | `.list-group-card` 行 | `assets.cubecobra.com/cardimages` | `#autocardImageFront` | — |

**定位规范（v1.4.0 统一）**：浮窗**先右后左**——默认锚点（卡牌/卡图/鼠标）右侧，空间不足换左侧；Moxfield 浮窗**跟随鼠标**；有原生卡图弹层的站点（MTGGoldfish / CubeCobra）锚定弹层摆放在卡图右侧，绝不遮挡卡图。

## 三、提交历史与当前版本

| Commit | 版本 | 内容 |
|---|---|---|
| `bc70f31` | v1.0.0 | MTGGoldfish + MTGDecks.net 支持（`data-card-id`/`image` 属性、mtgch 精确端点、Turbo 页面后浮窗重建） |
| `6727cfa` | — | MTGGoldfish 浮窗锚定原生卡图弹层，摆放在卡图旁不遮挡 |
| `78d3c88` | v1.0.1 | 浮窗默认卡图右侧；纯卡图悬停支持 |
| `0bb2228` | v1.0.2 | 修复纯卡图悬停只显示英文名+系列码（`cleanCardName` alt 注解清洗） |
| `ffb407c` | v1.1.0 | Scryfall / EDHREC / Moxfield / MTGTop8 支持；`fetchVia`（GM_xmlhttpRequest 突破 CSP） |
| `c53988f` | v1.2.0 | 更名「万智牌中文悬浮翻译助手」；日志前缀 `[mtg-cn]` |
| `2307984` | v1.3.0 | CubeCobra 支持（卡名行/卡图/原生弹层锚定） |
| `d520447` | v1.4.0 | Moxfield 跟随鼠标（修复 NaN 定位）；先右后左统一（MTGDecks 同）；EDHREC 文章内嵌卡名 |
| `58b8121` | v1.4.1 | 修复 Scryfall 浮窗全透明（GM_addStyle + CSSOM 兜底，CSP 拦截 style）；EDHREC 文章卡名部分触发（`/commanders/` 链接 + `.edhrecp__link` 包装器匹配） |
| 本次更新 | v1.4.5 | 刷新数据库至 `data-2026-09-27` / MTGJSON `2026-10-02`；Moxfield 数据镜像回退；无规则译文 API 缓存 7 天过期 |

**Greasy Fork**：591633 当前仍发布 v1.4.0；旧脚本 590313 已删除（redirect → 591633）。本次只提交并推送 GitHub，不更新 Greasy Fork。

## 四、仓库结构

```
manabrew-cn.user.js          # 脚本本体（单文件，自包含）
README.md                    # 使用文档（支持站点/安装/调试）
HANDOFF.md                   # 本文档
docs/
  greasyfork-submission.md   # Greasy Fork 提交用 Markdown 文案
  greasyfork-description.html # 提交用 HTML 附加信息
data/                        # (gitignore) 数据库构建源
scripts/build-zhs-db.mjs     # 数据库构建
scripts/fetch-tokens.mjs     # Scryfall token 抓取
dist/en2zhs.json.gz          # 提交的数据库（GitHub Raw 提供）
```

## 五、发布流程（如何再次发布）

1. **改代码** → `node --check manabrew-cn.user.js` 语法检查 → 按需 E2E（见下）。
2. **验证**：`node --test test/*.test.mjs`、`node --check manabrew-cn.user.js`、`git diff --check`。
3. **提交**：`git add ... && git commit`（版本号在 `@version` + 启动 LOG 里同步）。
4. **推 GitHub**：`git push origin main`。数据库由脚本在页面打开时从 GitHub Raw 拉取，更新 `dist/en2zhs.json.gz` 后会按 ETag 替换浏览器 IndexedDB 缓存。
5. **更新 Greasy Fork（单独发布）**：登录 greasyfork.org → 脚本 591633 → 「更新」→ 粘贴 `manabrew-cn.user.js` 全文 → 填 changelog → 发布。附加信息（描述）如需同步，编辑脚本附加信息（HTML 取自 `docs/greasyfork-description.html`）。

## 六、测试要点（真实浏览器）

- **页面上下文注入**会受站点 CSP 影响：Scryfall 有严格 CSP（`connect-src` 不含 raw.githubusercontent/mtgch），页内 `<script>` 注入不执行、`fetch` 被拦。测试需用 `Page.addScriptToEvaluateOnNewDocument`（扩展级注入）或 Tampermonkey 沙箱。
- **数据库**：新 origin 的 IndexedDB 为空，测试可预置种子数据（本会话做法：从 `dist/en2zhs.json.gz` 解压取若干条目写入 `manabrew-cn` IndexedDB）。
- **多实例污染**：同一标签页多次 `addScriptToEvaluateOnNewDocument` 会产生多个脚本实例互相抢面板（`#mbrw-cn-panel` 重复、位置错乱）。测试务必用全新标签页/任务空间。
- 各站点 E2E 关注点：卡名/卡图悬停出中文、原生弹层锚定不遮挡、先右后左回退、moxfield 跟随鼠标。

## 七、已知限制

- MTGTop8 视觉模式缩略图（`/metas_thumbs/`）无卡名，不支持（只有经典/visual 文本牌表）。
- Moxfield / EDHREC / CubeCobra 无身份（系列码+编号）来源，未命中本地库时走模糊搜索。
- Scryfall 多结果搜索列表页在部分浏览器渲染依赖 JS，检测逻辑已覆盖（`/cards/{set}/{num}/` 链接 + `img.card`）。
- 更名后：任何仍安装旧名脚本的用户需重装（Tampermonkey 按名称+命名空间识别）。

---

## 八、发布通道

GitHub Raw `main` 同时提供脚本与数据库。推送 `dist/en2zhs.json.gz` 后，脚本会在后续页面加载时按 ETag 更新浏览器 IndexedDB。Greasy Fork 591633 当前仍为 v1.4.0；本次提交只更新 GitHub，未发布 Greasy Fork。通过 Greasy Fork 安装的用户需在那里单独更新脚本，才能获得 1.4.5 的缓存过期修复。
