---
id: card-consistency
title: Every card in a family shares the design system's one card style
kind: scripted
analyser: scripts/checks/card-consistency.mjs
severity: warn
config: [cards.known, cards.exclude, cards.minWidth, cards.minHeight, checks.card-consistency.tolerancePx]
staff: [staffExceptions.card-consistency.severity]
exempt: exempt.card-consistency
---

## Enforces

Each card is compared with its family's canonical card in `design-system.json`, property by
property. The canon is the design system, not whatever most cards happen to do.

| family | canon | reference implementation |
| --- | --- | --- |
| site (`data-theme="padel"`) | 1px solid `--tp-border`, ground `--tp-surface`, radius `--tp-site-radius-md` (16px), padding 16-24px, **no shadow** | `.tp-acct__card` (`styles/site/account.css.ts`), `.tp-legal__form` |
| café (`data-theme="cafe"`) | 1px solid `--tp-border`, ground `--tp-surface`, radius `--tp-radius-md` (16px), padding 12-24px, no shadow | `.tp-card` (`styles/cafe/base.css.ts`) |

It also flags instances of one card component that differ from each other, and the
following problems in the card's own CSS rules:

- **Error:** an undefined token, meaning a `var(--tp-x)` with no fallback that the family
  never defines. It renders as the initial value. For example, `--tp-radius-ctl` on the
  download page gives radius 0.
- **Error:** the other family's token used in a card, which contracts §2 forbids.
- **Error:** a radius that is not on the family's radius scale.
- **Warning:** any other deviation from the canon, and a raw radius literal, or a raw padding
  literal in the café.

## Why

Style reference §9: "Card = card ground, 1px line border, radius 16, padding 16". §8.3:
"border first, shadow only on overlays". When cards are inconsistent, the site looks
assembled from parts. Sources: `docs/brand/touch-padel-style-reference.md` §8-§9,
`packages/ui/src/tokens/site.ts`, `cafeBrand.ts`, and
`docs/design/web-site/contracts-2026-09-23.md` §2.

## Thresholds and config keys

| key | default | meaning |
| --- | --- | --- |
| `cards.known` | the known card classes | always treated as cards when visible (precision) |
| `cards.exclude` | bands, posters, dialogs, header, menu rows | never treated as cards |
| `cards.minWidth` / `cards.minHeight` | 120 / 60 | heuristic size floor |
| `checks.card-consistency.tolerancePx` | 0.5 | px slack |
| `design-system.json families.<f>.card` | see the table above | the canon |

## How it is measured

In full mode the crawl records every visible element that is listed in `cards.known`, or
that meets all of these conditions:

- it has its own ground (different from its parent's), or a border on all four sides, or a
  shadow;
- it has a radius greater than 0 that is not a pill;
- it contains text and at least one child element;
- it is at least the minimum size;
- it is not a control.

Its computed radius, padding, borders, ground, shadow and gap are recorded, together with
the tokens resolved at that element, so a section that re-scopes colours is judged with its
own values. Cards are grouped per viewport by family and component class (the first `tp-*`
class without a `--modifier`). The source index maps the class back to its rule
(`*.css.ts:line`) and the component that renders it.

## Staff screens

`staffExceptions.card-consistency.severity` (default `warn`) downgrades errors on staff
screens and marks them `[staff]`.

## False positives

- Section bands, posters and ticket art are designed surfaces, not cards. They are listed in
  `cards.exclude` (`.tp-faq__ask`, `.tp-stage__band`, `tp-events__*`, `tp-ticket*`).
- The nightly site has two grounds (`--tp-site-band-bg`, `--tp-site-hero-bg`). A card on a
  band that uses the band ground is reported, because the canon says `--tp-surface`. When
  Majed decides that is intended, record it in `design-system.json` instead of exempting
  each card.
- A card that only renders with data (tour cards, coach cards) is missing when the local DB
  lacks the RPC. See the `NOTE local DB has no …` line.

## How to fix

Edit the card's rule in its `*.css.ts` to use the canon tokens: `border: 1px solid
var(--tp-border)`, `background: var(--tp-surface)`, `border-radius:
var(--tp-site-radius-md)` (site) or `var(--tp-radius-md)` (café), padding `clamp(1rem, 3vw,
1.5rem)` (site, as in `.tp-acct__card`) or `var(--tp-space-4)` (café), and no `box-shadow`.
Replace an undefined token with an existing token of the same family. Do not emit operator
tokens into the café theme (`theme.ts` keeps the vocabularies apart). Never import the site
sheet into the 404/error fallback.

## How to exempt

Add `.<class>` (as printed, for example `.tp-faq__item`) to `exempt.card-consistency`, with
the reason in the commit message. For a deliberate new card style, ask Majed and then record
it in `design-system.json`.
