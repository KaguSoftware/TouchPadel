---
id: click-depth
title: Every interactive element is reachable within maxClicks clicks of home
kind: scripted
analyser: scripts/checks/click-depth.mjs
severity: error
config: [checks.click-depth.maxClicks, startPath, viewports, crawl, neverClick, groups, keyBySelector, seedPaths]
staff: [staffExceptions.click-depth.exempt, staffExceptions.click-depth.maxClicks]
exempt: exempt.click-depth
---

## Enforces

Every button, link, tab, summary and form control on apps/web can be pressed within
`maxClicks` (default 3) clicks of `/en`, at both the desktop viewport (1280x800) and the
phone viewport (390x844).

## Why

A guest who has to dig for something does not find it. The club site exists to get people
booking and into the café menu, so anything worth a button should be close to the landing
page. Depth is judged per viewport because the header behaves differently at each: below
64rem, the book button, language and theme sit behind the "Site menu" sheet (+1 click).

## Thresholds and config keys

| key | default | meaning |
| --- | --- | --- |
| `checks.click-depth.maxClicks` | 3 | the most clicks allowed; an element visible on `/en` (after scrolling) costs 1 |
| `checks.click-depth.disabledCountsAsReached` | true | a disabled control counts as found where it is visible |
| `startPath` | `/en` | the root (written with its locale, because a bare `/` 307s by cookie or Accept-Language) |
| `viewports` | desktop, phone | one crawl per viewport |
| `crawl.*` | | settle timing, concurrency, the `maxStates`/`maxMinutes` budget |
| `neverClick.selectors`, `neverClick.text` | | recorded at their cost but never pressed (writes, sign-in, delete, send, language, theme). Prefer structural selectors (they hold in both locales); text rules carry English and Arabic forms |
| `network.localWriteGuard` | | the net under neverClick: a write the crawl still sends to the local stack (a write RPC, a non-GET `/rest/v1/<table>`, an auth or edge-function call) is aborted and printed as `WARN ... blocked a local WRITE` |
| `groups` | menu items, category pills, … | one key per repeated list; only `sample` members are pressed |
| `keyBySelector` | theme toggle, language link, … | stable keys for controls whose label flips |
| `seedPaths` | | extra roots for pages the site does not link; they never lower a click cost |

## How it is measured

`scripts/crawl.mjs` runs a breadth-first crawl in Playwright. A state is a pathname plus the
set of element keys a person could press there (with disabled ones marked). Each state is
reached by replaying its click path in a fresh context, so no state leaks between paths.
Opening a sheet, dialog, accordion or tab counts as a click. Expansion stops at `maxClicks`,
but the states at that depth are still recorded, so an element first seen there is caught at
`maxClicks + 1`.

`scripts/checks/click-depth.mjs` takes, per viewport, the cheapest cost of every key over the
states reached from `/en`. By default a disabled control counts as found where it is
visible (`disabledCountsAsReached: true`). The basket button is on the menu from the start,
and whether it works depends on what the guest did, not on navigation. Set the option to
false to measure the clicks until a control can actually be pressed. When a seed
root is itself a page reached from home (the `/en/menu` seed crawls the café sheets past the
budget), the cost continues through it: home depth of that page + depth inside the seed + 1,
with the joined path.

Report lines use the format `key (N clicks): step > step > key`. A key is `role:accessible
name [href path]`, with numbers shown as `:n`.

## Staff screens

`staffScreens` (default `^/(en|ar)/download/?$`, the operator installer page) is unlinked by
design. `staffExceptions.click-depth.exempt: true` drops findings that sit only on staff
screens. To judge staff screens instead, set `"maxClicks": 6`. The crawl depth grows to the
larger of the two limits.

## False positives

- Data-dependent controls (coach faces, event cards) do not render when the local DB lacks
  the RPC. The report prints a `NOTE local DB has no app.<rpc>` line, so read their absence
  as "not audited", not as "fine".
- A label that changes with live data, such as a price or a count, is normalised to `:n`.
  A label that changes in words would create a new key, so give that control a
  `keyBySelector` entry.
- Inline-anchor links (`#lessons`) and external links (wa.me, tel:, maps) are recorded and
  costed but never followed.

## How to fix

Move the control, or a shortcut to it, closer to the root. That might be a CTA on the page
that already shows its context, or a link in the footer or the header sheet. **Any change to
navigation structure needs Majed's explicit approval**, so propose it in the approval batch
and do not apply it on your own. Use the existing shared parts: `.tp-site-btn` variants on
the site, `.tp-btn` in the café, and the footer link list in `SiteFooter.tsx`.

## How to exempt

Add the exact key, or a `/regex/`, to `exempt.click-depth` in config.json, for example
`"button:Send to waiter"`, and note the reason next to it in the commit message (for
instance, "only meaningful after choosing items").
