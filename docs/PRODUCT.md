# PRODUCT.md — Touch Padel operator desktop app

register: product

## What it is
A Windows desktop application (Vite + React SPA inside Electron) installed on the till, the
court desk, the wall-mounted kitchen display, and the manager/owner machines at Touch Padel, a
padel venue with a cafe in Iraq. One build, one deployment, five purpose-built workspaces:
court desk, cashier, prep (kitchen), manager, owner. Bilingual English/Arabic with full RTL.

## Users
- **Court desk** — one person at a counter, phone in one hand, guest in front of them. Needs
  today's bookings, arrivals, the calendar, and a customer in seconds. Works at arm's length.
- **Cashier** — stands at a till under bright cafe lighting, glancing between screen and guest.
  Adds items by keyboard without looking, takes cash and card, splits bills. Speed is the product.
- **Prep** — the kitchen reads a wall screen from two to three metres through steam and noise.
  No mouse, no navigation, nothing to get lost in. Age of a ticket matters more than anything.
- **Manager** — floats between the floor and a desk. Opens the day, watches stock, resolves
  exceptions, closes the day with cash and card reconciled. Many screens, short visits.
- **Owner** — reads the business from a laptop, often after hours. Headline figures that open
  down to the transactions behind them. Nothing on this surface writes.

## Brand
Touch Padel 2026 identity: Touch Blue `#3360AB`, Padel Green `#A5D06F`, a teal accent, black,
white, grey `#BCBDBF`. Motif: diagonal court lines in green over blue. Latin display face
**Next Art**, Arabic **Frutiger LT Arabic** (licensed files not yet delivered; system faces
stand in behind tokens). Tone: confident, athletic, direct. "Touch is a lifestyle."

## Tone
Plain operational English and Arabic. Short labels. Every refusal states its reason. No
marketing voice inside the tool; the brand shows up in the navigation rail and in the print
artwork, not in the data.

## Anti-references
- Generic admin templates: white cards on grey with an icon, a heading and a paragraph each.
- Dashboards that grade staff (leaderboards, scores, rankings) — contractually excluded.
- Dark-mode-by-default "cool tool" aesthetics on the till and the desk; those rooms are bright.
- Decorative motion, gradient text, glass panels.

## Strategic principles
1. The tool disappears into the task. Familiar product patterns, dense where the job is dense.
2. Every action control respects `busy`; every refused action stays visible and says why.
3. Money, stock and time are never computed in the UI; the server's figures are rendered.
4. Both directions, both languages, every screen. Logical CSS only.
5. The kitchen screen is the one surface that may be dark and loud: it is read across a room.
