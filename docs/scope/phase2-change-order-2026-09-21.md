# Touch Padel: Phase 2 change order

**Date:** 2026-09-21
**From:** Kagu Web Studio (Parsa Mansouri)
**To:** Touch Padel (Mustafa)
**Status:** for review and signature. Nothing in it is started before it is signed.
**Revised 2026-09-23:** milestones 3 and 4 in section 3 (and their names in section 6) updated for
two changes of 2026-09-22 — Customer 360 removed at Touch's request, AI receipt scanning deferred —
and to record that the Touch Shop is built and awaiting acceptance. Nothing else changed; the fees
and the signatures are still blank.
**Revised 2026-09-27:** open matches are split out of milestone 6 into a milestone of their own,
built next (before coaching), and redesigned around a reusable open-match ticket; tournaments
become milestone 7 (sections 3, 4 and 6). The fees and the signatures are still blank.

---

## 1. Why this document exists

The signed Phase 1 Scope of Work carries a **CHANGE CONTROL** clause. It sits in the
"AFTER ACCEPTANCE" section of the contract, at lines 956 to 963 of
`docs/scope/touch-padel-phase1-scope-of-work.txt` (the text copy of the signed PDF). In short, it
says that any request which adds to, removes from or alters what the Scope of Work describes is
recorded in writing with its effect on the delivery date and the fee, and is then either approved by
Touch or deferred to a later phase, before work on it begins. Nothing is absorbed silently and
nothing is refused out of hand.

This document is that written record for Phase 2.

Eight of the nine items below are, word for word, the Scope of Work's own
"OUT OF SCOPE, LATER PHASES" list (SOW lines 140 to 154). They were always intended to be a later
phase. The ninth is new. Together they are not an extension of Phase 1; they are a second product,
larger than the first.

## 2. What Phase 2 adds

**Nine items.**

| # | Item | Where it comes from |
|---|---|---|
| 1 | Online and in-app payment (Qi Card), starting with court bookings | SOW out-of-scope list |
| 2 | Coaching, courses, coach schedules and commission settlement | SOW out-of-scope list |
| 3 | Open matches and seat splitting | SOW out-of-scope list |
| 4 | Tournaments and leagues | SOW out-of-scope list |
| 5 | Touch Shop retail and pro-shop inventory | SOW out-of-scope list |
| 6 | Loyalty points, rewards and tiers | SOW out-of-scope list |
| 7 | Customer 360 (the single customer record across every part of the business) | SOW out-of-scope list |
| 8 | Multi-venue and multi-location stock | SOW out-of-scope list |
| 9 | AI receipt scanning into goods-in | New request |

**One item has been dropped.** A tenth item was discussed, a new AI analysis system (chat over the
data, forecasting, cross-domain insights). It is **not part of this change order** and is not
quoted. If Touch wants it later it comes back as its own change order.

**One item is delivered but not billed.** An owner assistant was built during the Phase 1 period and
is on the system today, switched off. It stays switched off: it has no API key and its daily request
limit is set to zero, so no client role can reach it and it costs nothing to run. It is **not
charged for** under this change order. If it is ever switched on, that is a separate conversation.

**The management analytics panel** named in the Scope of Work's out-of-scope list was also built
during Phase 1 as a vendor addition and is already in the operator app, unbilled. Item 7 above is
therefore the Customer 360 half only.

## 3. Milestones

Work is delivered as eight milestones, in this order, except that milestone 6 (open matches) is
built next, before milestone 5 (coaching), as decided on 2026-09-27. Each one is a complete, usable piece of the
system. Each one is accepted and paid on its own. Sizes are in **agent-weeks**, the effort, not the
calendar, and are an order of magnitude, not a quotation; the fee and the dates are section 6.

