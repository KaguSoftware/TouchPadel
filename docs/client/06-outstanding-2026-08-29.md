# Still Outstanding — after the 2026-08-29 pack / ما تبقّى بعد حزمة ٢٩ آب

Thank you — the first pack is in and **eight items are now built into the system**: your opening
hours, the cancellation rule, the currency and tax decisions, Kurdish, your two courts, and your
details as approver. This is what is still missing.

شكراً لكم — وصلت الحزمة الأولى و**ثمانية بنود صارت مبنية في النظام**: ساعات العمل، قاعدة الإلغاء،
قراري العملة والضريبة، الكردية، الملعبان، وبياناتكم كجهة معتمدة. وفيما يلي ما تبقّى.

> The pack shows **8 of 21** answered and has **not been submitted** (`submittedAt: null`).
> Contract deadlines are from SOW section 11; a week's delay here is a week off the end.

---

## 1. Blocking right now — the booking system cannot open without these

### Rate rules / قواعد الأسعار — **Week 1**

**This is the single most urgent item.** You sent us the two courts, but the price table is empty.
Without at least one rule covering every open hour, **every booking attempt fails** — the guest app,
the website and the front desk all refuse the slot. Nothing else in Module 2 can be tested.

أرسلتم الملعبين لكن جدول الأسعار فارغ. **بدون قاعدة سعر تغطي كل ساعة عمل، يفشل كل حجز** — في
التطبيق وعلى الموقع وعلى المكتب.

One row per price rule: which days, which time window, which duration, the price in whole IQD.

> **Because you trade until 02:00, any price that runs past midnight must be given as two rows** —
> e.g. `21:00–24:00` and then `00:00–02:00`. Tell us the price and we will split it correctly; just
> don't write a single row from `21:00` to `02:00`, because the system will refuse it.

Your courts are set to **60 minutes only**. If you also want to sell 90- or 120-minute bookings,
say so now — a duration that is not on the court cannot be booked at all.

### The four closed days — exact dates / التواريخ الدقيقة لأيام الإغلاق — **Week 1**

You told us you close for **9 and 10 Muharram, Arbaeen, and Wafat al-Rasool**. We have deliberately
**not** entered any dates, because these follow the Hijri calendar and in Iraq depend on local
sighting — a date we guessed wrong would either turn away paying customers or take a booking you
cannot honour.

Please send the **Gregorian dates (YYYY-MM-DD)** for the next twelve months, and tell us whether the
closure is the whole day or only part of it.

نحتاج التواريخ الميلادية الدقيقة للأشهر الاثني عشر القادمة. لم ندخل أي تاريخ تقديري عمداً.

> One detail worth confirming: because you trade past midnight, a day you close also closes the
> **00:00–02:00 hours at the end of the night before**. Tell us if you would rather that night run
> to its normal 02:00 close.

### Menu rows / صفوف القائمة — **Week 1**

The menu table is empty. We are currently showing the 72-item menu transcribed from your approved
design file — but it carries **no sizes you have confirmed, no add-ons, no allergens and no
prices you have signed off**. Until you send the menu rows, what is on the website is our reading of
a PDF, not your menu.

القائمة الحالية مأخوذة من ملف التصميم المعتمد ولا تتضمن أحجاماً أو إضافات أو مسببات حساسية أو
أسعاراً مؤكدة منكم.

---

## 2. Week 2 — the kitchen, and the largest risk in the phase

### Recipes, sub-recipes and ingredients / الوصفات والمكونات

All four tables are empty: **Recipes**, **Sub-recipes**, **What goes into one batch**, and
**Ingredients**. The Scope of Work names measured recipes as **the single largest risk in this
phase** (item 11). Without them, Module 5 — stock, waste, margin and batch expiry — cannot be
delivered at all, and no dish can be costed.

الجداول الأربعة فارغة. العقد يسمّي الوصفات المقاسة **أكبر خطر في هذه المرحلة**. بدونها لا يمكن
تسليم وحدة المخزون إطلاقاً.

For ingredients we need, per item: pack size, pack cost in IQD, supplier, and shelf life in days.

