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
under 10% of any surface. The navigation rail is the single committed brand surface: **Touch
Blue itself** on paper, a darker exact shade of it in blue mode, carrying the court-line motif in
green (panel colours pass, owner 2026-10-17: "the white mode has none of the real blue").

**Padel Green means here and now.** Solid #A5D06F with `--tp-accent-2-contrast` ink (#152847,
the L18 shade of Touch Blue, 8.31:1) marks the page you are on (the rail's current-page pill),
a guest who has arrived (the `live` tone; `BookingStatusIndicator`, the desk grid), and what is
in play (running tournaments). Other success states (paid, ready, completed) keep the soft
green tint, so an arrival stands out. Green is never a button, a link or decoration in the data,
and green text never sits on a light ground.

**Each mode borrows the other's colour** (round 3, owner 2026-10-18: "more white in the blue mode
and more blue in the white mode"). Headers and selection carry it, in the same places in both
modes:

| | Paper | Blue mode |
|---|---|---|
| `--tp-heading` (page titles) | #1D3762 | white |
| `--tp-panel-head` / `-fg` (panel title band) | Touch Blue / white | #F4F7FB / #274982 |
| `--tp-group-head` / `-fg` (band of a panel holding panels) | Touch Blue / white | #3B6EC4 / white |
| `--tp-breakdown-<tone>` / `-fg` / `-edge` (the overview's Breakdown cards: green, violet, rose, sky, teal, gold) | full colour / navy | calm deep colour / light ink |
| `--tp-card-1..6` (figure cards by place, repeating after six: groups, tile strips, record tiles, analytics cards) | green, violet, rose, light blue, teal, gold | the same as calm light inks |
| `--tp-table-head` / `-fg` (column band, = `--tp-group-head`) | Touch Blue / white | #3B6EC4 / white |
| `--tp-selected` / `-fg` (selected row, Go to option) | Padel Green / navy | Padel Green / navy |
| `--tp-table-total` / `-fg` (a table's total row) | Padel Green / navy | Padel Green / navy |
| `--tp-total-card` / `-fg` / `-muted` (a drill's figure card) | #1A2A44 / white | the same |
| `--tp-split-<tone>` (the figure card's bar, full-strength card colours) | the same in both | the same in both |
| `--tp-seg-track` / `-edge` / `-fg` / `-hover` (segmented buttons) | light grey, Touch Blue frame at 30% / navy ink | #3B6EC4 / white ink |
| `--tp-seg-on` / `-on-fg` (the chosen segment) | Touch Blue / white | Padel Green / navy |

A solid band or selected row also **borrows the other mode's palette for what sits inside it**:
`theme.ts` emits two cross scopes. The panel title band (`.tp-band`) takes the other mode's colour
tokens in both modes: blue-mode tokens on paper's Touch Blue, paper tokens on blue mode's white.
The selected row is Padel Green in both modes (Sait, 2026-10-19), a light ground, so it takes the
paper tokens in blue mode and keeps its own on paper; inside it `--tp-muted-fg` and `--tp-accent`
are pinned to its navy, so nothing on the green is grey or link-blue. `.tp-paper` and `.tp-blue` force one direction for anything else. Links, grey text, buttons and badges inside
then stay readable without per-screen edits. The ground tokens themselves
(`OPERATOR_SCOPE_GROUNDS`) are left out of the scopes. Every pair, including the crossed ones,
is pinned in `apps/operator/src/lib/tokens.test.ts`.

| Token | Value | Use |
|---|---|---|
| `--tp-bg` | **#E4EBF7** (HSL L93 shade of Touch Blue; L97 until 2026-10-18) | page ground |
| `--tp-surface` | oklch(99.5% 0.003 260) | panels, tiles, tables |
| `--tp-surface-2` | **#E4EBF7** (L93 shade) | toolbars, table heads, secondary panels |
| `--tp-fg` | oklch(22% 0.035 260) | text |
| `--tp-muted-fg` | oklch(46% 0.05 260), #485974 | secondary text (≥ 4.5:1 on every surface) |
| `--tp-border` | #C4D4ED (L85 shade) | hairlines |
| `--tp-border-strong` | oklch(82% 0.015 260) | inputs, focused rows |
| `--tp-accent` | **#3360AB** (`var(--tp-brand-blue)`) | primary action, selection |
| `--tp-accent-hover` / `-active` | #2D5495 / #274982 (L38 / L33 shades) | |
| `--tp-accent-soft` / `-soft-fg` | #DCE5F4 / #274982 (L91 / L33 shades) | selected row / chip ground |
| `--tp-success` / `-soft` / `-fg` | **#A5D06F**, hue 128.68 | live, ready, arrived |
| `--tp-warn` / `-soft` / `-fg` | amber 75 hue | attention, ageing |
| `--tp-danger` / `-soft` / `-fg` | red 27 hue | refused, void, stale |
| `--tp-*-mark` | ~58% lightness | dots, small icons, 2px rules — see below |
| `--tp-border-input` | oklch(58% 0.035 260) | control boundaries; clears 3:1 on page and panel |
| `--tp-skeleton` | oklch(90% 0.012 260) | the loading ground |
| `--tp-rail` / `--tp-rail-2` / `--tp-rail-fg` | **#3360AB** / #2D5495 / oklch(97.5% 0.006 260) | workspace navigation |
| `--tp-rail-active` / `--tp-rail-active-fg` | Padel Green / #152847 | the current-page pill and its label |
| `--tp-kds-bg` / `--tp-kds-card` / `--tp-kds-fg` | dark family | kitchen display only |

### The palette is closed

Five colours exist, and they are spelled exactly — never approximated in OKLCH, never eyedropped:

| | | |
|---|---|---|
| Touch Blue | `#3360AB` | `oklch(49.65% 0.13 260.02)` |
| Padel Green | `#A5D06F` | `oklch(80.51% 0.134 128.68)` |
| Brand Gray | `#BCBDBF` | `oklch(79.82% 0.003 264.54)` |
| Black | `#000000` | |
| White | `#FFFFFF` | |

Every accent token is a `var()` alias onto one of them, so the identity cannot drift a second
time — it already had: `--tp-accent` was `oklch(47% 0.13 262)`, which renders **#3057A3**, and the
cafe palette had wandered to **#2456B4** / **#7FB05A** even though the cafe deck names the same
Touch Blue. Anything that is not one of the five is either an exact shade of one (same hue, same
saturation, lightness the only free variable) or one of the three functional exceptions:

- **status red and amber** — comprehension, not identity; the owner kept both;
- **the categorical chart scale** (`SERIES_2`, `SERIES_3`) — a data encoding that needs hue
  separation to be readable at all;
- **the operator's tinted neutrals** — paper and ink, deliberately not the brand gray.

The mobile app's dark theme is **blue mode**: its every blue is a true shade of #3360AB. See
`apps/mobile/src/theme/tokens.ts`.

### Blue mode (the operator's second appearance)

The operator has no dark mode. It has **blue mode** (owner call, 2026-09-19: "instead of using
dark colours just use the brand's blue" — and, on the first cut, "use the exact same blue, no
change at all"). **The page is #3360AB, unmodified.** The rail is a darker exact shade (L22,
#1A3156), so the true blue reads as the page and the rail frames it.

Panels, toolbars and wells are **not** shades of the page any more (panel colours pass,
2026-10-17: "the blue in blue mode is too blue"). When they were L38 / L33 / L29 at the brand's
full saturation, the page and every panel on it were bright blue and nothing stood out. They are
now the brand hue at low chroma (panel #2A3F5F, toolbar #1A2A44, well #142238, hover #354B6E,
hairlines white at 22% so an edge reads the same on the page and on a panel):
the operator's tinted neutrals, the exception the closed palette already allows. White text
measures 10.63:1 on a panel. Selection stays the one step *up* (L50, #3B6EC4), so a selected row
is the brightest blue on the screen, and hover is a lift of the panel ink, never the selection
blue. The current page in the rail is the same Padel Green pill as on paper (7.40:1 against the
rail). The ink is white and the lighter shades of the brand gray. Every pair is pinned in
`apps/operator/src/lib/tokens.test.ts`.

Tokens live in `packages/ui/src/tokens/operatorBlue.ts` and are emitted under
`:root[data-theme='operator'][data-mode='blue']`, after the operator block and at higher
specificity. Only colour tokens are in that block; type, spacing, layout and z-index are the
operator's own. The block also declares `color-scheme: dark` so native controls follow.

What flips, and why:

- `--tp-accent` is **white** and `--tp-accent-contrast` is **#3360AB** — the brand blue on
  itself is nothing and cannot carry a button. The mobile Welcome screen makes the same move (a
  white primary button with blue ink). The focus ring goes white too.
- `--tp-muted-fg` is #E0E0E1, not the brand gray: #BCBDBF measures 3.28:1 on #3360AB.
- Status **fills** (`--tp-success`, `--tp-warn`) are unchanged; **soft** grounds darken and
  **fg** / **mark** lift: the green mark stays #A5D06F exactly, amber goes to #F0CB85 on
  #4F380D, danger becomes a dusky rose (#F0B0B4 on #4A2A3A) with #C93B30 as the one strong
  red, the filled destructive surface. All four families clear 5:1 on their soft ground and
  every mark clears 3:1 on the panel.
- The kitchen board, already dark, is re-tinted onto the brand ramp (L29 / L33 / L38), and the
  till's floor board keeps the same ramp; neither moved in the 2026-10-17 pass.
- Charts: Recharts reads literals, so `features/analytics/charts/colors.ts` carries a second
  set behind `useChartColors()`. Series 1 is white, rust and magenta clear 3:1 on the L38 card,
  and the heat ramp runs card → L50 → white.

The station chooses (`lib/themeMode.tsx`, key `touch-operator-theme`, same shape as the
locale) from the rail or the sign-in screen; `index.html` reads the same key before React
mounts so the boot frame paints blue rather than paper. Light writes **no** `data-mode`
attribute, so the padel and cafe documents are byte-identical to before modes existed.

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
One family for UI, and here that is literal: **Lama Sans** carries Latin and Arabic in the same
faces, so the operator never swaps family with locale. Windows-only target, so the stack leads
with it and falls back to `Segoe UI Variable` / `Segoe UI`, which covers Arabic well without a
download — the faces ship with the app, but a station that paints before they arrive still has to
read. Numerals are always tabular. Scale (rem): 0.75 · 0.8125 · 0.875 (base) · 1 · 1.125 ·
1.375 · 1.75. Weights 400 / 600 / 700. Body line-height 1.5; data rows 1.3. Line length for
prose ≤ 70ch.

## Spacing and shape
4px base. Common steps: 4 · 8 · 12 · 16 · 24 · 32. Radius: 6px controls, 10px panels, pill
for badges. Elevation is a border first; shadow only on overlays (dialogs, sheets, toasts).

## Density
Tables: 40px rows (`--tp-row-h`), 34px dense (`--tp-row-h-dense`), a 44px column header
(`--tp-row-h-head`, 14px bold). Every table draws its own 1px edge, inside a panel or a dialog
too. Only the rows scroll: the vertical scrollbar is a thin thumb drawn over
the rows between the header and the total row (the native bar shortened both), and there is no
rubber band (Sait, 2026-10-19). A log grouped by day uses DataTable `groupColumn`: one Day cell beside each
day's rows (weekday, date, month, the day's total) and a single line between days. Till tiles ≥ 72px
(`--tp-tile-min-block`). 44px minimum touch target (`--tp-touch`) everywhere on till and
kitchen. Forms: 8px between label and control, 16px between fields. These are tokens, and they
are px — do not re-type the numbers.

## Components (shared vocabulary)
Button (primary / default / danger / ghost; every one accepts `busy`), Field, Input, Select,
Tabs, Modal, ConfirmationDialog, PinPromptOverlay, ReasonCodePrompt, AsyncStateWrapper,
DataTable, StatusIndicator (booking / payment / ticket / tab), HeadlineFigure, ComparisonDelta,
PermissionRefusedNotice, ConflictNotice, MessagePresenter, DegradedBanner, WorkspaceNav,
BilingualFieldPair, SearchField, Pagination, EmptyState, Skeleton, Spinner, Icon.

**Date ranges** use one control, `DateRangePicker` (operator, 2026-10-19; `DateRangeControl` and
the Analytics bar wrap it). The field is only the dates and a chevron ("20 Sep – 19 Oct"; the year
only when it is not this one, and both years when a range crosses one). Its panel: the screen's
periods as chips on one line that scrolls sideways, a one-month calendar whose title opens a month
grid and then a year grid, and Clear / Apply. No summary line: the field shows the pick as it is
made, Apply keeps it, Escape or a press outside cancels.

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

Two asked-for exceptions, both Sait's (2026-10-19): the overview Breakdown's View more glides
open and closed, and a segmented control's green thumb slides (220ms) to the new choice. The
thumb animates its inline position and size, because segments differ in width. Both stop under
`prefers-reduced-motion`. A third needs the owner's word, not a reviewer's.

Utility classes live in `GlobalStyles.tsx`: `.tp-rise`, `.tp-fade`, `.tp-attention`, `.tp-skel`,
`.tp-spin` / `.tp-ball-spin`. Indeterminate progress is exempted from the reduced-motion kill and
slows to 1800ms rather than freezing — a blanket `animation-iteration-count: 1` leaves a spinner
as a dead glyph while the app is still working. Everything else respects
`prefers-reduced-motion`.

## Direction and language
Logical properties only (lint-enforced). `dir` on `<html>` flips the document; no mirrored
stylesheet. Latin fragments inside Arabic strings go through `isolate()`. All formatting
through `@touch/i18n` formatters.