| # | Milestone | What it contains | Depends on | Size |
|---|---|---|---|---|
| **0** | **Phase 1 close-out** | The security, correctness and contract items found in the 2026-09-19 audit, closed before any new table is built: the offline replay path can no longer lose a till write, manager PINs are protected on the five money operations, guest profile fields are validated, the price a guest is quoted is the price they are charged, a device can be retired from offline mode, till refunds and voids go on the durable queue, the release pipeline is gated, and the hosted database is brought up to date on a rehearsed push. | none | 3 weeks (about three quarters done) |
| **1** | **Multi-venue** | The second branch. Every court, table, tab, order, stock movement and setting learns which venue it belongs to; one owner over all branches, managers per branch, one stock location per branch, shared guests. Owner venue switcher, venue picker in the guest app, venue axis on every report. | 0 | 6 to 7 weeks |
| **2** | **Online payment (Qi Card)** | Deposits and balances paid online for court bookings, on a hosted Qi page, with refunds and a no-show policy. Money paid online appears in day close and in the reports beside desk payments. | 1, plus Qi credentials for go-live | 3 to 4 weeks (plus Qi's own lead time) |
| **3** | **Loyalty and web sign-in** | Points earned on spend in every part of the business, three tiers over a rolling twelve months, and a rewards catalogue. Includes sign-in at checkout on the cafe website, which is what lets a cafe order earn points. Customer 360 (one customer record with lifetime value and a timeline) was removed from this milestone at Touch's request on 2026-09-22. | 1 | 6 to 7 weeks |
| **4** | **Touch Shop (AI receipts deferred)** | Retail products and variants, sold at the shop's own desk (its own staff role, PC, till, drawer and stock store; rebuilt 2026-09-27 at the owner's request) and counted in stock, with suppliers. Built 2026-09-22, rebuilt 2026-09-27, awaiting acceptance. AI receipt scanning (a supplier receipt photographed, read, matched to items and confirmed by a human) is deferred and is not part of this milestone. | 1 | 5 to 6 weeks |
| **5** | **Coaching** | Coaches, availability, lesson types, courses, enrolment, and commission settlement. Coaches are guests with a coach record and use a coach mode in the phone app; they are not staff accounts. | 1, 2 | 4 to 5 weeks |
| **6** | **Open matches** | Players fill a court four at a time, without one person booking the whole court. A player starts a match on a free time; others join in the app or from a shared link; the court is booked the moment the fourth player joins. While a match is still filling, a normal booking of the last free court takes priority. Each player holds a reusable open-match ticket, bought once online: it comes back after every game and is lost only by not turning up. Everyone who plays pays their share at the desk. Includes women-only and men-only matches, reporting and blocking of players, and share links that open the app. Designed 2026-09-27 (`docs/design/open-matches/build-contracts-2026-09-27.md`). | 1, 2 | 5 to 7 weeks |
| **7** | **Tournaments** | Tournaments and leagues: Americano and Mexicano first, then knockout, then leagues, with entries, scoring and standings. | 1, 2, 5, 6 | 5 to 6 weeks |

**Why multi-venue is first.** There is no notion of a branch anywhere in the system today. Every
other item has to know which branch a row belongs to. Building them first and adding branches
afterwards would mean building each of them twice.

Sequential total: roughly **37 to 45 agent-weeks**.

## 4. What each milestone needs from Touch

Work on a milestone does not start until its inputs are in. These are the only things asked for, and
they are asked for once.

| Milestone | Needed from Touch |
|---|---|
| **0** | The Phase 1 close-out items in section 7. Confirmation that the PITR backup tier is bought (section 8). |
| **1** | The second venue: name in English and Arabic, address, phone number, the list of courts, the list of cafe tables, opening hours, and its rate rules. |
| **2** | The Qi Card onboarding items listed in `docs/design/payments/qi-deposit-plan-2026-09-20.md` §2, and the credentials once Qi issues them. Which tax group applies to online payments. |
| **3** | Loyalty: what one point is worth in IQD, the tier names in English and Arabic, the thresholds, and the discount percentage at each tier. |
| **4** | Twenty to thirty real supplier receipts (photographs are fine), the ingredient and supplier list, and an Anthropic API key in Touch's own name. Which tax group applies to retail. |
| **5** | The coach list, the lesson types and their prices, and written confirmation of the 60 % coach share net of the court. Which tax group applies to lessons. |
| **6** | The price of one open-match ticket. The Arabic word the app uses for the ticket. Confirmation that tickets which never expire, and are refunded at the desk on request, suit the rules Touch trades under. Which tax group applies to seat shares and to forfeited tickets. |
| **7** | Entry fees and the prize policy per event; which tax group applies to entries. These are **open**. Touch decides them at the start of milestone 7. |