### The floor and the table numbering / مخطط الأرضية وترقيم الطاولات

Four questions still unanswered on "The floor", and one on "Where everything is". The QR code for
every table is generated from this list — **late layout means late QR printing means late table
ordering**.

### Receipt printer / طابعة الإيصالات

Purchase not yet confirmed. Model and specification are in `01-printer-spec.md`. Receipt and kitchen
printing cannot be tested on real hardware until it is on site.

### Power and network at the venue / الكهرباء والشبكة

Two questions still unanswered. The kitchen screen finds the till over the local network **by
address**, so we also need a static IP or DHCP reservation for the till machine.

---

## 3. Week 3 — people

### Staff list / قائمة الموظفين

Two rows were started but **both are incomplete**. We need each person's name and intended role
(till, kitchen, manager, admin). Accounts and training PINs are created from this list, and until it
exists the system's only accounts are our development ones.

صفّان بدأتما ولم يكتملا. نحتاج اسم كل موظف ودوره المقصود.

### Training availability / توفّر الموظفين للتدريب — Week 5

One question still unanswered.

---

## 4. Decisions and paperwork

| Item / البند | Due | Status |
|---|---|---|
| **Domain name** / اسم النطاق | Week 1 | You asked us to help. `touchpadel.com` is on the aftermarket at roughly $65,000; `touchpadel.iq` is restricted; `touchpadel.com.iq` is available at about $330/yr; a short `.com` variant is about $15/yr. **This is a brand decision only Mustafa can make.** Until a domain exists we cannot print the table QR cards — the system refuses to print a temporary address onto physical cards. |
| **PITR (database recovery)** / الاسترجاع الزمني | Week 1 | Still unanswered. Point-in-time recovery is a **paid Supabase add-on** on top of the ~$25/mo plan (roughly $100/mo), billed to Touch. The alternative is daily backups only, included. We need your written choice. |
| **Named approver** / الجهة المعتمدة | Week 1 | Two questions still open. We have Mustafa Awad, Owner. Please confirm the weekly slot he is available for sign-off. |
| **Brand font licences** / تراخيص الخطوط | Week 1 | Still unanswered. We need the **licensed font files** for Next Art (Latin) and Frutiger LT Arabic — not screenshots. Until they arrive the apps ship with free stand-ins, swapped later in one line. |
| **Branding assets** / أصول العلامة | Week 1 | You noted logo, colours and photos were "sent already via WhatsApp". **We do not have them in the build.** Please re-send them to the project email so they are on the record. |
| **Anything else we should know?** | Week 1 | Optional, still blank. |

---

## 5. One thing to check — your phone number / رقم الهاتف

The contact number in the pack is **`00995419010203`**. Read as an international number that is
**+995, which is Georgia** — Iraq is **+964**.

This number is not just a contact detail: it is what the system shows guests when the till loses
connection and bookings have to be taken by phone, and it is the number printed on the public
website. Please confirm the correct number before go-live.

الرقم المسجّل يبدأ بمفتاح **+995 (جورجيا)** وليس **+964 (العراق)**. هذا الرقم يظهر للضيوف على الموقع
وعند انقطاع الاتصال بالكاشير. يرجى تأكيده.

---

## What we did with what you sent / ما تم تنفيذه

| Your answer | Now live in the system |
|---|---|
| Open 09:00, close 02:00, all seven days | Opening hours, on every surface. The system now supports trading past midnight — it did not before |
| Cancel up to 4 hours before | Cancellation window, enforced server-side |
| IQD only, confirmed | Recorded as the trading currency (SOW section 10 decision) |
| Tax: zero | 0% across the board; the 10% group stays switched off until your accountant says otherwise |
| Kurdish: not needed | English + Arabic only, as contracted. Closed as a change request |
| Court 1 and Court 2, indoor, 60 minutes | Court records, awaiting rate rules before they can be booked |
| Mustafa Awad, Owner | Named approver and venue contact |
| Hosting done, Frankfurt region confirmed | Verified — the project is live in `eu-central-1` |
