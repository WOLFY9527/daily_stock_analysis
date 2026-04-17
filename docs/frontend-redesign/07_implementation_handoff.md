# 07. Implementation Phases & Handoff Guidance

This document outlines how an engineering agent (like Codex or Claude) should approach implementing the redesign in `apps/dsa-web/src/` later, without overwhelming the codebase or causing massive regressions.

## 1. Phase Recommendation

### Phase 1: The Design System Shell (Non-Destructive)
*Focus: Global CSS, Tokens, Shell layout, and Typography.*
1. **Design Tokens:** Implement the new CSS variables (Colors, Spacing, Radius, Typography) in the global stylesheet.
2. **Typography Setup:** Import and apply `Space Grotesk` (for CohereText approximation), `Inter` (for Unica77 approximation), and `Space Mono`.
3. **App Shell Redesign:** Update the Global Navigation (Sidebar/Topbar) to match the new structure.
4. **Card Component:** Create the fundamental `Card` component with the signature 22px radius and 1px borders.
5. **Terminology Pass:** Update the locale dictionary files (`zh-CN.json`, `en-US.json`) to enforce the new bilingual standards.

### Phase 2: Core Module Makeovers
*Focus: High-impact pages using the new components.*
1. **Auth / Guest Page:** The easiest to isolate and redesign for immediate visual impact.
2. **Scanner (Screener):** Rebuild the layout into the Master-Detail split view. Apply the new Data Table styling (monospace numbers, hover states).
3. **Ask (AI Chat):** Refactor the chat interface to the new terminal-like aesthetic.
4. **Home / Holdings / Backtest:** Incrementally wrap existing data in the new 22px Card components and update typography.

### Phase 3: Polish & Admin
*Focus: Edge cases and restricted areas.*
1. **State System:** Implement the unified Skeleton loaders, Empty states, and Error boundaries.
2. **Admin:** Apply the rigid terminal aesthetic to the Admin logs and config pages.

---

## 2. Handoff Guidance for Implementation Agents

When a coding agent is tasked with implementing this spec:

- **DO NOT rewrite the entire React architecture.** Keep existing state management, hooks, and API calls intact. The redesign is strictly presentational and structural.
- **Build Shared Components First:** Before touching `Scanner.tsx`, build a reusable `<Table />`, `<Card />`, and `<Button />` component that strictly adheres to the `02_core_design_system.md` rules.
- **Respect the Constraints:** If a table looks dense, do not add arbitrary padding. The design intentionally requests high data density akin to trading software.
- **Token Usage:** Never hardcode colors like `#1863dc` inside components. Always use CSS variables (e.g., `var(--color-interaction-blue)`) so theming (Dark/Light) works automatically.
- **Translation Keys:** Never hardcode English or Chinese strings in the JSX. Always use the `t()` translation function hooked into the updated dictionaries.