## 5. Acceptance

A milestone is accepted when all four of these are true. This is the same shape as Phase 1's
acceptance and the same shape for every milestone.

1. **An acceptance script is run end to end, in English and in Arabic.** It is written before the
   demonstration, it is run on the real system, and it is the thing demonstrated. Arabic is drafted
   with the English and reviewed by Touch.
2. **The milestone's database changes are live on the hosted project** before any app build is
   handed over, verified as zero pending migrations.
3. **An internal mobile build is provided whenever the milestone changes what guests see**
   (TestFlight for iPhone, Play internal testing for Android).
4. **Touch signs off in writing.** Acceptance is not withheld for items outside this change order,
   nor for matters outside Kagu's control.

## 6. Fee and dates

To be completed by Kagu and agreed with Touch before signature. Currency is US dollars, as in the
Phase 1 commercial terms.

| # | Milestone | Fee | Payable | Start | Delivery |
|---|---|---|---|---|---|
| 0 | Phase 1 close-out | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 1 | Multi-venue | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 2 | Online payment (Qi Card) | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 3 | Loyalty and web sign-in | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 4 | Touch Shop | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 5 | Coaching | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 6 | Open matches | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 7 | Tournaments | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| | **Total** | `[            ]` | | | |

Running costs that Touch pays directly and that are not part of any fee above: the Supabase plan
including the PITR tier, the Qi Card merchant fees, the OTP messaging account, and the Anthropic API
key used by receipt scanning.

## 7. Phase 1 close-out: a precondition

Phase 2 does not start on an unsettled Phase 1. These are outstanding from Phase 1 and are needed
before, or during, milestone 0.

- [ ] **Rate rules.** Until they exist, every booking on a real court is refused with "no rate".
      This is the oldest open item and it blocks a live booking today.
- [ ] **The cafe menu** rows.
- [ ] **Recipes, sub-recipes and ingredients.** Without them the stock module cannot be accepted.
- [ ] **The staff list**: real names and roles, so the seeded development accounts can be removed.
- [ ] **Floor numbering**: zones, seats and table numbers, so the QR table cards can be printed.
- [ ] **The printer model**, confirmed, so a physical print test can be done on site.
- [ ] **Brand files**: the official Touch Cafe artwork, and clarity on which typeface is the brand's
      and who holds the licence.
- [ ] **The venue phone number**, confirmed. The number given reads as a Georgian number, not an
      Iraqi one, and it is the number shown to guests.

## 8. Backups and environments

Two related decisions, taken on 2026-09-20, recorded here because they change what was agreed in
Phase 1.

- **Point-in-time recovery is bought.** The Scope of Work promised automated daily backups with
  point-in-time recovery. On 2026-08-30 point-in-time recovery was declined on cost. That is now
  **reversed**: Touch buys the point-in-time recovery tier on the production project. Until it is
  bought, the worst case remains up to one day of lost data.
- **A staging project is created**, from the latest backup, **before the multi-venue push**. Every
  database change is rehearsed there before it touches the live system. This also closes the Scope
  of Work's "staging and production environments" item, which Phase 1 did not deliver.

## 9. Signature

By signing, Touch Padel approves the scope, the milestone order, the acceptance shape and the fees
in section 6, and agrees that work on each milestone begins when that milestone's inputs are in.

| | Touch Padel | Kagu Web Studio |
|---|---|---|
| Name | `[                              ]` | Parsa Mansouri |
| Signature | `[                              ]` | `[                              ]` |
| Date | `[                              ]` | `[                              ]` |

---

<div dir="rtl" lang="ar">

# تتش بادل: أمر تغيير المرحلة الثانية

**مسودة للمراجعة (client to review)**

