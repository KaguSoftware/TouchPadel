# Touch Padel: Payment System and Technology Overview

Prepared for: Qi Card onboarding and compliance review
Prepared by: Kagu Web Studio, on behalf of Touch Padel
Date: October 2026

---

## 1. Business overview

Touch Padel is a padel club with an attached café in Iraq. Customers book courts, order food and drinks, join matches, take coaching lessons, enter tournaments and buy from a small shop.

| Item | Detail |
|---|---|
| Trading name | Touch Padel (café trades as Touch Cafe) |
| Legal entity | [TO FILL: registered legal name and registration number] |
| Address / city | [TO FILL] |
| Branches | One in operation. The system supports several branches; none beyond the first is planned for now. |
| Courts | [TO FILL] |
| Currency | Iraqi dinar (IQD) only. Amounts are stored as whole dinars. |
| Time zone / hours | Asia/Baghdad, 09:00 to 02:00 |
| Languages | English and Arabic (right-to-left) |
| Expected online volume | [TO FILL: transactions and value per month] |

## 2. Where money moves

Payment at the venue, in cash or by card, is the default for everything. Online payment through Qi Card is limited to three cases: court deposits, open-match tickets and, optionally, coaching lessons.

| Revenue stream | Who pays and where | Method |
|---|---|---|
| Café and food orders | Customer, at the till or desk | Cash or card at the venue |
| Table orders by QR code | Guest orders on the website, pays at the desk | Cash or card at the venue. No online payment. |
| Court bookings | Guest books in the mobile app or at the desk | Balance paid at the desk. A deposit can be paid online. |
| Court deposit | Guest, in the mobile app | Online through Qi Card. Default 50% of the booking, with a minimum amount. Set per branch as off, optional or required. Bookings made by staff at the desk never need a deposit. |
| Open matches | Player, in the mobile app | A reusable match ticket bought online through Qi Card. Each player pays their share at the desk. |
| Coaching lessons | Guest | Desk payment by default. Online through Qi Card is a per-branch setting. |
| Shop | Customer, at a separate shop desk | Cash or card at the venue, paid immediately |
| Tournament entry | Player, at the desk on the day | Cash or card at the venue |
| Loyalty points | Earned on spending. Redeemed as a discount on the bill. Points are not a payment method. | Not applicable |

Not offered: wallets, stored balances, memberships, saved cards, Apple Pay, Google Pay and bank transfers. The card terminal used at the venue is a separate device and is not connected to the system. Its batch total is entered at the end of the day and compared with the system.

## 3. Online payment flow (Qi Card)

Guests pay on Qi Card's hosted payment page, opened from the mobile app. Card details are entered only on Qi's page. Touch Padel's app, website and servers never see, transmit or store card numbers.

1. The guest chooses a slot and taps pay. The server creates a payment attempt with a unique reference and sends it to Qi.
2. The guest is sent to Qi's hosted page and completes payment there.
3. The server learns the result in three independent ways. Whichever answers first is applied; the others do nothing.
   - Qi's signed webhook notification. The signature is verified, and a notification that fails verification is rejected.
   - The app checking the result while the guest waits.
   - A background job that re-checks unfinished payments every 30 seconds.
4. Qi's status service, queried with Touch Padel's credentials, is the source of truth, not the notification alone.
5. A successful payment and the booking confirmation happen in the same step. A payment cannot exist without a booking.
6. If the slot is lost after payment (for example, taken by another customer at the same moment), the payment is refunded automatically.

Every message received from Qi is recorded in an append-only log, without card data. Payment attempts move through a fixed set of states: created, pending, succeeded, failed or expired, then refund pending, refunded or refund failed. Only one controlled function can change these states.

## 4. Refunds and cancellations

| Case | Handling |
|---|---|
| Guest or staff cancels a booking | Deposit refunded automatically |
| Slot lost after payment | Refunded automatically |
| Venue cancels or goes offline | Refunded automatically |
| Guest does not show up | Deposit kept by default. The owner can change this to refund. |
| Manual refund requested by staff | Manager or owner only; full or partial amount |
| Refund fails at Qi | Appears on an "needs attention" list. A manager can retry, or mark it settled another way with a manager PIN and a note. |
| Open-match ticket | Does not expire. Cashed out at the desk by a manager, as one refund to Qi per purchase. |

