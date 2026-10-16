# Setup: every action, screen by screen

Management › **Setup** — *Staff, courts, tables and how the venue is configured*. Part of the
[management actions inventory](README.md), which also covers the rail, who can
open what, and the problems this crawl turned up.

Snapshot of the operator app's **working tree on 2026-10-16**, uncommitted work
from parallel sessions included. Read from the code, not clicked through:
labels are the English catalog's words, writes name the `app.*` RPC (or queued
mutation) they call, and refusal codes come from the latest migration that
defines each function. If a screen changes, this file is stale for that screen.

| Screen (rail order) | Bullets |
|---|---|
| Staff — `/admin/staff` | 134 |
| Branches — `/admin/branches` | 50 |
| Courts — `/admin/courts` | 58 |
| Coaches — `/admin/coaches` | 176 |
| Tables & QR — `/admin/qr` | 55 |
| Loyalty — `/admin/loyalty` | 53 |
| Venue settings — `/admin/settings` | 117 |
| Opening hours — `/admin/hours` | 14 |
| Guest site — `/admin/hero` | 50 |
| Overview (Setup) — `/setup` | 45 |
| **Total** | **752** |

---

## Staff — `/admin/staff`
This page lists everyone who can sign in to the operator, says what each role opens, and is where the owner adds accounts and manages one person's name, role, access, PIN, branches, stations, password and sign-in.

*Who:* owner only (`ROUTE_ROLES['/admin/staff'] = ['owner']`; the `/admin` layout guard also applies). A manager, or anyone whose owner blocked the "Setup (menu, courts, day close)" page, gets the route guard card instead of the page. In-screen gate: `can.manageStaff` (owner), so on this owner-only route every control is live. *Source:* `apps/operator/src/features/admin/staff/StaffList.tsx`, `StaffAccountEditor.tsx`, `staffParts.tsx`, `staffModel.ts`, `hirePrefill.ts`; `routes/admin/staff.tsx` (`?hire=<uuid>` search param); `packages/core/src/staff/access.ts` (second jobs, page areas); edge function `staff-admin`.