**التاريخ:** 2026-09-21
**من:** Kagu Web Studio (پارسا منصوري)
**إلى:** تتش بادل (مصطفى)
**الحالة:** للمراجعة والتوقيع. لا يبدأ تنفيذ أي بند فيه قبل التوقيع عليه.
**تنقيح 2026-09-23:** حُدِّثت المحطتان الثالثة والرابعة في القسم الثالث (واسماهما في القسم
السادس) لتعكسا تغييرين وقعا في 2026-09-22: إزالة ملف الزبون الشامل بطلب من تتش، وتأجيل قراءة
الإيصالات بالذكاء الاصطناعي. وحُدِّثتا كذلك لتسجيل أن متجر تتش بُني وينتظر الاعتماد. لم يتغير شيء
آخر، وما زالت الأتعاب والتواقيع فارغة.
**تنقيح 2026-09-27:** فُصلت المباريات المفتوحة عن المحطة السادسة لتصبح محطة مستقلة تُبنى تاليًا
(قبل التدريب)، وأُعيد تصميمها حول تذكرة مباراة مفتوحة قابلة لإعادة الاستخدام، وصارت البطولات
المحطة السابعة (الأقسام الثالث والرابع والسادس). وما زالت الأتعاب والتواقيع فارغة.

---

## 1. سبب وجود هذه الوثيقة

يتضمن عقد المرحلة الأولى الموقَّع بندًا بعنوان **CHANGE CONTROL** (ضبط التغيير). يقع هذا البند في
قسم «AFTER ACCEPTANCE» (بعد الاعتماد) من العقد، في الأسطر من 956 إلى 963 من الملف
`docs/scope/touch-padel-phase1-scope-of-work.txt` (النسخة النصية من العقد الموقَّع). وخلاصته أن أي
طلب يضيف إلى ما ورد في وثيقة نطاق العمل أو يحذف منه أو يغيّره يُوثَّق كتابة مع أثره على موعد
التسليم وعلى الأتعاب، ثم إما أن توافق عليه تتش وإما أن يؤجَّل إلى مرحلة لاحقة، ولا يبدأ العمل به
قبل ذلك. فلا يُضاف شيء إلى العمل بصمت، ولا يُرفض شيء دون نقاش.

وهذه الوثيقة هي ذلك السجل الكتابي للمرحلة الثانية.

ثمانية من البنود التسعة أدناه مأخوذة حرفيًا من قائمة «خارج النطاق، مراحل لاحقة» الواردة في وثيقة
نطاق العمل نفسها (الأسطر 140 إلى 154). وكان المقصود منذ البداية أن تُنفَّذ في مرحلة لاحقة. أما
البند التاسع فجديد. وهي مجتمعة ليست امتدادًا للمرحلة الأولى، بل منتج ثانٍ أكبر من الأول.

## 2. ما تضيفه المرحلة الثانية

**تسعة بنود.**

| # | البند | مصدره |
|---|---|---|
| 1 | الدفع الإلكتروني والدفع داخل التطبيق (Qi Card)، بدءًا بحجوزات الملاعب | قائمة خارج النطاق في العقد |
| 2 | التدريب والدورات وجداول المدربين وتسوية العمولات | قائمة خارج النطاق في العقد |
| 3 | المباريات المفتوحة وتقسيم المقاعد | قائمة خارج النطاق في العقد |
| 4 | البطولات والدوريات | قائمة خارج النطاق في العقد |
| 5 | متجر تتش للبيع بالتجزئة ومخزون المتجر | قائمة خارج النطاق في العقد |
| 6 | نقاط الولاء والمكافآت والمستويات | قائمة خارج النطاق في العقد |
| 7 | ملف الزبون الشامل (Customer 360): سجل واحد للزبون عبر كل أقسام العمل | قائمة خارج النطاق في العقد |
| 8 | تعدد الفروع وتعدد مواقع المخزون | قائمة خارج النطاق في العقد |
| 9 | قراءة الإيصالات بالذكاء الاصطناعي وإدخالها في استلام البضائع | طلب جديد |

