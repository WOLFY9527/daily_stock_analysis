# 02. Core Design System

## 1. Color System
The color system emphasizes restraint, relying on cool grays and pure black/white, with blue for interaction and muted semantic colors for financial data.

### Foundation (Dark Mode First / Light Mode)
- **Background Page:** `#17171c` (Dark) / `#ffffff` (Light)
- **Background Card:** `#212121` (Dark) / `#ffffff` (Light)
- **Background Nav/Header:** `rgba(23, 23, 28, 0.95)` (Dark) / `rgba(255, 255, 255, 0.95)` (Light) - with backdrop blur.
- **Border Default:** `#333333` (Dark) / `#d9d9dd` (Light)
- **Border Subtle:** `#2a2a2f` (Dark) / `#f2f2f2` (Light)

### Text
- **Primary:** `#fafafa` (Dark) / `#000000` (Light)
- **Secondary:** `#d9d9dd` (Dark) / `#212121` (Light)
- **Muted/Tertiary:** `#93939f` (Both)

### Interaction & Semantic
- **Interaction Blue:** `#1863dc` - Used for primary buttons, active tabs, text links, and focus rings.
- **Ring Blue:** `rgba(76, 110, 230, 0.5)` - Focus ring glow.
- **Semantic Positive (Gain):** `#23a55a` (Dark) / `#10893E` (Light) - Calm, readable green.
- **Semantic Negative (Loss):** `#e14d4d` (Dark) / `#D22B2B` (Light) - Professional, distinct red.
- **Warning/Pending:** `#e5a000` (Dark) / `#B88000` (Light)

---

## 2. Typography System
A strict three-typeface hierarchy to separate display gravitas, UI utility, and financial precision.

- **Display (Page Titles, Large Headers):** `CohereText`, `Space Grotesk`, `ui-sans-serif`
  - *Attributes:* High contrast, tightly tracked (-1.2px), brings enterprise authority.
- **UI & Body (Buttons, Nav, Paragraphs):** `Unica77`, `Inter`, `ui-sans-serif`
  - *Attributes:* Swiss geometric precision. Mostly Regular (400) weight. Medium (500) for button labels.
- **Data & Code (Tickers, Prices, PnL, Terminal):** `Space Mono`, `JetBrains Mono`
  - *Attributes:* Tabular lining numerals are mandatory. All financial numbers and tickers must use this font to ensure vertical alignment in tables.

---

## 3. Spacing System
- **Macro Spacing:** Large breathing room (40px to 64px) between major sections or page title and content.
- **Container Spacing:** 24px to 32px padding inside the 22px rounded cards.
- **Micro Spacing:** 4px, 8px, 12px for internal element grouping (e.g., a label and its input). Tables have tighter vertical padding (12px) to allow high data density.

---

## 4. Radius System
- **Macro Containment:** `22px` - Used for all major layout cards, primary content boundaries, and large modals. This is the signature design token.
- **Interactive Elements:** `9999px` (Pill) for primary CTAs and status badges.
- **Utility Containers:** `6px` to `8px` for text inputs, dropdown menus, smaller secondary buttons, and table row hover states. This ensures the UI remains sharp and precise where interaction happens.

---

## 5. Borders & Elevation
- **Containment Strategy:** Rely purely on `1px solid` borders for separation. No diffuse drop-shadows on standard cards.
- **Focus States:** `2px solid var(--color-interaction-blue)` with an optional subtle ring glow.
- **Elevation:** Only floating elements (dropdowns, tooltips, modals, sticky headers) get a shadow.
  - *Modal Shadow:* `0 20px 40px rgba(0,0,0,0.4)` (Dark) or `rgba(0,0,0,0.1)` (Light), combined with a 1px border.

---

## 6. Iconography Direction
- **Style:** Clean, line-based, 1.5px stroke weight.
- **Usage:** Functional, never decorative. Icons should strictly accompany text labels in navigation, or serve as clear utility actions (sort, filter, download).
- **Size:** 16px for utility, 20px for navigation.

---

## 7. Interaction States
- **Default Ghost:** Many secondary actions are ghost buttons (no background, no border).
- **Hover:** Text or icon shifts to Interaction Blue (`#1863dc`), background gets a subtle opacity layer (e.g., `rgba(24, 99, 220, 0.08)`). Table rows get a subtle background highlight (`#2a2a2f` in dark).
- **Active/Pressed:** Scaling down slightly (`scale(0.98)`).
- **Focus:** 2px solid Interaction Blue outline. Keyboard accessibility is a first-class citizen.
