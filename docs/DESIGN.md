# DESIGN.md — Touch Padel operator desktop app

Tokens live in `packages/ui/src/tokens/operator.ts` and are emitted as CSS custom properties
under `:root[data-theme='operator']`. Components in `apps/operator` reference tokens only.

**The root size is 16px** (`GlobalStyles.tsx`), and every number below depends on it. This
document was authored against a 16px root while the app shipped a 14px one, so for a long time
each figure here rendered 12.5% smaller than it reads: body text at 12.25px against the 14px
floor this same file sets, `--tp-touch` at 38.5px against a documented 44px, and the "strict
4px scale" resolving to 3.5 / 7 / 10.5 / 14 / 21 / 28. Physical targets (`--tp-touch`,
`--tp-row-h`, `--tp-tile-min-block`) are now declared in **px** rather than rem, precisely so a
reading size can never move a finger target again.

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
| `--tp-*-mark` | ~58% lightness | dots, small icons, 2px rules — see below |
| `--tp-border-input` | oklch(65% 0.02 262) | control boundaries; clears 3:1 |
| `--tp-skeleton` | oklch(90% 0.012 262) | the loading ground |
| `--tp-rail` / `--tp-rail-fg` / `--tp-rail-active` | navy ink family | workspace navigation |
| `--tp-kds-bg` / `--tp-kds-card` / `--tp-kds-fg` | dark family | kitchen display only |

Each status family has four rungs and the rung decides the job: **fill** (a ground large enough
to read colour off), **soft** (the tinted ground a label sits on), **mark** (a dot, an icon, a
2px rule — anything small), **fg** (text on the soft ground). The fills sit at 80% lightness, so
a 7px dot drawn in one measures 1.78:1 on paper and is simply not there; that is what the
`-mark` rungs exist for. Padel Green is declared **once**, as `--tp-accent-2`; `--tp-success`,
`--tp-rail-green` and `--tp-kds-fresh` alias it, so the identity cannot split on a partial edit.

The surface ramp is four steps and each is at least 1.09:1 from the next, because "elevation is
a border first" needs something to lean on: page ground, panel, toolbar, well.

Never `#000` or `#fff`. Status is never carried by colour alone; every indicator has a label.

**The brand mark** (`components/brand.tsx`) is the real 2026 logo as vectors — the ball, the
green-to-teal-to-blue swoosh, and the wordmark — extracted from the brand deck rather than
redrawn. It appears on exactly **six** surfaces and nowhere else: boot, the sign-in aside, the
rail head, the lock overlay, the KDS masthead, and print artwork. Plus one concession: the ball
is the busy indicator at `md` and `lg` only, never at `xs`/`sm`, because `xs` is what every
`<Button busy>` renders and the mark must not appear inside the data. The swoosh gradient fills
the swoosh path and nothing else — not text, not a border, not a divider, not a chart series.
The court-line motif has two call sites (rail head, lock overlay).

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
Tables: 40px rows (`--tp-row-h`), 34px dense (`--tp-row-h-dense`). Till tiles ≥ 72px
(`--tp-tile-min-block`). 44px minimum touch target (`--tp-touch`) everywhere on till and
kitchen. Forms: 8px between label and control, 16px between fields. These are tokens, and they
are px — do not re-type the numbers.

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

**The rule: motion is reserved for what the SERVER did while the operator was looking somewhere
else.** Nothing a finger, a click or a key causes may animate. This is testable in review — for
any proposed animation, name the actor; if the answer is "the operator", it does not ship. It is
why a KDS ticket arriving over the broadcast settles in while the identical card bumped by a
digit key does not, and why the workspace switch is deliberately still.

160ms (`--tp-dur-fast`) for hover and focus; 220ms (`--tp-dur-base`) for panel and sheet entry;
`transform`, `opacity` and `filter` only, never a layout property. `--tp-dur-ceremony` (420ms,
on `--tp-ease-settle`) has exactly **one** call site in the codebase — the sign-in swoosh — and
that single-call-site property is what makes it auditable by grep.

One attention loop exists, `.tp-attention` on `--tp-dur-attention`, and it may only mean
"pending" or "past its target": the stale ticket, the escalated waiter call, a connection still
being made. It rides a ring or a dot that carries **no text** — it used to run on the KDS card
root, dropping the most urgent ticket on the board to 45% opacity, which is the opposite of what
an alarm is for.

Utility classes live in `GlobalStyles.tsx`: `.tp-rise`, `.tp-fade`, `.tp-attention`, `.tp-skel`,
`.tp-spin` / `.tp-ball-spin`. Indeterminate progress is exempted from the reduced-motion kill and
slows to 1800ms rather than freezing — a blanket `animation-iteration-count: 1` leaves a spinner
as a dead glyph while the app is still working. Everything else respects
`prefers-reduced-motion`.

## Direction and language
Logical properties only (lint-enforced). `dir` on `<html>` flips the document; no mirrored
stylesheet. Latin fragments inside Arabic strings go through `isolate()`. All formatting
through `@touch/i18n` formatters.