**بند واحد أُسقط.** نوقش بند عاشر، وهو نظام جديد لتحليل البيانات بالذكاء الاصطناعي (محادثة حول
البيانات وتوقعات واستنتاجات عابرة للأقسام). هذا البند **ليس جزءًا من أمر التغيير هذا** ولم يُقدَّم
عنه عرض سعر. وإن رغبت تتش فيه لاحقًا فيعود بأمر تغيير مستقل.

**بند واحد سُلِّم دون احتساب أتعاب.** بُني خلال المرحلة الأولى «مساعد المالك»، وهو موجود اليوم
في النظام لكنه مُطفأ. وسيبقى كذلك: لا يملك مفتاح واجهة برمجية، وحدّه اليومي للطلبات مضبوط على
صفر، فلا يصل إليه أي دور من الأدوار المتاحة لتتش، ولا تترتب على تشغيله أي كلفة. ولا تُحتسب عليه
**أي أتعاب** في أمر التغيير هذا. وإن تقرّر تشغيله يومًا فذلك نقاش منفصل.

كذلك **لوحة التحليلات الإدارية** المذكورة في قائمة خارج النطاق بُنيت خلال المرحلة الأولى كإضافة من
جانب Kagu، وهي موجودة اليوم في تطبيق التشغيل دون احتساب أتعاب. ولذلك لا يشمل البند 7 أعلاه سوى
شطر ملف الزبون الشامل.

## 3. المحطات

يُسلَّم العمل على ثماني محطات، بهذا الترتيب، إلا أن المحطة السادسة (المباريات المفتوحة) تُبنى تاليًا،
قبل المحطة الخامسة (التدريب)، بقرار اتُّخذ في 2026-09-27. كل محطة جزء كامل قابل للاستخدام من النظام،
وتُعتمد وتُدفع أتعابها على حدة. والأحجام بوحدة **أسابيع عمل الوكلاء** (agent-weeks)، أي حجم الجهد لا
مدة التقويم، وهي تقدير تقريبي لا عرض سعر؛ أما الأتعاب والمواعيد فترد في القسم السادس.

