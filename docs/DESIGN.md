# DESIGN.md — Touch Padel operator desktop app

Tokens live in `packages/ui/src/tokens/operator.ts` and are emitted as CSS custom properties
under `:root[data-theme='operator']`. Components in `apps/operator` reference tokens only.

## Scene, and why the theme is what it is
"A cashier at a Windows till under bright cafe lighting, glancing between the screen and a
guest, needs to find Cappuccino in one second; a wall-mounted kitchen display is read from three
metres through steam; the owner reads a week's numbers on a laptop at night." The bright rooms
force a light, paper-like surface for desk, till, manager and owner. The kitchen forces a dark,
high-contrast board with large type. Both are decided by the room, not by the category.

## Color (OKLCH, all neutrals tinted toward the brand blue hue 262)
Strategy: **Restrained**. One accent (Touch Blue) on primary actions, selection and focus,
under 10% of any surface. Padel Green is a semantic colour (live, ready, arrived, success), not
decoration. The navigation rail is the single committed brand surface: deep navy ink carrying
the court-line motif at low opacity.

| Token | Value | Use |
|---|---|---|
| `--tp-bg` | oklch(98.5% 0.004 262) | page ground |
| `--tp-surface` | oklch(99.4% 0.002 262) | panels, tiles, tables |
| `--tp-surface-2` | oklch(96.4% 0.006 262) | toolbars, table heads, secondary panels |
| `--tp-fg` | oklch(22% 0.03 262) | text |
| `--tp-muted-fg` | oklch(48% 0.025 262) | secondary text (≥ 4.5:1 on bg) |
| `--tp-border` | oklch(90% 0.01 262) | hairlines |
| `--tp-border-strong` | oklch(82% 0.015 262) | inputs, focused rows |
| `--tp-accent` | oklch(47% 0.13 262) ≈ #3360AB | primary action, selection |
| `--tp-accent-hover` | oklch(42% 0.13 262) | |
| `--tp-accent-soft` | oklch(94% 0.03 262) | selected row / chip ground |
| `--tp-success` / `-soft` / `-fg` | green 125–135 hue | live, ready, arrived |
| `--tp-warn` / `-soft` / `-fg` | amber 75 hue | attention, ageing |
| `--tp-danger` / `-soft` / `-fg` | red 27 hue | refused, void, stale |
| `--tp-rail` / `--tp-rail-fg` / `--tp-rail-active` | navy ink family | workspace navigation |
| `--tp-kds-bg` / `--tp-kds-card` / `--tp-kds-fg` | dark family | kitchen display only |

Never `#000` or `#fff`. Status is never carried by colour alone; every indicator has a label.

## Typography
One family for UI. Windows-only target, so the stack leads with the licensed faces (when they
arrive) and falls back to `Segoe UI Variable` / `Segoe UI`, which covers Arabic well without a
download (kiosks may be offline). Numerals are always tabular. Scale (rem): 0.75 · 0.8125 ·
0.875 (base) · 1 · 1.125 · 1.375 · 1.75. Weights 400 / 600 / 700. Body line-height 1.5;
data rows 1.3. Line length for prose ≤ 70ch.

## Spacing and shape
4px base. Common steps: 4 · 8 · 12 · 16 · 24 · 32. Radius: 6px controls, 10px panels, pill
for badges. Elevation is a border first; shadow only on overlays (dialogs, sheets, toasts).

## Density
Tables: 36px rows. Till tiles: ≥ 72px tall, 44px minimum touch target everywhere on till
and kitchen. Forms: 8px between label and control, 16px between fields.

## Components (shared vocabulary)
Button (primary / default / danger / ghost; every one accepts `busy`), Field, Input, Select,
Tabs, Modal, ConfirmationDialog, PinPromptOverlay, ReasonCodePrompt, AsyncStateWrapper,
DataTable, StatusIndicator (booking / payment / ticket / tab), HeadlineFigure, ComparisonDelta,
PermissionRefusedNotice, ConflictNotice, MessagePresenter, DegradedBanner, WorkspaceNav,
BilingualFieldPair, SearchField, Pagination, EmptyState, Skeleton, Spinner, Icon.

## States
Every interactive component: default, hover, focus-visible (2px accent ring, 2px offset),
active, disabled (opacity .5, `not-allowed`), busy (spinner in place of label, non-actionable).
Every data screen: loading (skeleton), ready, empty (teaches the next action), error (retry).

## Motion
160ms ease-out-quart for hover/focus/press; 220ms for panel and sheet entry; opacity and
transform only. The kitchen stale-ticket pulse is the one attention animation. Respect
`prefers-reduced-motion`.

## Direction and language
Logical properties only (lint-enforced). `dir` on `<html>` flips the document; no mirrored
stylesheet. Latin fragments inside Arabic strings go through `isolate()`. All formatting
through `@touch/i18n` formatters.
