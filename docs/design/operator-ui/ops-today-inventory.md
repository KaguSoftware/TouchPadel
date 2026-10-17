# Operations → Today (`/ops`): everything the page shows and does

This is the page as rebuilt on 2026-10-16. It lists every figure, row,
button, dialog and write on the Operations workspace's landing page, and
where each one leads. If you change the page, update this file in the same
commit.

**Source:** `apps/operator/src/features/ops/`

| File | What it holds |
|---|---|
| `OperationsOverview.tsx` | The screen and its layout |
| `NeedsYou.tsx` | The to-do list |
| `TodaySections.tsx` | The other panels |
| `opsLogic.ts` | The `NEEDS` table and the figures |
| `queueOpener.ts` | Opening one queue from inside another |

The three queues opened inside "Needs you" are drawn by their own components:

- `features/deposits/DepositAttentionPanel.tsx`
- `features/ops/MatchReportsPanel.tsx`
- `features/ops/LessonRefundsDuePanel.tsx`, with the row actions in
  `features/coaching/LessonRefundsDue.tsx` and `BlockedRefundDialog.tsx`, and
  the refund dialog in `features/till/ManagerActions.tsx` (`RefundDialog`).

**Words:** `ws.manager.ops.*` in `packages/i18n/src/catalogs/ws/manager.en.ts`
and `.ar.ts`. The queues' rows use `ws.manager.onlineRefunds.*`,
`ws.matches.ops.*` and `ws.coaching.lessonRefunds.*` / `ws.coaching.refunds.*`.

---

## 1. The page in one look

| | |
|---|---|
| Route | `/ops` |
| Rail name | **Today**, the first row of the Operations workspace |
| Page title | **Today** |
| Who can open it | `manager`, `owner` (`ROUTE_ROLES['/ops']`) |
| Whose home it is | The manager's. A manager signs in and lands here. |
| Owner | An owner who opens `/ops` outside the Operations workspace is sent to `/observation`, which shows the same body (`FloorNow`). Inside the Operations workspace the owner stays on `/ops`. |
| Languages | English and Arabic (right to left). Names, phones and times are isolated so they read correctly in both. |
| Data | One read, `app.ops_overview()`. Every figure is the server's, except "changes waiting to send", which only this station knows. |

### Layout

```
┌ The day isn't open  (only when no day is open)       [Open the day ↗] ┐
├ NOW (wide column)                     ┬ THE DAY (narrow column)        ┤
│  Needs you  n                         │  Before you close   (state)    │
│  On the floor now                     │  Stock to watch                │
│  (Observe only: the live floor plan)  │  So far today                  │
│  Who worked today                     │                                │
└───────────────────────────────────────┴────────────────────────────────┘
```

Below about a 1220px-wide screen, the two columns stack with the "now"
column first.

### The rules the page keeps

1. **One to-do list.** Everything that needs a person is a row of "Needs
   you", in one shape with one action. The online refunds, lesson refunds and
   player reports are rows too, and they open in place.
2. **Every figure appears once.** Waiter calls, late orders, running low and
   expired stock appear only in "Needs you". Open tabs appear only on the
   floor.
3. **Colour means act.** Only the count chips in "Needs you" and the two
   checks in "Before you close" carry status colour. Every other figure is
   plain ink, and zero is grey.
4. **Clickable looks clickable.** A figure that opens something is a whole
   row with a chevron. A group's link sits beside its title. A panel's links
   sit at its foot. Every link is named for where it goes.
5. **The day not being open is one banner**, holding the page's only primary
   button.

---

## 2. Header

| Element | What it shows / does |
|---|---|
| Title | "Today" |
| Subtitle, day open | "{weekday}, {date} · open since {time}" |
| Subtitle, no day open | "{weekday}, {date}" (today's business date by the server's clock) |
| "Updated {time}" | When the overview was last read |
| **Refresh** | Reads the overview again right away. It spins while the read runs. |

---

## 3. How the page stays current

| Read | Refresh |
|---|---|
| `ops_overview` (every panel) | Every **30 s**, and straight away on the `floor`, `courts` and `kds` broadcasts |
| `protocols_waiting_count`, `purchases_to_receive` | Every 60 s |
| Pay deductions, incidents, posts to approve | Every 60 s, and only for the roles allowed to read them |
| `till_shift_list` (till shifts with a difference) | Every 60 s |
| `deposit_attention`, `match_reports_open`, `lesson_refunds_due` | Every 60 s. Shared with the queues' own panels (one cache). |
| This station's unsent changes | Live, from the station queue. In browser mode there is no queue, so it is always 0. |

