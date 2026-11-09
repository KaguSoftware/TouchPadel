# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** lane `operator-money`: `apps/operator/src/features/{desk,till,tillShift,kds,safe,deposits,discounts,loyalty,shop,stock,wages,deductions}`. That is 75,072 lines including tests and 54,177 lines of production `.ts/.tsx` across 12 features. Checked against `packages/core/src/{money,pricing,loyalty,status}`, `packages/i18n/src/formatting.ts`, the operator `lib/` registries and the applied SQL that the screens mirror. No `.brooks-lint.yaml` exists, so the defaults apply (balanced, all risks enabled). This was a read-only audit: no file in the repo was changed, and no tests or app were run.
**Health Score:** 41/100

The lane's money rules are mostly safe at the edges, because the server stamps every figure. The client side, though, re-derives and re-validates money in many places. The till's copy of the bill maths lives in `features/till` rather than `packages/core`, and core's own money helpers have almost no consumers here. That drift has already produced one real defect in the Shop till and two probable defect classes: dropped Arabic-Indic digits in till money fields, and idempotency keys that outlive the values they were minted for.

---

## Findings

### 🟡 Warning

**R3 Knowledge Duplication: the Shop till re-derives "due" from raw `tabs` columns and sends the wrong `expectedTotalIqd` (Warning, probable bug)**
Symptom: `ShopTill.tsx` computes what a sale owes inline, four times: `ShopTill.tsx:277-278`, `:294-295`, `:341-342` and `:603`. Each one is `(detail.total_iqd ?? detail.subtotal_iqd ?? 0) - Σpayments`, with no call to `computeTabTotals`, even though that function is imported (`ShopTill.tsx:56`, used only at `:692`). The read behind it, `fetchTabDetail` (`till/tillData.ts:307-331`), selects the raw `tabs.subtotal_iqd, total_iqd` columns. Those columns are "stamped at settle" (`packages/db/supabase/migrations/20260824000015_tabs_orders.sql:51,54`) and are written only by `settle_tab`/`settle_zero_tab` (`20261001000281_lesson_money.sql:923-928`). On a sale that has never been settled they are both `null`, so:
- `resume()` (`:294-295`) and `payAfterMember()` (`:277-278`) work out `due = 0` for an unpaid sale.
- The comment and override at `:244-246`, "The server's total (tax, rounding) is what is charged", never fires. The first charge is therefore the bare basket estimate (`shopTillLogic.ts:119-122`, no tax or discount).
- `settle()` sends `expectedTotalIqd: paying.due` (`:333`), which is the amount still owed. The desk and the till send the full bill total (`desk/payment/CourtBillPanel.tsx:228`, `till/TabDetailPanel.tsx:219`), which is what `settle_tab` compares against (`20261001000281_lesson_money.sql:916`: `p_expected_total_iqd <> v_totals.total_iqd`). So any second payment on a part-paid shop sale is refused with `TOTAL_CHANGED`. PaymentPane allows part payment by default here (`ShopTill.tsx:547-557`, `allowPartial` defaults to true).
- The `TOTAL_CHANGED` recovery (`:354-357`) then sets `due = detail.total_iqd` without subtracting earlier payments, or does nothing at all when that column is still null.