Desk refunds for café, shop and lesson sales are restricted to managers and owners, require a reason code, and restore stock. Refunds are counted on the day they are made.

## 5. Desk payments and cash control

- Staff record each payment at the till as cash or card. For cash, the amount handed over, change given and drawer opening are recorded.
- Payment and refund records cannot be edited or deleted. Mistakes are corrected with a refund, so the history stays intact.
- Every payment carries a unique key, so a repeated submission cannot charge twice.
- Totals, tax and prices are calculated on the server, not on the till.
- Discounts, price changes and refunds require a manager PIN.
- A trading day opens with a cash float and closes with a count. Cash and card totals are compared against the system's expected figures, and the day cannot close while a bill is open. Online payments appear in the same close report.
- When the internet drops, the till keeps working and saves actions in a local queue. They are applied in order on reconnection. Queued items are shown to staff as saved locally, never as completed.
- An audit log records who did what and when.

## 6. Security and compliance

- **Card data.** None is collected or stored. Card entry is on Qi's hosted page, which keeps Touch Padel outside the card-data scope. The app store privacy declarations state that no card data is collected.
- **Webhook security.** Signature verification on notifications, plus a status check against Qi.
- **Secrets.** Payment credentials are kept in the server's secret store only. They are never included in the mobile app, website or desktop app, and automated checks block secrets from being placed in any client-visible setting.
- **Access control.** Staff roles (cashier, court desk, shop staff, kitchen, manager, owner) limit what each person can do. Money-sensitive actions are restricted to managers and owners.
- **Data protection.** Database-level row security is enforced on every table, and all business changes go through controlled server functions. Access rules are covered by an automated test matrix.
- **Testing and scanning.** Every change runs automated tests, a secret scan of the code history, and a dependency vulnerability audit before release.
- **Sandbox separation.** Test accounts are routed to Qi's sandbox, and sandbox payments are excluded from financial figures.
- **Known gaps.** Point-in-time database backup and a separate staging environment have not yet been purchased. Error tracking and uptime monitoring are planned.

## 7. Technology and why

| Component | Choice | Reason |
|---|---|---|
| Codebase | One TypeScript repository (pnpm and Turborepo) | One language and shared rules for money, pricing and availability across every app, so the numbers match everywhere |
| Guest mobile app | Expo and React Native | One codebase for iPhone and Android, fast updates |
| Website | Next.js on Vercel | Public site, café menu, QR ordering and payment return page. Good performance and simple hosting. |
| Staff app (till, kitchen) | Desktop app (Electron with React) for Windows | Needs to work offline, print Arabic receipts and drive a kitchen screen on the local network. Iraq's power and internet interruptions make this essential. |
| Database and backend | Supabase (PostgreSQL) hosted in Frankfurt | A mature relational database suits financial records. Frankfurt is the nearest well-supported region to Iraq. The project belongs to the client. |
| Server logic | Database functions and edge functions | The server owns every figure, with the database enforcing permissions as a second layer |
| Database changes | Versioned, reviewed migration files | Repeatable, auditable changes with no manual edits in production |
| Sign-in and messages | Phone number codes by WhatsApp with SMS fallback, email, Google and Apple sign-in | Phone is the primary identity in the region. Cost is roughly 80 to 100 IQD per message. |
| Notifications | Push notifications and a Telegram bot | Booking updates for guests, and order and waiter-call alerts for the café |
| Languages | English and Arabic, full right-to-left layout | The customer base is bilingual |
| Release process | GitHub Actions with automated tests and checks | Nothing ships unless tests and security checks pass |

## 8. Status and open items

- **Integration status.** The Qi Card integration is built and has been tested against Qi's public sandbox. It is switched off pending production credentials. Until then, the app offers desk payment.
- **Needed from Qi.** Production access details and webhook verification key.
- **Questions for Qi.**
  1. Transaction fees and settlement schedule.
  2. Time limit for refunds.
  3. Lifetime of a payment page before it expires.
  4. Whether selling prepaid match tickets is permitted under the merchant agreement.
- **Tax.** No general VAT applies in Iraq. Tax is configurable per item group, and the applicable treatment for each revenue stream is being confirmed with the client's accountant.
- **Contact.** info@touch-padel.com