Page states:

- **Loading:** a skeleton. While "Needs you" waits for its reads, it shows a
  skeleton rather than a false "Nothing needs you".
- **Overview read failed:** an error message with **Try again**.
- **Loaded:** the panels below.

---

## 4. The day not open (banner)

The banner shows only when no business day is open:

- **Title:** "The day isn't open"
- **Text:** "The till can't take payments until you open the day with the
  cash float."
- **Button:** **Open the day** (primary) → `/admin/day-close`

When the banner shows, "Before you close" is hidden. The day not being open
is never also a row of "Needs you".

---

## 5. Needs you

One list. A row shows only when its count is above zero. Each row has:

- a count chip, red for danger or amber for warn;
- a title;
- one line saying what to do;
- one thing at the end of the row.

**Order:** the fixed order below, by who is waiting, never by count.

**Cap:** 3 rows show, then **View more (n)** / **Show less**.

**Nothing waiting:** one green line, "Nothing needs you right now."

**A read that failed:** one row saying "Some of this list didn't load, so it
may be missing something." with **Try again**. It is never folded away
under "View more".

**Heading:** "Needs you" with the number of rows beside it.

| # | Row | Tone | At the end | Who sees it |
|---|---|---|---|---|
| 1 | Tables calling for a waiter | amber | **Answer calls** → `/till/tabs` | manager, owner |
| 2 | Kitchen orders running late | red | "Tell the kitchen" as plain text. No screen here cooks them, so there is no button. | manager, owner |
| 3 | Online refunds needing attention | red (amber when every refund is only waiting on Qi) | **Review refunds**: opens the refunds in place (§6) | manager, owner |
| 4 | Lesson refunds due ("{total} paid at the desk for lessons that were cancelled or left.") | amber | **Review lesson refunds**: opens them in place (§7) | manager, owner (`refund`) |
| 5 | Player reports | amber | **Review reports**: opens them in place (§8) | manager, owner (`reviewMatchReports`) |
| 6 | Expired stock on the shelf | red | **See expired** → `/stock/expiry` | manager, owner |
| 7 | Ingredients running low | amber | **See which** → `/stock?filter=low` | manager, owner |
| 8 | Driver's purchases to receive | amber | **Receive goods** → `/stock/receive` | manager, owner |
| 9 | Till shifts closed short or over today | amber | **Open Day close** → `/admin/day-close` | manager, owner |
| 10 | Protocol steps waiting on you | amber | **Open protocols** → `/protocols?filter=waiting` | manager, owner |
| 11 | Deductions to decide | amber | **Decide deductions** → `/deductions` | **owner only** |
| 12 | Incidents to review | amber | **Review incidents** → `/incidents` | manager, owner |
| 13 | Posts to approve | amber | **Review posts** → `/marketing` | **owner only** |

**Opening a queue:** a **Review …** button toggles its queue open or shut
under the row (`aria-expanded`). The queue's rows sit in a tinted well
indented to the row's text. Each queue keeps its own "View more" after its
first 3 rows.

**On Observe** the owner's own rows follow these: staff requests, new
suggestions, and campaigns to start or end.

---

## 6. Online refunds (opened from "Review refunds")

**Data:** `app.deposit_attention` for the branch on the rail.

**Order:** failed refunds first, then paid bookings that are no longer on,
then slow refunds. Oldest first within each.

**Each row shows:**

- the guest (or "Guest with no name") and their phone;
- **Test** on a sandbox payment;
- "Ticket refund · {tickets} · {name}" with **Any branch can settle this**
  for a ticket refund, or "Lesson refund · {name}" for a lesson refund;
- the court and time, and the amount;
- the kind badge and its hint;
- why, when, and how many tries.

| Row kind | Action | What happens |
|---|---|---|
| Refund failed | **Try again** | Sends the refund to Qi Card again |
| Refund failed | **Settled another way** | A dialog asks how it was settled (required, up to 500 characters) and for a manager PIN (4–6 digits). **Mark as settled** closes the refund by hand. |
| Refund not confirmed (over a day) | *nothing* | Qi may still answer, and the server retries. Settling it here could pay twice (R23). |
| Paid, booking not on | **Refund to guest** | A confirm, then the whole deposit goes back to the card |
| Lesson row | **Open lesson** | → `/desk/lessons/{id}` |
| Lesson or ticket row | **Open customer** | → `/desk/customers/{id}` |

