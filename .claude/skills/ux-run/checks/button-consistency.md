---
id: button-consistency
title: Buttons of one kind look the same everywhere and come from the shared button
kind: scripted
analyser: scripts/checks/button-consistency.mjs
severity: error
config: [checks.button-consistency.tolerancePx, checks.button-consistency.allow, checks.button-consistency.roles]
staff: [staffExceptions.button-consistency.severity]
exempt: exempt.button-consistency
---

## Enforces

Every boxed button or link (one with a ground, a border or a shadow) is judged against its
family's shared button in `design-system.json`:

| family | shared button | canon (rendered) |
| --- | --- | --- |
| site | `.tp-site-btn` + one of `--go/--primary/--ghost/--blue`, optional `--sm/--lg/--xl`; `.tp-site-iconbtn` | min height 48 (sm 48, lg 56, xl 64), radius `--tp-site-radius-btn` 14px, font `--tp-font-body`, weight 800, UPPERCASE, tracking .07em (xl .09em), font 15px (sm 13, lg 16, xl 17), border 1.5px solid transparent (visible on `--ghost`); RTL: no case, no tracking, font 16 (sm 15, lg/xl 18). Icon: 48x48 pill |
| café | `.tp-btn` + `--primary/--secondary/--ghost/--onblue`, optional `--block` | min height 44, pill radius, font `--tp-font-body`, weight 700, border 1px solid transparent (visible on `--ghost`) |

Controls that are their own component, not text buttons, have their own canon
(`design-system.json` `buttons.kinds`) and are judged against it, never against the text
button:

| family | kind | members | canon |
| --- | --- | --- | --- |
| site | pill (chip / nav pill / language pill) | `.tp-site-header__lang`, `.tp-legal__nav a` | min height 48, pill radius, 1.5px solid border |
| café | FAB | `.tp-fab` (`--top` 44) | 56x56, round |
| café | café icon button | `.tp-sheet__close`, `.tp-itemsheet__expand`, `.tp-lightbox__close`, `.tp-qty__step`, `.tp-basket-line__remove` | 44x44, round |
| café | category chip / tab pill | `.tp-cattabs button` | min height 44, pill radius |
| café | language pill | `.tp-locale-switch` | min height 44, pill radius |

Type (font family, weight, case, tracking, size) is read from the element that holds the
visible label (the café locale switch sets it on `.tp-locale-switch__code`), and is not
judged at all on icon-only controls. A border is judged as seen: the canon's
`1px solid transparent` and no border look the same and are not a finding; a visible border
where the canon's is transparent (the browser's default `2px outset` on an unstyled
`<button>`) is. A `<button>` that renders in the browser's default font (13.3px, not a
family font) is named as such.

The check reports five kinds of finding:

- **hand-built** (error): a boxed button that does not use its family's button class.
- **foreign** (error): a site button wearing the café's `.tp-btn`, or the reverse, such as
  `.tp-legal .tp-btn`.
- **kind** (warning): a FAB, icon button, chip or pill (see the kinds table) that differs
  from its kind's canon.
- **drift** (warning): a shared button whose height, radius, font, weight, case, tracking,
  font size or border differs from its variant's canon. The finding names the rule that
  overrides it, for example `.tp-ticket__go` in `events.css.ts`.
- **allowlisted look-alike** (warning, only when it differs): a button that is a copy on
  purpose (`checks.button-consistency.allow`, each with its reason), compared with the canon
  it imitates.

Separately, a radius that is off the radius tokens, or a font size off the type scale, is
reported as a one-off value.

## Why

Style reference §9 names the buttons: CTA "go" is Padel Green, black, UPPERCASE, 800, radius
14 or more; Primary is Touch Blue; Secondary and Ghost. When one action looks different on
each page, guests have to relearn it. `apps/web/CLAUDE.md` puts all styling in
`src/styles/**/*.css.ts` with tokens, so a hand-built button is also a maintenance fork.

## Thresholds and config keys

| key | default | meaning |
| --- | --- | --- |
| `checks.button-consistency.tolerancePx` | 0.5 | px slack |
| `checks.button-consistency.roles` | `["button","link"]` | which roles count as buttons (tabs, summaries and options are other components) |
| `checks.button-consistency.allow` | `.tp-lost__btn` and the standalone pages' `*__open` CTAs | deliberate copies: `{class, reason, compareTo}` |
| `design-system.json families.<f>.buttons` | | the shared classes, variants, sizes and canon values |

## How it is measured

From the crawl's element records, the check keeps links and buttons that have a box, or
that carry a button class. It groups them per viewport and direction by their full `tp-*`
class signature. For each group it compares the computed values (min height, radius, weight,
text-transform, letter-spacing in em, font size, font family, border width, style and
visibility) with the expected canon. The
canon is resolved from the component, variant and size classes, with the RTL overrides
applied. Tokens are resolved live at the element. For each deviation, the source index finds
the declaration that sets the property outside the canonical rules (`file:line`). Source
lines only ever name rules that were live in the page's stylesheets: on `/delete-account`
the café sheet is not loaded, so `.tp-btn` there points at `.tp-legal .tp-btn`
(`legal.css.ts`), not at `cafe/base.css.ts`.

## Staff screens

`staffExceptions.button-consistency.severity` (default `warn`) downgrades findings that sit
only on staff screens (the download page), and marks them `[staff]`.

## False positives

- Tabs (`.tp-appband__tab`), FAQ summaries and option chips are not buttons in the design
  system. They are left out through `roles`. The café category pills are plain `<button>`s,
  so they are judged, against the chip kind.
- A new FAB, icon button or pill that is not in `buttons.kinds` shows up as hand-built.
  Add it to the right kind in `design-system.json` (with Majed) rather than exempting it.
- The standalone pages (`/pay/return`, `/m/:token`, `/c/:id`, `/events/:id`, the 404) ship
  their own sheet for performance, by design. Their CTAs are allowlisted and only compared.
  The fix is to align the values, never to import the site sheet into them.
- `.tp-club__cta` scales with the 3D court (container units). Its font drift is expected:
  exempt it once Majed confirms.

## How to fix

Replace a hand-built button with the shared class (`.tp-site-btn tp-site-btn--<variant>
[--<size>]` on the site, `.tp-btn tp-btn--<variant>` in the café) and delete the copied
rule. When the context really needs something different, add a variant to the shared
component with Majed's approval, never a page-local override. Remove overrides of font
size, tracking or radius in section rules. Replace raw radii with `--tp-site-radius-*` or
`--tp-radius-*`. Check `/ar` after every change, because RTL drops case and tracking.

## How to exempt

Add the printed key (the class signature, for example `.tp-site-btn.tp-ticket__go`) to
`exempt.button-consistency`, or add an `allow` entry with a reason and the canon it imitates.
