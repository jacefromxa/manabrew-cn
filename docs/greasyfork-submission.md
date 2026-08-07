# Greasy Fork 提交文档 — Manabrew 简体中文卡牌浮窗

> 发布站点：https://greasyfork.org/zh-CN
> 提交前请在 Greasy Fork 页面选择「用户脚本 → 提交用户脚本」。

---

## 一、基础信息（对应脚本元数据头）

| 字段 | 值 |
|------|-----|
| **名称 (Name)** | `Manabrew 简体中文卡牌浮窗` |
| **命名空间 (Namespace)** | `https://play.manabrew.app/` |
| **简介 (Description / Synopsis)** | 在 Manabrew 悬停 MTG 卡牌时显示简体中文翻译浮窗——卡名、类别、规则文本、费用、攻防（含 MTG 符号图标）。 |
| **版本 (Version)** | `0.9.3` |
| **作者 (Author)** | `jacefromxa` |
| **许可 (License)** | `GPL-3.0` |
| **适用站点 (Match)** | `https://play.manabrew.app/*` |
| **主页 (Homepage)** | `https://github.com/jacefromxa/manabrew-cn` |
| **安装地址 (Download URL)** | `https://raw.githubusercontent.com/jacefromxa/manabrew-cn/main/manabrew-cn.user.js` |
| **更新地址 (Update URL)** | 同上（GitHub Raw 托管，Tampermonkey 可自动检查更新） |

> 以上字段在脚本 `// ==UserScript==` 元数据头中已写好，上传脚本文件时 Greasy Fork 会自动读取。
> **命名空间与脚本名一起构成唯一标识，如后续改版务必保持 namespace 不变，否则会变成全新脚本。**

---

## 二、详细介绍（可粘贴到 Greasy Fork 的「附加信息 / Additional information」）

以下为 Markdown 版；Greasy Fork 附加信息支持 HTML，需要时把小节标题改 `<h2>`、列表改 `<ul><li>` 即可。

### 这是什么