| # | المحطة | ما تتضمنه | تعتمد على | الحجم |
|---|---|---|---|---|
| **0** | **إغلاق المرحلة الأولى** | معالجة بنود الأمان وصحة التنفيذ والعقد التي كشفها تدقيق 2026-09-19، قبل بناء أي جدول جديد: منع ضياع أي عملية مسجلة على الصندوق في مسار إعادة التنفيذ دون اتصال، وحماية الأرقام السرية للمديرين في عمليات المال الخمس، والتحقق من حقول الملف الشخصي للضيف، وضمان أن يكون السعر المعروض على الضيف هو السعر الذي يُحاسَب به، وإمكانية إخراج جهاز من وضع العمل دون اتصال، ووضع عمليات الاسترداد والإلغاء على الصندوق في الطابور الدائم، وإخضاع مسار الإصدار لبوابات فحص، وتحديث قاعدة البيانات المستضافة بدفعة تحديث جرت تجربتها مسبقًا. | لا شيء | 3 أسابيع (أُنجز نحو ثلاثة أرباع العمل) |
| **1** | **تعدد الفروع** | الفرع الثاني. يُسجَّل لكل ملعب وطاولة وفاتورة وطلب وحركة مخزون وإعداد الفرع الذي يتبع له؛ مالك واحد لكل الفروع، ومديرون لكل فرع، وموقع مخزون واحد لكل فرع، وضيوف مشتركون بين الفروع. مبدّل فروع للمالك، واختيار الفرع في تطبيق الضيوف، وتقسيم كل تقرير حسب الفرع. | 0 | 6 إلى 7 أسابيع |
| **2** | **الدفع الإلكتروني (Qi Card)** | دفع العربون والمبلغ المتبقي إلكترونيًا لحجوزات الملاعب عبر صفحة Qi المستضافة، مع الاسترداد وسياسة عدم الحضور. وتظهر المبالغ المدفوعة إلكترونيًا في إغلاق اليوم وفي التقارير إلى جانب المدفوعات المسجلة في مكتب الملاعب. | 1، مع بيانات اعتماد Qi للإطلاق الفعلي | 3 إلى 4 أسابيع (إضافة إلى المدة التي تستغرقها Qi نفسها) |
| **3** | **الولاء وتسجيل الدخول عبر الموقع** | نقاط تُكتسب مقابل الإنفاق في كل أقسام العمل، وثلاثة مستويات تُحتسب على فترة متحركة مدتها اثنا عشر شهرًا، وكتالوج مكافآت. ويشمل تسجيل الدخول عند إتمام الطلب في موقع الكافيه، وهو ما يتيح لطلب الكافيه أن يكسب نقاطًا. أما ملف الزبون الشامل (سجل واحد للزبون يضم قيمته الإجمالية طوال فترة تعامله وخطًا زمنيًا لنشاطه) فقد أُزيل من هذه المحطة بطلب من تتش في 2026-09-22. | 1 | 6 إلى 7 أسابيع |
| **4** | **متجر تتش (قراءة الإيصالات مؤجَّلة)** | منتجات التجزئة ومتغيراتها، تُباع في مكتب المتجر المستقل (له دور موظف وحاسوب وصندوق ودرج نقد ومخزن، كلها خاصة به) وتُدرج في المخزون، مع المورّدين. بُني في 2026-09-22 وأُعيد بناؤه في 2026-09-27 بطلب من المالك، وهو بانتظار الاعتماد. أما قراءة الإيصالات بالذكاء الاصطناعي (تصوير إيصال المورّد وقراءته ومطابقة بنوده مع أصناف المخزون وتأكيده بمراجعة بشرية) فمؤجَّلة، وليست جزءًا من هذه المحطة. | 1 | 5 إلى 6 أسابيع |
| **5** | **التدريب** | المدربون وأوقات توفرهم وأنواع الدروس والدورات والتسجيل في الدورات وتسوية العمولات. والمدربون ضيوف لهم سجل مدرب، ويستخدمون وضع المدرب في تطبيق الهاتف، وليسوا حسابات موظفين. | 1 و2 | 4 إلى 5 أسابيع |
| **6** | **المباريات المفتوحة** | يلتقي أربعة لاعبين في ملعب واحد دون أن يتولى شخص واحد حجز الملعب كله. يبدأ لاعب مباراة مفتوحة في موعد متاح، وينضم إليها الآخرون من التطبيق أو من رابط مشاركة، ويُحجز الملعب لحظة انضمام اللاعب الرابع. وما دامت المباراة لم تكتمل، فالأولوية للحجز العادي لآخر ملعب متاح. ولكل لاعب تذكرة مباراة مفتوحة قابلة لإعادة الاستخدام، يشتريها مرة واحدة عبر الإنترنت: تعود إليه بعد كل مباراة، ولا يخسرها إلا بعدم الحضور. ويدفع كل من يلعب حصته عند مكتب الملاعب. وتتضمن المحطة مباريات للنساء فقط وأخرى للرجال فقط، والإبلاغ عن اللاعبين وحظرهم، وروابط مشاركة تفتح التطبيق. صُمِّمت في 2026-09-27 (`docs/design/open-matches/build-contracts-2026-09-27.md`). | 1 و2 | 5 إلى 7 أسابيع |
| **7** | **البطولات** | البطولات والدوريات: أمريكانو وميكسيكانو أولًا، ثم خروج المغلوب، ثم الدوريات، مع تسجيل المشاركين واحتساب النتائج وجداول الترتيب. | 1 و2 و5 و6 | 5 إلى 6 أسابيع |

**لماذا تعدد الفروع أولًا.** لا يوجد اليوم في النظام أي مفهوم للفرع، وكل بند آخر يحتاج إلى معرفة
الفرع الذي ينتمي إليه كل سجل. ولو بُنيت تلك البنود أولًا ثم أُضيفت الفروع بعدها لوجب بناء كل واحد
منها مرتين.

المجموع التسلسلي: نحو **37 إلى 45 أسبوعًا** من عمل الوكلاء.

## 4. ما تحتاجه كل محطة من تتش

لا يبدأ العمل في أي محطة قبل وصول مدخلاتها. وهذا كل ما يُطلب، ويُطلب مرة واحدة.

