# 05. State System

A professional trading tool must handle asynchronous states elegantly without causing layout shifts or blinding the user with full-page loading screens.

## 1. Loading States (Skeleton Strategy)

- **Rule of Thumb:** Never use full-page generic spinners.
- **Skeletons:** Use structural skeleton loaders that match the layout of the incoming data.
- **Aesthetic:** Skeletons should use a subtle, slow pulse animation.
  - *Dark Mode:* Pulse between `#212121` and `#2a2a2f`.
  - *Light Mode:* Pulse between `#f2f2f2` and `#e5e7eb`.
- **Progressive Disclosure:** Load the shell (navigation, headers, card borders) instantly. Show skeletons only inside the card bodies.
- **AI Streaming:** For the "Ask" interface, use a blinking terminal cursor (`█`) to indicate the AI is processing, followed by streaming markdown.

## 2. Empty States

- **Aesthetic:** Minimalist and calm. Do not use playful illustrations or "sad" icons.
- **Layout:** Centered within the card. A single, clean 1.5px stroke icon (e.g., an empty tray, a dashed circle).
- **Typography:**
  - Header (Unica77, 18px, Primary text): `No Data Found` / `暂无数据`
  - Subtext (Unica77, 14px, Muted text): Brief explanation of why it's empty.
  - Action (Ghost button): Optional contextual action (e.g., "Create a new screener").

## 3. Error States

- **Inline Errors (Component Level):**
  - If a specific widget fails (e.g., a chart fails to load), do not crash the page.
  - Display a subtle error state within that specific card.
  - Background: Very faint red tint. Border: 1px Semantic Red.
  - Text (Space Mono): `[ERR] DATA_FETCH_FAILED` / `[错误] 数据拉取失败`. Provide a "Retry" text link.
- **Global Errors (Critical):**
  - For critical failures (e.g., API unreachable), use a dismissible banner below the Top Navigation.
  - Red background, white text.

## 4. Success States

- **Transient Actions (e.g., "Settings Saved"):**
  - Use a toast notification in the bottom right corner.
  - Dark background, green left-border accent, auto-dismiss after 3 seconds.
- **Persistent Actions (e.g., "Backtest Completed"):**
  - Show a green status badge (`Completed`) in the execution history table.

## 5. Forbidden / Locked States

- **Guest / Unauthenticated:**
  - Standard login screen. Centered 22px card, input fields, primary CTA.
- **Unauthorized Role (e.g., User accessing Admin):**
  - Minimalist locked state.
  - Icon: A padlock.
  - Text: `Access Denied. Elevated privileges required.` / `访问被拒绝。需要更高权限。`
  - Action: Button to return to `Market Overview`.
