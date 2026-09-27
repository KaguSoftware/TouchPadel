# App Store listing — Touch Padel (iOS)

Everything that gets **typed** into App Store Connect, in both listing languages.
Everything that gets **answered** (privacy labels, age rating, review notes) is
in `app-store-submission.md`. The browser agent that types both into App Store
Connect is `docs/client/app-store-connect-chrome-prompt.md`. Screenshots are generated —
`apps/mobile/store/README.md`.

- **Bundle ID:** `com.kagu.touchpadel`
- **Primary language:** English (U.S.)
- **Second localization:** Arabic — required, because `CFBundleLocalizations`
  ships `['en','ar']` and the app is fully RTL. A listing without it shows Iraqi
  users an English-only page for an app that is half Arabic.
- **SKU:** `touch-padel-ios`

Character counts below are **actual, measured** (`pnpm store:copy-check`), not
estimates. Apple truncates silently at the limit; nothing here is close enough
to the edge to be at risk.

---

## 1 · English (U.S.)

### App Name — 11 / 30

```
Touch Padel
```

The venue's name, nothing appended. This is a single-venue app: nobody finds it
by searching "padel booking", they find it because Touch told them to. Keyword
padding in the name buys nothing here and reads as spam.

### Subtitle — 29 / 30

```
Book a padel court in seconds
```

### Promotional Text — 110 / 170

```
Courts are live in the app. Pick a day, pick a time, and your slot is held while you confirm. Pay at the desk.
```

Promotional text can be changed **without a new review** — it is the only field
that can. Use it for "Ramadan hours", "new third court", "closed for
maintenance"; never put anything in it the app depends on.

### Description — 1,244 / 4,000

```
Touch Padel is the booking app for Touch Padel, Iraq.

See which courts are free, reserve the time you want, and turn up. That is the whole app.

BOOK IN SECONDS
Open the app, pick a day, and every slot for that day is there with its price. Tap the one you want. Your slot is held while you check the details, so nobody takes it out from under you while you decide.

PAY AT THE DESK
There is no online payment in this app and no card details are ever asked for. You reserve the court here and settle at reception when you arrive.

YOUR RESERVATIONS, IN ONE PLACE
Upcoming games, games you have played, and anything that was cancelled — each in its own list, with the booking reference the desk asks for.

FREE CANCELLATION
Cancel in the app up to the venue's cancellation window. Inside that window the front desk can still help.

REMINDERS THAT MATTER
A confirmation when you book, a reminder before your slot, and a notice if anything changes. Nothing else.

ARABIC AND ENGLISH
The whole app is built in both, right-to-left included — not a translation layer bolted onto an English app. Switch language any time in Settings.

Touch Padel is for booking padel courts at Touch Padel only. It is not a marketplace and does not list other venues.
```

### Keywords — 97 / 100

```
padel,court,booking,reserve,slot,club,racket,sport,tennis,baghdad,iraq,venue,game,match,play,time
```

Rules Apple enforces and people forget: comma-separated with **no spaces after
the commas** (a space costs you a character), never repeat a word already in the
app name or subtitle (they are indexed anyway), singular only — Apple stems
plurals for you.

### What's New — first submission

```
First release.

Book a padel court at Touch Padel: live availability, your slot held while you confirm, free cancellation inside the venue's window, and reminders before you play. Arabic and English throughout.
```

### URLs

| Field | Value |
|---|---|
| Support URL | `https://www.touch-padel.com/en/support` |
| Marketing URL | *leave empty* |
| Privacy Policy URL | `https://www.touch-padel.com/en/privacy` (App Information, per localization) |

Both pages live in `apps/web/app/[locale]/{privacy,support}` and read the venue phone and hours from
`venue_settings_public`, so they never go stale against the desk's settings. Marketing URL is optional; the only
other public page is the cafe menu, which the app does not contain (see §3), so it stays empty.

The domain is live (2026-09-23), so these are the final URLs. The same folder also holds `terms` and
`delete-account`.

**Terms of Service / EULA.** Keep Apple's **standard EULA** (App Information → License Agreement: leave the default).
Our own Terms of Service are at `https://www.touch-padel.com/en/terms` (AR `/ar/terms`). Every account accepts them
in the app, through the sign-up switch or the consent screen (migration 0153). App Store Connect has no Terms URL
field, so link them from the end of the description if they should be visible in the listing.

### Copyright

