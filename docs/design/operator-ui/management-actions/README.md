# Management's four sections: every action

An inventory of everything a person can do on Management's **Financial**,
**Observe**, **Stock** and **Setup** sections of the operator app: every
button, row, tab, filter, picker, dialog, form field, shortcut and export,
which `app.*` RPC each write calls, who may use it, when it is disabled, and
which refusals it can get.

Snapshot of the **working tree on 2026-10-16**, uncommitted work from parallel
sessions included (the `/ops` body that Observe's overview carries was being
rebuilt that evening, so that part is the least settled). Everything here was
read from the code by a per-screen crawl, not clicked through in the running
app. Labels are the English catalog's words. Server refusal codes come from the
latest migration that defines each function, not from the hosted database.

| Section | File | Screens | Bullets |
|---|---|---|---|
| Financial | [financial.md](financial.md) | 15 | 912 |
| Observe | [observe.md](observe.md) | 15 | 842 |
| Stock | [stock.md](stock.md) | 22 | 633 |
| Setup | [setup.md](setup.md) | 10 | 752 |
| **All four** | | **62** | **3,139** |

One bullet is usually one control. Many bullets hold several, with a dialog's
fields nested under the button that opens it, so the real count of distinct
controls is well above 3,139. The Protocols bullets alone cover about 330
controls.

---

## 0. Getting around the four sections (the rail)

The four sections are Management's (`owner` workspace) section buttons. On the
Management rail they sit under the three top rows (Management panel,
Analytics, Assistant), one button each with a forward chevron. Source:
`apps/operator/src/lib/workspaces.ts`, `apps/operator/src/routes/__root.tsx`
(`WorkspaceNav`, `RailGroup`, `SectionFolder`), `components/RailBranch.tsx`.

| Section button | Lead line under the name | Lands on | Who sees the button |
|---|---|---|---|
| **Financial** | Money in, money out, and whether the cash agrees | `/financial` | owner |
| **Observe** | The floor now, the pattern behind it, and what is waiting on you | `/observation` | owner |
| **Stock** | On hand, deliveries, waste, counts and what the shelves are worth | `/stock` | owner (manager reaches the same rail from the **Stock** row in Operations › Run the day) |
| **Setup** | Staff, courts, tables and how the venue is configured | `/admin/staff` (no Overview row; `/setup` is URL-only) | owner |

**Inside any section the rail becomes that section only:**
- **Section name + lead line** at the top (read-only).
- **‹ Management** (back control; screen readers hear "Back to Management") — goes to `/panel`. No confirm: it stays in the same workspace.
- **Branch** — shown only when the business has more than one branch. Owner (or a manager at two branches) on an unregistered machine gets a dropdown: pick a branch → every screen reloads for that branch; a branch still being set up reads "‹name› · Preparing". Everyone else sees the branch name as plain text.
- **Each row** — opens its screen; the row of the current screen is lit. A row with a count shows a number pill (screen readers: "N waiting on you").
- **Dropdown rows** (a title with a chevron): press to open/close. It opens itself when you are on one of its screens; closed, it shows the sum of its rows' counts.
- Rows the person cannot open are not printed (`canAccess`: role, second jobs, pages the owner blocked on the Access list).

**Rows per section (what the rail prints):**
- **Financial:** Overview · Reports (tabs Revenue / Courts / Cafe on the screen) · Cash drawer · Safe · Day close · Wages (count = wages due now or overdue) · Rewards · Coach pay · Rates · Menu prices. Hidden but keeps this rail: Late and early (`/attendance`, opened from Wages).
- **Observe:** Overview · Bookings · Tills · Staff activity · Activity monitor · **From the team ▾** (Requests · Pay deductions (count) · Protocols (count) · Suggestions (count) · Incidents (count)) · Marketing (count = posts waiting on the owner) · Audit log. Hidden but keeps this rail: Promotions, Telegram (opened from Marketing), Floor now (`/ops` → redirects to Overview for the owner), `/desk` and `/till/tabs` (drill-through targets from the overview).
- **Stock:** On hand · Alerts · Expiry · **Stock in and out ▾** (Goods in · Move stock · Waste & production) · **Counting ▾** (Stock count (count = phone counts waiting) · Count differences) · **Recipes and costs ▾** (Ingredients · Recipes · Margins) · Stock value · Shop.
- **Setup:** Staff · Branches · Courts · Coaches · Tables & QR · Loyalty · Venue settings · Guest site. Hidden: Overview (`/setup`).