**Getting there**
- **Staff** (rail row, owner's Setup section, shield icon). Goes to `/admin/staff`. It is also the section's home: the Setup section icon lands here.
- **Staff** card on the Setup overview (`/setup`). Goes to `/admin/staff`.
- **Set PINs** / **Go to Staff** buttons on the Setup overview's "Worth checking" rows. Go to `/admin/staff`.
- **Fix** on the Branches checklist row "A manager works here". Switches the rail branch to that branch, then goes to `/admin/staff`.
- From Protocols, a hiring run's add_staff step goes to `/admin/staff?hire=<run step id>` (a malformed id is dropped).
- Refused visitor: the guard card says "Not allowed for your role: Opening this screen needs the Owner role…", or for a blocked page "The owner has closed this page for you. Ask them if you need it.", plus the link **Go to my home screen**, which goes to the person's home route.

**Page header**
- **Add staff member** (primary, user-plus icon). Opens the Add staff member dialog in plain mode. Disabled unless `can.manageStaff`.
- If `can.manageStaff` is false, a notice reads "Not allowed for your role: Managing staff accounts needs the Owner role…". The guard makes this unreachable in practice.

**Hiring banner (only with `?hire=`; reads `app.protocol_step_detail`, `app.protocol_run_detail`, `app.hiring_candidates`)**
- Loading: "Loading the hiring run…" (read-only).
- Load failed: "The hiring run could not be loaded." plus the error.
  - **Try again**. Refetches whichever of the three reads failed.
  - **Close**. Navigates to `/admin/staff` and clears `?hire`.
- Step not open, or not a hiring add_staff step: "This hiring step is not waiting on you, so nothing is filled in."
  - **Open the hiring run**. Shown only when it is a hiring step and the viewer can open `/protocols`. Goes to `/protocols?run=<run>&step=<step>`.
  - **Close**. Clears `?hire`.
- The position's role cannot be given to an account (or is Owner): "The position names a role an account cannot be given here, so nothing is filled in. Check the position on the hiring run."
  - **Open the hiring run**. Goes to `/protocols?run=…&step=…`.
  - **Close**. Clears `?hire`.
- Ready: panel "From a hiring run". Body: "{name} was picked for {role}. Add their account here; the hiring run finishes when it is saved." When there is no name: "The run picked someone for {role}…".
  - **Add {name}**, or **Add the new staff member** when there is no name (primary). Opens the Add staff member dialog in hire mode, with the name filled in and the role locked.

**Notices above the list**
- When exactly one active owner exists, an info line (read-only): "There is only one owner account, and nobody can remove or re-role their own. Add a second owner as a safeguard."

**Breaks panel ("Breaks")**
- **Break time per person per day** (numeric input, digits only, at most 3 characters, "minutes" suffix). Edits a draft. Hint: "Several breaks may add up to this. 0 switches breaks off. Starting or ending one takes the person's own PIN." Disabled when the viewer cannot manage staff, while settings load, or while saving.
  - **Discard changes** (shown only when the draft differs from the saved value). Resets the draft.
  - **Save** (shown only when the draft differs). Calls RPC `app.set_cafe_setting` with `p_key='break_allowance_minutes'` and `p_value=<n>`, with an optimistic cache update that rolls back on error. Validation: a whole number from 0 to 480. While the value is invalid the button is disabled, and hovering it shows the hint text. Success toast: "Break allowance saved." Errors appear in an error toast. Online only.

**Staff table (`app.list_staff`; sorted by name)**
- Loading: a skeleton table. Error: "This could not be loaded." plus the error and "You may be offline. The last known data is shown where available."
  - **Try again**. Refetches `list_staff`.
- Empty: "No staff accounts yet" / "Add the first account. Each person signs in with their own email and password."
  - **Add staff member** (primary). Opens the Add dialog. Disabled unless `can.manageStaff`.
- Columns are read-only:
  - **Name**, with a "You" badge on your own row.
  - **Role** (role name). A "Retired" badge appears for Kitchen/prep. While the panel is closed, a second line shows what the role opens.
  - **PIN**: "Set" or "Not set". "Not set" is amber for Manager and Owner, because without it they cannot approve at the till.
  - **Access**: "Can sign in" or "No access".
- **Manage** (button in each row; hidden while the account panel is open). Opens the account panel for that person.
- Clicking a row, or pressing Enter or Space on a focused row, opens or moves the account panel to that person. The selected row is highlighted.
- **Show people without access ({count})** / **Hide people without access** (ghost button, only when at least one inactive account exists). Toggles inactive accounts in and out of the list.

**Account panel (StaffAccountEditor; opens beside the list, sticky)**
- Header: name plus a "Can sign in" / "No access" badge.
- **Close** (X icon button). Closes the panel. Disabled while a write is in flight.
- On your own account, an info line (read-only): "This is your own account. Only another owner can change your role or remove your access."
- Refusals from any section show at the top of the panel in the screen's own words:
  - PIN_WEAK: "That PIN is too easy to guess. Avoid repeated digits and runs like 123456."
  - PIN_FORMAT: "A PIN is 6 to 12 digits."
  - EMAIL_IN_USE: "An account with this email already exists."
  - ROLE_RETIRED: "Kitchen is no longer given to anyone. Choose Barista or Chef assistant."
  - LAST_OWNER: "This is the only owner. Make someone else an owner first."
  - Any other code uses the shared error line.

- *Name section*
  - **Name shown in the app** (text, at most 80 characters). Hint: "The sign-in email cannot be changed here. To use a different email, add a new account and remove access from this one." Disabled when the viewer cannot manage staff or a write is busy. It works on your own account too.
  - **Discard changes** (only when the trimmed name is non-empty and differs). Restores the saved name.
  - **Save name** (only when changed). Calls RPC `app.rename_staff(p_staff_id, p_display_name)` with no confirm. Toast: "Saved." Errors: NAME_LENGTH ("A name must be 1 to 80 characters."), FORBIDDEN, STAFF_NOT_FOUND.

- *Role section*
  - **Role** (dropdown). Options, in order: Cashier, Waiter, Court desk, Shop assistant, Head barista, Barista, Assistant barista, Head chef, Chef assistant, Driver, Marketing, Manager, Owner. On a prep account, "Kitchen" is listed first, greyed and not choosable. The hint underneath states what the chosen role opens. Disabled on your own account, on an inactive account, and while busy. On an inactive account a note reads: "Give this person access again before changing their role."
  - **Discard changes** (only when the role was changed). Reverts the dropdown.
  - **Change role** (only when the role was changed). Opens a confirm.
    - Title: "Change {name}'s role to {role}?"
    - Body: what that role opens, then "The change applies straight away; their menus update the next time they sign in."
    - **Cancel**. No change.
    - **Change to {role}**. Red when the new role is Owner. Calls RPC `app.set_staff_role(p_staff_id, p_role)`. Toast: "Role changed." Errors: LAST_OWNER, ROLE_RETIRED, CANNOT_EDIT_SELF ("You cannot change your own role or switch off your own account. Another owner has to do it."), FORBIDDEN.

- *Access section (0345 — second jobs and blocked pages; reads `staff.extra_roles, blocked_areas`)*
  - On an Owner account: "An owner opens everything, so there is nothing to tick." No controls.
  - While loading the section shows "…". On error it shows the error line.
  - Lead: "Their role ticks the pages it opens. Add a second job for someone who covers two jobs, or untick a page to keep them out of it."
  - **Second jobs** (checkbox group). Hint: "Each one adds that job's screens and buttons beside their role." The offered jobs leave out the person's own role: **Cashier**, **Waiter**, **Court desk**, **Shop assistant**, **Barista**, **Chef assistant**, **Driver**, **Marketing**. Each tick or untick only edits the draft, and the Pages list below updates live.
    - On a Manager account there are no checkboxes. Note: "A manager already opens the till, the desk, the kitchen screen and the shop."
  - **Pages they can open** (checkbox group; ticked means open, unticked means blocked). Hint: "Untick a page to take it off their menu and keep them out of it." It lists only the pages that the role plus the ticked second jobs open, from this set in this order: **Till**, **Court desk**, **Customers**, **Tournaments**, **Kitchen**, **Touch Shop**, **My tasks**, **Incidents**, **Operations**, **Stock**, **Setup (menu, courts, day close)**, **Reports**, **Protocols**, **Suggestions**, **Pay deductions**, **Late and early**.
    - Cashier sees Till, Customers, My tasks, Incidents.
    - Court desk sees Court desk, Customers, Tournaments, My tasks, Incidents.
    - The bar and kitchen roles see Kitchen and My tasks. Prep sees Kitchen only.
    - Shop assistant sees Touch Shop.
    - Waiter, Driver and Marketing see My tasks.
    - Manager sees all except My tasks.
  - Both groups are disabled on your own account, on an inactive account, and while saving.
  - **Discard changes** (only when dirty). Drops the draft.
  - **Save access** (only when dirty; disabled when locked). Opens a confirm.
    - Title: "Change what {name} can open?"
    - Body lines, where each applies: "Adds the second job: {list}.", "Takes away the second job: {list}.", "Keeps them out of: {list}.", "Opens again: {list}.", then "Their screens update within a minute."
    - **Cancel**.
    - **Save access**. Calls RPC `app.set_staff_access(p_staff_id, p_extra_roles, p_blocked_areas)`. A block on a page that no job opens any more is dropped on save. Toast: "Access saved." Errors: CANNOT_EDIT_SELF, INVALID_ARGUMENT (owner account, or an unknown job or area), STAFF_NOT_FOUND, FORBIDDEN.
    - The block only hides screens. The person's role RPCs still answer.

- *PIN section ("PIN")*
  - A read-only note that depends on the role and on whether a PIN exists:
    - Manager or Owner with a PIN: "Set. They can approve discounts and voids at the till, take breaks and unlock the station."
    - Manager or Owner without a PIN: "Not set. They cannot approve discounts or voids, or take a break, until one is set."
    - Everyone else with a PIN: "Set. It starts and ends their breaks and unlocks the station."
    - Everyone else without a PIN: "Not set. They cannot take a break until one is set."
  - **Set PIN** / **Change PIN** (lock icon). Opens the PIN dialog. Disabled for inactive accounts or while busy. It is allowed on your own account.
  - **Remove PIN** (only when a PIN is set). Opens a red confirm.
    - Title: "Remove the PIN for {name}?"
    - Body: "They will not be able to approve discounts, voids or price changes at the till until a new PIN is set."
    - **Cancel**.
    - **Remove PIN**. Calls RPC `app.clear_staff_pin(p_staff_id)`. Toast: "PIN removed."

- *Branches section (only when more than one branch exists; multi-venue, `app.staff_memberships` / `app.set_staff_venues`)*
  - On an Owner account: "An owner works at every branch." No controls.
  - Otherwise the hint reads "Where this person works. Someone at two branches picks one on every screen." Below it is one checkbox per branch, named in the UI language. The checkboxes are disabled for inactive accounts and while saving.
  - **Save branches** (only when changed; disabled with no branch ticked). Calls RPC `app.set_staff_venues(p_staff_id, p_venue_ids)` with no confirm. The success toast also reads "Save branches". Errors: STAFF_VENUE_REQUIRED ("A staff member has to work at one branch at least."), VENUE_NOT_FOUND, INVALID_ARGUMENT (owner). There is no Discard button here.

- *Stations section ("Stations")*
  - On Manager or Owner accounts it only says: "Managers and owners can cover any station."
  - Otherwise: "Offered as cover on these stations' break screens." Below that is one checkbox per station id. The list combines every device in `device_heartbeats` with any station the person is already assigned to. While loading it shows "…". With none: "No station has reported in yet. A station appears here once its app has run." Disabled for inactive accounts.
  - **Discard changes** (only when dirty). Drops the draft.
  - **Save stations** (only when dirty). Calls RPC `app.set_station_staff(p_staff_id, p_station_ids)` with no confirm. Toast: "Stations saved." Errors: VENUE_MISMATCH (the person does not work at this branch), INVALID_STATION, STAFF_NOT_FOUND.

- *Password section ("Password")*
  - Note: "Set a new one when they forget theirs."
  - **Set a new password** (lock icon). Opens the password dialog. Disabled for inactive accounts or while busy.

- *Access section (sign-in; titled "Access" too)*
  - Note, active: "Removing access signs them out and stops them signing in. Their records stay under their name." Inactive: "This person cannot sign in. Their past work stays in the records under their name."
  - **Remove access** (red, ban icon; active accounts). Disabled on your own account, with the tooltip "You cannot change your own account." Opens a red confirm.
    - Title: "Remove access for {name}?"
    - Body: "{name} is signed out on every device within the hour and cannot sign in again. Their manager PIN, if they have one, is removed. Everything they did stays in the records under their name. You can give access back later."
    - **Cancel**.
    - **Remove access**. Calls RPC `app.set_staff_active(p_staff_id, false)`. Toast: "Access removed." Errors: LAST_OWNER, CANNOT_EDIT_SELF.
  - **Give access back** (undo icon; inactive accounts). Opens a confirm.
    - Title: "Give {name} access again?"
    - Body: "They can sign in again with their old password, in the role shown. They will need a new PIN."
    - **Cancel**.
    - **Give access back**. Calls RPC `app.set_staff_active(p_staff_id, true)`. Toast: "Access given back."

**Add staff member dialog (modal; X "Close", Esc and a backdrop click close it)**
- Subtitle: "They sign in with this email and password." In hire mode: "Saving the account finishes the hiring run."
- **Name** (required, at most 80 characters). Hint: "As staff and the records will see it." It takes focus unless hire mode filled it in.
- **Email** (required, email type). Hint: "Used only to sign in." While a non-empty value fails the shape check, the inline error reads: "This does not look like an email address."
- **Role** (dropdown). Same 13 options as the account panel, Cashier by default. The hint says what the role opens. In hire mode it is locked to the position's role, with the note "Set by the hiring run: the account must be in the role the position named."
- **Password** (required; shown in clear text on purpose). Hint: "At least 10 characters. Tell them in person; they can change it afterwards." Inline error: "Too short: add {count} more." The server also caps it at 72 characters.
- **Cancel**. Closes. Disabled while creating.
- **Add staff member** (primary). Disabled until the name, a valid email and a password of at least 10 characters are present; the tooltip then reads "Fill in a name, a valid email and a long enough password." It calls edge function `staff-admin` with `{action:'create', email, password, display_name, role, venue_id: <branch in the rail switcher>}`. The call is never cached and needs a connection.
  - Plain mode: toast "Account created.", the dialog closes and the list refreshes.
  - Errors: EMAIL_IN_USE ("An account with this email already exists."), ROLE_RETIRED, BAD_REQUEST (password length, bad venue).
  - Hire mode: after create the form locks, then RPC `app.submit_step(p_run_step_id, p_record={staff_id}, p_photos=[], p_idempotency_key)` runs. Success toast: "Account added. The hiring run is finished." Then it navigates to `/admin/staff` with `?hire` cleared.
  - If that send fails: "The account was created, but the hiring step was not sent." The primary button becomes **Send the hiring step again**, which re-sends `submit_step` with the same idempotency key.

**Password dialog (modal)**
- Title: "New password for {name}". Subtitle: "Their current password stops working as soon as you save."
- **New password** (text shown in clear, autofocus). Hint: "At least 10 characters…".
- **Cancel**.
- **Set password** (primary, lock icon). Disabled under 10 characters, with no tooltip. Calls edge function `staff-admin` `{action:'reset_password', staff_id, password}`. Toast: "Password changed." Errors show inline.

**PIN dialog (modal, small)**
- Title: "Set a PIN for {name}" or "Change the PIN for {name}". Subtitle: "Typed at the till to go on break and unlock the station. A manager's or owner's PIN also approves a discount, a void or a price change."
- **New PIN** (digits only, at most 12, large centred field, autofocus). Hint: "6 to 12 digits. Repeated digits (111111) and runs (123456) are refused." Pressing **Enter** saves when the value is valid.
- **Cancel**.
- **Save** (primary, lock icon). Disabled until 6 to 12 digits. Calls RPC `app.set_staff_pin(p_staff_id, p_pin)`. Toast: "PIN saved." Errors: PIN_WEAK, PIN_FORMAT, STAFF_NOT_FOUND (inactive account).

---

## Branches — `/admin/branches`
This page lists every Touch location, shows a new branch's "Before it opens" checklist, and is where the owner opens a new branch, opens it to guests, or closes one.

*Who:* owner only (`ROUTE_ROLES['/admin/branches'] = ['owner']`). Every RPC is owner-gated server-side, except `branch_readiness`, which takes manager or owner at that venue. There is no in-screen capability gate. "Fix" and "Print table QR codes" depend on `useVenue().canSwitch`: a registered station can only reach its own branch. *Source:* `apps/operator/src/features/admin/branches/BranchesAdmin.tsx`, `branchesLogic.ts`.

**Getting there**
- **Branches** (rail row, owner's Setup section, home icon). Goes to `/admin/branches`.
- **Branches** card on the Setup overview. Goes to `/admin/branches`.

**Page header**
- **Open a new branch** (primary, plus icon). Opens the "Open a new branch" dialog.

**Branches list panel (reads the `venues` table, ordered by creation)**
- Loading shows a skeleton. On error it shows the error line, with no retry button. When empty: "No branches yet."
- Each row is a button showing the branch name, the slug and a status badge ("Preparing", "Open" or "Closed"). Clicking it selects that branch and shows its panel. `aria-pressed` marks the current one. With nothing chosen, the first Preparing branch is shown. If no branch is Preparing, no panel shows until one is clicked.

**Branch panel (the selected branch)**
- Title: the name plus a status badge. Address and phone show as a read-only line.
- **Before it opens** checklist (not shown for a Closed branch; `app.branch_readiness(p_venue)`). The intro reads "Guests see the branch once every required step is done." Required rows sort first. Each row has a badge, "Required" (red when not done) or "Recommended" (amber when not done), green once done, and one of these labels:
  - "A court with a rate"
  - "Opening hours"
  - "A manager works here"
  - "A till is registered"
  - "A menu item on sale"
  - "A Telegram group for alerts"
  - "Opening stock received"
  - Loading shows a skeleton; an error shows the error line.
  - **Fix** (ghost; only on rows not done). It switches the rail branch to this branch when the machine can switch, then navigates by row:
    - courts_and_rates goes to `/admin/rates`
    - opening_hours goes to `/admin/hours`
    - manager goes to `/admin/staff`
    - till goes to `/admin/settings`
    - menu goes to `/admin/menu`
    - telegram goes to `/admin/telegram`
    - opening_stock goes to `/stock`
    - On a station of another branch the button is disabled, with the tooltip "This machine is a station of another branch. Do this from that branch's machine, or from one that is not a station."
- **Open to guests** (primary, check icon; Preparing only). Disabled until every required row is done. Calls RPC `app.open_branch(p_venue)` with no confirm. Toast: "{name} is open to guests." Error toast BRANCH_NOT_READY: "This branch isn't ready to open yet. Finish the checklist first." Afterwards it refreshes the branches and venues lists.
- **Print table QR codes** (Preparing only). Switches the rail branch to this one when possible, then goes to `/admin/qr`. Disabled, with the same tooltip, on a station of another branch.
- **Close branch** (red; Preparing or Open). Opens a red confirm.
  - Title: "Close branch"
  - Body: "Close {name}? Guests stop seeing it. Nothing is deleted, and you can open it again."
  - **Cancel**.
  - **Confirm** (the default label). Calls RPC `app.close_branch(p_venue)`. Toast: "{name} is closed."
  - Errors show both as a toast and inline under the buttons:
    - BRANCH_HAS_BOOKINGS: "This branch still has bookings, lessons, holds or series to come. Cancel or move them first."
    - The coaching-money variant: "This branch still has coach statements to approve or pay… Settle them in Coach pay and Ops first."
    - BRANCH_DAY_OPEN: "Close this branch's day before closing the branch."
    - LAST_OPEN_BRANCH: "This is the only open branch. Open another branch before closing it."
- A Closed branch shows only its name, badge and address. The page has no action to reopen it.

**Open a new branch dialog (wide modal; X, Esc and backdrop close it, except while creating)**
- Intro: "The new branch starts as a copy of the branch you pick: courts, rates, hours, tables, menu, recipes, checklists and protocol templates. Nothing is copied back, and no promotion, stock or staff comes across."
- **Name (English)** (required). Typing also fills Short name until Short name has been edited by hand. Valid at 2 to 80 characters; it is marked invalid when non-empty and out of range.
- **Name (Arabic)** (required, RTL). Valid at 2 to 80 characters. It has no invalid marking, but it blocks Create.
- **Short name** (required; lowercased as you type). Hint: "Lowercase letters, digits and dashes, used in links." Valid as `^[a-z0-9][a-z0-9-]{1,31}$`, so 2 to 32 characters. Marked invalid when non-empty and wrong.
- **Copy setup from** (dropdown of non-closed branches; defaults to the first Open one). Required.
- **Phone** (optional). When filled it must match `+`, digits, spaces and `()-`, 6 to 20 characters. Marked invalid otherwise.
- **Timezone** (optional; prefilled from the source branch).
- **Address (English)** (optional).
- **Address (Arabic)** (optional, RTL).
- **Cancel**. Disabled while creating.
- **Create** (primary; reads "Creating the branch…" while busy). Disabled while any field problem stands, with no tooltip. Calls RPC `app.create_branch(p_source_venue, p_slug, p_name_en, p_name_ar, p_phone, p_timezone, p_address_en, p_address_ar)`. Blank fields go as null. The new branch starts as Preparing.
  - Success toasts: "{name} is ready to set up." and "Copied: {courts} courts, {items} menu items, {tables} tables." The dialog closes and the new branch is selected.
  - Error toast only: SLUG_TAKEN ("Another branch already uses this short name. Pick another."), TEXT_BOTH_LANGUAGES_REQUIRED, INVALID_ARGUMENT, VENUE_NOT_FOUND.

---

## Courts — `/admin/courts`
This page lists the bookable courts in desk-calendar order and is where courts are added, edited (names, descriptions, indoor or outdoor, booking lengths, photo), switched off, reordered and deleted.

*Who:* manager and owner (it inherits `ROUTE_ROLES['/admin']`). Every RPC is guarded with `is_staff('manager','owner')`. There is no in-screen capability gate, so a manager can do everything an owner can here. Only the owner's rail has a Courts row; a manager reaches the page by URL. A manager whose "Setup (menu, courts, day close)" page is blocked gets the guard card. The data and writes follow the branch in the rail switcher. *Source:* `apps/operator/src/features/admin/courts/CourtsAdmin.tsx`, `courtsLogic.ts`; `components/inputs.tsx` (BilingualFields, SortButtons); `components/ImageField.tsx`; `components/Switch.tsx`.

**Getting there**
- **Courts** (rail row, owner's Setup section, court icon). Goes to `/admin/courts`.
- **Courts** card on the Setup overview. Goes to `/admin/courts`.

**Page header**
- **Add court** (primary, plus icon). Opens the editor panel as "New court".

**Courts table (reads the `courts` table, including switched-off courts, by `sort_order`)**
- Loading shows a skeleton. Error: "This could not be loaded." plus details and the offline hint.
  - **Try again**. Refetches.
- Empty: "No courts yet" / "Add the first court. Nothing can be booked until one exists."
  - **Add court**. Opens the new-court editor.
- **Move up** / **Move down** (arrow icon buttons in the "Order" column, with those words as tooltip and label). Each swaps the court with its visible neighbour, then calls RPC `app.reorder_courts(p_ids)` with the full id order, with no confirm. Disabled at the top or bottom of the visible list and while a reorder is pending. Errors show as an error toast; the list refetches either way.
- Read-only columns:
  - **Court**: name, plus the description while the editor is closed.
  - **Type**: "Indoor" or "Outdoor". Hidden while the editor is open.
  - **Booking lengths**: e.g. "60 min · 90 min". Hidden while the editor is open.
  - **Status**: "Open for booking" or "Switched off".
- **Edit** (note icon, in each row; hidden while the editor is open). Opens the editor for that court.
- Clicking a row, or pressing Enter or Space on a focused row, opens or moves the editor to that court. The selected row is highlighted.
- Note (read-only): "The arrows set the order courts appear in on the desk calendar."
- **Show switched-off courts ({count})** / **Hide switched-off courts** (only when at least one is off). Toggles them in the list. The court being edited stays listed regardless.

**Court editor panel (sticky, beside the table)**
- Title: the court name, or "New court". An "Unsaved changes" badge shows while the form is dirty.
- **Close** (X icon). Closes immediately without asking, even when dirty. Disabled while saving or deleting.
- **Name (English)** / **Name (Arabic)** (text, at most 60 characters each). Both are required to save.
- **Description (English)** / **Description (Arabic)** (multi-line, at most 300 characters). Hint: "Optional. A short note about the court, like "Air-conditioned, glass walls"."
- **Indoor or outdoor** (segmented control): **Indoor** / **Outdoor**.
- **Booking lengths** (toggle buttons, pressed means chosen): **30 min**, **45 min**, **60 min**, **75 min**, **90 min**, **120 min**, **150 min**, **180 min**. A new court defaults to 60, 90 and 120. Hint: "How long a guest or the desk can book this court for. Each length needs a price under Rates." With none chosen the error reads "Choose at least one length."
- **Photo** (ImageField, 16:9):
  - **Drop zone**. Clicking it, or pressing Enter or Space, opens the file chooser. Dragging and dropping a file also works. Placeholder: "Drag a file here or click to choose one."
  - **Upload** / **Replace**. Opens the file chooser. It accepts JPEG, PNG, WebP, GIF and AVIF up to 10 MB. The file is compressed to WebP and uploaded to storage at once, folder `courts`. The new path is saved to the court only on Save. While uploading it shows "Uploading…". Errors appear as toasts: "File is too large (max 10 MB).", "That file is not a supported image.", "Upload failed."
  - **Remove** (only when a photo is set). Opens the confirm "Remove this photo?" with **Cancel** and **Remove**. Remove clears the field, which is saved on Save.
- **Open for booking** (switch). Hint when on: "Guests and the desk can book this court." When off: "The court leaves the desk calendar and the guest app. Past bookings and reports keep its name."
  - Switching an existing open court off makes the panel count its upcoming bookings (reservations with status pending, confirmed or arrived that have not ended). A skeleton shows while counting, and errors show inline.
  - If there are any: "Upcoming bookings on this court: {count}. Move or cancel them at the desk before switching it off."
    - **Open the desk calendar**. Navigates to `/desk`.
- **Delete court** (red ghost button with a trash icon; existing courts only). Opens a red confirm.
  - Title: "Delete {court}?"
  - Body: "It is removed from the calendar, the guest app and the price rules for good. This cannot be undone."
  - **Cancel**.
  - **Delete court**. Calls RPC `app.delete_court(p_id)`. Toast: "Court deleted." The editor closes.
  - On COURT_IN_USE a refusal shows inline: "{court} cannot be deleted because the records still use it. Bookings: {n}. Repeat bookings: {n}. Price rules: {n}." followed by "Switch it off instead: it leaves the calendar and the guest app, and the reports keep its name."
    - **Switch off instead** (ban icon; only when the court is active). Calls RPC `app.upsert_court` with `p_is_active=false`, with no confirm. Toast: "Saved."
- **Close** / **Discard changes** (the label reads "Discard changes" when dirty). Closes the editor with no confirm. Disabled while saving or deleting.
- **Save** on an existing court, or **Add court** on a new one (primary, check icon).
  - It is disabled in four cases, each with a tooltip where one exists:
    - A name is missing: "Fill in both names first."
    - No length is chosen: "Choose at least one duration."
    - Upcoming bookings block switching off: "Move its upcoming bookings first."
    - The bookings are still being counted (no tooltip).
  - When switching off, it first asks for confirmation.
    - Title: "Switch off {court}?"
    - Body: "It leaves the desk calendar and the guest app as soon as you save, and nobody can book it…"
    - **Cancel**.
    - **Switch off**.
  - It then calls RPC `app.upsert_court(p_id, p_name_en, p_name_ar, p_indoor, p_description_en, p_description_ar, p_photo_path, p_duration_options, p_is_active, p_active_from, p_active_to)`. Toast: "Saved." The editor closes.
  - Errors show inline:
    - NAME_REQUIRED
    - INVALID_DURATIONS
    - COURT_HAS_FUTURE_RESERVATIONS ("This court still has upcoming bookings — move or cancel them at the desk first.")
    - INVALID_PHOTO_PATH
    - COURT_NOT_FOUND
    - FORBIDDEN

---

## Coaches — `/admin/coaches`
This page sets up coaching at the rail's branch: who the coaches are and their public profile, which lesson types exist and what they cost, and each coach's weekly hours and time off.

*Who:* manager and owner. The route inherits `/admin` (`ROUTE_ROLES['/admin'] = ['manager','owner']`) and is listed in `SUB_ROUTES['/admin']`. Rail row "Coaches" (whistle icon) sits in the manager's Setup (`MANAGER_SETUP`) and in the owner's Setup (`OWNER_SETUP`). A page the owner blocked for the person closes it (`canAccess`). In-screen gates come from `useCoachingCaps()`: `manageCoaches` (manager, owner) covers every write button. `editLaunchedPrices` (owner; shop_staff also holds it but cannot open this route) lets someone set a coach's own price and edit a launched lesson type's price and shape. `launchDirectly` (owner) puts a draft on sale directly. `startProtocolPriceChange` together with `canAccess('/protocols')` (manager, owner) shows the "Propose…" and protocol "Put on sale" buttons. The server re-checks each RPC: a manager acts only on "a coach in scope" or a branch they work at.
*Source:* `apps/operator/src/features/admin/coaches/` (CoachesAdmin.tsx, CoachesTab.tsx, CoachEditor.tsx, PromoteCoachDialog.tsx, LessonTypesTab.tsx, LessonTypeEditor.tsx, CoachHoursTab.tsx, coachesLogic.ts, lessonTypeLogic.ts, coachHoursLogic.ts), `routes/admin/coaches.tsx`, `features/coaching/useCoaching.ts`, `features/coaching/LessonReadNotice.tsx`, `features/admin/promotions/PriceChangeStart.tsx`, `features/desk/customers/CustomerPicker.tsx`, `components/ImageField.tsx`, `components/inputs.tsx`. Strings: `ws.coaching.coachesAdmin.*`, `ws.coaching.lessonTypes.*`, `ws.coaching.coachHours.*` (coachingAdmin.en.ts), `ws.coaching.offline/errors/common.*` (coaching.en.ts), `op.errors.*` (opErrors.coaching.en.ts).

**Ways in (deep links; `?tab=coaches|types|hours&coach=<uuid>&promote=<uuid>&type=<uuid>`; a value that is not a UUID is dropped)**
- **Rail "Coaches"** opens `/admin/coaches` on the Coaches tab.
- **Customer record "Make coach"** (record of a customer who is not a coach; needs `manageCoaches`) goes to `/admin/coaches?tab=coaches&promote=<customerId>` and opens the Make a coach dialog with that customer read through `app.customer_record` and picked.
- **Customer record "Open in Coaches"** (the customer is a coach) goes to `/admin/coaches?coach=<coachId>` and opens that coach's editor.
- **The URL itself.** `?type=<id>` opens that lesson type's editor. `?tab=hours&coach=<id>` picks that coach on Hours. Every in-screen navigation rewrites the search with `replace: true`, so Back skips tab changes.

**Page frame (every tab)**
- **Header "Coaches"** with the line "Coaches, the lessons they teach and their hours at this branch." This is read-only.
- **Header button "Make a coach"** (primary, plus icon) shows only on the Coaches tab, only once data has loaded, and only with `manageCoaches`. It opens the Make a coach dialog (below) with an empty form. It is not disabled offline; the dialog's submit is.
- **Header button "New lesson type"** (primary, plus icon) shows only on the Lesson types tab, after load, with `manageCoaches`. It opens a blank new-type editor beside the list and clears `?type`.
- **Tabs "Coaches" / "Lesson types" / "Hours"** switch tab through `?tab=`. Arrow keys, Home and End move between tabs (RTL aware). Going to Lesson types drops `?coach`. Going to Hours keeps `?coach`, so the coach being edited is the one picked.
- **Branch.** The page always shows the rail's branch (`useVenue().branchId`). The owner changes branch with the rail switcher, outside this page; a switch remounts the screen. A registered station never switches.
- **Auto refresh.** `app.coaches_admin(p_venue_id)` re-reads every 60 s while the page is open. Every write also re-reads it.
- **Loading.** A 6-line skeleton shows while data loads.
- **Server without coaching** (`RPC_MISSING`) shows the empty state "Coaching needs a server update that isn't there yet." with no tabs and no actions.
- **Read failed.** The red line "Lessons can't be shown without a connection" appears with a **"Try again"** button that refetches `coaches_admin`.
- **Stale data** (an earlier read is still shown) carries the muted line "Last updated {time}".
- **Lessons switched off at this branch** shows the info line "Lessons are switched off at this branch. Coaches and lesson types can be set up now; guests see nothing until the owner switches lessons on." Everything below stays editable.
- **Offline rule.** Every write is a direct `appRpc` call, online only and never queued. While the station's last heartbeat failed (`useStationReach().reachable` false), write buttons are disabled with the hover tooltip "Needs a connection: lessons work online only".

**Coaches tab: list**
- **Empty state** "No coaches yet" / "Make a coach from a guest account: they teach the lesson types you tick, at the branches you choose."
  - **"Make a coach"** (primary; only with `manageCoaches`) opens the Make a coach dialog.
- **Table "Coaches"** (no sort and no list cap). Columns while no editor is open: Photo (square photo, or whistle placeholder "No photo"), "Coach" (display name in screen language plus badges), "At this branch", and Actions. Coaches sort by `sort_order`, then English name.
  - Badges (read-only): "Active" / "Paused" / "Retired", "Account deleted", and "Waiting for the coach to accept" (not on retired coaches).
  - "At this branch" shows "Branches {count}", "Lesson types {count}", "Upcoming lessons {count}", and a warning badge "No hours yet" (not on retired coaches with no hours).
- **Row click, or Enter/Space on a focused row,** opens that coach's editor beside the list (`?coach=<id>`). While the editor is open the table shrinks to Photo, Coach and "Status" columns, and the selected row is highlighted.
- **"Open"** (per-row button, note icon, aria "Open: {name}"; only while no editor is open) opens that coach's editor.
- **"Show retired coaches ({count})" / "Hide retired coaches"** (ghost button; shows when any coach is retired) folds or unfolds retired coaches. A retired coach being edited stays listed while folded.

**Coaches tab: coach editor (sticky panel; each part saves on its own)**
- **Title:** photo, display name and badges (read-only).
- **X "Close"** (icon button) closes the editor and clears `?coach`. Any unsaved draft in the editor is dropped without asking.
- **Account section** (read-only): heading "Account", the account's full name (staff only, never public), phone or "No phone".
  - **"Open customer"** (ghost, user icon plus outward arrow; only when the coach has a profile) navigates to `/desk/customers/<profileId>`.
  - When the account is deleted it instead reads "Account deleted: the bio and photo were cleared; the display name stays on their statements."
- **Retired coach:** the editor is read-only, with the info line "Retired. Their statements stay under Coach pay."
  - **"Make a coach again"** (user-plus icon; needs `manageCoaches`, account not deleted, a profile present) opens the Make a coach dialog prefilled with the retired coach's names and bios, the customer picked, and their branches that this screen shows plus the rail branch. The photo starts empty. It sends `app.coach_promote`, which revives the coach.
- **Info lines** (not retired):
  - "{name} hasn't accepted a public profile yet. Guests don't see them until they accept in the app; lessons booked at the desk or by the coach work now." shows while acceptance is pending.
  - "Not teaching at this branch. Their lesson types and prices here can't change until this branch is ticked again under Branches." shows when the coach is not active here.
- **Public profile section** (a draft, saved with "Save profile" through `app.coach_update(p_coach_id, p_patch)`, which sends changed keys only):
  - **"Display name (English)"** / **"Display name (Arabic)"**: text inputs, max 60 each, both required (trimmed).
  - **"Link name"** (only when the server sends a slug, from migration 0337 on): LTR input with no autocapitalise or spellcheck, max 48. Hint "Their share link: touch-padel.com/c/{slug}. Changing it stops the old link working." Validation: "Use 2 to 48 lowercase letters, numbers and dashes, starting with a letter or number." It also may not look like a coach id. An emptied field is not sent, so the coach keeps the old link name. Saved lower-cased.
  - **"Bio (English)"** / **"Bio (Arabic)"**: textareas, max 1000 each, optional.
  - **"Photo"**: square image field.
    - Click or drag a file onto the drop zone ("Drag a file here or click to choose one"); the zone is keyboard-operable with Enter/Space.
    - **"Upload"** / **"Replace"** opens the file chooser (jpeg, png, webp, gif, avif). The file is compressed to WebP and uploaded straight away to storage under `coaches/<random uuid>/`.
    - **"Remove"** asks "Remove this photo?" with **"Remove"** / **"Cancel"** and clears the photo in the draft.
    - Error toasts: "File is too large (max 10 MB).", "That file is not a supported image.", "Upload failed." The spinner reads "Uploading…".
  - **"Levels they coach"**: checkboxes "Beginner", "Intermediate", "Advanced". Hint: "Guests pick a level on the app's Coaches page. Leave all three unticked and this coach shows under every level."
  - **"Place in the list" N**, hint "Guests see coaches in this order, at every branch they teach at."
    - **Move up** / **Move down** (chevron icon buttons, tooltips "Move up" / "Move down") save immediately, separate from the draft. They swap this coach with its neighbour among non-retired coaches, renumber in steps of 10, and send one `app.coach_update {sort_order}` per changed coach. Disabled at the ends, while saving, and offline. The order applies at every branch. Errors appear under the arrows.
  - **"Unsaved"** (warning badge) shows when the draft differs from what is stored.
  - **"Discard"** (ghost; shown when dirty) resets the draft and deletes a photo uploaded but never saved.
  - **"Save profile"** (primary; shown when dirty) sends `app.coach_update`. It is disabled offline (tooltip "Needs a connection…") or on a validation problem (tooltip "Both display names are needed.", the same tooltip even when the slug or bio is the problem). Success toasts "Profile saved." and removes the replaced photo's old file. Errors: "Another coach already uses this link name. Pick another." (`COACH_SLUG_TAKEN`), "Invalid input — check the values and try again." (`INVALID_ARGUMENT`, for example on a retired coach), "That coach can't be found." (`COACH_NOT_FOUND`), "You do not have permission for that." (`FORBIDDEN`).
- **Branches section** "Branches", hint "Where this coach teaches.":
  - **Branch checkboxes**, one per branch the person can see (`useVenue().venues`). Saved branches the screen can't show are kept automatically.
  - **"Save branches"** (primary, small; shown when the set changed) sends `app.set_coach_branches(p_coach_id, p_venue_ids)`. It is disabled offline or when nothing is ticked (tooltip "Tick at least one branch."). Toast "Branches saved." Unticking a branch deletes the coach's hours there; their lessons are kept. Error `BRANCH_HAS_BOOKINGS` reads "This coach has lessons at {branch}. Cancel them first." Also possible: `FORBIDDEN` and `COACH_NOT_FOUND`.
- **Lesson types section** "Lesson types here":
  - **A checkbox per lesson type at this branch** (name plus "Private" / "Group" / "Course"). Disabled when the coach is not active here. Shows "No lesson types at this branch yet." when there are none.
  - **"Save lesson types"** (primary, small; shown when changed and the coach is active here, or after a refused promote) sends `app.set_coach_lesson_types(p_coach_id, p_venue_id=current branch, p_lesson_type_ids)`. Disabled offline. Toast "Lesson types saved."
    - When unticking a type for which the coach has their own price, a danger confirm appears: title "Remove {coach}'s own price?", body "Unticking {type} also removes {coach}'s own price for it." (one line per type), buttons **"Cancel"** / **"Untick and remove the price"**.
    - Errors: `COACH_NOT_AT_BRANCH`, `LESSON_TYPE_NOT_FOUND`, `FORBIDDEN`.
  - After a refused promote, the line "{name} is a coach now, but their lesson types weren't saved. Tick them again below." shows, with the attempted ticks restored.
- **Prices section** "Prices for this coach" lists each lesson type the coach teaches here: the type name and "Lesson price {price}" or "No price yet". It shows "This coach teaches no lesson types here yet." when there are none.
  - **Owner:** hint "Leave empty to use the lesson type's price." Each row has an **IQD input** (aria "{coach}'s price for {type}"; digits only, Arabic digits accepted, formatted IQD shown beside; blank means remove).
    - **"Set"** sends `app.set_coach_price(p_coach_id, p_lesson_type_id, p_price_iqd)`. Disabled when unchanged, offline, or the coach is not active here (tooltip is the not-here line).
    - Toast "Price saved." or "{coach} now uses the lesson type's price."
    - Errors: `INVALID_ARGUMENT` (≤0, over 100,000,000, or below a course's session count), "This coach doesn't teach this lesson type." (`LESSON_TYPE_NOT_OFFERED`), `COACH_NOT_FOUND`, `PRICE_VIA_PROTOCOL` ("Lesson prices change through the owner's approval.").
  - **Manager:** the lock note "Prices change through the owner's approval." Each row shows "{coach}'s price {price}" when an own price exists.
    - **"Propose a price for {coach}"** (outward-arrow button; aria "…: {type}"; hidden when the coach is not active here) navigates to `/protocols?start=price_promo&change=coach_price&coach=<id>&lessonType=<id>`.
- **Status section** "Status" (hint "Not bookable and hidden from guests. Lessons already booked stay." while active):
  - **"Pause"** (hourglass; only when active; disabled offline or busy) opens the Pause dialog.
    - Title "Pause: {name}", text as the hint.
    - **"Note (optional)"** input, max 200.
    - **"Cancel"** closes. Esc and the backdrop also close it; there is no X.
    - **"Pause"** (primary) sends `app.set_coach_status(p_status='paused', p_reason=note or null)`. Toast "{name} is paused." Errors show in the dialog.
  - **"Resume"** (play icon; only when paused; disabled offline) sends `app.set_coach_status('active')` directly, with no confirm. Toast "{name} is active again."
  - **"Retire"** (danger, ban icon; active or paused; disabled offline or busy) opens the Retire dialog.
    - Title "Retire {name}?"
    - Body: "Their lessons to come ({lessons}) are cancelled as coach cancels: everyone booked is told, online money goes back and desk money becomes a refund due. Their photo comes off the app and the website. They keep seeing their approved and paid statements, nothing else." A variant mentions "and any running course" when a course is open.
    - **"Why"** textarea, required, 1–200 characters, hint "A note is needed to retire a coach."
    - **"Cancel"** (autofocused) closes. A backdrop click only shakes the dialog (requireChoice); Esc still closes.
    - **"Retire"** (danger; disabled until a note is typed, tooltip the hint) sends `app.set_coach_status('retired', note)`. The server never refuses this. It cancels every upcoming lesson and open course at every branch, removes the photo and sets retired. Toast "{name} is retired: {lessons} cancelled." It re-reads every coaching, reservation and desk-match list.
  - A same-status call returns `{duplicate:true}`. A retired coach can only come back through Make a coach again (`INVALID_TRANSITION`).

**Make a coach dialog** (Modal, large; opened by the header button, the empty-state button, "Make a coach again" or `?promote=`; needs `manageCoaches`)
- **"Guest account"** (customer picker; the label also shows "(optional)", a picker quirk, though it is required):
  - Search box with placeholder "Type a name or phone number…". It searches `app.customer_search` from 2 characters, debounced 200 ms, up to 8 results, and shows "Searching…".
  - **A result row** (name, phone, customer flags) picks that customer.
  - "No customer matches. You can still book by name." shows when nothing matches. This is desk wording.
  - The picked state reads "Linked to {name}" with the phone, plus **"Unlink"** (x), which clears the pick.
  - Hint: "Guests see the display name below, never the account name."
- **"Display name (English)"** / **"Display name (Arabic)"**: max 60, both required.
- **"Bio (English)"** / **"Bio (Arabic)"**: textareas, max 1000.
- **"Photo"**: the same Upload / Replace / Remove / drag-drop field as the editor. It uploads at once to a fresh random `coaches/` folder.
- **"Branches"**: one checkbox per branch shown, with the rail branch ticked by default. Unticking the rail branch also clears the lesson-type ticks.
  - The note "Their other branches are left to the managers there." shows on Make a coach again when the retired coach had branches this screen can't show.
- **"Lesson types at this branch"**: one checkbox per type at this branch (name plus kind word). Disabled with "Tick this branch to choose its lesson types." while the rail branch is unticked. Shows "No lesson types at this branch yet. Add them on the Lesson types tab." when there are none.
- Info: "The coach is asked in the app to accept being shown publicly. Until then guests don't see them."
- **"Cancel"**, the X, Esc and the backdrop close the dialog (not while saving) and delete an uploaded but unsaved photo. Closing clears `?promote`.
- **"Make coach"** (primary, whistle icon; disabled offline with tooltip "Needs a connection…"):
  - It first validates. After the first press a red list may show "Pick a guest account first.", "Both display names are needed." and "Tick at least one branch."
  - It then sends `app.coach_promote(p_profile_id, p_display_name_en/ar, p_bio_en/ar, p_photo_path, p_venue_ids = ticked branches this screen shows)`. When types are ticked and the rail branch is ticked, it also sends `app.set_coach_lesson_types`.
  - Success toasts "{name} is now a coach." The dialog closes and the new coach's editor opens. A types refusal shows inside that editor.
  - Errors: "This customer is already a coach." (`ALREADY_COACH`) plus **"Open {name}"** (outward-arrow button, shown when that coach is on this screen), which closes the dialog and opens that coach's editor. Also "That customer can't be found." (`CUSTOMER_NOT_FOUND`), `FORBIDDEN` (a branch the caller doesn't work at), and `INVALID_ARGUMENT`. A failed `?promote` customer read shows its error line.

**Lesson types tab: list**
- **Empty state** "No lesson types yet" / "Add a private lesson, a group session or a course. A new type is a draft until it goes on sale."
  - **"New lesson type"** (primary; `manageCoaches`) opens the blank new-type editor.
- **Three grouped tables:** "Private lessons", "Group sessions", "Courses" (only groups with rows; each sorted by `sort_order`, then English name). Columns while no editor is open: "Lesson type", "Length" ("{n} min"), "Places" ("Up to {n} people", "{min}–{max} places", plus "· {n} sessions" for a course), "Price" (IQD or "No price yet", plus "Court share {amount}" when above 0), "State". While the editor is open only Lesson type and State show.
  - State badges: "Draft", "On sale", "Off".
  - **"Price change in progress"** (ghost link button, outward arrow; shows when a price proposal is open) navigates to `/protocols?run=<runId>`.
- **Row click, or Enter/Space on a focused row,** opens that type in the editor (`?type=<id>`).

**Lesson types tab: lesson type editor (sticky panel)**
Locks by role and state (`priceLock`):
- A new type: everything is editable.
- A saved draft: the kind is locked; everything else is editable by manager and owner, price included.
- A launched type, owner: all fields except the kind.
- A launched type, manager: price, court share, length, sessions and a private type's party size are read-only.
- The "On sale" switch on a launched type is a direct write for both roles.

Editor controls:
- **Title:** the type name (or "New lesson type"), the state badge, and "Unsaved" when dirty.
- **X "Close"** (disabled while saving) closes the editor and clears `?type`.
- **"Kind"** segmented control: "Private lesson" / "Group session" / "Course". Editable only on a new type; switching resets the places, minimum, cut-off and sessions defaults. On a saved type the hint reads "The kind can't change once saved. Make a new lesson type instead."
  - **"Make a new lesson type…"** (plus icon; beside Kind on a saved type whose shape isn't locked) opens a new-type editor prefilled from this one.
- **"Name (English)"** / **"Name (Arabic)"**: max 60, both required ("Both names are needed, up to 60 characters.").
- **"Description (English)"** / **"Description (Arabic)"**: textareas, max 500 ("Between 0 and 500.").
- **"Length"**: select from 30 to 240 min in 30-minute steps. Read-only when the shape is locked. Error: "From 30 to 240 minutes, in steps of 30."
- **Private kinds:** **"Largest party"** select 1–4, hint "The booker and up to 3 friends.". Read-only for a manager on a launched type.
- **Group and course kinds:**
  - **"Places"** (whole number 2–16).
  - **"Minimum"** (1 up to Places), hint "Below this many by the cut-off, it is cancelled.". Errors: "Between {min} and {max}.", "The minimum can't be above the places.", "A whole number."
- **Course only:** **"Sessions"** (whole number 2–52). Read-only when the shape is locked.
- **Group and course:** **"Cut-off"** (whole hours 0–168; aria unit "hours before"), hint "Below the minimum this long before the start, it is cancelled and refunded. At least 1 hour when the minimum is above 1." Error: "At least 1 hour when the minimum is above 1." New group and course types start at 2 hours.
- **Shape locked (manager on a launched type):** the line "Make a new lesson type to change its length, sessions or party size." plus **"Make a new lesson type…"**.
- **"Price"** (IQD; blank means no price yet), with a hint by kind: "The whole lesson." / "One place." / "The whole course, for one person."
- **"Court share"** (IQD; blank means 0), hint "Per session, kept by the venue before the coach's share."
- **Price locked (manager on a launched type):** the lock note "Lesson prices change through the owner's approval." and read-only Price and Court share.
  - **"Propose a price"** (outward arrow) navigates to `/protocols?start=price_promo&change=lesson_price&lessonType=<id>`.
- **"Coaches teaching it"** (saved type, read-only): coach badges or "No coach teaches it yet.", hint "Choose coaches on the Coaches tab."
- **"Place in the list"** with **Move up** / **Move down** (saved type) saves immediately. It moves the type among its own kind's types and sends one `app.upsert_lesson_type {sort_order}` per changed type. Disabled at the ends, while saving, and offline. A refused order reads "The server did not accept this value." It is a direct edit for a manager too.
- **"On sale" switch** (launched type only; disabled offline or busy) is an optimistic flip that sends `app.upsert_lesson_type {is_active}`. Hint "Guests can book it." or "Guests can't book it. Lessons already booked stay." Toasts "{name} is on sale again." / "{name} is off sale." On error the switch reverts and shows an error toast.
- **"Put on sale"** (draft, owner, `launchDirectly`) sends `app.upsert_lesson_type {is_active:true}` directly. Toast "{name} is on sale." Disabled with the tooltip "Save the draft first." (unsaved changes) or "Set a price first." (no price), and offline.
- **"Put on sale"** (draft, manager; outward arrow) navigates to `/protocols?start=price_promo&change=lesson_launch&lessonType=<id>`. It has the same "Save the draft first." / "Set a price first." disables.
- **"Discard"** (saved type with changes) or **"Close"** (otherwise, and on a new type) closes the editor. Discard does not ask first.
- **"Save"** (saved type; shown when dirty) or **"Create draft"** (new type) is disabled offline. It sends `app.upsert_lesson_type(p_venue_id=current branch, p_id, p_patch)`, with every key for a new type and only changed, unlocked keys for a saved one.
  - Invalid fields block the save and show their field errors after the first press.
  - Toasts: "Saved." / "{name} saved as a draft." A created draft then opens as `?type=<newId>`.
  - Server `INVALID_ARGUMENT <key>` marks that field "The server did not accept this value."
- **Stale-screen refusals** (a manager whose screen is out of date):
  - `PRICE_VIA_PROTOCOL` with detail price, or `LAUNCH_VIA_PROTOCOL`, shows "Lesson prices change through the owner's approval." plus **"Propose a price"** or **"Put on sale"** (protocol start).
  - `PRICE_VIA_PROTOCOL` with detail shape shows "Make a new lesson type to change its length, sessions or party size." plus **"Make a new lesson type…"**.
  - Other errors: `LESSON_TYPE_NOT_FOUND`, `FORBIDDEN`.

**Hours tab**
- **Empty state** "No active or paused coach at this branch yet." (clock icon; no action). It counts only coaches who are not retired and are active here.
- **"Coach"** select (placeholder "Choose a coach"; defaults to the first coach) picks the coach and sets `?coach=<id>`.
- **Weekly hours panel** "Weekly hours":
  - A muted line names who set them: "Set by the coach on {date}", "Set at the desk by {name} on {date}" or "No hours set yet."
  - **Per day, Sunday to Saturday** (day name; "Not working" when the day has no windows):
    - **"Add a window"** (ghost, plus; aria "Add a window: {day}") adds 09:00–13:00 on an empty day, or a 2-hour window after the last one.
    - **"Copy to every day"** (ghost, repeat; only on a day with windows; aria "Copy {day} to every day") replaces every day's windows with this day's.
    - **Per window:** a **Start** select (00:00–23:30, every half hour) and an **End** select (00:30–24:00). Aria "{day}, window {n} · Start/End".
    - **Remove** (x icon; aria "Remove this window: {day}, window {n}") deletes that window.
    - Inline errors after the first Save: "The window has to start before it ends.", "Windows start and end on the half hour.", "Overlaps another window on this day."
    - Warning (does not block): "{day}: overlaps the hours at {branch}. Saving may be refused."
    - Muted line per day: "At {branch}: {from}–{to}", the coach's windows at other branches.
  - Line: "The coach sees the change in coach mode. Lessons already booked stay."
  - **"Discard"** (ghost; when changed) resets the grid to what is stored.
  - **"Save hours"** (primary; when changed; disabled offline) sends `app.set_coach_hours(p_coach_id, p_venue_id=current branch, p_windows)`. It is blocked by the pure checks. Toast "Hours saved."
    - Server refusals are mapped back to the window they name: `HOURS_OVERLAP` "{day}: these hours overlap the coach's hours here or at another branch." and `HOURS_INVALID` "{day}: each window has to start before it ends, on the half hour, by 24:00."
    - Also `COACH_NOT_AT_BRANCH`, `COACH_NOT_FOUND` and `FORBIDDEN`.
- **Time off panel** "Time off":
  - The list of time off still to come (earliest first): "{from} – {to}" (weekday, date, time in branch time; an end at midnight shows as 24:00), then the reason, then "set by the coach" or "set by {name}". Shows "No time off coming up." when empty.
  - **"Cancel"** (per row, ghost x; aria "Cancel time off {span}"; disabled offline) opens a danger confirm.
    - Title "Cancel this time off?", body the span plus "The coach can be booked in that time again."
    - **"Keep"** closes it.
    - **"Cancel time off"** sends `app.cancel_coach_time_off(p_id)`. Toast "Time off cancelled." An already-cancelled row returns duplicate; an unknown id is `INVALID_ARGUMENT`. The list re-reads either way. Errors show under the list.
  - **"Add time off"** (panel header button, plus; not disabled offline) opens the inline form:
    - **"From"**: a **date** picker (aria "From · Date") and a **time** select from 00:00 to 23:30 (aria "From · Time").
    - **"To"**: a **date** picker and a **time** select from 00:30 to 24:00, defaulting to 24:00.
    - **"Reason"** (optional; hint "Optional, up to 200 characters."; max 200).
    - Validation after the first press: "Choose the start and the end." / "The end has to be after the start."
    - **"Cancel"** closes and clears the form.
    - **"Add time off"** (primary; disabled offline) sends `app.add_coach_time_off(p_coach_id, p_starts_at, p_ends_at, p_reason)`; times are converted from the branch's time zone. Toast "Time off added."
    - Errors: "{name} has {lessons} in that time. Cancel or move them first." (`TIME_OFF_HAS_LESSONS`), "This overlaps time off already set." (`HOURS_OVERLAP` time_off), `INVALID_ARGUMENT`, `FORBIDDEN`.

**Owner vs manager on Coaches (summary)**
- Both can make, edit, order, re-branch, pause, resume and retire coaches; set lesson types per coach; create, edit and order lesson types; switch a launched type on or off; and set hours and time off.
- Only the owner sets a coach's own price directly, edits a launched type's price, court share, length, sessions and party size, and puts a draft on sale directly.
- The manager instead gets "Propose a price for {coach}", "Propose a price", "Put on sale" (all through `/protocols`) and "Make a new lesson type…".
- A manager's branch checkboxes list only their own branches. The server also limits a manager to coaches in their scope.

---

## Tables & QR — `/admin/qr`
This page lists the café tables and the QR card on each one. Here staff switch a table's waiter bell, add or edit tables, print one card or every card, and replace a lost or copied card's QR code.

*Who:* manager and owner (it inherits `/admin`; the reads and writes are `is_staff('manager','owner')`). In-screen gate: `can(staff,'rotateTableToken')`, which is **owner only**, covers **Replace QR code** and the **Replace every QR code** panel. A manager sees a lock badge instead of the button and no replace-all panel. Only the owner's rail has a "Tables & QR" row; a manager reaches it by URL, from the Guest app tab strip, or from Branches. A blocked "Setup (menu, courts, day close)" page gets the guard card. *Source:* `apps/operator/src/features/admin/qr/QrPage.tsx`, `TableForm.tsx`, `QrCard.tsx`, `qrCardGeometry.ts`, `queries.ts`; `routes/admin.tsx` (tab strip).

**Getting there**
- **Tables & QR** (rail row, owner's Setup section, QR icon). Goes to `/admin/qr`.
- **Tables & QR** card on the Setup overview. Goes to `/admin/qr`.
- **Print table QR codes** on a Preparing branch (Branches page). Goes to `/admin/qr` after switching the branch.

**Guest app tab strip (above the page; the "Guest app" family)**
- **Home screen**. Navigates to `/admin/hero`.
- **Tables & QR** (current page).
- **Telegram**. Navigates to `/admin/telegram`. The owner sees this tab; a manager's strip shows only the first two.

**Page header**
- **Add table** (plus icon). Opens the Add table dialog.
- **Print all cards ({count})** (primary, printer icon). It mounts a print sheet holding one A6 card per in-use table, each a QR of `<guest site>/t/<token>`, then opens the system print dialog (`window.print`, A6 mode). Disabled with no tables or while printing. Tables with no site address are skipped.
- A waiter-bell error shows as an error line under the header.

**Search and table list (`app.table_qr_tokens()`, in-use tables only)**
- The read is audited on every call and is not refetched when the window regains focus.
- **Find a table or zone** (search box). Filters as you type, case-insensitive, on table number or zone. Pressing **Esc** clears it.
  - **Clear** (X inside the box, only with text). Clears the search.
- Loading shows a skeleton. Error: "This could not be loaded." plus the offline hint.
  - **Try again**. Refetches.
- Empty: "No tables yet" / "Add a table to print its card."
  - **Add table**. Opens the Add table dialog.
- No match: "No table matches "{query}"."
  - **Clear search**. Empties the search box.
- Table columns, sorted naturally (T2 before T10):
  - **Table**, **Zone**, **Seats** (read-only; "—" when empty).
  - **Waiter bell** (a switch per row, labelled "Waiter bell for table {table}" for screen readers). It flips at once and calls RPC `app.set_table_bell(p_table_id, p_enabled)`, with no confirm. On failure it reverts and shows an error toast. Clicking the switch does not open the card.
  - **Card** (button). Opens that table's card panel.
- Clicking a row, or pressing Enter or Space on a focused row, opens that table's card panel. The selected row is highlighted.

**Tables not in use (reads `cafe_tables` where `is_active=false`)**
- **Tables not in use ({count})** / **Hide tables not in use** (ghost toggle; only when at least one exists). It shows the lead "These tables have no working card and do not appear at the till. Open one to put it back in use."
  - **{table number}** (one button per inactive table, note icon). Opens the Edit table dialog for that table, where switching **In use** back on restores it.

**Replace-all panel ("If many cards were copied"; owner only, with at least one table)**
- Lead: "Give every table a new QR code at once. Every printed card in the venue stops working until the new ones are printed and placed."
- **Replace every QR code** (red, repeat icon). Opens a red confirm.
  - Title: "Replace the QR code on every table ({count})?"
  - Body: "Every printed card in the venue stops working as soon as you confirm. Guests cannot order by scanning until the new cards are printed and placed."
  - **Cancel**.
  - **Replace every QR code**. Calls RPC `app.rotate_table_token(p_table_id)` once per table, in sequence. The button reads "Replacing {done} of {total}…" meanwhile.
  - Success toast: "Table codes rotated — reprint the cards."
  - If any table fails, the run continues and an error toast reads: "Replaced {done} of {total}. These tables still have their old QR code: {tables}. Print new cards for the ones that were replaced."

**Card panel (sticky, right side)**
- With nothing selected the panel is titled "Table card": "Pick a table to see its card" / "From there you can print it, edit the table, or replace a card that was lost." It is read-only.
- With a table selected, the title reads "Table {table}".
  - **Close** (X icon). Deselects the table.
  - The card preview is read-only: a QR of `<guest site>/t/<token>`, "TABLE {n}" and "Scan · Order · Relax". Without a site address it is a blank card showing the table number.
  - Read-only text: "Scanning opens {site URL}", then "One card per page, A6 size. Print on plain white card."
  - **Print this card** (primary, printer icon). Prints this table's card alone on A6. Disabled while printing.
  - **Edit table** (note icon). Opens the Edit table dialog.
  - Section "Card lost or photographed?": "Give this table a new QR code. The card on the table stops working straight away, so print the new card and put it out at once."
    - **Replace QR code** (repeat icon; owner only). Opens a red confirm.
      - Title: "Replace the QR code for table {table}?"
      - Body: "The card on table {table} stops working as soon as you confirm: guests who scan it will not reach the menu. Print the new card and put it on the table straight away."
      - **Cancel**.
      - **Replace QR code**. Calls RPC `app.rotate_table_token(p_table_id)`. Toast: "Table {table} has a new QR code. Print its card now." A failure gives the partial-failure toast.
    - Manager: a lock badge "Only an owner can replace a card's QR code." No button.

**Add table / Edit table dialog (modal; X, Esc and backdrop close it with no confirm)**
- **Table number** (required, at most 16 characters, autofocus). Hint: "Printed large on the card, and how staff find the table at the till."
- **Zone** (optional, at most 40 characters). Hint: "Where the table is, like Terrace or Upstairs."
- **Seats** (optional number, 1 to 99).
- **In use** (switch). On: "The card works and the table appears at the till." Off: "Its card stops working and it leaves the till. Nothing is deleted." The text turns amber when an existing in-use table is being switched off.
- **Cancel**. Closes. Disabled while saving.
- **Add table** on a new table, or **Save** on an existing one (primary, submit). Pressing **Enter** in a field also submits. Disabled when the number is blank, with the tooltip "Enter a table number." Calls RPC `app.upsert_cafe_table(p_id, p_table_number, p_zone, p_capacity, p_is_active)`. The token is never touched here. Toast: "Saved." The dialog closes.
  - Errors show inline: TABLE_NUMBER_TAKEN ("That table number is already in use."), INVALID_TABLE_NUMBER, TABLE_NOT_FOUND, FORBIDDEN.
- There is no delete-table action anywhere. Switching **In use** off is the only way to retire a table.

---

## Loyalty — `/admin/loyalty`
This page holds the owner's business-wide loyalty programme: whether loyalty is on, how points are earned and valued, the tiers, and the rewards guests can take at the till.

*Who:* owner only. `ROUTE_ROLES['/admin/loyalty'] = ['owner']`; it is listed in `SUB_ROUTES['/admin']`. The rail row "Loyalty" (star icon) is only in the owner's Setup (`OWNER_SETUP`). A manager has no row, and a direct URL is refused by `RequireRole`. The in-screen gate `can(staff,'editLoyalty')` (owner) controls every edit control. A non-owner would see the lock line "Only the owner can change loyalty." with every control disabled, but no non-owner can open the route. The read `app.loyalty_admin` allows a manager server-side. The page ignores the rail's branch: loyalty is shared across branches.
*Source:* `apps/operator/src/features/loyalty/LoyaltySetup.tsx` (`LoyaltySetupScreen`), `loyaltyLogic.ts`, `useLoyalty.ts` (`useLoyaltyAdmin`, `invalidateLoyaltyAdmin`), `features/admin/settings/settingsFields.tsx` (`NumberField`), `components/Switch.tsx`, `features/till/tillData.ts` (`TILL_MENU_QUERY`), `routes/admin/loyalty.tsx`. Strings: `ws.loyalty.setup.*`, `ws.loyalty.rewards.*` (loyalty.en.ts), `op.errors.*` (opErrors.loyalty.en.ts, en.ts).

**Page frame**
- **Header "Loyalty"** with the line "Points across every branch: what a guest earns, what a point is worth, the tiers and the rewards." This is read-only.
- **Loading.** An 8-line skeleton shows while `app.loyalty_admin()` loads.
- **Load error.** The card reads "This could not be loaded." with the error line and "You may be offline. The last known data is shown where available."
  - **"Try again"** (refresh icon) refetches `loyalty_admin`.
- **Offline rule.** Writes are direct `appRpc` calls, online only and never queued. Some buttons are disabled while `reachable` is false (noted per control), with no tooltip. After any write the page re-reads `loyalty_admin`, and the till's cached copy of the loyalty terms is invalidated.

**Points panel** "Points" (a draft form; nothing saves until **Save**; the form resets when server settings change)
- **"Loyalty is on"** (switch) turns loyalty on or off in the draft. Hint: "Off: no points are earned or used, and guests do not see a balance." Loyalty ships off.
- **"Spend for one point"** (whole number, unit "IQD"; hint "A guest earns one point for every this much paid.") must be above 0: "Type a whole number above 0."
- **"Value of one point"** (whole number, unit "IQD"; hint "What one point takes off a bill.") must be above 0.
- **"Smallest use"** (whole number, unit "points"; hint "The fewest points a guest can use at once.") must be 0 or more: "Type a whole number, 0 or more."
- **"Points expire after"** (optional whole number, unit "months"; hint "Months with no points earned or used. Leave empty to keep points for ever.") must be above 0 when filled; empty means never.
- **"Member QR changes every"** (whole number, unit "seconds"; hint "Between 15 and 120 seconds.") must be from 15 to 120: "Between 15 and 120."
- All number boxes take digits only; Arabic-Indic digits are converted.
- **"Points are earned on"** switches (draft only): **"Café bills"**, **"Shop sales"**, **"Court fees"**, **"Lessons"**, **"Tournament entry fees"**.
- **"Save"** (primary; disabled until something changed and while offline; the fieldset locks while saving) validates first and shows field errors.
  - It sends `app.set_loyalty_settings(p_patch = the whole settings)`. Toast "Saved."
  - Errors: `INVALID_ARGUMENT` (unknown key), "Invalid value." (`INVALID_VALUE`), `FORBIDDEN`.
  - Turning loyalty on stamps `enabled_at`, which the nightly expiry counts from. The write is audited (`loyalty.settings`).

**Tiers panel** "Tiers"
- Lead: "A guest moves up by the points earned in the last 12 months. The first tier is everyone's and cannot be removed."
- **"Add a tier"** (panel header, plus; owner; disabled offline) opens the tier dialog "Add a tier" (below). A new tier goes after the last one.
- **Tier table** (sorted by order): "Tier" (name, with "Base tier" on the sort-0 tier), "From" (points over 12 months), "Earns" ("×{multiplier}"). Shows "No tiers." when empty. Read-only; rows are not clickable.
  - **"Edit tier"** (per row, ghost, settings icon; owner; disabled offline) opens the tier dialog "Edit tier".
  - **"Remove"** (per row, ghost, trash icon; owner; not on the base tier; disabled offline) opens the remove dialog.
- **Remove dialog** "Remove the tier {name}?" with body "Guests in it move to the tier below.":
  - **"Cancel"**, Esc, the backdrop and the X close it (not while removing).
  - **"Remove"** (danger) sends `app.delete_loyalty_tier(p_tier_id)`. Toast "Saved." Accounts fall to the tier their points now reach.
  - Errors in the dialog: "A promotion is still limited to this tier. Change that promotion first." (`TIER_IN_USE`), and `INVALID_ARGUMENT` for the base tier or an unknown id.
- **Tier dialog** ("Add a tier" / "Edit tier"):
  - **"Name (English)"** (max 40) and **"Name (Arabic)"** (RTL, max 40): both required, "Both names are needed." (shown under the English name).
  - **"From points (12 months)"**: digits only, 0 or more ("Type a whole number, 0 or more."). Disabled when editing the base tier, which always starts at 0.
  - **"Earn multiplier"** (decimal from 1 to 5, at most 2 decimals; the Arabic decimal separator is accepted; hint "Between 1 and 5, for example 1.5."): "Between 1 and 5."
  - No control for the tier's linked promotion or its order. Both are carried over unchanged (a new tier gets the next order).
  - **"Cancel"**, Esc, the backdrop and the X close it (not while saving).
  - **"Save"** (primary; not disabled offline) validates, then sends `app.upsert_loyalty_tier(p_tier {id?, name_en, name_ar, min_points_12m, earn_multiplier, promotion_id, sort})`. Toast "Saved." and the dialog closes. Every account's tier follows at once.
  - Errors: "Invalid value." (`INVALID_VALUE`: a duplicate threshold or order, or a missing name), `INVALID_ARGUMENT` (unknown id, or the base tier's order).

**Rewards panel** "Rewards"
- Lead: "What a guest can take for points at the till. Switch a reward off to stop offering it."
- **"Add a reward"** (panel header, plus; owner; disabled offline) opens the reward dialog "Add a reward".
- **Reward table** (the server puts active rewards first): "Reward" (name), "Cost" ("{points} points"), "Gives" ("{amount} off" or "An item from the menu"), "On offer". Shows "No rewards yet." when empty.
  - **"On offer"** (per-row switch, label hidden; disabled for a non-owner and offline) is an optimistic flip that sends `app.upsert_loyalty_reward` with the reward's full fields and `active` flipped. No success toast. On refusal the switch reverts and an error toast shows.
  - **"Edit reward"** (per row, ghost, settings icon; owner; disabled offline) opens the reward dialog "Edit reward".
  - There is no reward delete; switching a reward off is the way to retire it.
- **Reward dialog** ("Add a reward" / "Edit reward"):
  - **"Name (English)"** (max 60) and **"Name (Arabic)"** (RTL, max 60): both required, "Both names are needed."
  - **"Cost"** (whole number, unit "points"): above 0, "Type a whole number above 0."
  - **"Gives"** select: **"An amount off the bill"** or **"A menu item"**. Switching to an amount clears the chosen menu item.
  - **"Amount off"** (shown for an amount; whole number, unit "IQD"): above 0, "Type an amount above 0."
  - **"Menu item"** (shown for a menu item): select with placeholder "Choose an item". It lists every size of every active menu item ("Item · Size" when an item has more than one size), read from the till menu (`TILL_MENU_QUERY`, cached 5 min). Required: "Choose the menu item."
  - **"On offer"** switch sets the draft only. New rewards default to on.
  - No branch control. An existing reward keeps its `venue_id`; a new one is sent with `venue_id: null`, meaning every branch.
  - **"Cancel"**, Esc, the backdrop and the X close it (not while saving).
  - **"Save"** (primary; not disabled offline) validates, then sends `app.upsert_loyalty_reward(p_reward {id?, name_en, name_ar, cost_points, kind, iqd_off|null, menu_variant_id|null, active, venue_id})`. Toast "Saved." and the dialog closes.
  - Errors: "Invalid value." (`INVALID_VALUE`, the kind's shape), "This belongs to another branch. Switch to that branch to do this." (`VENUE_MISMATCH`: a menu item of another branch), `INVALID_ARGUMENT` (unknown id).

**Owner vs manager on Loyalty**
- Only the owner can reach the page or change anything.
- A manager cannot open `/admin/loyalty` and has no rail row. The manager's loyalty powers live elsewhere: Adjust points on the customer record, behind a manager PIN.

---

## Venue settings — `/admin/settings`
The page where the venue's opening hours and closed days, business-day start, waiter-call wait, analytics exclusions, venue name and phone, booking rules, online deposit, open-match, lesson and tournament rules, offline mode, devices and stations are set for the branch in scope.

*Who:* route `/admin` → `manager`, `owner` (no own key in `ROUTE_ROLES`; longest-prefix match). Rail row **Venue settings** (`ws.shell.nav.settings`, gear icon) sits only in the owner's **Management › Setup** section (`OWNER_SETUP`). A manager has no rail row for it and gets here only by typing the URL. Two other ways in: the owner's Analytics › Courts notice link **Set opening hours**, and Branches › readiness checklist "till" fix (which first switches the rail to that branch). Capability gates inside: `setBusinessDayStart` (owner), `editVenueDetails` (owner). The Analytics tab is shown only if `canAccess(staff,'/analytics')` (owner). The Stations panel lets an owner or a manager act (`can(editVenueDetails) || staff.role==='manager'`, an inline role check). If the person lacks the role, or the owner blocked the page, they see a refusal card instead: "Opening this screen" + required role, or "The owner has closed this page for you. Ask them if you need it.", with a link **Go to my home screen**.
*Branch:* every read and write is for the rail's branch (`useVenue().branchId`; a registered station's own branch outranks it). Switching branch on the rail remounts the screen and throws away any unsaved draft. There is no branch picker on this page.
*Source:* `routes/admin/settings.tsx`, `features/admin/settings/{CafeSettings,VenueSettings,DayServiceTab,AnalyticsTab,VenueDetailsTab,MatchSettingsPanel,CoachingSettingsPanel,TournamentsSettingsPanel,DevicesPanel,StationsPanel,settingsFields,SettingsList,venueQueries,venueDetailsLogic,matchSettingsLogic,coachingSettingsLogic}.ts(x)`, `features/admin/OpeningHoursEditor.tsx`, `features/deposits/{DepositSettingsPanel,depositSettingsLogic,depositApi,useOnlinePaymentsLive}.ts(x)`, `lib/settings.ts`.

**Page header**
- Read-only title **Venue settings** and lead "Opening hours, the business day, and the details guests see. Every change is recorded in the audit log."

**Tab bar** (local state, not in the URL, so a reload returns to the first tab; arrow keys, Home and End move between tabs, and the arrow direction flips in Arabic)
- **Opening hours**: shows the opening-hours editor. This is the default tab.
- **Day & service**: shows the business-day and waiter-call settings.
- **Analytics**: shows analytics exclusions and the guest-app visit start date. *Owner only*; managers do not see this tab at all.
- **Venue details**: shows the venue, booking rules, deposit, match, lesson and tournament rules, offline mode, devices, stations, fixed values and tax.

---

**Tab: Opening hours** (`OpeningHoursEditor`; the same component as `/admin/hours`, without its page header). Manager and owner can edit it.
- Loading shows a skeleton. If the load fails: "This could not be loaded." + "You may be offline. The last known data is shown where available." + **Try again** (refetches `venue_settings`).
- Panel **Opening hours**, with the note "A closing time earlier than the opening time means the venue closes after midnight, marked "next day"."
  - One row per day, **Sun Mon Tue Wed Thu Fri Sat**:
    - **Closed** checkbox: marks the whole day closed and hides that day's time inputs (draft only).
    - **Opens** time input (24 h, LTR): sets the day's opening time (draft).
    - **Closes** time input: sets the closing time (draft). A close at or before the open (and not 00:00) shows an info badge **next day**, meaning an overnight close.
    - If a day has more than one stored opening period, both time inputs are disabled and a **Read-only** badge shows. Under the list: "This day has more than one opening period, which this screen cannot edit. Change it in the database, or it will be flattened."
- Panel **Closed days**, hint "Days the venue does not open at all. Bookings are refused on these dates in the app, on the website and at the desk."
  - Date input (aria "Add closed day"): picks a date. There is no min or max, so past dates are accepted.
  - **Add closed day** (plus icon): adds the picked date to the draft list, kept sorted and de-duplicated, then clears the input. Disabled when the date is empty or invalid, or already listed.
  - Upcoming list (dates from the venue's own "today" onward, in the venue timezone), shown as "Wkd dd/mm/yyyy". Each row has **Remove** (x icon), which drops that date from the draft. Empty: "No closed days coming up."
  - **Past closed days (N)**: a `<details>` you click to expand or collapse. Read-only list; past dates are kept and cannot be removed here.
- Footer:
  - **Save** (primary, check icon): converts the week with `writeOpeningHours` (an overnight tail is stored on the next day, and Saturday wraps onto Sunday) and calls RPC `app.set_opening_hours(p_opening_hours, p_closed_dates)`. One call writes both halves and one audit row (`settings.opening_hours`). Online only, not queued, no PIN. Disabled until something changed (tooltip "Nothing has changed yet."). Success shows the inline message "Opening hours saved." and refetches `venue_settings`. Errors appear inline under the panels: `INVALID_HOURS` "Invalid opening-hours format.", `FORBIDDEN` "You do not have permission for that.", `VENUE_SETTINGS_MISSING` "This branch's settings are missing. The owner needs to finish setting up the branch.", `VENUE_REQUIRED`, and a network failure "No connection. Check your internet and try again."
  - **Discard changes** (ghost): resets the week and closed days to the saved values. Disabled when there are no changes.
  - **Unsaved changes** badge: shown while there are changes.

---

**Tab: Day & service** (`DayServiceTab`)
- Group **The business day**, lead "Decides which day a sale after midnight belongs to."
  - **Business day starts at** (hint: "A sale after midnight counts towards the previous day until this hour, on the panel, in analytics and in reports.").
    - *Owner*: dropdown with the options **00:00 (midnight)**, **04:00**, **05:00**, **06:00**, **07:00**, **08:00**. Changing it only edits the draft.
      - **Discard changes** and **Save** appear only after a change. Discard reverts the dropdown.
      - **Save** opens a confirm dialog with the title "Start the business day at {hour}?" and the body "It was {from}; it will be {to}. Sales between midnight and the start hour count towards the day before, so this changes how every day is grouped on the panel, in analytics and in reports — past days included."
        - **Change the start**: writes through RPC `app.set_cafe_setting(p_key='analytics_business_day_start_hour', p_value)`. The setting is owner-only (`min_role` owner). The cache is patched optimistically and rolled back if the write fails. Success toast "Saved."; errors are toasted (FORBIDDEN, network).
        - **Cancel**: closes the dialog without saving.
    - *Manager*: sees the saved value as plain text, plus an "Owner only" lock badge. No controls.
- Group **Waiter calls**
  - **Wait between waiter calls (seconds)**: a number input, 30–600, disabled while it loads. Hint: "After a table calls a waiter, it cannot call again until this many seconds have passed. From 30 to 600." Readout "That is {n} min." when the value is 60 or more. An invalid value shows the live inline error "Enter a whole number of seconds from 30 to 600." A load error shows under the field.
    - **Discard changes** and **Save** appear only after a change. Discard reverts the field.
    - **Save**: RPC `app.set_waiter_call_cooldown(p_seconds)` (manager or owner at the branch; audited `settings.waiter_cooldown`). Disabled while the value is invalid (tooltip shows the same error). Success toast "Saved." and the value is refetched. Errors toast `INVALID_COOLDOWN` "Cooldown must be between 30 and 600 seconds.", FORBIDDEN, VENUE_SETTINGS_MISSING, or network. Online only.

---

**Tab: Analytics** (`AnalyticsTab`, owner only; the tab is hidden for a manager)
- Group **Items left out of analytics**, lead "Nothing here changes what is sold or what guests pay, only what the analytics screens count."
  - **Left out now** chips: one soft button per excluded item, with an x. Clicking one removes that item from the draft list (aria "Count {item} again"). An item no longer on the menu shows as "An item no longer on the menu". Empty: "None — every item is counted."
  - **Find an item to leave out**: search box (placeholder "Search"; hint "Left out of analytics only. The item is still sold as normal."). Filters the menu list by English or Arabic name. Esc or the **Clear** (x) button empties it. While a search is active a result count shows as "{shown} of {total}".
  - Scrollable menu list: one checkbox per menu item (all items, in sort order). Ticking adds the item to the draft exclusions; unticking removes it.
  - **Discard changes** and **Save** appear only after a change. Discard restores the saved list.
  - **Save**: RPC `app.set_cafe_setting('analytics_excluded_item_ids', [ids])`, an owner-only key. Toast "Saved." or the error.
- Group **Guest app visits**
  - **Count guest-app visits from**: a date input. Hint: "Visits recorded before this date are ignored, so testing before launch does not count." The status line reads "Counting guest-app visits from {date}." or "No start date: every guest-app visit on record is counted."
  - **Save**: appears when the typed date differs from the saved one and is not empty. RPC `app.set_cafe_setting('analytics_engagement_floor', 'YYYY-MM-DD')`, an owner-only key. Toast "Saved."
  - **Remove the date**: appears when a date is saved and the field still shows it. It writes `analytics_engagement_floor = null` straight away, with no confirm, and clears the field. Toast "Saved."

---

**Tab: Venue details** (`VenueDetailsTab`). The owner edits everything here. A manager reads it, with the lock banner "Only the owner can change the venue name, phone and booking rules." at the top.
- Loading shows a skeleton. If the load fails: "This could not be loaded." + **Try again** (refetches `venue_settings`).

*Owner: panel **The venue***
- **Venue name** (required, at most 80 characters; hint "Shown to guests on the guest site."). Edits the draft. Validation after Save: "Use 2 to 80 characters."
- **Phone** (optional, LTR, `inputMode=tel`, at most 20 characters; hint "Shown to guests on the guest site, and in the notice they see when online booking is paused."). Validation after Save: "Use digits, spaces, brackets and dashes, optionally starting with +." (6–20 characters).

*Owner: panel **Booking rules*** (lead "These apply to guests booking online and to the desk."). Every field accepts whole numbers only: non-digits are stripped as you type, and Arabic-Indic digits become Latin digits.
- **Free cancellation** [hours], 0–168. Hint: "A guest can cancel without charge up to this many hours before the booking starts. 0 means free cancellation until it starts."
- **Time to finish a booking** [minutes], 1–60, stored in seconds. Hint: "While a guest is booking, the slot is held for them this long, then released for others."
- **How far ahead guests can book** [days], 0–730. Hint: "Guests cannot book further ahead than this. 0 means no limit."
- **Slots one guest can hold at once** [slots], 1–10. Hint: "Stops one guest holding many slots while they decide."
- Errors appear only after Save is pressed: "Enter a whole number." / "Enter a number from {min} to {max}."

*Owner: panel **Online deposit (Qi Card)***. It is shown only when the server says online payments are live (`app.online_payments_live`; fails closed, so it is hidden while that answer loads or fails). It has its own draft and its own Save.
- Lead text and the info note "Guests can only pay online once the club's Qi Card account is connected. Whoever set up your system connects it, so ask them before you turn this on." Loading shows a skeleton; a load error shows **Try again** (refetches `app.deposit_settings(p_venue_id)`).
- **Ask guests for a deposit**: a radio group with one choice row each:
  - **Off**: "Guests book as they do now and pay everything at the desk."
  - **Optional** (badge "Recommended to start"): "Guests choose: pay the deposit now, or pay everything at the desk."
  - **Required**: "A booking is confirmed only once the deposit is paid. Guests marked "No deposit needed" can still book without one."
- **Deposit size** [% of the court price], 1–100. Hint: "Rounded up to the nearest 250 IQD, and never more than the court price."
- **Time to pay** [minutes], 2–30. Hint: "The slot is held this long while the guest pays. If they do not finish in time, it is released for others."
- **Smallest deposit** [IQD], 0–10,000,000. Hint: "No deposit is less than this, unless the court costs less."
- **Largest deposit** [IQD] (optional; placeholder "No limit"; empty means no cap), 1–10,000,000. It must not be below Smallest: "The largest deposit cannot be less than the smallest." Hint: "Leave empty for no limit."
- **When a guest does not show up**: radios **Keep the deposit** / **Refund the deposit**. Hint: "A booking cancelled by the guest or the desk always gets its deposit back."
- Save bar, shown once there are changes: badge **Unsaved changes** and the text "Applies to new bookings as soon as you save."
  - **Discard**: resets this panel's draft.
  - **Save deposit rules**: RPC `app.set_deposit_settings(p_patch={changed keys only}, p_venue_id)`. Owner at the branch only. Toast "Deposit rules saved." and the cache is replaced with the server's answer. A field refusal (`INVALID_ARGUMENT` whose detail names the field) shows on that field as the range message, or "This was not accepted. Check it and save again." Other errors are toasted and also shown under the panel: `ONLINE_PAYMENTS_PAUSED` "Online payments are paused. This setting can't be turned on yet.", FORBIDDEN, network.
  - Client-side errors show once Save has been pressed: "Enter a whole number." / "Enter a number from {min} to {max}."

*Owner: panel **Open matches*** (shown only when online payments are live and the server has `app.match_settings`; hidden on `RPC_MISSING`). It has its own draft and its own Save.
- Lead: "Players find, start and join open matches in the app. These rules decide when a match can start and what a ticket costs." Loading shows a skeleton. A failed first read shows "Open matches can't be shown without a connection" + **Try again**. Data kept from an earlier read shows "Last updated {time}".
- Badge **This branch**:
  - Switch **Open matches at this branch**: changes the draft only. Hint on: "Players can start open matches here and join them." Hint off: "Nobody can start a new open match here and no new players can join. Matches already started carry on."
  - **Fill deadline** [minutes], 60–2880. Hint: "A match not full this long before it starts is cancelled, and its tickets go back. A match can only be started for a time at least this long, plus one hour, from now."
- Badge **All branches**, lead "Changing these changes them at every branch.":
  - **Ticket price** [IQD], 1,000–1,000,000, in steps of 250 ("Use a multiple of 250."). Hint: "Tickets already bought keep the price paid; a cash-out returns what was paid."
  - **Filling matches per player** [matches], 1–10. Hint: "How many open matches one player can have filling at once."
- Save bar: **Unsaved changes** and the text "Changes apply as soon as they are saved."
  - **Discard**: resets this panel's draft.
  - **Save open-match rules**: RPC `app.set_match_settings(p_patch, p_venue_id)`, owner only. Disabled when the station cannot reach the server (tooltip "Needs a connection: open matches work online only"). Toast "Open-match rules saved." A field refusal shows "The server did not accept this value." on that field. Other errors show inline under the panel, with no toast: ONLINE_PAYMENTS_PAUSED, FORBIDDEN, network.

*Owner: panel **Lessons and coaches*** (always shown unless the server lacks `app.coaching_settings`). It has its own draft and its own Save.
- Loading shows a skeleton. A failed read shows "Lessons can't be shown without a connection" + **Try again**. Stale data shows "Last updated {time}".
- Switch **Lessons at this branch**: changes the draft. Hint on: "Guests can book lessons here and the website shows this branch's coaches." Hint off: "Guests can't book lessons here and the website leaves this branch out. Lessons already booked carry on, and the desk can still set lessons up."
- **How lessons are paid** (hint "Lessons booked by a coach or at the desk are always paid at the desk."): a segmented control with **At the desk** / **At the desk or online** / **Online only**.
  - The two online choices are listed only when online payments are live, or when one of them is the saved mode. If only the desk choice is left, the plain text "At the desk" shows instead of the control.
  - The online choices are disabled while they are blocked. The reasons show as a bullet list (only when online payments are live): "Online payment isn't set up for this branch." / "Online lesson payment can be switched on once the terms and privacy text with a lessons section are live."
- **Coach's share** [%]: accepts up to two decimals, and Arabic digits and the ٫ separator. Hint: "Coaches earn this share of what is collected for a lesson, after the court share. Each lesson keeps the share it was booked with." Error: "A percentage from 0 to 100, with at most two decimals."
- **Private lessons a coach can hold for their students** [lessons], 1–100. Hint: "At most this many upcoming private lessons booked by a coach at once. Lessons booked in the app or at the desk don't count." Errors: "A whole number." / "Between 1 and 100."
- Switch **Prices on the website**: changes the draft. Hint: "Lesson prices show on the website's coaching page only when this is on. The app shows them either way."
- Save bar: **Unsaved changes** and the text "Applies as soon as it is saved."
  - **Discard**: resets this panel's draft.
  - **Save lesson settings**: RPC `app.set_coaching_settings(p_venue_id, p_patch)`, owner only. Disabled when the station is unreachable (tooltip "Needs a connection: lessons work online only"). Toast "Lesson settings saved." A field refusal shows "The server did not accept this value." on that field. `ONLINE_PAYMENT_OFF` (provider or terms) shows on the payment mode and adds that reason to the block list. Other errors show inline under the panel through the coaching error lines (e.g. ONLINE_PAYMENTS_PAUSED, FORBIDDEN).

*Owner: panel **Tournaments*** (hidden when the server has no `tournaments_enabled` column)
- Switch **Tournaments at this branch**. It saves on the flip, with no Save button and no confirm. RPC `app.set_tournaments_enabled(p_venue_id, p_enabled)`, owner only; audited `venue.tournaments_settings`. The switch moves at once and reverts with an error toast if the call fails (`VENUE_MISMATCH` "This belongs to another branch. Switch to that branch to do this.", FORBIDDEN, network). Success toast "Saved." Disabled when the station is unreachable. Hint on: "Published tournaments show in the app and on the website, and guests can register." Hint off: "Tournaments are hidden from guests, and nothing can be published."
- A load error shows the refused message with a wifi-off icon. There is no retry button.

*Owner: panel **Offline mode*** (lead explains till heartbeats)
- Switch **Use offline mode**. It saves on the flip, separately from the form. RPC `app.set_venue_details(p_patch={offline_mode_enabled})`, owner only. Toast "Offline mode is on." / "Offline mode is off. The venue always counts as online." On error the switch reverts with a toast. No confirm. The hint below changes between the on and off texts.
- **Tills silent before offline mode** [seconds], 15–600. Hint: "How long every till may be silent before the venue counts as offline. The tills report every 10 seconds."
- **Bookings locked while offline** [hours], 0–168. Hint: "While offline, bookings that start within this many hours cannot be made or changed online, so nothing is double-booked when the tills reconnect."

*Owner: sticky save bar for the venue form* (covers The venue, Booking rules and the two Offline-mode numbers; shown once anything changed)
- Badge **Unsaved changes** and the text "Booking rules apply to new bookings as soon as you save."
- **Discard**: resets the venue form draft and clears its errors.
- **Save changes** (check icon): validates first. If anything is invalid, the field errors show and nothing is sent. Otherwise it calls RPC `app.set_venue_details(p_patch={changed keys})`, owner only; audited `settings.venue_details`. Toast "Venue details saved." and both `venue_settings` queries refetch, which updates the guest site and the desk.
  - `INVALID_ARGUMENT` with a field detail puts an error on that field. For a number field it reads "Enter a number from {min} to {max}." with the range filled in. *Observed bug:* when the server refuses **Venue name** or **Phone**, the same range sentence shows with the `{min}`/`{max}` placeholders left unfilled.
  - Other errors are toasted and shown in red under the bar: FORBIDDEN, VENUE_SETTINGS_MISSING, network.

*Manager: read-only versions* (label, hint and value rows; no inputs)
- **The venue**: Venue name, and Phone (or "No phone number set").
- **Booking rules**: Free cancellation ("Up to {n h} before"), Time to finish a booking, How far ahead guests can book ("No limit" when 0), Slots one guest can hold at once.
- **Online deposit (Qi Card)** (when online payments are live): lock note "Only the owner can change the online deposit rules.", then Ask guests for a deposit, Deposit size ("{n}% of the court price"), Smallest deposit, Largest deposit ("No limit"), Time to pay, When a guest does not show up.
- **Open matches** (when online payments are live): lock note "Only the owner can change these.", then under This branch: Open matches at this branch On/Off and Fill deadline; under All branches: Ticket price and Filling matches per player. It has the same read-failure **Try again**.
- **Lessons and coaches**: lock note, then Lessons at this branch On/Off, How lessons are paid, Coach's share, Prices on the website Shown/Hidden, and Private lessons a coach can hold. It has the same **Try again**.
- **Tournaments**: lock note "Only the owner can change this.", then Tournaments at this branch On/Off.
- **Offline mode**: Use offline mode On/Off, Tills silent before offline mode, Bookings locked while offline.

*Both roles: panel **Devices*** (shown once the venue row has loaded). Lead: "Every till, desk and kitchen screen that has reported in…". It refetches by itself every 15 s.
- Table columns: **Device** · **Kind** (Till / Screen) · **Last report** (badge **Reporting**, or **Silent** past `heartbeat_stale_seconds`, plus the date and time) · **Waiting to sync** · **Version**. The rows cannot be clicked and the columns cannot be sorted.
- **Retire** (trash icon, one per row; *owner only*, and the column is absent for a manager): opens a confirm dialog titled "Retire this device?" with the body "{device} is removed from the list and stops counting toward offline mode. If it reports in again it comes back on its own."
  - **Retire** (danger): RPC `app.retire_device(p_device_id)`, owner only; audited `device.retired`. It also clears the offline period in the same call. Toast "{device} retired." or "{device} retired. The venue is still offline: another till is silent." Refetches the devices and the offline flag. Errors are toasted: `DEVICE_NOT_FOUND` "That station no longer exists. Refresh the list.", FORBIDDEN.
  - **Cancel**: closes the dialog without retiring.
- Empty: "No device has reported in yet." Error: "This could not be loaded." + **Try again**.

*Owner and manager: panel **Stations*** (multi-branch slice; intro "Every till, desk and kitchen screen belongs to one branch.")
- Register row: shown to an owner or manager when this machine's station is not registered and live at the branch in scope. It shows the station id (from station.json; the browser fallback is `DEV1`), its type (Till / Court desk / Kitchen screen / Touch Shop desk), and the branch name.
  - **Register this station** (primary, small): RPC `app.register_station(p_id, p_venue_id=branch, p_mode=till|desk|kds|shop)`, manager or owner at the branch; audited `station.register`. The success toast oddly reads "Register this station" (it reuses the button's string). Refetches stations, venues and branches. Errors toast `STATION_OTHER_BRANCH` "This station name is in use at another branch. Retire it there first, or pick another name.", `STATION_HAS_HISTORY` "This station name has till shifts at another branch. Pick another name.", `INVALID_STATION` "This station has no valid name. Set the station up again.", FORBIDDEN.
- Live station list: id, type badge, and the date and time it was registered.
  - **Retire** (ghost, owner or manager): opens a confirm dialog titled "Retire" with the body "Retire {name}? It stops counting for offline mode and the day close. The name can be registered again later." The confirm button reads **Confirm** (no custom label), styled danger.
    - **Confirm**: RPC `app.retire_station(p_id)`; audited `station.retire`. There is no success toast; the list refreshes. Errors toast `STATION_UNKNOWN`, `VENUE_MISMATCH`, FORBIDDEN.
    - **Cancel**: closes the dialog without retiring.
- Empty list: "Never seen". A load error shows an inline error with no retry.

*Both roles: panel **Fixed at setup*** (read-only; note: "Changing any of these would change how every past business day and amount is read, so they cannot be changed from this app. To change one, contact whoever set up your system.")
- Rows: **Timezone**, **Currency**, **Menu prices include tax** (Yes/No), **No-shows** ("Marked by the desk"). No actions.

*Both roles: panel **Tax by item group*** (read-only; lead "The tax rate each group of menu items carries.")
- Table: **Item group** · **Rate** (%) · **Status** (In use / Not in use). No row actions. Empty: "No tax groups are set up." Error: **Try again**.

---

---

## Opening hours — `/admin/hours`
The same opening-hours and closed-days editor as the Venue settings › Opening hours tab, on a page of its own.

*Who:* `/admin` → `manager`, `owner`, with no extra capability gate (both can save). It has no rail row for anyone. People arrive from Branches › readiness checklist "opening hours" fix (which first switches the rail to that branch), or by URL. The admin sub-nav strip is not shown here. *Source:* `routes/admin/hours.tsx`, `features/admin/OpeningHoursPage.tsx`, `features/admin/OpeningHoursEditor.tsx`, `features/admin/closedDates.ts`.

**Page header**
- Read-only title **Opening hours** and lead "When courts can be booked and the cafe takes orders, and the days the venue stays shut."

**Panel Opening hours** (one row each for Sun–Sat)
- **Closed** checkbox for each day: marks the day closed in the draft and hides its times.
- **Opens** time input for each day: edits the opening time.
- **Closes** time input for each day: edits the closing time. It shows a **next day** badge when the close is earlier than or equal to the open.
- A day with several stored periods has its time inputs disabled and a **Read-only** badge. The notice "This day has more than one opening period, which this screen cannot edit…" appears.

**Panel Closed days**
- Date picker (aria "Add closed day"): picks a date. Past dates are allowed.
- **Add closed day**: adds the date to the draft. Disabled when the date is empty, invalid or already listed.
- **Remove** on each upcoming date: drops it from the draft.
- **Past closed days (N)**: expand or collapse a read-only list.
- Empty: "No closed days coming up."

**Footer**
- **Save**: RPC `app.set_opening_hours(p_opening_hours, p_closed_dates)`, manager or owner at the branch; audited. Online only. Disabled with no changes (tooltip "Nothing has changed yet."). Success shows "Opening hours saved." inline. Errors appear inline (INVALID_HOURS, FORBIDDEN, VENUE_SETTINGS_MISSING, network).
- **Discard changes**: reverts the draft.
- **Unsaved changes** badge: shown while there are changes.
- Load error: **Try again**.

---

---

## Guest site — `/admin/hero`
The builder for the top of the guest menu (what guests see after scanning a table QR): a hero mode (menu only, photo or video, or a featured item), scrolling ticker lines and the waiter-bell tip, with a live phone preview.

*Who:* `/admin` → `manager`, `owner`. Rail row **Guest site** (`ws.shell.nav.guestSite`, globe icon) sits in the owner's **Management › Setup** section. A manager has no rail row for it and reaches it by URL. Capability gate: `editLaunchedPrices` (`owner`, `shop_staff`). Without it (a manager), the featured discount is locked (see "Manager locks" below). The price-change button needs `startProtocolPriceChange` plus access to `/protocols` (manager or owner). *Branch:* the rail's branch; `cafe_settings` is per branch. *Source:* `routes/admin/hero.tsx`, `routes/admin.tsx` (AdminShell strip), `features/admin/hero/{HeroBuilder,HeroPreview,TickerEditor,ticker}.ts(x)`, `features/admin/promotions/{priceChange.ts,PriceChangeStart.tsx}`, `components/{ImageField,Switch,inputs,ConfirmDialog}.tsx`, `lib/{settings,storage}.ts`.

**Section strip above the page** (AdminShell "Guest app" family; shown when at least 2 of its pages are visible)
- **Home screen**: navigates to `/admin/hero` (this page).
- **Tables & QR**: navigates to `/admin/qr`.
- **Telegram**: navigates to `/admin/telegram`. *Owner only*; it is hidden from a manager, who sees just the first two.

**Page header**
- Read-only title **Guest site home screen** and lead "What guests see at the top of the menu after they scan a table card."
- Loading shows a skeleton until the cafe settings have loaded.

**Panel At the top of the menu** (three toggle tiles, `aria-pressed`; editing the draft)
- **Menu only** ("Guests go straight to the menu."): sets the draft mode to `none`.
- **Photo or video** ("A wide photo or a short silent video above the menu."): sets the draft mode to `media` and reveals the media panel.
- **Featured item** ("One menu item in the spotlight, with a tag and an optional discount."): sets the draft mode to `featured` and reveals the featured panel. *Disabled for a manager* when a discount above 0 is stored and the saved mode is not Featured. In that case a lock note shows: "A {pct}% discount is stored for {item}. Featured mode puts the stored discount on sale. Switch the discount off first, or change it in Protocols.", with the buttons below.
  - **Switch the discount off** and **Change the discount**: see "Manager locks".
- Switching modes keeps every panel's draft; the hidden panels stay mounted.

**Panel Photo or video** (visible only in Photo or video mode)
- Drop zone (role button; click, Enter or Space opens the file picker; you can also drag a file onto it). It shows the current image or video, playing muted and looped, or the text "Drag a file here or click to choose one". "Uploading…" with a spinner shows while a file uploads.
  - Accepted files: images, and MP4 or WebM video. An image may be at most 10 MB before compression; it is converted in the browser to WebP at most 1600 px wide, about 800 KB. A video may be at most 8 MB and is uploaded as it is.
  - The upload goes straight to Storage bucket `menu-media` at `hero/{uuid}.{webp|mp4|webm}` (new name, no upsert). It only replaces the draft path; nothing is live until Save.
  - Errors are toasted: "File is too large (max {mb} MB).", "That file is not a supported image.", "Upload failed."
- **Upload** / **Replace** button (ghost): opens the same file picker. Disabled while uploading.
- **Remove** (ghost, shown when there is media): opens a confirm dialog titled "Remove this photo?".
  - **Remove** (danger): clears the draft media. The stored file is deleted only after Save.
  - **Cancel**: closes the dialog and keeps the media.
- Hint: "A photo up to 1600 px wide, or an MP4 or WebM video up to 8 MB."

**Panel The featured item** (visible only in Featured item mode)
- **Item** dropdown: "Choose an item…" plus one entry per active menu item, labelled "Category · Item" and grouped by category order. Choosing one sets the draft featured item. Hint: "Only items currently on the menu can be featured." *Disabled for a manager while a discount is stored* (hint becomes "Moving the featured item moves its discount. Change both with "Change the discount", or switch the discount off first."). Empty menu: "There are no items on the menu yet."
- **Line above the name (EN)** and **Line above the name (AR)**: text inputs, at most 200 characters each. Hint: "A short line shown above the item name, like "A true Baghdadi breakfast"."
- **Badge (EN)** and **Badge (AR)**: text inputs, at most 60 characters each. Hint: "A word or two on the photo, like "New"."
- **Discount (%)**: digits only, at most 3 digits, clamped to 0–99; it re-formats when you leave the field. Hint: "Guests really pay this much less for the item while it is featured. 0 means no discount." *Read-only for a manager* (hint becomes "The owner approves the discount. Change it in Protocols, or switch it off here."), with **Change the discount** and, when a discount is stored, **Switch the discount off** under it.

**Panel Scrolling lines** (hint "Short lines that scroll under the header, in both languages. Up to 12.")
- One row per line:
  - **Line (English)** text input, LTR, at most 120 characters.
  - **Line (Arabic)** text input, RTL, at most 120 characters.
  - **Move up** (chevron icon; tooltip "Move up"): swaps the line with the one above. Disabled on the first row.
  - **Move down** (chevron icon; tooltip "Move down"): swaps the line with the one below. Disabled on the last row.
  - **✕** (aria and tooltip "Remove"): deletes the row from the draft, with no confirm.
- **Add a line**: appends an empty row. Disabled at 12 rows, where it shows "That is the most lines there can be: 12."
- Validation: a row that is blank on both sides is dropped at save. A row filled on only one side blocks Save and shows the inline alert "Every line needs both English and Arabic text."

**Panel Waiter bell help**
- Switch **Show how the waiter bell works**: changes the draft only and is saved with the page. Hint: "First-time guests see a short explanation of the waiter bell."

**Sticky save bar** (at the foot of the form column)
- Status text: "You have unsaved changes." or "Everything is saved."
- **Discard changes** (ghost, shown only when there are changes): resets the whole draft to the saved settings.
- **Save** (primary, check icon): sends only the keys that changed, in one atomic RPC `app.set_cafe_settings(p_settings={…})`. Each key goes through `set_cafe_setting` and gets its own audit row. The order is hero_media_path → hero_media_kind → featured_item_id → featured_label_en/ar → featured_badge_en/ar → featured_discount_pct → ticker_en → ticker_ar → bell_tutorial_enabled → hero_mode. Online only, no PIN.
  - On success: toast "Saved.", the old hero media file is deleted best-effort (`removeMedia`, skipped if `app.storage_path_in_use`), and cafe settings refetch.
  - Disabled when nothing changed or a save is running.
  - Also disabled, with the reason as a hover tooltip:
    - Photo or video mode with no media: "Upload a photo or video for this choice."
    - Featured mode with no item: "Choose the item to feature."
    - A half-filled ticker line: "Every line needs both English and Arabic text."
    - Too many or too long lines: "A line is too long, or there are too many lines."
  - Errors are toasted: `PRICE_VIA_PROTOCOL` (a manager touching the discount or item), `INVALID_SETTING_VALUE` "That value is not valid for this setting.", `ITEM_NOT_FOUND`, FORBIDDEN, network.

**Manager locks** (no `editLaunchedPrices`; computed from the SAVED values; a locked value is always sent as its saved value)
- **Change the discount** (arrow-out icon): navigates to `/protocols?start=price_promo&change=featured_discount` to start a price or promo change. Shown wherever the discount is locked, which for a manager is always.
- **Switch the discount off** (shown when a discount above 0 is stored): opens a confirm dialog titled "Switch the featured discount off?" with the body "The featured item goes back to its full price on the till and the guest menu. A new discount needs the owner's OK."
  - **Switch it off**: RPC `app.set_cafe_settings({featured_discount_pct: 0})`, the one discount write a manager may make. Toast "The featured discount is off." or the error. Disabled while the page is saving.
  - **Keep it**: closes the dialog and changes nothing.
- An owner sees no locks: every field is editable, and neither button appears.

**Preview (right column, sticky)**
- Heading **Preview** and the note "How the top of the menu looks on a phone. Guests see it in their own language."
- A 390 px phone mock-up, read-only, with no controls. It follows the operator's own UI language; there is no language or device toggle. It shows the "TOUCH CAFE" header, "Preview as table 12", the scrolling ticker, then the media (video autoplays muted) or the featured card (badge, line above the name, item name, and the price struck through next to the discounted price), placeholder menu rows, and the bell tip when it is on.

---

## Overview (Setup) — `/setup`
This is the Setup section's landing page. It shows the "Worth checking" health list, kitchen-screen pairing, and one card per Setup screen with a live line.

*Who:* owner only (`ROUTE_ROLES['/setup'] = ['owner']`). It is hidden from the rail (`hidden: true`) and reachable by URL only; the Setup section icon lands on `/admin/staff`, not here. Cards only appear for screens the viewer may open. The kitchen pairing button shows only when the operator runs in the desktop shell on a station whose mode is `till`. *Source:* `apps/operator/src/features/admin/SetupHome.tsx`, `KitchenPairing.tsx`; `components/SectionHome.tsx`; `lib/workspaces.ts` (OWNER_SETUP).

**Header**
- Title: "Setup". It has no lead text and no actions.

**Worth checking panel**
- The panel icon is a check-circle when everything is clear and an alert otherwise. When all reads succeed and nothing is wrong: "Nothing in setup needs attention." While loading it shows a one-line skeleton.
- Each row shows a count or icon, a title, a hint and an action button. Only rows that apply appear; at most 3 show before **View more**.
  - "Telegram notifications are not reaching staff". Its hint is one of: "Notifications are switched on, but no staff group is chosen." / "The last message Telegram was asked to send did not arrive." / "Messages have been waiting to send for more than two minutes."
    - **Open Telegram**. Navigates to `/admin/telegram`.
  - "Managers or owners without a PIN" ({count}): "They cannot approve a discount or a void at the till until a PIN is set."
    - **Set PINs**. Navigates to `/admin/staff`.
  - "Only one owner account": "If it is lost or locked, nobody can manage staff accounts. A second owner is the safeguard."
    - **Go to Staff**. Navigates to `/admin/staff`.
  - "Accounts still on the retired Kitchen role" ({count}): "Update every station to the latest version first… Then move each one to Barista or Chef assistant…"
    - **Go to Staff**. Navigates to `/admin/staff`.
  - "Prepared items with no par level" ({count}): "The kitchen's "What to make today" list never asks for these until each has a par level."
    - **Open Ingredients**. Navigates to `/stock/ingredients`.
  - "Staff stock additions need a cost" ({count}): "Staff added stock on the phone with no cost on record… Set the cost on Goods in, under Added by staff."
    - **Open Goods in**. Navigates to `/stock/receive`.
  - "Cashiers and desk staff with no PIN" ({count}): "They end their till shift with a manager's PIN. Give each one a PIN of their own under Staff."
    - **Go to Staff**. Navigates to `/admin/staff`.
  - When any of the reads fails (staff list, Telegram outbox, prepared-no-par count, needs-cost count): "Some checks could not load."
    - **Try again** (refresh icon). Refetches each failed read.
- **View more ({count})** / **Show less** (only when more than 3 rows). Expands or collapses the list.

**Kitchen screens panel (KitchenPairing)**
- Off a till station, read-only text: "The pairing code is kept on the till itself. Open Setup on the till computer to pair a kitchen screen." There is no button.
- On a till station, the text reads "A new kitchen screen connects to this till with a code. Show the code here, then type it on the kitchen screen."
  - **Pair a kitchen screen** (primary, QR icon). Opens the pairing dialog.
- **Pair a kitchen screen dialog** (small modal; X, Esc and backdrop close it and reset it):
  - Lead: "A manager PIN shows the code a new kitchen screen needs to connect to this till."
  - **Manager PIN** (password field, digits only, autofocus). Pressing **Enter** reveals when at least 4 digits are typed. Manager or owner PINs work.
  - **Back**. Closes the dialog.
  - **Show the code** (primary, eye icon). Disabled under 4 digits.
    - Online, it first calls RPC `app.verify_manager_pin(p_pin, p_device_id=<station id>)`. A wrong PIN gives "Incorrect PIN." and a lockout gives PIN_LOCKED: "Too many wrong PINs — locked for a few minutes." A correct PIN is cached in the shell.
    - Offline, it skips the server check and relies on the shell's cached-PIN check.
    - It then asks the shell over IPC (`touch.getPairingInfo(pin)`). An unrecognised PIN shows as an error line.
  - On success the dialog shows the steps (read-only): "1 On the kitchen screen's setup, choose Kitchen screen." and "2 Type this code:", followed by the pairing code in large type, then "If it cannot find this till, choose Enter the till address there and type {host}." With no LAN address it reads: "This till has no local network address yet; kitchen screens will find it once it is on the venue network."
    - **Done**. Closes the dialog.
  - Shell refusals show as an alert with only **Back**:
    - "Only a till can pair kitchen screens."
    - "This till has no pairing key. Remove station.json and set the station up again."
    - "This till was set up with a custom key from the command line. Pair kitchen screens with the same --lan-psk flag."

**Setup screens (card grid under the heading "Setup screens"; each card is a link with a live status line)**
- **Staff**. "Who can sign in, what each person can open, and the manager PINs that approve discounts and voids." Status: "People with access {n}". Goes to `/admin/staff`.
- **Branches**. "Every Touch location. Open a new branch as a copy of an existing one, set it up, then open it to guests." Status: "Branches {n}". Goes to `/admin/branches`.
- **Courts**. "The courts guests and the desk can book: names, photos, booking lengths and calendar order." Status: "Open for booking {n}". Goes to `/admin/courts`.
- **Coaches**. "Coaches, the lessons they teach, prices and hours". Status, only when coaching is available: "Coaches {n} · Lesson types on sale {n}". Goes to `/admin/coaches`.
- **Tables & QR**. "The cafe tables and the QR card on each one. Switch a waiter bell, print a card, or replace a lost one." Status: "Tables in use {n}". Goes to `/admin/qr`.
- **Loyalty**. "Points, tiers and rewards guests earn on every bill, at every branch." No status line. Goes to `/admin/loyalty`.
- **Venue settings**. "Opening hours, closed days, when the business day starts, and the venue details fixed at setup." Status: "Business day starts 00:00 (midnight)" or "{hh}:00". Goes to `/admin/settings`.
- **Guest site**. "What guests see at the top of the menu after scanning a table card. Table QR codes and Telegram are tabs on the same page." Status: "Top of the menu Menu only / Photo or video / Featured item". Goes to `/admin/hero`.