| المحطة | المطلوب من تتش |
|---|---|
| **0** | بنود إغلاق المرحلة الأولى الواردة في القسم السابع، وتأكيد شراء مستوى الاستعادة الزمنية (PITR) للنسخ الاحتياطي، كما في القسم الثامن. |
| **1** | بيانات الفرع الثاني: الاسم بالعربية والإنجليزية، والعنوان، ورقم الهاتف، وقائمة الملاعب، وقائمة طاولات الكافيه، وساعات العمل، وقواعد أسعار الملاعب فيه. |
| **2** | متطلبات الانضمام إلى Qi Card المذكورة في `docs/design/payments/qi-deposit-plan-2026-09-20.md` (القسم 2)، وبيانات الاعتماد حين تصدرها Qi، مع تحديد المجموعة الضريبية التي تنطبق على الدفع الإلكتروني. |
| **3** | الولاء: قيمة النقطة الواحدة بالدينار العراقي، وأسماء المستويات بالعربية والإنجليزية، وحدود الانتقال بين المستويات، ونسبة الخصم عند كل مستوى. |
| **4** | من عشرين إلى ثلاثين إيصالًا حقيقيًا من المورّدين (تكفي الصور)، وقائمة المكوّنات والمورّدين، ومفتاح واجهة Anthropic البرمجية المسجَّل باسم تتش، مع تحديد المجموعة الضريبية التي تنطبق على التجزئة. |
| **5** | قائمة المدربين، وأنواع الدروس وأسعارها، وتأكيد كتابي لحصة المدرب البالغة 60% بعد خصم كلفة الملعب، مع تحديد المجموعة الضريبية التي تنطبق على الدروس. |
| **6** | سعر تذكرة المباراة المفتوحة الواحدة، والكلمة العربية التي يستخدمها التطبيق للتذكرة، وتأكيد أن التذاكر التي لا تنتهي صلاحيتها وتُستردّ قيمتها في مكتب الملاعب عند الطلب تتوافق مع القواعد التي تعمل تتش بموجبها، وتحديد المجموعة الضريبية التي تنطبق على حصص المقاعد وعلى التذاكر المصادَرة بسبب عدم الحضور. |
| **7** | رسوم المشاركة وسياسة الجوائز لكل فعالية، والمجموعة الضريبية التي تنطبق على رسوم المشاركة. وهذه البنود **مفتوحة**، وتقرّرها تتش عند بدء المحطة السابعة. |

## 5. الاعتماد

تُعتمد المحطة عند تحقق الشروط الأربعة الآتية جميعها. وهي الصيغة نفسها المعتمدة في المرحلة الأولى،
وتسري على كل محطة.

1. **يُشغَّل سيناريو الاعتماد كاملًا من أوله إلى آخره، بالإنجليزية وبالعربية.** يُكتب قبل العرض،
ويُنفَّذ على النظام الحقيقي، وهو نفسه ما يُعرض. وتُصاغ النسخة العربية مع الإنجليزية وتراجعها تتش.

2. **تغييرات قاعدة البيانات التي تتطلبها المحطة مطبَّقة على المشروع المستضاف** قبل تسليم أي نسخة
من التطبيق، مع التحقق من أنه لا توجد ترحيلات معلّقة.

3. **تُوفَّر نسخة تجريبية داخلية من تطبيق الهاتف كلما غيّرت المحطة ما يراه الضيوف** (TestFlight
لآيفون، واختبار Play الداخلي لأندرويد).

4. **تعتمد تتش المحطة كتابة.** ولا يُعلَّق الاعتماد على بنود خارج أمر التغيير هذا، ولا على أمور
خارجة عن سيطرة Kagu.

## 6. الأتعاب والمواعيد

تستكمل Kagu هذا القسم ويُتفق عليه مع تتش قبل التوقيع. والعملة هي الدولار الأمريكي، كما في الشروط
التجارية للمرحلة الأولى.

