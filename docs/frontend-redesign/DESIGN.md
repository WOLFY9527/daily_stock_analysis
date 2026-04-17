# Frontend UI/UX Redesign - Index & Overview

This directory contains the comprehensive frontend UI/UX redesign specifications for the Daily Stock Analysis (DSA) system.

## Design Goal
To completely redesign the frontend UI/UX, improving clarity, usability, information architecture, and cross-locale consistency, while rigorously adhering to a **SpaceX-like dark, industrial, terminal aesthetic fused with modern Web3 crypto-exchange data density.**

## Documents

1. [01_design_principles.md](./01_design_principles.md) - Core design language, visual aesthetics, and UX principles.
2. [02_information_architecture.md](./02_information_architecture.md) - IA and Navigation redesign.
3. [03_shared_system.md](./03_shared_system.md) - Layouts, component systems, and UI states (loading, error, etc.).
4. [04_bilingual_terminology.md](./04_bilingual_terminology.md) - Strict Chinese/English localization dictionary and rules.
5. [05_page_specs.md](./05_page_specs.md) - Page-by-page design specifications (Home, Scanner, Ask, Holdings, Backtest, Admin).
6. [06_implementation_plan.md](./06_implementation_plan.md) - Phased rollout strategy (Phase 1 & 2).

## Hard Constraints Addressed
- **Zero modification to production code** (`apps/dsa-web/src/`).
- **Zero modification to main or bug-fix branches.**
- **Strictly scoped to `docs/frontend-redesign/` directory.**
- **No mixed Chinese/English UI labels.**
- **Professional finance and Web3 terminology only.**
