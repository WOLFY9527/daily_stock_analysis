# 06. Page-by-Page Redesign Spec

This section details the specific layout and hierarchy for each core product surface, adhering to the Cohere-inspired enterprise design language.

---

## 1. Home (Market Overview)
- **Purpose:** Provide a high-level pulse of the market and system status upon login.
- **Target User:** All authenticated users.
- **Layout Structure:**
  - **Top Section (Hero Card):** Wide, 22px rounded card. Contains 3-4 macro metrics (e.g., S&P 500, CSI 300, VIX) using large `CohereText` typography for numbers. Monospace for percentage changes.
  - **Bottom Split:** Two 22px cards. Left: "Recent AI Insights" (List of recent analysis summaries). Right: "System Health" (API latencies, last data sync time).
- **Interaction:** Clicking a macro index opens a minimal inline sparkline chart.

## 2. Scanner (Screener)
- **Purpose:** Execute multi-factor queries to find specific stock setups.
- **Layout Structure (Master-Detail):**
  - **Left Card (30% width):** "Saved Screens" list and "New Query" form. Sharp, dense inputs for filtering (Market Cap, Volume, PE Ratio).
  - **Right Card (70% width):** Results Data Table.
- **Key Components:**
  - **Data Table:** Sticky header. Monospace fonts for all numeric columns. Zebra striping disabled; use subtle row-hover highlights instead. Right-aligned numbers.
  - **Primary Action:** Pill-shaped "Execute" button in Interaction Blue.
- **Terminology Notes:** ZH must use `选股器`, not `扫描器`.

## 3. Ask (AI Analysis)
- **Purpose:** Deep qualitative and quantitative conversational analysis of specific stocks.
- **Layout Structure (Chat Terminal):**
  - **Main Container:** A single large 22px card filling the main area, acting as the terminal viewport.
  - **Chat Bubbles:** Not cartoonish bubbles.
    - *User:* Right-aligned, simple text block, slightly muted.
    - *System (AI):* Left-aligned, full Markdown support, syntax highlighting for JSON/Code blocks. Monospace tabular data.
  - **Input Area:** Fixed at the bottom of the card. A single-line input that auto-expands. Prefixed with a prompt `>_`. Submit via `Enter`.
- **Interaction:** Streaming responses with a blinking `█` cursor.

## 4. Holdings (Portfolio)
- **Purpose:** Track current positions and historical PnL.
- **Layout Structure:**
  - **Top Bar:** Portfolio Net Asset Value (NAV) in massive `CohereText`, with daily PnL below it.
  - **Middle Section:** A wide chart card showing equity curve over time. Minimalist TradingView-style line chart.
  - **Bottom Section:** "Current Positions" Data Table. Columns: Symbol, Shares, Cost Basis, Last Price, Unrealized PnL. PnL column uses Semantic Green/Red.

## 5. Backtest (Strategy Backtesting)
- **Purpose:** Configure, run, and review quantitative strategy simulations.
- **Layout Structure:**
  - **Header Tabs:** "New Configuration", "Execution History".
  - **Config View:** A multi-column form card. Use clean dropdowns and 6px radius text inputs for strategy parameters.
  - **Results View:** Highly dense. Top metrics row (Win Rate, Max Drawdown, Sharpe Ratio). Below: Equity curve chart. Bottom: Trade log table.
- **Interaction:** Running a backtest shows an inline progress bar or skeleton until results return.

## 6. Admin (System Admin)
- **Purpose:** Manage global system parameters, LLM providers, and view logs.
- **Target User:** Administrators only.
- **Layout Structure:**
  - **Left Sub-Nav:** Providers, Users, Logs.
  - **Main Card:** Setting toggles and input fields.
  - **Logs View:** A strict, pure-black terminal-like card with `Space Mono` text only. Searchable via a command input at the top.
- **Aesthetic Shift:** Admin sections can use slightly darker, more rigid visual cues to signify system-level access.

## 7. Auth / Guest
- **Purpose:** Secure entry point.
- **Layout Structure:**
  - **Canvas:** Pure white (Light) or deep dark (Dark). No sidebars.
  - **Center Container:** A beautifully proportioned 22px card. Soft border.
  - **Typography:** `CohereText` for "Sign In" / "登录".
  - **Inputs:** Clean, floating-label or simple placeholder inputs.
  - **Action:** Solid black (in light mode) or white (in dark mode) button for maximum contrast, or Interaction Blue.
