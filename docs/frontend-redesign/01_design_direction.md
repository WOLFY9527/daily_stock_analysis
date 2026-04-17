# 01. Design Direction & Theme Strategy

## 1. Design Direction Summary

### The New WolfyStock Style
The new WolfyStock design language is **institutional, precise, calm, premium, finance-native, and enterprise-operational**. It moves away from overly aggressive, gamer-like "hacker" interfaces and fragmented layouts toward a unified, high-trust environment. It feels like software built for quantitative analysts and portfolio managers—serious, structured, and profoundly clear.

### How It Borrows from Cohere
- **Enterprise Command-Deck Feeling:** The interface operates as a centralized hub, treating information as critical infrastructure.
- **Restrained Palette:** A strict black, white, and cool-gray foundation. Color is used sparingly, primarily for data meaning or interaction states.
- **Signature 22px Card Roundness:** Large, border-contained panels use a distinct 22px border radius, creating an organic, cloud-like containment language that feels modern and approachable.
- **Typography Hierarchy:** A dual-typeface system pairing a display serif (for gravitas and authority in headers) with a geometric sans-serif (for UI utility). Monospace is introduced strictly for tabular data and tickers.
- **Interaction Blue:** `#1863dc` is reserved almost exclusively for hover, focus, and primary interactive states.
- **Border-led Containment:** Reliance on 1px borders (`#d9d9dd` in light, `#333333` in dark) instead of heavy drop-shadows to define hierarchy and separation.
- **Strong Section Rhythm:** Ample breathing room between macro-sections to prevent cognitive overload.

### How It Differs for Finance/Product Usage (The Adaptation)
While Cohere's language is optimized for landing pages and generic AI chat, WolfyStock is a dense, analytical product.
- **Data Density:** Inside the 22px rounded cards, the content must be significantly denser. Tables, matrices, and charts require tight spacing and precise alignment.
- **Monospace Dominance:** Financial data (prices, PnL, ratios) and stock tickers require monospace fonts (`Space Mono` or `JetBrains Mono`) to ensure tabular alignment and scannability.
- **Semantic Financial Colors:** We must introduce specific Semantic Greens (Gain/Positive) and Semantic Reds (Loss/Negative), but these are muted and sophisticated, not glaring neons.
- **Control-Plane Layout:** Instead of scrolling marketing pages, the app requires a persistent navigation shell, sticky headers, and split-pane views for deep-dives (e.g., Scanner list on the left, Stock detail on the right).

---

## 2. Dark and Light Theme Strategy

### Recommendation: Dark-First (Primary Default)
**Why Dark-First?**
- **Finance Native:** Professional traders and analysts spend 8-12 hours a day staring at market data. Dark mode is the industry standard for financial terminals (Bloomberg, Refinitiv) and crypto exchanges because it significantly reduces eye strain over long periods.
- **Data Contrast:** Candlestick charts, heatmaps, and brightly colored semantic text (green/red) pop with much greater clarity against a dark background (`#17171c`).
- **Focus:** A dark canvas minimizes peripheral glare, allowing the user to hyper-focus on the data blocks and AI terminal outputs.

### Secondary Theme: Light (Optional)
**Why Retain Light Mode?**
- **Reporting & Exporting:** Light mode is essential when users are reviewing generated reports, printing backtest results, or reading long-form AI analysis in well-lit office environments.
- **Enterprise Polish:** The Cohere light theme provides an incredibly crisp, document-like feel that works beautifully for the "Admin" and "Settings" pages, or when reviewing the "Holdings" overview during daytime hours.

### Visual Token References (from previews)
- **Dark Mode Canvas:** `#17171c` (Deep Dark) with cards at `#212121` (Near Black). Text is `#fafafa` (Snow).
- **Light Mode Canvas:** `#ffffff` (Pure White) with cards also at `#ffffff` but defined by `#d9d9dd` borders. Text is `#000000` (Cohere Black).
