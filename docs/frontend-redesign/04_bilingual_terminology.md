# 04. Bilingual Terminology System

## Goal
Establish a strict, professional bilingual terminology system. Eradicate mixed Chinese/English labels, direct literal translations, and colloquialisms. The language must reflect an institutional financial intelligence platform.

## 1. Banned Translations & Mixed Terms

| Bad / Mixed Phrase | Reason | Correct Action |
| :--- | :--- | :--- |
| 近期 runs | Mixed languages, colloquial. | **EN:** Recent Executions / **ZH:** 近期执行记录 |
| 宇宙与评分说明 | Literal translation of "Universe". Unprofessional in finance context. | **EN:** Stock Universe & Scoring / **ZH:** 选股池与评分基准 |
| 跑一下 | Too casual/colloquial. | **EN:** Execute / Run Scan / **ZH:** 执行扫描 |
| 问AI | Too generic consumer-tech. | **EN:** AI Assistant / Quant Chat / **ZH:** 智能分析 |
| 赚/亏 | Too colloquial for an institutional tool. | **EN:** PnL / **ZH:** 盈亏 (or 浮动盈亏) |

---

## 2. Core Navigation Terminology

| Component | English (EN) | Chinese (ZH) | Notes |
| :--- | :--- | :--- | :--- |
| Home | Market Overview | 市场总览 | "Home" is too consumer; "Overview" fits a terminal. |
| Scanner | Screener / Scanner | 选股器 | "Screener" is the standard finance term. |
| Ask | AI Analysis | 智能分析 | Represents the AI chat/deep-dive functionality. |
| Holdings | Portfolio | 投资组合 | "Portfolio" is more institutional than "Holdings". |
| Backtest | Backtesting | 策略回测 | |
| Admin | System Admin | 系统管理 | |
| Settings | Preferences | 偏好设置 | |

---

## 3. Action Terminology

| Action | English (EN) | Chinese (ZH) |
| :--- | :--- | :--- |
| Run / Start | Execute | 执行 |
| Cancel | Abort | 中止 |
| Save | Save Configuration | 保存配置 |
| Delete | Delete | 删除 |
| Export | Export CSV | 导出 CSV |
| View Details | View Details | 查看详情 |
| Refresh Data | Sync Data | 同步数据 |

---

## 4. Financial & Analytical Terminology

| Concept | English (EN) | Chinese (ZH) |
| :--- | :--- | :--- |
| Ticker / Symbol | Symbol | 代码 |
| Price | Last Price | 最新价 |
| Volume | Volume | 成交量 |
| Market Cap | Market Cap | 总市值 |
| PnL (Profit and Loss) | Unrealized PnL | 浮动盈亏 |
| Win Rate | Win Rate | 胜率 |
| Max Drawdown | Max Drawdown | 最大回撤 |
| Volatility | Volatility | 波动率 |
| Strategy | Strategy | 投资策略 |
| Benchmark | Benchmark | 业绩基准 |
| Signal | Trade Signal | 交易信号 |
| Factor | Factor | 因子 |

## 5. Implementation Rules
1. **Locale Keys:** All text must be driven by locale dictionaries (e.g., `en-US.json`, `zh-CN.json`). Hardcoding strings in components is forbidden.
2. **Typography Context:** In Chinese UI, avoid using italics for emphasis (as Chinese characters don't italicize cleanly). Use font-weight or color for emphasis.
3. **Date/Number Formatting:**
   - EN: `MM/DD/YYYY` or `YYYY-MM-DD`, Numbers: `1,234,567.89`
   - ZH: `YYYY-MM-DD`, Numbers: `1,234,567.89` (Retain comma separators for financial readability).