---

## 7. Lesson refunds due (opened from "Review lesson refunds")

**Data:** `app.lesson_refunds_due`. The total due is in the row's hint.

**Each row shows:**

- the student and their phone;
- the lesson's time, kind and coach, with **Open lesson**
  (→ `/desk/lessons/{id}`);
- each payment: what was paid and how, and what has gone back so far;
- "Due {amount}";
- the course-leave line, when the student left a course.

**Refund** (per payment) opens the till's refund dialog:

- Pick the payment and the amount. The amount is capped at what is due.
- **Goodwill: refund more than is due** lifts the cap to whatever is left on
  the payment.
- A manager PIN, with the reason `lesson_refund` or `lesson_goodwill`.
- It is queued, so it works offline.

**When Qi could not take back part of the money:** the line says "Online
refund needs attention: {amount}" and offers two things:

- **Online refunds** opens the online refunds row on this page and scrolls
  to it (`queueOpener`).
- **Record the handback** records the money handed back another way. It
  needs an amount (no more than is blocked), a reference (1–80 characters,
  never a card number), a manager PIN, and a connection.

---

## 8. Player reports (opened from "Review reports")

**Data:** `app.match_reports_open`, oldest first.

**Each row shows:**

- the reason and when it was reported;
- the reported player: name, phone, flags, reports in 90 days and no-shows;
- who reported them;
- the match: when, its category and its status.

| Action | What happens |
|---|---|
| **Open customer** | → `/desk/customers/{id}` |
| **Open match** | → `/desk/matches/{id}` |
| **Close report** | Dismisses the report in one press |
| **Ban** | Shown only while the player is not banned yet. A confirm, then a chain-wide open-match ban with the reason "Reported by players". |

**Close report** and **Ban** need a connection. If someone else already
dealt with the report, the list re-reads and a toast says so.

---

## 9. On the floor now

One panel, three groups side by side. The figures are plain and none of
them opens anything; each group's way out sits beside its title.

| Group | Figures | Link |
|---|---|---|
| Courts | Booked today, Arrived, Still to come, Next up ("{time} · {court} · {guest}", or "No more arrivals today") | **See bookings** → `/desk` |
| Café | Open tabs, Orders today ("—" if not reported) | **See tabs** → `/till/tabs` |
| Kitchen | Waiting, Being made ("—" if not reported) | none |

Late orders are not repeated here: when there are any, they are a row of
"Needs you". The kitchen's figures overlap (a late order is also waiting or
being made), so they are never added up.

**On Observe** the live 3D floor plan sits under this panel.

---

## 10. Before you close (day open only)

The **state badge** uses Day close's own words: Open tabs left (red),
Waiting to sync (amber), or Ready to close (green).

There are two checks. Each shows a tick when it is clear, or a coloured
mark when it is not.

1. **Open tabs.**
   - Clear: "Every tab is settled".
   - Not clear: "{n} tabs are still open", with "Take the payment or void
     each one at the till."
   - Up to 3 buttons, one per tab, named "Table {n}" or the guest's name.
     Each opens that tab at the till: `/till?tab={id}`.
   - **+{n} more** → `/till/tabs`
2. **This station.**
   - Clear: "This station has sent everything".
   - Not clear: "{n} changes waiting to send", with "They go as soon as this
     station is back online."

**Go to Day close** → `/admin/day-close`. It becomes the primary button when
the state is Ready to close.

The page does not close the day itself. The cash count, the card total and
the close happen on Day close.

---

## 11. Stock to watch

Every row opens exactly those items:

| Row | Opens |
|---|---|
| Below the level you keep (below par) | `/stock?filter=belowPar` |
| Expiring soon | `/stock/expiry` |
| Alerts to check (only when the server reports the figure) | `/stock/alerts` |
| Last stock count (date, or "Never") | `/stock/counts` |

Running low and expired stock are rows of "Needs you" when there are any.

**See all stock** (foot of the panel) → `/stock`

---

## 12. So far today