```
2026 Touch Padel
```

The venue, not Kagu. Kagu built it; Touch owns it.

---

## 2 · Arabic

Arabic listing copy is **not** a translation of the English — it is the same
claims written natively. The app's own Arabic (`packages/i18n/src/catalogs/ar.ts`)
is the register to match.

### App Name — 8 / 30

```
تتش بادل
```

Transliterated, not translated: it is a venue name and the venue writes it this
way. The Latin form stays available through the English listing.

### Subtitle — 25 / 30

```
احجز ملعب بادل خلال ثوانٍ
```

### Promotional Text — 102 / 170

```
الملاعب متاحة مباشرة في التطبيق. اختر اليوم والوقت، ويُحجز لك الوقت ريثما تؤكّد. والدفع عند الاستقبال.
```

### Description — 1,002 / 4,000

```
تطبيق تتش بادل لحجز ملاعب البادل في تتش بادل، العراق.

اعرف أي الملاعب متاحة، احجز الوقت الذي يناسبك، واحضر. هذا كل ما يفعله التطبيق.

احجز خلال ثوانٍ
افتح التطبيق، اختر اليوم، وستجد كل الأوقات المتاحة مع أسعارها. اضغط الوقت الذي تريده. يُحجز لك الوقت ريثما تراجع التفاصيل، فلا يأخذه أحد أثناء ذلك.

الدفع عند الاستقبال
لا يوجد دفع إلكتروني في هذا التطبيق ولا تُطلب بيانات أي بطاقة. تحجز الملعب هنا وتدفع في الاستقبال عند وصولك.

حجوزاتك في مكان واحد
المباريات القادمة، والمباريات التي لعبتها، وما أُلغي — كل منها في قائمته، مع رقم الحجز الذي يطلبه الاستقبال.

إلغاء مجاني
ألغِ من التطبيق ضمن مدة الإلغاء المجاني التي يحددها المكان. بعد ذلك يساعدك الاستقبال.

تذكيرات مفيدة فقط
تأكيد عند الحجز، وتذكير قبل موعدك، وتنبيه إذا تغيّر شيء. لا شيء غير ذلك.

بالعربية والإنجليزية
التطبيق مبني باللغتين بالكامل، بما في ذلك الاتجاه من اليمين إلى اليسار — وليس ترجمة أُضيفت إلى تطبيق إنجليزي. غيّر اللغة متى شئت من الإعدادات.

تتش بادل مخصص لحجز ملاعب البادل في تتش بادل فقط. ليس منصة تجمع أماكن أخرى ولا يعرضها.
```

### Keywords — 85 / 100

```
بادل,ملعب,حجز,ملاعب,رياضة,تنس,نادي,مباراة,لعب,بغداد,العراق,موعد,وقت,تمرين,أصدقاء,دوري
```

Arabic keywords are indexed separately from the English ones — a user searching
in Arabic never sees the English field. Do not transliterate the English list
into Arabic script; use the words Iraqi players actually type.

### What's New — first submission

```
الإصدار الأول.

احجز ملعب بادل في تتش بادل: الأوقات المتاحة مباشرة، ويُحجز لك الوقت ريثما تؤكّد، وإلغاء مجاني ضمن مدة المكان، وتذكيرات قبل موعدك. بالعربية والإنجليزية بالكامل.
```

### URLs (Arabic)

| Field | Value |
|---|---|
| Support URL | `https://www.touch-padel.com/ar/support` |
| Marketing URL | *leave empty* |
| Privacy Policy URL | `https://www.touch-padel.com/ar/privacy` |

---

## 3 · What NOT to say

The listing is reviewed against the binary. Every one of these has caused a
metadata rejection on apps like this one:

- **No cafe, menu, ordering or QR anything.** The cafe lives on the website. The
  submitted app is padel booking only, and a description promising food ordering
  gets rejected against a binary that cannot do it.
- **No prices in the description.** Court rates are venue config, they change,
  and a listing change needs a review. The app shows live prices; the listing
  says "with its price".
- **No "payment", "pay online", "checkout"** as a capability. The app takes no
  money. Saying it does invites both a rejection and an IAP interrogation.
- **No other venues, no city-wide claims.** One venue. Saying otherwise makes it
  a marketplace, which is a different review conversation entirely.
- **No unreleased features** — no leagues, no ranking, no matchmaking, no cafe
  ordering, however certain they feel for phase 2.