**Rail foot (same on every screen in these sections):**
- **Go on break** (with "N min left today" / "No break time left today") → PIN dialog **Start break**; while away the station shows **Cover this station** (pick a name + PIN → **Confirm**), **I'm back** / **End break** with PIN.
- **Options ▾** (Station controls): **Switch workspace** (only if the person holds more than one workspace; goes to the picker, which asks before changing workspace) · **Assistant** drawer · **العربية / English** · **Blue mode / Light mode** · (Electron, locked station) **Exit forced full screen** and **Quit to desktop** (needs another manager's PIN unless the owner is confirmed online; Quit installs a waiting update) · **Restart to update to vX** when "Update ready" shows · version line.
- **Sign out** → confirm "Sign out?" → **Sign out** / **Cancel**. With your own till shift open it asks about the drawer instead (**End my shift**, **Sign out anyway**, **Cancel**).

**Who can open each screen directly (`ROUTE_ROLES`, longest prefix wins, unknown = denied):**
- **Owner only:** `/financial`, `/observation` and every board under it (Bookings, Tills, Activity monitor, Requests), `/setup`, `/reports/revenue`, `/wages`, `/rewards`, `/marketing`, `/admin/staff`, `/admin/branches`, `/admin/loyalty`, `/admin/telegram`.
- **Manager + owner:** `/reports/*` (courts, cafe, staff, stock, coaches), `/safe`, `/attendance`, `/deductions`, `/protocols`, `/suggestions`, `/stock/*`, every other `/admin/*` (day close, rates, menu family, audit, promotions, courts, coaches, QR, settings, hours, hero).
- **Also desk + till:** `/incidents` (court_desk, cashier report there; review is management's), `/till/drawer` (cashier). `/shop/*`: shop_staff + manager + owner.
- A person can be blocked from any page by the owner (Staff › Access): the screen then says "The owner has closed this page for you. Ask them if you need it."

---

## What the crawl turned up that looks wrong

Found while reading the code; **none of these has been reproduced in the app**.
They are listed so they can be checked, not as confirmed bugs.

**Financial**
- *Export* on Reports, the Audit log and Expiry downloads an **.xlsx** file, while the Financial overview card promises a "CSV export".
- Online-refund buttons on the Financial overview (Retry, Refund, Settled another way) are **not disabled offline**.
- Closing a till shift needs a PIN of **6+ digits**; Day close's *Dismiss* accepts **4**.
- Day close: after *Open the next day*, *Open the day* on the same calendar date gets back the existing session (`app.open_day` dedupes), so the open form may stay up.
- The manager's rail has no *Cash drawer* row; they get there only by URL or through the Till workspace.
- Rates: *Save*'s hover reason says "Fill in both names first." on a form with one name. The `INVALID_DURATION` message says "not offered on this court", but the rule is actually 15–480 minutes in steps of 5.
- Wages and Late and early: *Previous month* has no lower bound.
- Menu: a manager always gets *Propose a new item*, never *New item*. The shop's *Put on sale* cannot be reached here. Nothing on the four menu tabs can be deleted, only switched off.
- Add-ons and Suggested have **no unsaved-changes guard**, so switching group or item drops edits. Their item and category lists include shop products and shop sections. Ticking an item on an existing sub-group turns it into an item group.

**Observe**
- The overview's **Activity monitor card shows a raw i18n key** as its description (`ws.owner.observationHome.cards.activityMonitor` is not in the catalog). Checked against the code: the key is indeed missing.
- Date bar tooltips print the key hint twice: "Previous day (← key) (←)".
- On a lesson-refund row, the *Online refunds* link does nothing on `/observation` when Needs you has no online-refunds row.
- Tills board: a table card opens only that table's **first** open tab.
- Requests: the approve and decline dialogs can still be closed (X, Esc, backdrop) while the decision is sending. Only Cancel is locked.
- Incidents: the desk's and till's *My reports* filter uses management's words, so your own open reports sit under "To review". Enter in *Where exactly* may send the report without the Review step.
- Audit log: with no rows at all it says "Nothing matches those filters."
- Marketing: the campaign and audience editors have **no unsaved-changes guard**. In the promotion editor, *Generate code* saves the code on the server at once, without *Save*.
- Protocols: a picked candidate cannot be un-picked.
- `docs/design/operator-ui/ops-today-inventory.md` is out of date against the rebuilt `/ops` body (Needs you, Before you close, So far today).

**Stock**
- **Recipes dialog (likely bug):** closing it with X, Esc or the backdrop fades it out *before* the unsaved-changes question. *Keep editing* can then leave an invisible layer that eats every click. Ingredients had the same problem and was fixed.
- Ingredients: the *Count stock* link in the dialog leaves without asking about unsaved changes. Nothing on screen stops expected waste over 100, a pack size of 0 or less, or a negative par or reorder point. A decimal pack price gets the generic "wrong format".
- Recipes: the ingredient picker includes shop stock and lets the same ingredient go on two lines.
- Count differences: the count picker has no store filter, so shop counts appear too.
- The receipt check view's ingredient picker lists shop stock; the typed Goods in form does not.
- Shop: *Finish count*, *Apply count* and the *Count differences* link go to `/stock/variance`, and Goods in's *On hand* link goes to `/stock`. Shop staff get a refusal there, and managers drop off the shop rail.
- Shop till: *Take payment* on a resumed sale always opens the Cash pane, so card is not possible. A staff-member customer who needs a manager PIN to attach is skipped with an error, and the sale goes through without the member.
- Shop copy: "Make a shop section in the menu first." although sections are now made on Products. Page titles differ from their rail rows ("On hand" vs *Shop stock*, "Shop products" vs *Products*). Products cannot be hidden or deleted from here.

**Setup**
- A manager may open Courts, Tables & QR, Venue settings, Opening hours and Guest site (all under `/admin`), but **no row on their rail leads there**.
- Branches: a closed branch has no way to be reopened, although the Close confirm says "you can open it again". With no branch Preparing, the right panel stays empty until a branch is clicked.
- Staff: two sections are both titled "Access". *Save branches* toasts its own button text and has no Discard.
- Courts editor: X and *Discard changes* close without asking, even with unsaved changes.
- Tables & QR: tables cannot be deleted, only switched out of use.
- Venue settings: registering a station toasts the button's own text. *Retire* shows a bare "Confirm" and no toast. A server refusal of Venue name or Phone shows "Enter a number from {min} to {max}." with the placeholders unfilled. On Analytics, clearing a saved "Count guest-app visits from" date shows neither Save nor *Remove the date*.
- Coaches: the *Make a coach* account picker says "(optional)" but the account is required. *Save profile*'s tooltip always says "Both display names are needed.", whatever is actually missing. *Add time off* is not blocked offline.
- Loyalty: the manager read-only mode can never show (the route is owner-only). Tier and reward *Save* are not blocked offline. A new reward is always valid at every branch, and no control picks a tier's linked promotion.
