# 03. Product Shell & Architecture

## 1. App Frame
The application operates as a **Persistent Control Plane**, filling the viewport (`100vw x 100vh`).
- Internal sections scroll independently.
- The global navigation remains rigidly in place.
- Background uses the `Page Background` color, while content areas sit inside `Card Background` containers.

## 2. Navigation Model

### Side Navigation (Primary Nav)
A fixed, left-aligned sidebar containing the core product map.
- **Width:** 240px (Expandable) / 64px (Collapsed).
- **Style:** Flat background (`#17171c`), items are text-based with subtle 20px line icons.
- **Active State:** Text shifts to Interaction Blue, right border highlight or subtle blue background pill.
- **Items:**
  - Home
  - Scanner
  - Ask
  - Holdings
  - Backtest
  - Admin (Separated by a visual divider, restricted to admin roles)

### Top Navigation / Header
A slim, horizontal bar across the top of the main content area.
- **Height:** 64px.
- **Style:** Translucent background with backdrop-blur, 1px bottom border.
- **Content Left:** Contextual Page Title (in Display Serif font) + Breadcrumbs.
- **Content Right:** Global Search (Command Palette `Cmd+K`), Locale Switcher, System Status Indicator, User Avatar/Menu.

## 3. Section Structure & Card Rules

The layout heavily utilizes the **Signature 22px Card**.

- **Page Layout:** Most pages consist of a main grid containing one or more 22px rounded cards.
- **Card Anatomy:**
  - *Header:* 24px padding, Unica77 font, optional right-aligned actions (e.g., a "Download CSV" ghost button).
  - *Body:* Contains the data, tables, or charts. No internal padding if it's a full-width data table; 24px padding if it's a form or text.
  - *Divider:* 1px solid border separates header from body.
- **Split Views:** For master-detail interfaces (e.g., Scanner list + Stock detail), use a 30/70 or 40/60 vertical split, where each side is a separate 22px card.

## 4. Filter / Action Bar Model
Filters and controls sit immediately above data tables or within the card header.
- **Inputs & Selects:** Sharp 6px radius, dark background, 1px border.
- **Primary Action (e.g., "Run Scan"):** Pill-shaped, Interaction Blue background, white text.
- **Segmented Controls:** Pill-shaped container with subtle background, active segment gets a solid background and shadow.

## 5. Information Architecture Map

```text
WolfyStock
├── Public/Guest
│   ├── Login / Auth
│   └── Public Shared Reports (Read-only view)
├── User Space
│   ├── Home (Dashboard, Market Pulse)
│   ├── Scanner (Watchlists, Multi-factor Screening)
│   ├── Ask (AI Stock Chat, Deep-dive Analysis)
│   ├── Holdings (Portfolio tracking, PnL)
│   ├── Backtest (Strategy config, Execution history)
│   └── Settings (Profile, API Keys, Preferences)
└── Admin Space
    ├── User Management
    ├── System Logs (Background jobs, sync status)
    ├── Provider Config (Data source fallback logic)
    └── LLM Routing (Model selection, agent rules)
```

## 6. Role-Based Structure
- **Guest:** Sees a locked-down login screen. High-end, minimalist. Centered 22px card.
- **Normal User:** Full access to Home, Scanner, Ask, Holdings, Backtest, and personal Settings. Admin module is completely hidden from the DOM and Sidebar.
- **Admin:** Sees a distinct "Admin" section at the bottom of the sidebar. Entering Admin mode shifts the top header border to a subtle red/purple to indicate elevated privileges.