一个为开源万智牌（MTG）在线客户端 [Manabrew](https://play.manabrew.app/) 开发的用户脚本。悬停任意卡牌，自动在旁边显示**简体中文翻译浮窗**——中文卡名、英文原名、类别行、规则文本、法术力费用与攻防，正文与费用中的 MTG 符号（`{W}`、`{T}`、`{2/W}` 等）以彩色图标渲染，观感接近真实卡牌。

### 功能特性

- **覆盖全部卡牌区域**：战场（预览大图）、手牌、堆叠、牌组选择目录、牌组编辑器，双面牌自动显示当前面的翻译。
- **本地数据库优先，零网络延迟**：内置约 36,600 张卡牌的简中数据（35,000+ 含完整规则文本），首次加载后存入浏览器缓存，日常使用不产生任何请求。
- **智能 API 回退**：少数未翻译卡牌自动查询 [mtgch.com 中文卡查](https://mtgch.com/api/v1/docs)。能拿到卡牌身份（系列码 + 编号）的路径走**精确端点**单次请求，不会因同名卡模糊匹配而显示错牌；每张牌结果长期缓存，只请求一次。
- **本地卡缺失字段自动补齐**：本地数据缺规则文本 / 费用 / 攻防时，后台向 API 补齐，已有的本地翻译不被覆盖。
- **完全可定制的样式**：底色、边框、每个文字区块（卡名 / 英文卡名 / 类别行 / 规则文本 / 攻防 / 来源脚注）各自的颜色与字号（上限 30px），实时预览。
- **面板跟随 / 固定**：脚本菜单唯一开关切换，固定模式可拖动。

### 使用方法

1. 安装 Tampermonkey（Chrome/Edge/Firefox）或 Violentmonkey。
2. 点击安装本脚本。
3. 打开 [https://play.manabrew.app/](https://play.manabrew.app/)，进入任意对局 / 牌组页面，悬停卡牌即可看到中文浮窗。

无需任何配置。悬停浮窗右下角会标注数据来源（📦 本地 / 🌐 mtgch）。

### 样式设置

Tampermonkey / Violentmonkey 菜单 → **⚙ 样式设置**：

- 底色 / 边框：各自颜色 + 透明度滑块
- 六个文字区块（卡名含同行的费用、英文卡名、类别行、规则文本、攻防、来源脚注）：各自颜色 + 字号（8–30px）
- 弹窗顶部实时预览，与浮窗共用同一组样式变量，改动即时生效

面板「跟随 / 固定」由脚本菜单里的唯一开关**固定浮窗**控制。

### 数据来源与隐私

- 本地数据库由社区翻译项目 [magic-cards-zhs](https://github.com/HeliumOctahelide/magic-cards-zhs)、[MTGJSON](https://mtgjson.com/) 与 Scryfall token 数据构建，与 mtgch.com 同源，中文准确度高。
- 运行时仅在本地库未命中时访问 mtgch.com API（约 900 张边缘卡牌，命中后缓存）。
- **脚本不收集任何个人信息**；设置、缓存均只保存在你的浏览器本地。

### 兼容性

- 支持 Tampermonkey / Violentmonkey。
- 需要浏览器支持 `DecompressionStream`（Chrome 80+ / Edge 80+ / Firefox 113+ / Safari 16.4+），不支持时自动降级，功能不受影响。
- 仅在 `https://play.manabrew.app/*` 下生效。

### 常见问题

- **浮窗不显示？** 确认脚本已在 Tampermonkey 中启用、页面为 manabrew.app；按 F12 查看控制台 `[manabrew-cn]` 日志定位原因。
- **想关掉调试日志？** 控制台执行 `localStorage['mbrw-cn-diag']='0'`，或设置 `window.__MBRW_DIAG=false`。
- **某张牌翻译缺失？** 属于本地库未收录的稀有卡，脚本会自动回退 API；若 API 也没有则显示英文原名（翻译暂缺）。

### 更新日志

- **v0.9.3** — 修复「固定浮窗」会自动消失的问题：固定模式下浮窗不再被移开鼠标 / 预览卸载 / 后台轮询自动隐藏，可一直固定在屏幕上（内容仍随悬停切换）。
- **v0.9.2** — 身份感知精确查询：能拿到系列码+编号的路径（手牌/堆叠/封面/预览）改走 mtgch 精确端点 `/api/v1/card/{SET}/{CN}`，单次请求、零错牌风险；带后缀编号等 404 场景自动回退模糊搜索。
- **v0.9.1** — 修复本地卡缺失费用/攻防后台补齐；修复 reanimate 等牌因 `/result` 模糊分页取错卡的问题。
- **v0.9.0** — 完整样式设置（底色/边框 + 六个文字区块颜色字号，上限 30px）；修复「固定浮窗」开关重复出现的问题；本地卡费用/攻防自动补齐。
- **v0.8.x** — 牌组编辑器预览浮窗（live preview observer）；双面牌支持。
- **v0.7.0** — 牌组选择目录悬停封面卡 / 主将。
- **v0.6.0** — 手牌与堆叠浮窗（React fiber 内省）；全卡双语显示。
- **v0.5.0** — 法术卡布局：费用右上角与卡名同行、攻防 `*/*` 文本、正文彩色 mana 图标、token 攻防数据。
- **v0.3.0** — 手牌与堆叠区浮窗。

---

## 三、提交检查清单

- [ ] 已在 Greasy Fork 登录账号
- [ ] 名称 / 命名空间 / 版本 / 许可与脚本元数据一致
- [ ] 简介（Description）已填写，控制在 200 字内（Greasy Fork 简介区建议简短）
- [ ] 详细说明已粘贴到「附加信息」栏
- [ ] 主页填 GitHub 仓库地址
- [ ] 上传 `manabrew-cn.user.js`（或填 GitHub Raw 安装地址，建议勾选「让 Greasy Fork 自动更新脚本」——脚本内已有 `@updateURL` / `@downloadURL` 指向 GitHub Raw，发布后每次 commit 推送即可让 Tampermonkey 自动拉新版）
- [ ] 提交后到脚本页把语言设为简体中文，方便中文用户检索