| # | المحطة | الأتعاب | موعد الاستحقاق | البدء | التسليم |
|---|---|---|---|---|---|
| 0 | إغلاق المرحلة الأولى | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 1 | تعدد الفروع | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 2 | الدفع الإلكتروني (Qi Card) | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 3 | الولاء وتسجيل الدخول عبر الموقع | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 4 | متجر تتش | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 5 | التدريب | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 6 | المباريات المفتوحة | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 7 | البطولات | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| | **المجموع** | `[            ]` | | | |

مصاريف التشغيل التي تدفعها تتش مباشرة وليست جزءًا من أي أتعاب مذكورة أعلاه: باقة Supabase بما فيها
مستوى الاستعادة الزمنية (PITR)، ورسوم التاجر لدى Qi Card، وحساب رسائل رموز التحقق، ومفتاح واجهة
Anthropic البرمجية المستخدم في قراءة الإيصالات.

## 7. إغلاق المرحلة الأولى: شرط مسبق

لا تبدأ المرحلة الثانية قبل أن تُغلق المرحلة الأولى. وهذه البنود ما زالت معلّقة من المرحلة الأولى،
وهي مطلوبة قبل المحطة 0 أو خلالها.

- [ ] **قواعد أسعار الملاعب.** ما لم توجد، يُرفض كل حجز على ملعب حقيقي برسالة «لا توجد قاعدة سعر».
      وهذا أقدم بند مفتوح، وهو يمنع إجراء أي حجز فعلي اليوم.
- [ ] **أصناف منيو الكافيه.**
- [ ] **الوصفات والوصفات الفرعية والمكوّنات.** من دونها لا يمكن اعتماد وحدة المخزون.
- [ ] **قائمة الموظفين**: الأسماء والأدوار الحقيقية، ليصبح بالإمكان حذف حسابات التطوير التجريبية.
- [ ] **ترقيم الصالة**: المناطق والمقاعد وأرقام الطاولات، ليصبح بالإمكان طباعة بطاقات الطاولات برمز QR.
- [ ] **تأكيد طراز الطابعة**، لإجراء اختبار طباعة فعلي في الموقع.
- [ ] **ملفات الهوية البصرية**: المواد التصميمية الرسمية لتتش كافيه، وتوضيح أي خط هو خط الهوية
      ومن يملك رخصته.
- [ ] **تأكيد رقم هاتف الفرع.** الرقم المعطى يبدو رقمًا جورجيًا لا عراقيًا، وهو الرقم الظاهر
      للضيوف.

## 8. النسخ الاحتياطي والبيئات

قراران مترابطان اتُّخذا في 2026-09-20، ويُوثَّقان هنا لأنهما يغيّران ما اتُّفق عليه في المرحلة
الأولى.

- **شراء الاستعادة الزمنية (PITR).** نص نطاق العمل على نسخ احتياطي يومي آلي مع استعادة زمنية. وفي
  2026-08-30 رُفضت الاستعادة الزمنية بسبب كلفتها. وقد **عُكس** هذا القرار الآن: تشتري تتش مستوى
  الاستعادة الزمنية لمشروع الإنتاج. وإلى أن يُشترى هذا المستوى، يبقى أسوأ احتمال هو فقدان بيانات
  يوم واحد كحد أقصى.
- **إنشاء مشروع تجريبي (staging)** من آخر نسخة احتياطية، **قبل نشر تحديث تعدد الفروع**. ويُجرَّب كل
  تغيير في قاعدة البيانات عليه قبل أن يمسّ النظام الفعلي. وبهذا يُغلق أيضًا بند «بيئتا التجريب
  والإنتاج» الوارد في نطاق العمل، وهو بند لم تسلّمه المرحلة الأولى.

## 9. التوقيع

بالتوقيع، تعتمد تتش بادل النطاق وترتيب المحطات وصيغة الاعتماد والأتعاب الواردة في القسم السادس،
وتوافق على أن العمل في كل محطة يبدأ عند وصول مدخلاتها.

| | تتش بادل | Kagu Web Studio |
|---|---|---|
| الاسم | `[                              ]` | پارسا منصوري |
| التوقيع | `[                              ]` | `[                              ]` |
| التاريخ | `[                              ]` | `[                              ]` |

</div>
