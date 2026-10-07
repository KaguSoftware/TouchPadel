---
id: button-size
title: Every tap target meets its family's minimum size, and one kind has one size
kind: scripted
analyser: scripts/checks/button-size.mjs
severity: error
config: [checks.button-size.minTarget, checks.button-size.sizeTolerancePx, checks.button-size.kindSpreadPx, checks.button-size.kinds]
staff: [staffExceptions.button-size.minTarget]
exempt: exempt.button-size
---

## Enforces

1. **Minimum.** The rendered hit area of every interactive element must be at least the
   family minimum in both width and height: **48x48 on the site** (`--tp-site-touch`,
   resolved live) and **44x44 in the café** (`.tp-btn`'s `min-block-size: 2.75rem`; the café
   has no touch token). This is an error.
2. **Consistency.** Targets of one kind should share one height. Icon-only kinds should
   share one width and height. A kind is the family plus the component class plus its
   modifiers (for example `tp-site-btn.tp-site-btn--go.tp-site-btn--lg`), or a semantic kind
   from `kinds` (for example the sheet close / expand / lightbox close buttons). This is a
   warning.

## Why

Guests use the café menu one-handed at a table, and the club site on phones. Small targets
cause mis-taps. `docs/design/web-site/contracts-2026-09-23.md` §5 requires site targets to
be at least `--tp-site-touch` (48px). The café's de-facto minimum is the 44px `.tp-btn`, which
is WCAG 2.5.5 AAA. WCAG 2.5.8 (AA, 24px) exempts inline links inside running text, and so
does this check, but only when non-link text shares a line box with the link. A link alone
on its line is a standalone target even when its container also holds a heading (the café
footer's phone number under its "Phone" title is judged).

## Thresholds and config keys

| key | default | meaning |
| --- | --- | --- |
| `checks.button-size.minTarget` | `null` | when set, overrides the family minimum everywhere |
| `checks.button-size.sizeTolerancePx` | 0.5 | sub-pixel slack (café rem tokens give fractional px) |
| `checks.button-size.kindSpreadPx` | 2 | a kind whose heights spread by more than this is flagged |
| `checks.button-size.kinds` | close/expand buttons, steppers | semantic kinds that cross class names |
| `design-system.json families.<f>.minTarget` | padel 48, café 44 | the family minimum when `minTarget` is null |

## How it is measured

The crawl records each element's **effective hit area**:

- the element's box;
- for a radio or checkbox, grown to cover its `<label>`;
- for a `::before`/`::after` with `position: absolute` that reaches more than 4px past the
  element (the stretched-link card pattern, for example `.tp-menu-item__open` covering its
  `.tp-menu-item`), grown to cover the pseudo-element's box in its containing block. The
  1.5px hover fill on `.tp-site-btn` does not count.

`inline` marks an `<a>` with no box (no ground, border or shadow) and `display: inline`
whose nearest block ancestor holds other text. Those links are exempt under WCAG 2.5.8.
Records are deduped per viewport by key and class list, keeping the worst size.

## Staff screens

`staffExceptions.button-size.minTarget` (default 40) replaces the minimum on screens matched
by `staffScreens`, because staff use the download page from a desktop with a mouse. Findings
on those screens are marked `[staff]`.

## False positives

- A target that is small on purpose but sits inside a larger clickable card: the hit-area
  logic covers the stretched-link pattern. A card that is clickable through JS on the
  container is not covered, so exempt it.
- A footer or legal text link that wraps onto two lines inside a paragraph is inline and
  exempt. A link styled `display: block` is judged.
- Disabled controls are still measured, because they become active later.

## How to fix

- Site: give the control `min-block-size: var(--tp-site-touch)` (and
  `min-inline-size: var(--tp-site-touch)` for icon-only controls), or use the shared
  `.tp-site-btn` / `.tp-site-iconbtn`. Keep the visual size and grow the hit area with
  padding or a `::before { inset: … }` when the design wants a small glyph.
- Café: use `.tp-btn` (`min-block-size: 2.75rem`). For icon buttons use
  `inline-size/block-size: 2.75rem`. Use the `--tp-space-*` tokens for padding.
- Make one kind one size: the sheet close / expand / lightbox close buttons should share one
  size.
- Use logical properties only (`apps/web/CLAUDE.md`). Check `/ar` as well.

## How to exempt

Add the element key (as printed, for example `menu-category-pill`) or the size-kind key
(`kind:<name>`) to `exempt.button-size`, with the reason in the commit message.
