# Touch Padel: Phase 2 change order

**Date:** 2026-09-21
**From:** Kagu Web Studio (Parsa Mansouri)
**To:** Touch Padel (Mustafa)
**Status:** for review and signature. Nothing in it is started before it is signed.

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

Work is delivered as seven milestones, in this order. Each one is a complete, usable piece of the
system. Each one is accepted and paid on its own. Sizes are in **agent-weeks**, the effort, not the
calendar, and are an order of magnitude, not a quotation; the fee and the dates are section 6.

| # | Milestone | What it contains | Depends on | Size |
|---|---|---|---|---|
| **0** | **Phase 1 close-out** | The security, correctness and contract items found in the 2026-09-19 audit, closed before any new table is built: the offline replay path can no longer lose a till write, manager PINs are protected on the five money operations, guest profile fields are validated, the price a guest is quoted is the price they are charged, a device can be retired from offline mode, till refunds and voids go on the durable queue, the release pipeline is gated, and the hosted database is brought up to date on a rehearsed push. | none | 3 weeks (about three quarters done) |
| **1** | **Multi-venue** | The second branch. Every court, table, tab, order, stock movement and setting learns which venue it belongs to; one owner over all branches, managers per branch, one stock location per branch, shared guests. Owner venue switcher, venue picker in the guest app, venue axis on every report. | 0 | 6 to 7 weeks |
| **2** | **Online payment (Qi Card)** | Deposits and balances paid online for court bookings, on a hosted Qi page, with refunds and a no-show policy. Money paid online appears in day close and in the reports beside desk payments. | 1, plus Qi credentials for go-live | 3 to 4 weeks (plus Qi's own lead time) |
| **3** | **Customers 360 and loyalty** | One customer record across bookings, cafe, shop, lessons and matches, with lifetime value and a timeline. Points earned on spend in every part of the business, three tiers over a rolling twelve months, and a rewards catalogue. Includes sign-in at checkout on the cafe website, which is what lets a cafe order earn points. | 1 | 6 to 7 weeks |
| **4** | **Shop and AI receipts** | Retail products and variants sold on the till and counted in stock, with suppliers. A staff member photographs a supplier receipt from a code on the till, the lines are read, matched to items and shown for a human to confirm before anything enters the ledger. | 1 | 5 to 6 weeks |
| **5** | **Coaching** | Coaches, availability, lesson types, courses, enrolment, and commission settlement. Coaches are guests with a coach record and use a coach mode in the phone app; they are not staff accounts. | 1, 2 | 4 to 5 weeks |
| **6** | **Open matches, then tournaments** | Open matches with four seats and seat splitting, then tournaments and leagues: Americano and Mexicano first, then knockout, then leagues, with entries, scoring and standings. | 1, 2, 5 | 8 to 9 weeks |

**Why multi-venue is first.** There is no notion of a branch anywhere in the system today. Every
other item has to know which branch a row belongs to. Building them first and adding branches
afterwards would mean building each of them twice.

Sequential total: roughly **35 to 41 agent-weeks**.

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
| **6** | Entry fees and the prize policy per event; which tax group applies to seats and entries. These are **open**. Touch decides them at the start of milestone 6. |

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
| 3 | Customers 360 and loyalty | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 4 | Shop and AI receipts | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 5 | Coaching | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| 6 | Open matches and tournaments | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
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

# تاتش بادل: أمر تغيير المرحلة الثانية

**مسودة للمراجعة (client to review)**

**التاريخ:** 2026-09-21
**من:** Kagu Web Studio (پارسا منصوري)
**إلى:** تاتش بادل (مصطفى)
**الحالة:** للمراجعة والتوقيع. لا يبدأ أي بند فيه قبل توقيعه.

---

## ١. سبب وجود هذه الوثيقة

يتضمن عقد المرحلة الأولى الموقَّع بنداً بعنوان **CHANGE CONTROL** (ضبط التغيير). يقع هذا البند في
قسم "AFTER ACCEPTANCE" من العقد، في الأسطر من ٩٥٦ إلى ٩٦٣ من الملف
`docs/scope/touch-padel-phase1-scope-of-work.txt` (النسخة النصية من العقد الموقَّع). وخلاصته أن أي
طلب يضيف إلى ما ورد في نطاق العمل أو يحذف منه أو يغيّره، يُوثَّق كتابةً مع أثره على موعد التسليم
وعلى الأتعاب، ثم إمّا توافق عليه تاتش أو يؤجَّل إلى مرحلة لاحقة، وذلك قبل بدء العمل به. لا شيء
يُستوعب بصمت، ولا شيء يُرفض دون نقاش.

وهذه الوثيقة هي ذلك التوثيق الكتابي للمرحلة الثانية.

ثمانية من البنود التسعة أدناه مأخوذة حرفياً من قائمة "خارج النطاق، مراحل لاحقة" الواردة في نطاق
العمل نفسه (الأسطر ١٤٠ إلى ١٥٤). وقد كانت منذ البداية مقصودة كمرحلة لاحقة. أما البند التاسع فهو
جديد. ومجتمعةً، هذه البنود ليست امتداداً للمرحلة الأولى، بل هي منتج ثانٍ أكبر من الأول.

## ٢. ما تضيفه المرحلة الثانية

**تسعة بنود.**

| # | البند | مصدره |
|---|---|---|
| ١ | الدفع الإلكتروني وداخل التطبيق (Qi Card)، بدءاً بحجوزات الملاعب | قائمة خارج النطاق في العقد |
| ٢ | التدريب والدورات وجداول المدربين وتسوية العمولات | قائمة خارج النطاق في العقد |
| ٣ | المباريات المفتوحة وتقسيم المقاعد | قائمة خارج النطاق في العقد |
| ٤ | البطولات والدوريات | قائمة خارج النطاق في العقد |
| ٥ | متجر تاتش للبيع بالتجزئة ومخزون المتجر | قائمة خارج النطاق في العقد |
| ٦ | نقاط الولاء والمكافآت والفئات | قائمة خارج النطاق في العقد |
| ٧ | ملف العميل الشامل (Customer 360) عبر كل أقسام العمل | قائمة خارج النطاق في العقد |
| ٨ | تعدد الفروع وتعدد مواقع المخزون | قائمة خارج النطاق في العقد |
| ٩ | قراءة فواتير المورّدين بالذكاء الاصطناعي وإدخالها إلى المخزون | طلب جديد |

**بند واحد أُسقط.** نوقش بند عاشر، وهو نظام تحليل جديد بالذكاء الاصطناعي (محادثة مع البيانات،
وتنبؤات، ورؤى عابرة للأقسام). هذا البند **ليس جزءاً من أمر التغيير هذا** ولم تُسعَّر له أتعاب. وإذا
رغبت تاتش به لاحقاً فيعود بأمر تغيير مستقل.

**بند واحد سُلِّم دون احتساب أتعاب.** بُني خلال فترة المرحلة الأولى "مساعد المالك"، وهو موجود اليوم
في النظام لكنه مُطفأ. وسيبقى مُطفأً: لا يملك مفتاح واجهة برمجية، وحدّه اليومي للطلبات مضبوط على
صفر، فلا يصل إليه أي دور من أدوار العميل ولا يكلّف شيئاً في التشغيل. وهو **غير محتسب** في أمر
التغيير هذا. وإن تقرّر تشغيله يوماً فذلك نقاش منفصل.

كذلك **لوحة التحليلات الإدارية** المذكورة في قائمة خارج النطاق بُنيت خلال المرحلة الأولى كإضافة من
المورّد وهي موجودة اليوم في تطبيق التشغيل دون احتساب أتعاب. ولذلك فإن البند السابع أعلاه يشمل
الشطر الخاص بملف العميل الشامل فقط.

## ٣. المراحل

يُسلَّم العمل على سبع مراحل، بهذا الترتيب. كل مرحلة قطعة كاملة وقابلة للاستخدام من النظام، وتُعتمد
وتُدفَع على حدة. والأحجام بوحدة **أسابيع عمل**، أي الجهد لا التقويم، وهي تقدير لرتبة الحجم لا عرض
سعر؛ أما الأتعاب والمواعيد فهي في القسم السادس.

| # | المرحلة | ما تتضمنه | تعتمد على | الحجم |
|---|---|---|---|---|
| **٠** | **إغلاق المرحلة الأولى** | معالجة بنود الأمان والصحة والعقد التي كشفها تدقيق ٢٠٢٦-٠٩-١٩، قبل بناء أي جدول جديد: لم يعد ممكناً أن يضيع أي إدخال من الكاشير في مسار العمل دون اتصال، وحماية أرقام تعريف المدير السرية على عمليات المال الخمس، والتحقق من حقول ملف الضيف، وأن يكون السعر المعروض على الضيف هو السعر المحتسب عليه، وإمكانية سحب جهاز من وضع عدم الاتصال، ووضع عمليات الاسترجاع والإلغاء في الكاشير على الطابور الدائم، ووضع بوابة موافقة على خط إصدار البرنامج، وتحديث قاعدة البيانات المستضافة عبر دفعة مُجرَّبة مسبقاً. | لا شيء | ٣ أسابيع (أُنجز نحو ثلاثة أرباعها) |
| **١** | **تعدد الفروع** | الفرع الثاني. كل ملعب وطاولة وفاتورة وطلب وحركة مخزون وإعداد يعرف إلى أي فرع ينتمي؛ مالك واحد فوق كل الفروع، ومدراء لكل فرع، وموقع مخزون واحد لكل فرع، وضيوف مشتركون. مبدّل فروع للمالك، واختيار الفرع في تطبيق الضيف، ومحور الفرع في كل تقرير. | ٠ | ٦ إلى ٧ أسابيع |
| **٢** | **الدفع الإلكتروني (Qi Card)** | دفع العربون والرصيد إلكترونياً لحجوزات الملاعب عبر صفحة Qi المستضافة، مع الاسترجاع وسياسة عدم الحضور. والمبالغ المدفوعة إلكترونياً تظهر في إقفال اليوم وفي التقارير إلى جانب مدفوعات الكاشير. | ١، مع بيانات اعتماد Qi للتشغيل الفعلي | ٣ إلى ٤ أسابيع (إضافةً إلى مدة Qi نفسها) |
| **٣** | **ملف العميل الشامل والولاء** | سجل واحد للعميل عبر الحجوزات والكافيه والمتجر والدروس والمباريات، مع القيمة الإجمالية للعميل وخط زمني لتعاملاته. ونقاط تُكتسب على الإنفاق في كل أقسام العمل، وثلاث فئات على مدى اثني عشر شهراً متحركة، وكتالوج مكافآت. ويشمل تسجيل الدخول عند الدفع في موقع الكافيه، وهو ما يتيح لطلب الكافيه أن يكسب نقاطاً. | ١ | ٦ إلى ٧ أسابيع |
| **٤** | **المتجر وقراءة الفواتير** | منتجات التجزئة وأصنافها تُباع على الكاشير وتُحتسب في المخزون، مع المورّدين. يصوّر الموظف فاتورة المورّد انطلاقاً من رمز يظهر على الكاشير، فتُقرأ سطورها وتُطابَق بالأصناف وتُعرض ليؤكدها إنسان قبل دخول أي شيء إلى السجل. | ١ | ٥ إلى ٦ أسابيع |
| **٥** | **التدريب** | المدربون وأوقات توفرهم وأنواع الدروس والدورات والتسجيل وتسوية العمولات. والمدربون ضيوف لهم سجل مدرب ويستخدمون وضع المدرب في تطبيق الهاتف، وليسوا حسابات موظفين. | ١، ٢ | ٤ إلى ٥ أسابيع |
| **٦** | **المباريات المفتوحة ثم البطولات** | مباريات مفتوحة بأربعة مقاعد مع تقسيم المقاعد، ثم البطولات والدوريات: أمريكانو وميكسيكانو أولاً، ثم خروج المغلوب، ثم الدوريات، مع التسجيل واحتساب النتائج والترتيب. | ١، ٢، ٥ | ٨ إلى ٩ أسابيع |

**لماذا تعدد الفروع أولاً.** لا يوجد اليوم في النظام أي مفهوم للفرع. وكل بند آخر يحتاج أن يعرف إلى
أي فرع ينتمي كل سجل. وبناء تلك البنود أولاً ثم إضافة الفروع بعدها يعني بناء كل واحد منها مرتين.

المجموع التتابعي: نحو **٣٥ إلى ٤١ أسبوع عمل**.

## ٤. ما تحتاجه كل مرحلة من تاتش

لا يبدأ العمل في أي مرحلة قبل وصول مدخلاتها. وهذه هي كل المطلوب، ويُطلب مرة واحدة.

| المرحلة | المطلوب من تاتش |
|---|---|
| **٠** | بنود إغلاق المرحلة الأولى الواردة في القسم السابع. وتأكيد شراء اشتراك النسخ الاحتياطي الزمني (القسم الثامن). |
| **١** | بيانات الفرع الثاني: الاسم بالعربية والإنجليزية، والعنوان، ورقم الهاتف، وقائمة الملاعب، وقائمة طاولات الكافيه، وساعات العمل، وقواعد التسعير الخاصة به. |
| **٢** | بنود التسجيل لدى Qi Card المذكورة في `docs/design/payments/qi-deposit-plan-2026-09-20.md` القسم ٢، وبيانات الاعتماد حين تصدرها Qi. وتحديد المجموعة الضريبية المطبَّقة على الدفع الإلكتروني. |
| **٣** | الولاء: قيمة النقطة الواحدة بالدينار العراقي، وأسماء الفئات بالعربية والإنجليزية، وحدود كل فئة، ونسبة الخصم عند كل فئة. |
| **٤** | من عشرين إلى ثلاثين فاتورة مورّد حقيقية (تكفي صور)، وقائمة المكوّنات والمورّدين، ومفتاح واجهة Anthropic باسم تاتش. وتحديد المجموعة الضريبية المطبَّقة على التجزئة. |
| **٥** | قائمة المدربين، وأنواع الدروس وأسعارها، وتأكيد كتابي لحصة المدرب البالغة ٦٠٪ بعد خصم حصة الملعب. وتحديد المجموعة الضريبية المطبَّقة على الدروس. |
| **٦** | رسوم الاشتراك وسياسة الجوائز لكل فعالية؛ وتحديد المجموعة الضريبية المطبَّقة على المقاعد والاشتراكات. وهذه البنود **مفتوحة**. تقرّرها تاتش عند بدء المرحلة السادسة. |

## ٥. الاعتماد

تُعتمد المرحلة عند تحقق هذه النقاط الأربع جميعها. وهي الصيغة نفسها المتبعة في اعتماد المرحلة
الأولى، وتنطبق على كل مرحلة.

١. **تشغيل نص اعتماد كامل من البداية إلى النهاية، بالإنجليزية وبالعربية.** يُكتب قبل العرض،
ويُشغَّل على النظام الحقيقي، وهو نفسه ما يُعرض. وتُكتب النسخة العربية مع الإنجليزية وتراجعها تاتش.

٢. **وصول تغييرات قاعدة البيانات الخاصة بالمرحلة إلى المشروع المستضاف** قبل تسليم أي نسخة من
التطبيق، مع التحقق من عدم وجود أي ترحيل معلّق.

٣. **توفير نسخة تجريبية داخلية من تطبيق الهاتف كلما غيّرت المرحلة ما يراه الضيوف** (TestFlight
للآيفون، واختبار Play الداخلي للأندرويد).

٤. **اعتماد تاتش كتابةً.** ولا يُحجب الاعتماد بسبب بنود خارج أمر التغيير هذا، ولا بسبب أمور خارجة
عن سيطرة Kagu.

## ٦. الأتعاب والمواعيد

تُستكمل من Kagu ويُتفق عليها مع تاتش قبل التوقيع. والعملة هي الدولار الأمريكي، كما في الشروط
التجارية للمرحلة الأولى.

| # | المرحلة | الأتعاب | تُستحق في | البدء | التسليم |
|---|---|---|---|---|---|
| ٠ | إغلاق المرحلة الأولى | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ١ | تعدد الفروع | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ٢ | الدفع الإلكتروني (Qi Card) | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ٣ | ملف العميل الشامل والولاء | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ٤ | المتجر وقراءة الفواتير | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ٥ | التدريب | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| ٦ | المباريات المفتوحة والبطولات | `[            ]` | `[            ]` | `[            ]` | `[            ]` |
| | **المجموع** | `[            ]` | | | |

تكاليف تشغيلية تدفعها تاتش مباشرة وليست جزءاً من أي أتعاب أعلاه: اشتراك Supabase بما فيه مستوى
النسخ الاحتياطي الزمني، ورسوم تاجر Qi Card، وحساب رسائل رموز التحقق، ومفتاح واجهة Anthropic
المستخدم في قراءة الفواتير.

## ٧. إغلاق المرحلة الأولى: شرط مسبق

لا تبدأ المرحلة الثانية على مرحلة أولى غير مقفلة. هذه البنود متأخرة من المرحلة الأولى ومطلوبة قبل
المرحلة صفر أو خلالها.

- [ ] **قواعد التسعير.** ما لم توجد، يُرفض كل حجز على ملعب حقيقي برسالة "لا يوجد سعر". وهذا أقدم
      بند مفتوح، وهو يمنع أي حجز فعلي اليوم.
- [ ] **قائمة طعام الكافيه**.
- [ ] **الوصفات والوصفات الفرعية والمكوّنات.** بدونها لا يمكن اعتماد وحدة المخزون.
- [ ] **قائمة الموظفين**: الأسماء والأدوار الحقيقية، لتُحذف حسابات التطوير التجريبية.
- [ ] **ترقيم أرضية الصالة**: المناطق والمقاعد وأرقام الطاولات، لتتم طباعة بطاقات رمز الاستجابة
      السريعة.
- [ ] **طراز الطابعة** مؤكَّداً، لإجراء اختبار طباعة فعلي في الموقع.
- [ ] **ملفات الهوية البصرية**: الشعار الرسمي لتاتش كافيه، وتوضيح أي خط هو خط الهوية ومن يملك
      رخصته.
- [ ] **رقم هاتف الفرع** مؤكَّداً. الرقم المُعطى يُقرأ كرقم جورجي لا عراقي، وهو الرقم الظاهر
      للضيوف.

## ٨. النسخ الاحتياطي والبيئات

قراران مترابطان اتُّخذا في ٢٠٢٦-٠٩-٢٠، ويُوثَّقان هنا لأنهما يغيّران ما اتُّفق عليه في المرحلة
الأولى.

- **شراء الاستعادة الزمنية (PITR).** نص نطاق العمل على نسخ احتياطي يومي آلي مع استعادة زمنية. وفي
  ٢٠٢٦-٠٨-٣٠ رُفضت الاستعادة الزمنية لاعتبارات الكلفة. وقد **عُكس** هذا القرار: تشتري تاتش مستوى
  الاستعادة الزمنية على مشروع الإنتاج. وإلى أن يُشترى، يبقى أسوأ احتمال هو فقدان بيانات يوم واحد.
- **إنشاء مشروع تجريبي (staging)** من آخر نسخة احتياطية، **قبل دفعة تعدد الفروع**. ويُجرَّب كل
  تغيير في قاعدة البيانات عليه قبل أن يمسّ النظام الحي. وهذا يغلق أيضاً بند "بيئتا التجريب
  والإنتاج" الوارد في نطاق العمل ولم تسلّمه المرحلة الأولى.

## ٩. التوقيع

بالتوقيع، تعتمد تاتش بادل النطاق وترتيب المراحل وصيغة الاعتماد والأتعاب الواردة في القسم السادس،
وتوافق على أن العمل في كل مرحلة يبدأ عند اكتمال مدخلات تلك المرحلة.

| | تاتش بادل | Kagu Web Studio |
|---|---|---|
| الاسم | `[                              ]` | پارسا منصوري |
| التوقيع | `[                              ]` | `[                              ]` |
| التاريخ | `[                              ]` | `[                              ]` |

</div>
