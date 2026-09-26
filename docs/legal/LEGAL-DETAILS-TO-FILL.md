# Legal details to fill in

Touch Padel's legal pages are written and live, but a few facts can only come from the business. Until they are
filled in, the pages show `[FILL: …]` where each fact belongs. The app stores will not accept the app while those
markers are visible.

**Who fills this in:** someone who can get these facts from Mustafa (the venue owner), such as his company paperwork
or accountant. The Arabic text is the one that counts legally, so the Arabic values matter most.

**How to hand it back:** fill in the right-hand column of each table below and send the file to Parsa. He puts the
values into the site. You do not need to edit any code.

**The pages:**

| Page | English | Arabic |
|---|---|---|
| Privacy Policy | https://www.touch-padel.com/en/privacy | https://www.touch-padel.com/ar/privacy |
| Terms of Service | https://www.touch-padel.com/en/terms | https://www.touch-padel.com/ar/terms |
| Delete account | https://www.touch-padel.com/en/delete-account | https://www.touch-padel.com/ar/delete-account |
| Support | https://www.touch-padel.com/en/support | https://www.touch-padel.com/ar/support |

---

## 1. Company details (required before the app is submitted to the stores)

These name the business that is legally responsible for the app, the venue and the customers' information.

| # | What | Why it is needed | Example | English value | Arabic value |
|---|---|---|---|---|---|
| 1 | **Company legal name**: the name on the commercial registration, not "Touch Padel" unless that *is* the registered name | The Privacy Policy must say who is responsible for people's data, and the Terms must say who the customer's contract is with | Touch Sports Co. for Recreation Ltd. | | |
| 2 | **Commercial registration number** | Identifies the company beyond doubt | 12345 / Erbil | | (usually the same) |
| 3 | **Registered address** | A contact address for legal and privacy requests | 100 Meter Road, Erbil, Kurdistan Region, Iraq | | |
| 4 | **Privacy contact email**: an inbox someone actually reads, answered within 30 days | Customers use it to ask for their data or to delete their account. Google Play checks that deletion requests can reach you | privacy@touch-padel.com | | (same email) |
| 5 | **City whose courts hear disputes**, normally where the company is registered | The Terms say which courts handle a dispute | Erbil | | أربيل |
| 6 | **Age below which children must be supervised on court** | The Terms' safety rules | 14 | | (same number) |

> Tip for #4: a dedicated address such as `privacy@touch-padel.com` (forwarding to Mustafa or the manager) is better
> than a personal Gmail. It survives staff changes.

---

## 2. Business decisions: please confirm or change

The pages already say the following. If any is wrong, write the correct rule in the "Your answer" column.

| # | What the pages currently say | Where | Your answer (leave blank if correct) |
|---|---|---|---|
| 7 | Free cancellation in the app until **4 hours** before the slot; after that only the front desk can change or cancel. *(The number comes live from the venue settings in the operator app, so changing it there changes the pages too.)* | Terms → Bookings, Support | |
| 8 | Repeated no-shows **may limit or suspend** booking from that account. There is **no fee** for a no-show or a late cancellation. | Terms → Bookings | |
| 9 | If the venue cancels (maintenance, power cut, event), the customer is offered **another time or a free cancellation**. Nothing more. | Terms → Bookings | |
| 10 | Minimum age to **create an account: 13**; under 18 needs a parent's or guardian's agreement. | Terms → Your account, Privacy → Children | |
| 11 | Payment is **at the venue only**; there is no online payment. *(If Qi Card deposits go live, the Terms need a refund section first. Tell Parsa before launch.)* | Terms → Bookings, Café | |
| 12 | The venue is **not responsible for lost or stolen belongings** unless the venue caused the loss. | Terms → Venue rules | |
| 13 | The venue's liability for a booking or order is **capped at the amount paid**, except for injury caused by negligence, fraud, or anything the law does not allow to be limited. | Terms → Our responsibility | |
| 14 | **Who answers privacy and deletion emails**, and how quickly (the pages promise **within 30 days**). | Privacy → Your rights, Delete account | Name / role: |

---

## 3. How long records are kept: confirm

| # | Record | What the Privacy Policy says now | Confirm, or give a period |
|---|---|---|---|
| 15 | Bookings, café orders, payments (anonymised after account deletion) | Kept "for the period the law requires" for accounting. **What period does the accountant need?** (Iraqi commercial books are commonly kept for several years.) | |
| 16 | Records of verification SMS/WhatsApp messages | Kept "as long as needed for security and accounting". A fixed period (for example 12 months) is better practice and Parsa can automate the deletion. | |
| 17 | Staff audit log (who changed what, when) | Same wording as #16. | |

---

## 4. Have a local lawyer review before launch

These pages follow app-store requirements and international privacy practice (GDPR-level). Iraq and the Kurdistan
Region have **no dedicated data-protection law yet** (a federal one is expected by the end of 2026), and **this is
not legal advice**. Have a lawyer in Iraq look at these points in particular:

- [ ] **Assumption of risk and the liability cap** (Terms → Venue rules, Our responsibility). Can a sports venue
      limit its liability like this under the Iraqi Civil Code and Kurdistan Region law? An over-broad clause can be
      void, so it deliberately does not exclude injury caused by negligence.
- [ ] **Governing law and courts** (Terms → Law and disputes). Iraq, "including the laws of the Kurdistan Region
      where they apply", with the courts of the city in #5.
- [ ] **The Arabic text is authoritative.** Have a native legal reader check the Arabic of the Terms and the
      Privacy Policy.
- [ ] **Minors.** Is agreement "by a parent or guardian" for 13–17 year-olds workable as written?
- [ ] **Posted venue rules.** The Terms refer to "the posted venue rules". Make sure there is a physical rules sign at
      the courts (shoes, glass walls, children, conduct).
- [ ] **The AI assistant.** The owner's assistant sends booking and sales records (names included, phone numbers and
      emails masked) to an AI provider in the United States. Confirm this is acceptable, or ask Parsa to mask names
      too.

---

## 5. After filling in (for Parsa)

1. Put the values into `packages/i18n/src/catalogs/legal.en.ts` and `legal.ar.ts` under `entity`, and adjust the
   copy for any changed decision in §2–§3.
2. Run `LEGAL_STRICT=1 pnpm check:legal`. It must pass before any store submission.
3. If the change is material (§2 rules changed after guests had already accepted), bump `CURRENT_TERMS_VERSION` in
   `packages/core/src/legal/terms.ts` and `lastUpdated` in both legal catalogs. Every signed-in guest is then asked
   to accept again.