| Row | Value | Opens |
|---|---|---|
| Discounts | "{n} times" + IQD | `/admin/audit?q=discount.apply` |
| Voided items | "{n} times" + IQD | `/admin/audit?q=order_item.void` |
| Refunds | "{n} times" + IQD | `/admin/audit?q=payment.refund` |
| Waste (absent if the server omits it) | "{n} times" + cost in IQD | `/admin/audit?q=stock.record_waste` |
| No-shows | count | nothing |
| Cancelled bookings | count, or "—" | nothing |

The counts read in words: "Once", "2 times". In Arabic: «مرة واحدة»,
«مرتان», «3 مرات».

Foot of the panel:

- **Reports** → `/reports/courts`
- **Audit log** → `/admin/audit`

---

## 13. Who worked today

"What each person recorded today. A record of the shift, not a ranking."

- **Columns:** Name, Role, Orders, Bookings, Payments ("—" when not
  reported), ordered by name.
- The table is plain on purpose, with no bars.
- **Cap:** 3 people, then **View more (n)**.
- **Empty:** "Nobody has recorded anything yet today."

---

## 14. Every action on the page, in one list

**Changes data** (all inside the three queues):

| # | Action | Where | Needs |
|---|---|---|---|
| 1 | Try again (failed online refund) | Online refunds | connection |
| 2 | Settled another way | Online refunds | note + manager PIN |
| 3 | Refund to guest (whole deposit) | Online refunds | confirm |
| 4 | Close report | Player reports | connection |
| 5 | Ban from open matches (all branches) | Player reports | confirm + connection |
| 6 | Refund lesson money (capped, or goodwill) | Lesson refunds due | manager PIN (works offline) |
| 7 | Record the handback | Lesson refunds due | amount + reference + manager PIN + connection |

**Reloads data:**

- Refresh (header).
- Try again on a failed page read.
- Try again on the failed-checks row.
- Retry on a queue that failed to load.

**Opens and folds:**

- Review refunds / Review lesson refunds / Review reports.
- View more / Show less on "Needs you", on each queue, and on "Who worked
  today".

**Navigation, every destination:**

| Destination | From |
|---|---|
| `/admin/day-close` | Open the day (banner), Open Day close (till shifts), Go to Day close |
| `/till/tabs` | Answer calls, See tabs, +{n} more |
| `/till?tab={id}` | Each open-tab button in "Before you close" |
| `/desk` | See bookings |
| `/stock` | See all stock |
| `/stock?filter=low` | See which |
| `/stock?filter=belowPar` | Below the level you keep |
| `/stock/expiry` | See expired, Expiring soon |
| `/stock/alerts` | Alerts to check |
| `/stock/counts` | Last stock count |
| `/stock/receive` | Receive goods |
| `/protocols?filter=waiting` | Open protocols |
| `/deductions` | Decide deductions (owner) |
| `/incidents` | Review incidents |
| `/marketing` | Review posts (owner) |
| `/admin/audit?q=…` | Discounts, Voided items, Refunds, Waste |
| `/admin/audit` | Audit log |
| `/reports/courts` | Reports |
| `/desk/customers/{id}` | Open customer (player reports, online refunds) |
| `/desk/matches/{id}` | Open match |
| `/desk/lessons/{id}` | Open lesson (online refunds, lesson refunds) |

**Deliberately not on the page:**

- Closing the day.
- Answering a waiter call.
- Acting on a kitchen order.
- Editing stock.
- Approving a protocol or a deduction in place.

Each of those is one press away on its own screen.

---

## 15. Around the page (the Operations shell)

From `apps/operator/src/lib/workspaces.ts` (`WORKSPACES.manager`) and the
rail foot (`RailMoreMenu.tsx`). These are shared with every Operations
screen.

- **Today**: this page.
- **Run the day:** Bookings, Open tabs, Stock, Day close, Safe, Protocols,
  Suggestions, Pay deductions, Late and early, Incidents.
- **Records:** Reports, Coach pay, Audit log.
- **Setup:** Menu, Rates, Coaches, Promotions.
- **Rail foot:**
  - **Switch workspace**: Operations, Court desk, Cashier, Prep and Shop for
    a manager; an owner also has Management.
  - **Options**: language, appearance, and the assistant where the account
    has it.
  - Go on break.
  - Pair kitchen screen.
  - The update row.
  - Sign out.
