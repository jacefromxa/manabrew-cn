# manabrew-cn

> Manabrew 简体中文卡牌悬停翻译浮窗

在 [Manabrew](https://play.manabrew.app/) 悬停万智牌卡牌时，自动在预览大图旁显示简体中文翻译浮窗——卡名、类别、规则文本。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 点击 [`manabrew-cn.user.js`](manabrew-cn.user.js) → 用户脚本管理器应提示安装
3. 访问 https://play.manabrew.app/play/offline/constructed → 悬停战场卡牌即可看到中文翻译

## 数据来源

本地数据库由两个数据源合并构建（~37,000 条，含中文名 + 规则文本）：

| 来源 | 内容 |
|------|------|
| [HeliumOctahelide/magic-cards-zhs](https://github.com/HeliumOctahelide/magic-cards-zhs) | 社区简中卡名（36,484 条） |
| MTGJSON `AtomicCards.json` `foreignData` | 官方中文规则文本 + 类别行（21,769 条） |

本地库未命中时回退到 [mtgch.com API](https://mtgch.com/api/v1/docs)，结果自动缓存。

## 构建数据库（开发用，一般无需）

```bash
# 需要手动准备数据源：
#   data/magic-cards-zhs-names.json   # 来自 magic-cards-zhs 仓库
#   data/AtomicCards.json.gz           # 来自 MTGJSON
node scripts/build-zhs-db.mjs
# → dist/en2zhs.json.gz
```

## 许可

GPL-3.0
