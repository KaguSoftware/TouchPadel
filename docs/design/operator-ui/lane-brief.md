# Lane brief — read this first (every workstream)

You are building one lane of the Touch Padel operator desktop app against
`docs/design/operator-ui/touch-padel-desktop-ui-spec.md`. The binding contracts (routes, RPC
names, file ownership, decisions) are in `build-plan-2026-09-03.md` beside this file. Design
context: `docs/PRODUCT.md` and `docs/DESIGN.md`. HANDOFF.md explains the repo; read its
"Conventions" section.

## Non-negotiables
- **Stay in your lane's files** (build plan §5). Never edit `components/**`, `lib/auth.tsx`,
  `lib/workspaces.ts`, `routes/__root.tsx`, `main.tsx`, `packages/ui/**`, or another lane's
  folders. If you need a shared primitive that does not exist, build it inside your own folder
  and list it under "Proposed for promotion" in your report.
- **No git commits, no pushes, no branches.** Leave the working tree for the integrator.
- **Strings**: every user-facing string via `tr('ws.<lane>.…')` from your own catalog pair
  `packages/i18n/src/catalogs/ws/<lane>.en.ts` + `<lane>.ar.ts` (Arabic parity is type-enforced;
  write real Arabic, not transliteration). Reuse `ws.kit.*` and `ws.shell.*` where a string
  already exists; existing `op.*` keys may be reused too. Never add keys to `en.ts`/`ar.ts` directly.
- **Formatting**: `formatIQD / formatNumber / formatDate / formatTime / formatDateTime /
  formatTimeRange` from `@touch/i18n` only. No `Intl.*`, no `toLocaleString`, no hand-built
  money strings. `isolate()` for Latin fragments in Arabic sentences; `<bdi>` in JSX.
- **No money / stock / time arithmetic in the UI.** Render server figures. Change due, totals,
  variance, prices: from the RPC result. (Pure display helpers like "is this date today" are fine.)
- **No permission conditionals.** Use `usePermissions()` / `permissionsFor()` from `lib/auth`
  (`can.refund`, `can.discount`, …) and render `PermissionRefusedNotice` for a refused control.
  The control stays visible (spec R9).
- **Every action control accepts `busy`** (`<Button busy>`), disables while pending, and shows
  the server error inline (`<ErrorText error>`), never only as a toast.
- **Four states** on every data screen: `AsyncStateWrapper` with `asyncStatus(query, isEmpty)`
  — loading (skeleton), ready, empty (teaches the next action), error (retry).
- **Sensitive actions** (discount, void, price override, stock adjustment, refund, reservation
  move/shorten/extend/cancel/status change, series cancel) route through `ReasonCodePrompt`,
  and where the RPC takes a PIN, `PinPromptOverlay` (or the existing `PinReasonModal`) before the
  callback fires.
- **Layout**: inline styles with CSS logical properties only (lint-enforced): `marginInlineStart`,
  `insetInlineEnd`, `textAlign: 'start'`, `paddingBlock`. Never left/right. Test mentally in RTL.
- **Realtime**: render from props/queries; `useBroadcast` for invalidation; polling
  `refetchInterval` as the safety net (existing patterns in `lib/realtime.ts`).
- **Writes**: registered mutation types go through `mutate()` (`lib/mutate.ts`); everything else
  through `appRpc()` or, for the new 0065–0068 names, `appRpcPending()` from `lib/appRpc`.
  Reads: `supabase.from(...)` or RPC via `useQuery`. Query keys: check `lib/queries.ts` (QK) and
  never reuse a shared key with a different shape.
- **Design**: product register (`docs/DESIGN.md`). Tokens only (`var(--tp-…)`). No emoji as
  icons: `<Icon name="…">` from `components/icons`. No side-stripe borders, no gradient text, no
  glass, no card grids of identical cards, no modal where an inline panel works. Density where
  the job is dense. 44px touch targets on till and kitchen.
- **Keyboard**: till and kitchen must be fully operable by keyboard (spec R11); elsewhere keep
  focus order sane and dialogs trapped (Modal does this).

## Shared components (import from `../../components/...`)
- `ui`: `Button` (kind default|primary|danger|ghost|soft, size sm|md|lg|xl, icon, busy), `Field`
  (label, hint, error, required), `inputStyle`, `card`, `panelMuted`, `Modal` (title, subtitle,
  size, footer), `ErrorText`, `Spinner`, `Skeleton`, `Tabs`, `Select`, `AmountPad`,
  `PinReasonModal`, `REASON_CODES`.
- `kit`: `PageHeader`, `Toolbar`, `Panel`, `Kbd`, `AsyncStateWrapper`, `asyncStatus`, `EmptyState`,
  `StatusBadge`, `BookingStatusIndicator`, `PaymentStatusIndicator`, `TicketStateIndicator`,
  `TabStatusIndicator`, `CustomerFlagBadge`, `DataTable` (+`Column`, `SortState`), `Pagination`,
  `DescriptionList`, `HeadlineFigure`, `ComparisonDelta`, `ComparisonControl`, `DateRangeControl`
  (+`Period`, `presetPeriod`), `ExportButton`, `DrillThroughPanel`, `PinPromptOverlay`,
  `ReasonCodePrompt`, `PermissionRefusedNotice`, `MessagePresenter`, `ConflictNotice`,
  `SearchField`, `SegmentedControl`, `Money`, `ChangeDueDisplay`, `BilingualFieldPair`,
  `LocalizedRecordText`, `BidirectionalTextRenderer`.
- `icons`: `Icon` (names in the file), `CourtLines`, `BrandMark`.
- `inputs`: `MoneyInput`, `PercentInput`, `BilingualFields`, `SortButtons`.
- `toast`: `useToast()`; `ConfirmDialog`: `useConfirm()`; `Switch`.
- `lib/i18n`: `useLocale()` → `{ tr, locale, dir, toggleLocale }`, `pickName(locale, row)`.
- `lib/auth`: `useAuth()`, `usePermissions()`, `requiredRoleFor()`.
- Shell: `useWorkspace()` from `routes/__root` if you need the active workspace.

## Gate before you report
```
pnpm --filter @touch/operator lint typecheck test
pnpm --filter @touch/i18n typecheck
```
All green. Add unit tests for any pure logic you write (`*.test.ts`, vitest, node env) and at
least one component test (`*.test.tsx`, jsdom + testing-library) for your lane's main screen
rendering its four states. Keep existing e2e selectors your lane touches stable (headings,
button names, dialog names listed in `e2e/tests/operator-*.spec.ts`).

## Report format (final message)
1. Screens built (spec §) with the states each renders.
2. Files created/changed.
3. Deviations from the contract and why.
4. Proposed for promotion to shared components.
5. Gate output (counts), anything not verified.