Source: Fowler, *Refactoring*: Duplicate Code. Hunt & Thomas: DRY.
Consequence: the Shop till's checkout, resume and part-payment paths each work from their own figure, so the cashier can be shown 0 owed, or the full total after part of it was paid. The pay buttons can also loop on `TOTAL_CHANGED`. `ShopTill.tsx` has no component test (`features/shop/` contains only `shopTillLogic.test.ts`, `shopReward.test.ts` and `ShopSectionDialog.test.tsx`), so nothing catches this. Treat this as a probable defect to confirm on the local stack: it is inferred from the code and the SQL, not reproduced.
Remedy: feed the shop the same totals as the till. Either call `computeTabTotals(detail, taxCtx, 0).due` (extended to carry the tab's own payments), or read `app.compute_tab_totals` through an RPC. Send `expectedTotalIqd = totals.total`, never the due. Remove the four inline copies. Add a `ShopTill` test for the resume and part-payment paths.
Fix-Class: Extended-Safe. The change is two files (ShopTill and a helper), no export changes, and a test command exists.
Priority: Pain 3 × Spread 1 = 3
Intent: accidental

**R3/R5 Knowledge Duplication: the bill-maths engine lives in a feature folder, not `packages/core`, and core's money helpers go unused (Warning)**
Symptom: the till's mirror of `app.compute_tab_totals` (`till/tabTotals.ts:134-199`, covering tax groups, inclusive carve-out, discount cap and court fee) and of `app.apply_discount` (`till/offlineTotals.ts:61-68`) are app-private. Each file carries its own identical `roundDiv` (`tabTotals.ts:101-103`, `offlineTotals.ts:50-53`). Core already has the same half-up rule as `calcTaxIqd` (`packages/core/src/money/tax.ts:11-26`: `floor((x+5000)/10000)` ≡ `roundDiv(x, 10000)`). Across the whole repo, `calcTaxIqd`, `toIqdHalfUp`, `promotionDiscountIqd` and `splitByItems` have no production importer. In this lane, `iqd`/`subIqd` in `till/change.ts:5` is the only use of `@touch/core` money. Other features then reach into `till` for the maths: `shop/ShopTill.tsx:49,56,68` imports `offlineTotals` and `tabTotals`.
Source: Martin, *Clean Architecture*: Stable Dependencies Principle. Hunt & Thomas: DRY.
Consequence: a rounding or tax rule change (`0380_tax_zero` already moved tax) has to be made in SQL, `tabTotals.ts` and `offlineTotals.ts`, and checked by hand against a core helper nobody calls. Mobile and web cannot reuse the tested mirror. Bugs like the Shop finding above come from screens that skip the mirror because it is not "the" API.
Remedy: move `tabTotals.ts` and `discountAmountIqd` into `packages/core/src/money/tabTotals.ts`. Build them on one exported `roundDivHalfUp` and on `calcTaxIqd`, with the existing node tests moving alongside. Keep `features/till/tabTotals.ts` as a re-export for one pass.
Fix-Class: Residual. It moves an exported module across a package boundary.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication: till money fields drop Arabic-Indic digits; digit folding is written five times (Warning, bug)**
Symptom: the admin `MoneyInput` folds Arabic-Indic and Persian digits before parsing (`components/inputs.tsx:15-21`), and `@touch/i18n` exports `asciiDigits` (`packages/i18n/src/formatting.ts:267-273`). The till's own money boxes strip them instead: `till/PaymentPane.tsx:128` (`Number(raw.replace(/\D/g, '')) || 0`, used for the part-payment amount at `:155` and the tender at `:247`), and `till/ManagerActions.tsx:243` (refund amount), `:281` (refund quantity) and `:393` (price override). JS `\D` treats `٣` as a non-digit, so it is deleted. The folding itself is re-implemented in `stock/decimalInput.ts:15-19`, `shop/priceWatch/parseSupplierPrice.ts:123-129` (a private `asciiDigits` that shadows the i18n one) and `desk/customers/customerDirectoryLogic.ts:41-47`. None of the till parsers checks `Number.isSafeInteger`, unlike `MoneyInput` (`inputs.tsx:68`).
Source: Fowler: Duplicate Code. Evans: Ubiquitous Language (one "typed amount" concept, five parsers).
Consequence: on an Arabic keyboard that emits Arabic-Indic digits, which the repo explicitly supports (`inputs.tsx:16` comment), a cashier typing a refund, a price override or a part payment gets a silently shortened or zero amount. Every new money box picks one of five behaviours at random.
Remedy: send the till fields through `MoneyInput` or a shared `parseIqdText()` built on `asciiDigits` plus a safe-integer check. Replace the three private folders with the i18n export.
Fix-Class: Extended-Safe. It touches 2 till files plus 3 local helpers, with no export changes.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: the "idempotency key follows the values" rule (F-13) has three implementations, and the Safe and till-shift forms lack it (Warning, probable bug class)**
Symptom: F-13 is documented at `wages/wagesLogic.ts:636-652`: "One key per dialog replayed the FIRST answer after a lost one, so a retry with a changed amount … recorded the old values". It is implemented as `keyForValues`, which `stock/products/ProductsAdmin.tsx:41` and `stock/products/NewProductFromPurchase.tsx:26` import from wages. A second, inline version is in `deductions/ProposeDeduction.tsx:73-86`. The Safe page's Pay, Move and Count forms still mint one key per form and change it only on success (`safe/SafePage.tsx:254-264`, `:388-396`, `:477-492`). `tillShift/ShiftDialog.tsx` does the same for open (`:128,138-139`) and close (`:197,234-236`). The key is rotated only after a successful await, so a retry after a lost reply with an edited float or count reuses it.
Source: Fowler: Duplicate Code. Winters et al.: Hyrum's Law (idempotent replay is a contract the caller must honour).
Consequence: the defect F-13 fixed for wages is still live on the Safe page (logging a cost, moving cash, counting the safe) and on the till-shift close count, which are the cash-box writes. After a timeout and a corrected amount, the server can replay the first write while the toast names the new one.
Remedy: move `keyForValues` into `lib/idem.ts` (or a `useValueBoundKey` hook) and use it in SafePage's three forms, ShiftDialog's open and close, and ProposeDeduction.
Fix-Class: Extended-Safe. It touches 5 files and keeps the export as a re-export.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication: `redeemWorth` contradicts core's `redeemAmount` and the server's rounding (Warning)**
Symptom: `loyalty/loyaltyLogic.ts:185-193` previews points as `min(points × value, remaining)`. Core's twin (`packages/core/src/loyalty/points.ts:43-51`, "Points that fit the tab: rounded down") and the SQL (`20261105000403_loyalty_rewards_only.sql:1035-1036`: `v_points := least(p_points, v_room / point_value)`, `v_amount := v_points * point_value`) both round the points down to a whole multiple. The same file already imports `redeemAmount` for the default (`loyaltyLogic.ts:13,164`), and `MemberAttach.tsx:779` shows `redeemWorth`.
Source: Hunt & Thomas: DRY. Fowler: Alternative Classes with Different Interfaces.
Consequence: with 3,020 IQD left and a 50 IQD point, the dialog promises 3,020 off while the server takes 60 points for 3,000. Exposure is limited: "Use points" is behind `points_off_enabled`, which is off by default since 0403.
Remedy: make `redeemWorth` return `redeemAmount({...}).amountIqd`, and the fitted points too.
Fix-Class: Safe. It is one function body in one file, with the same signature.
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**R3 Knowledge Duplication: the manager discount dialog is copy-pasted online and offline; percent↔bp conversion appears four times (Warning)**
Symptom: `till/TabDetailPanel.tsx:995-1028` and `till/OfflineTabPanel.tsx:280-312` are the same `PinReasonModal`, SegmentedControl, number box and clamp, line for line. Both convert percent to basis points inline: `TabDetailPanel.tsx:346` and `OfflineTabPanel.tsx:106` (`discountValue * 100`). Named converters also exist in `discounts/discountLogic.ts:158-164` (`bpFromPercent`), `deposits/depositSettingsLogic.ts:55-61` (`percentToBp`, `bpToWholePercent`), `admin/settings/venueQueries.ts:53` and `admin/settings/coachingSettingsLogic.ts:54-85`.
Source: Fowler: Duplicate Code.
Consequence: a rule change, such as allowing 12.5 %, has to be made in two dialogs and four converters. The online and offline copies have already diverged once: the "typing 150 reached the payload as 15000 bp" fix comment appears only at `TabDetailPanel.tsx:1022`.
Remedy: extract a `ManagerDiscountDialog` component with a `discountPayload(kind, value)` helper, and export one `percentToBp`/`bpToPercent` pair from core money.
Fix-Class: Extended-Safe. Three till files plus a helper, no export changes.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication: defensive row readers are copy-pasted with three different rules for missing money (Warning)**
Symptom: the `isObj`/`num`/`str` primitives are redefined in `tillShift/tillShiftLogic.ts:175-181` (`num` turns a missing value into **0**), `safe/safeLogic.ts:72-75` (null), `till/slips/slipLogic.ts:65-71`, `stock/receipts/receiptLogic.ts:69-75` (null, accepts numeric strings), `stock/storeLogic.ts:287`, `stock/driverPurchasesLogic.ts:38` and `shop/shopReward.ts:32-33`. Wages imports a fourth copy from another feature (`wages/wagesLogic.ts:13` ← `roleExtras/roleExtrasLogic.ts:11-13`). Headers promise one rule and the code does another. `safeLogic.ts:101` says "anything missing reads as absent, never as 0", yet `:82-83` and `:113-114` default amounts with `?? 0`. `shopReward.ts:36` says "never shown as 0", then `:42,44` use `?? 0`.
Source: Fowler: Duplicate Code. Ousterhout: Information Leakage.
Consequence: whether a dropped `cash_expected_iqd` or `left_in_drawer_iqd` shows "—" or "0 IQD" depends on which file read it. On cash-count screens a false zero reads as a real figure.
Remedy: add `lib/readers.ts` (`isRecord`, `numOrNull`, `strOrNull`, `oneOf`, `list`) and make money fields `numOrNull` by default. Replace the local copies over a few passes.
Fix-Class: Extended-Safe, batched at 5 files or fewer per pass. The helpers are module-private today.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R2 Change Propagation: shared query keys are hand-typed and money-write invalidations repeated per screen (Warning)**
Symptom: `QK.bookingBill`, `QK.bookingBillStates`, `QK.tab` and `QK.tabs` exist (`lib/queryKeys.ts:68-75`), and `apps/operator/CLAUDE.md` ("Queries and realtime") says shared keys live in `QK`. In the lane the literals appear instead: `'tabs'` 22 times, `'tab'` 11, `'bookingBill'` 10 and `'bookingBillStates'` 5 (only 46 `queryKey: QK.` uses in all 12 features). The same refresh trio after a money write is hand-written at `desk/payment/CourtBillPanel.tsx:179-181`, `desk/payment/AddCafeBillDialog.tsx:129-131`, `desk/BookingDetail.tsx:165-166`, `discounts/useCustomerDiscount.ts:100-105`, `deposits/DepositAttentionPanel.tsx:176`, `loyalty/useLoyalty.ts:324` and `till/TabDetailPanel.tsx:205,274-275,314-315`. This sits alongside `RESULT_INVALIDATIONS` (`lib/queueResults.ts:33-41`), which already decides it per mutation type. The two key builders disagree on a null id: `['bookingBill', reservationId ?? '']` (`desk/payment/useBookingBill.ts:13`) against `['bookingBill', reservationId]` (`till/TabDetailPanel.tsx:190`).
Source: Fowler: Shotgun Surgery. Hunt & Thomas: Orthogonality.
Consequence: renaming or splitting a key, for example per branch, touches about 15 files, and a missed literal fails silently as a stale bill on a money screen.
Remedy: replace the literals with `QK.*`. Add a `refreshAfterMoneyWrite(qc)` helper that reuses `RESULT_INVALIDATIONS['tab.settle']`.
Fix-Class: Extended-Safe, batched at 5 files or fewer per pass.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R1 Cognitive Overload: god components on the money and desk paths (Warning)**
Symptom: these are single component functions, measured from declaration to the next top-level declaration:
- `desk/DeskCalendar.tsx:259` `DeskCalendar()`: **1,332 lines**, with 13 `useState` and 7 `useEffect`. It holds the day grid, month zoom, drag-move and reason prompt, matches strip, lessons, the customer strip and the keyboard.
- `till/TabDetailPanel.tsx:108`: **956 lines**, with 15 `useState`. It covers pay, split, merge, charge-to-booking, refund, void, override, promotion, discounts, loyalty, court fee and drawer, through a 14-variant `Overlay` union (`:91-106`).
- `till/TillScreen.tsx:71`: **804 lines**.
- `desk/customers/CustomerRecord.tsx:93`: 521 lines.
- `desk/CreateReservationDialog.tsx:111`: 475 lines.
- `shop/ShopTill.tsx:132`: 466 lines.
- `tillShift/ShiftDialog.tsx:95`: 461 lines.

Source: McConnell, *Code Complete*, Ch. 7 (routine length). Fowler: Long Method, Divergent Change.
Consequence: every money change on the till edits a 956-line closure whose state the tests can only reach through jsdom. Settle, discount and loyalty rules sit inline, which is exactly where the shop and offline copies above split away.
Remedy: carry on the extraction `tabTotals.ts` started (its header, `tabTotals.ts:8-12`, records the earlier one). Give each overlay its own component that owns its state, and move each handler (`settle`, `applyDiscount`, `void`) into a hook or pure function with a node test. For DeskCalendar, split out `DayGrid`, `MonthZoom`, `MatchesStrip` and `useDragMove`.
Fix-Class: Residual. These are large multi-file refactors of untested JSX.
Priority: Pain 3 × Spread 2 = 6
Intent: accidental

**R5 Dependency Disorder: feature-to-feature cycles, and shared building blocks parked inside features (Warning)**
Symptom: these production imports, tests excluded, form feature-level cycles:
- desk ↔ till: `desk/payment/CourtBillPanel.tsx:59,83`, `desk/payment/CourtReceiptPrint.tsx:12`, `desk/customers/recordSummary.ts:6`, against `till/FloorView.tsx:20` and `till/NewTabDialog.tsx:16`.
- shop ↔ stock: `shop/ShopStockPages.tsx:8-11`, against `stock/products/ProductsAdmin.tsx:67-71` and `stock/products/productsLogic.ts:9`.
- desk ↔ loyalty: `loyalty/CustomerLoyaltyPanel.tsx:26-27`.
- desk ↔ discounts: `discounts/CustomerDiscountCard.tsx:17`.

App-wide primitives are owned by whichever feature wrote them first:
- calendar helpers in `deductions/venueDate.ts`, used by wages (8 files, e.g. `wages/wagesLogic.ts:14`), `tillShift/DrawerDay.tsx:22` and `safe/SafePage.tsx:34`;
- the idempotency helper in `wages/wagesLogic.ts:645`, used by stock;
- JSON readers in `roleExtras/roleExtrasLogic.ts`, used by wages;
- `PaymentPane` and `buildReceiptDoc` in till, used by desk and shop.

There are no file-level cycles: the edges are one-way per file.
Source: Martin, *Clean Architecture*: Acyclic Dependencies, Common Closure. Brooks: Conceptual Integrity.
Consequence: a change to `deductions/venueDate.ts` or `wages/wagesLogic.ts` re-tests unrelated cash screens. Nobody can tell which feature owns `PaymentPane`, the one component that takes money in three places.
Remedy: promote the shared parts to `src/lib/` (dates, idempotency, readers) and `src/components/money/` (PaymentPane, BillView receipt builder, Money). Leave a re-export at the old path for one pass.
Fix-Class: Residual. It moves exported symbols across many importers.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

### 🟢 Suggestion

**R3 Knowledge Duplication: the ticket status machine is re-declared in KDS and till; core's has no app consumer (Suggestion)**
Symptom: `kds/ticketView.ts:20` (its own `TicketStatus`, without `voided`) and `:197-202` (its own `TRANSITIONS`), plus `till/kitchenReach.ts:28` (`CloudTicketStatus`), duplicate `packages/core/src/status/machines.ts:11,79-85`. `ticketStatusMachine` is imported by no app.
Source: Hunt & Thomas: DRY.
Consequence: a new ticket state needs edits in SQL, core, KDS and till. The tables agree today, so impact is limited.
Remedy: derive `canTransition` from `ticketStatusMachine.canTransition` and the type from core's `TicketStatus`.
Fix-Class: Extended-Safe (3 files).
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: the "live tab" status set is copied six times in the lane (Suggestion)**
Symptom: `['open','awaiting_payment']` appears at `shop/ShopTill.tsx:103`, `till/ManagerActions.tsx:446`, `till/floorPlan.ts:216`, `till/TabDetailPanel.tsx:231`, `till/tillData.ts:178` and `till/tillData.ts:382`. Four more copies are outside the lane, e.g. `admin/DayClose.tsx:208`.
Source: Fowler: Duplicate Code.
Consequence: a new tab state means ten edits.
Remedy: export `LIVE_TAB_STATUSES` from `core/status/machines.ts` next to `TabStatus` and use it everywhere.
Fix-Class: Extended-Safe, in passes.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: venue day/month helpers are scattered and disagree on time zone (Suggestion)**
Symptom: `deductions/venueDate.ts:16-17` uses `VENUE_TZ`, while `admin/menu/availability.ts:96-97` (`todayIso`) uses the station's local clock. The latter supplies the default date for every goods-in form (`stock/ReceiveDelivery.tsx:61`, `stock/DriverPurchases.tsx:62`, `stock/receipts/ReceiptReview.tsx:34`). Other local "today" derivations: `desk/weekLogic.ts:44`, `desk/useTradingNight.ts:29`, `desk/CourtBlock.tsx:376` and `loyalty/loyaltyLogic.ts:262`. `shiftMonth` is written twice (`safe/safeLogic.ts:288`, `deductions/venueDate.ts:35`), and the "stepper may go forward" guard four times (`tillShift/drawerDayLogic.ts:61`, `safe/safeLogic.ts:284`, `deductions/deductionsLogic.ts:241`, `wages/wagesLogic.ts:558`).
Source: Hunt & Thomas: DRY.
Consequence: a station whose zone is off pre-fills goods-in with a different day than the rest of the app. The server re-checks, so the cost is a refusal or a wrong default, not bad data.
Remedy: one `lib/venueDate.ts` (or core `time/`) holding `venueToday`, `addDays`, `shiftMonth` and `canStepTo`. Remove `todayIso`.
Fix-Class: Extended-Safe, in passes.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R3 Knowledge Duplication: float-to-IQD and 4-dp unit-cost rounding are re-done outside core (Suggestion)**
Symptom: core says `toIqdHalfUp` is "the ONE sanctioned float→IQD conversion … in this package only" (`packages/core/src/money/iqd.ts:6-8`, `tax.ts:27-39`). Yet `Math.round` produces IQD at `stock/ReceiveDelivery.tsx:212`, `stock/receipts/receiptLogic.ts:213`, `stock/products/NewProductFromPurchase.tsx:48` and `shop/shopTillLogic.ts:272`. The 4-dp unit cost is written three times: `stock/storeLogic.ts:350`, `stock/stockLogic.ts:174` and `stock/driverPurchasesLogic.ts:93`. The same price/qty is rounded to whole IQD in `NewProductFromPurchase.tsx:48` but to 4 dp in `driverPurchasesLogic.ts:93`.
Source: Fowler: Duplicate Code. McConnell, Ch. 12 (numeric types).
Consequence: the first time the stored cost precision or the rounding rule changes, three stock screens have to change in lockstep.
Remedy: add `unitCost4(price, qty)` to core money next to `toIqdHalfUp`, and use both.
Fix-Class: Extended-Safe (5 files or fewer per pass).
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: cash change recomputed inline; `PaymentMethod` re-declared six times (Suggestion)**
Symptom: `till/change.ts:16-23` (`computeChange`, built on `subIqd`) is bypassed by `tendered - amount` at `till/SplitBillDialog.tsx:106` and `shop/ShopTill.tsx:321,349`. The `'cash' | 'card'` union is re-declared at `desk/payment/CourtBillPanel.tsx:85`, `desk/payment/deskPaymentLogic.ts:132`, `till/PaymentPane.tsx:51`, `till/offlineTotals.ts:79,84`, `till/payGuards.ts:15` and `shop/shopTillLogic.ts:195`. The authority is `z.enum(['cash','card'])` in `packages/core/src/schemas/mutations.ts:261,465`.
Source: Hunt & Thomas: DRY.
Consequence: these are display-only figures, but a negative "change" can show on a short tender (no floor). A third method would need about eight edits.
Remedy: use `computeChange(...).changeIqd`, and export `PaymentMethod = z.infer<…>` from core schemas.
Fix-Class: Extended-Safe.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: cash-box list, "paid from" and the main-cash ceiling are each defined twice (Suggestion)**
Symptom:
- `Box = 'cafe' | 'desk' | 'shop'` plus a literal filter (`safe/safeLogic.ts:18,106`), against `CASH_BOXES` (`admin/handInLogic.ts:13`).
- `PaidFrom` in `safe/safeLogic.ts:17`, against `PAID_FROM` in `wages/wagesLogic.ts:43-44`.
- `AMOUNT_MAX = 1_000_000_000` (`safeLogic.ts:24`), against `HAND_IN_MAX_IQD = 1_000_000_000` (`handInLogic.ts:16`). Both are the same `main_cash_entries` CHECK.

Source: Fowler: Duplicate Code.
Consequence: adding a fourth drawer box (a second desk, a branch shop) means finding both lists.
Remedy: one `lib/mainCash.ts` (or a core module) with `CASH_BOXES`, `PAID_FROM` and `MAIN_CASH_MAX_IQD`.
Fix-Class: Extended-Safe (3 files).
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: `canReadBookings` keeps a capability role list outside `CAPABILITY_ROLES` (Suggestion)**
Symptom: `till/tillData.ts:374-379` hard-codes `cashier | court_desk | manager | owner`. It is used by `till/TabDetailPanel.tsx:125`, `till/NewTabDialog.tsx:193,199` and `till/DeliveryDialog.tsx:52`. `apps/operator/CLAUDE.md` ("Roles and routes") says a capability gated inside a screen goes in `CAPABILITY_ROLES` (`lib/auth.tsx:487`), which is "the one place to change a permission".
Source: Hunt & Thomas: DRY. Evans: Ubiquitous Language.
Consequence: changing who can read bookings means editing a till data file nobody would look in.
Remedy: add `readBookings` to `CAPABILITY_ROLES` and make `canReadBookings = (w) => can(w, 'readBookings')`.
Fix-Class: Extended-Safe (2 files).
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**R4 Accidental Complexity: dead `isPromotionAdjustment` (Suggestion)**
Symptom: `till/tillData.ts:340` defines it and nothing references it. The same rule lives in `till/tabTotals.ts:226` (`a.reason_code === 'promotion'`). Gate: `grep -rlw isPromotionAdjustment` over `*.ts *.tsx *.md *.json *.mjs` from the repo root, excluding node_modules, returns only `tillData.ts`. No string or registry use exists, and nothing outside the app imports it.
Source: Fowler: Dead Code / Speculative Generality.
Consequence: it suggests there is a second place the promotion rule should change.
Remedy: delete it.
Fix-Class: Safe (one file, an exported but unreferenced symbol; it passes the gate).
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**R3 Knowledge Duplication: two `formatIQD` implementations, plus a local wrapper per screen (Suggestion, cross-lane)**
Symptom: `packages/core/src/money/format.ts:20-40` (Intl-based, rejects negatives through `iqd()`) and `packages/i18n/src/formatting.ts:237-243` (hand-built, accepts negatives) both export `formatIQD`. Operator imports only the i18n one (91 files), and no app imports core's. Screens wrap it again next to the kit's `<Money>` (`components/kit.tsx:2306`): `shop/ShopTill.tsx:143`, `wages/WagesPage.tsx:752`, `wages/AdvanceDialog.tsx:86`, `tillShift/ShiftRows.tsx:46` and `tillShift/ShiftDialog.tsx:118`.
Source: Fowler: Alternative Classes with Different Interfaces.
Consequence: two answers to "how is a dinar printed", with different negative-number rules (signed matches deltas, for example).
Remedy: keep one exported `formatIQD`; the packages lane decides which. Add a `money(n)` hook in the kit instead of per-screen lambdas.
Fix-Class: Residual (exported API in two packages).
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `desk/DeskCalendar.tsx` | 1,591 | One 1,332-line component: grid, month zoom, drag-move with reason prompt, matches, lessons, customer strip, keyboard |
| `till/TabDetailPanel.tsx` | 1,245 | 956-line component, 14-variant overlay union; settle, discount (copy-pasted with offline), loyalty, court fee, refund, void, merge |
| `desk/customers/CustomerRecord.tsx` | 1,168 | 521-line screen function, 19 `useState`, 6 queries |
| `desk/TodaysBoard.tsx` | 1,141 | Board screen + view + panels in one file (258 / 184 / 137-line functions) |
| `loyalty/LoyaltySetup.tsx` | 1,140 | 22 `useState`, 8 queries, 7 writes; settings, tiers, rewards wizard in one file |
| `loyalty/MemberAttach.tsx` | 1,014 | 356-line component; redeem preview diverges from core (`redeemWorth`) |
| `till/TillScreen.tsx` | 875 | 804-line component, 16 `useState`, 7 queries, 5 effects |
| `stock/ReceiveDelivery.tsx` | 852 | 8 queries; local float→IQD rounding (`:212`), browser-zone `todayIso` |
| `stock/products/ProductsAdmin.tsx` | 826 | Imports shop price-watch, shop reward and wages' idempotency helper (feature cycle) |
| `shop/ShopTill.tsx` | 721 | 466-line component; four inline "due" copies, wrong `expectedTotalIqd`, no component test |
| `tillShift/ShiftDialog.tsx` | 585 | 461-line component; idempotency key outlives edited float or count |
| `safe/SafePage.tsx` | 763 | Three forms with one key per form (F-13 class) |

## Looks bad but is fine

- **Safe page lets a cost go below zero while wages, advances and coach pay block.** `safe/safeLogic.ts:191-193` (`takesSafeBelowZero` warns) and `wages/wagesLogic.ts:661-663` (`safeShort` blocks) look like one decision made twice. They are two of Majed's decisions: `20261101000387_safe_balance_guard.sql:4-19` says main_cash_pay "keeps 0343's rule … it may still go below zero", while linked payments raise `SAFE_NOT_ENOUGH`.
- **The operator does not use `packages/core/src/pricing/rateRules`.** The desk prices a slot through the server's `price_slot` RPC (`desk/CreateReservationDialog.tsx:238-243`), so the server is the pricing authority. Calling the core mirror would add a third copy.
- **The till does not use core `splitEvenly`.** The even split is the server's `app.split_evenly`, and its result is rendered, never recomputed (`till/SplitBillDialog.tsx:3-4`).
- **`deskPaymentLogic.paymentMethodKey` maps unknown methods to "online" while `courtReceipt.ts:75` maps them to cash.** The `payment_method` enum is closed at `('cash','card')` (`20260824000002_enums_domains.sql:13`), so the third branch cannot fire. It is defensive code, not drift.
- **`desk/payment/deskPaymentLogic.ts` (`chargeLabelOf`, `panelStateOf`).** This is a status mapping over the server's `booking_bill_states.state`, with no arithmetic (header `:4-7`). It is one pure, tested home, not duplication.
- **`till/tabTotals.ts` existing at all.** It is a documented, tested display mirror of SQL (`:1-35`). The debt is where it lives (finding 2), not that it exists.
- **`tillShift` → `admin/dayCloseLogic` (`tillShiftLogic.ts:21`).** It reuses `varianceSign`/`varianceMagnitude` instead of re-deriving them, which is the right direction.
- **The feature-level import table first showed `tillShift → till/PaymentPane`.** That edge comes only from test files. Production code has no till ↔ tillShift cycle (`till/PaymentPane.tsx:46` is one-way).
- **`shopReward.rewardFor` (`shop/shopReward.ts:57-60`) and `offlineTotals.discountAmountIqd`.** Both are labelled mirrors of a named server rule, used for previews only, with the server re-stamping. They are acceptable at an explicit boundary once they live in one place.
- **No TODO/FIXME cluster.** No TODO/FIXME/XXX/HACK markers exist in the lane. All 9 `eslint-disable` lines are `react-hooks/exhaustive-deps`, and most carry a reason.
- **The 13 "exported but only used in its own file" symbols** (e.g. `deskPaymentLogic.needsSettling`, `kds/alarms.CALL_STALE_SECS`) are used locally. They are over-exported, not dead. Only `isPromotionAdjustment` passes the dead-code gate.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 1 | 6.0 | Scheduled | accidental |
| Change Propagation      | 1 | 6.0 | Scheduled | accidental |
| Knowledge Duplication   | 15 | 2.8 | Monitored (W-tier items Scheduled) | accidental |
| Accidental Complexity   | 1 | 1.0 | Monitored | accidental |
| Dependency Disorder     | 1 | 6.0 | Scheduled | accidental |
| Domain Model Distortion | 0 | — | — | — |

(The bill-maths finding is counted under Knowledge Duplication although it also carries an R5 aspect.)

**Recommended focus:** Knowledge Duplication on the money path. In order: fix the Shop till's due and expected total; move `tabTotals`/`offlineTotals` into core money; put every money text box on one parser; bind every cash-write idempotency key to its values. Then Change Propagation (QK literals) and the god components that let those copies grow.

## Summary

The most important action is to make the Shop till use the same bill totals as the till: it reads `tabs.total_iqd`, which is null before settle, and sends the remaining due where the server expects the full total. The next most important is to move the till's tested `computeTabTotals` mirror into `packages/core`, so desk, shop and offline paths cannot re-derive money on their own. The trend is consistent: each new money screen (shop, safe, deposits, wages) re-implemented readers, parsers, keys and query keys rather than reaching for core or `lib`. The three defect classes found here (shop due, dropped digits, stale idempotency keys) all come from that drift.

**Counts:** 🔴 0 · 🟡 10 · 🟢 9. Score = 100 − 10×5 − 9×1 = **41**.
