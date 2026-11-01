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
- **Version:** **1.1.0** (`apps/mobile/app.config.ts`), the first version submitted to the store.
- **What this build does (2026-11-01, F-02/F-03):** court booking, open matches, lessons with the club's
  coaches, tournaments, the Club tab (member card with points and rewards, the Ranks leaderboard, the café
  menu to look at), My Bookings and Profile. **No online payment and no tickets**: the production profile in
  `apps/mobile/eas.json` sets `EXPO_PUBLIC_ONLINE_PAYMENTS` to "off", and `EXPO_PUBLIC_TOURNAMENTS` stays "on".
  Open matches are on: since 0370 each player pays their seat at the front desk, and with online payment off
  the app never asks for a ticket (`useMatchPayAtDesk`). Everything is paid at the front desk. The listing, the review notes
  (`app-store-submission.md` §5) and the binary must say the same thing; change all three together.

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

### Description — 1,873 / 4,000

```
Touch Padel is the app for Touch Padel, Iraq: book a court, join an open match, book a lesson, enter a tournament and keep your club card in your pocket.

BOOK IN SECONDS
Open the app, pick a day, and every slot for that day is there with its price. Tap the one you want. Your slot is held while you check the details, so nobody takes it out from under you while you decide.

OPEN MATCHES
Start a game at any free time, or join one. Four players book the court together, and each pays their share at the desk.

PAY AT THE CLUB
There is no online payment in this app and no card details are ever asked for. Courts, match seats, lessons and tournament entries are all paid at the front desk when you arrive.

LESSONS WITH OUR COACHES
See the club's coaches, the lessons they teach and the sessions that still have places, and book yours.

TOURNAMENTS
See what is coming up, enter, join the waiting list or withdraw, and follow the schedule and the standings.

YOUR CLUB CARD
Show your member card at the till to collect points and use your rewards. See where you stand on the club's leaderboard, and look through the café menu before you come.

YOUR BOOKINGS, IN ONE PLACE
Upcoming games, open matches, lessons and tournament entries, games you have played, and anything that was cancelled, each in its own list, with the booking reference the desk asks for.

FREE CANCELLATION
Cancel in the app up to the venue's cancellation window. Inside that window the front desk can still help.

REMINDERS THAT MATTER
A confirmation when you book, a reminder before your slot, and a notice if anything changes. Nothing else.

ARABIC AND ENGLISH
The whole app is built in both, right-to-left included — not a translation layer bolted onto an English app. Switch language any time in Settings.

Touch Padel is for Touch Padel only. It is not a marketplace and does not list other venues.
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

Book a padel court at Touch Padel: live availability, your slot held while you confirm, free cancellation inside the venue's window, and reminders before you play. Start or join open matches, book lessons with the club's coaches, enter tournaments, and carry your member card for points and rewards. Everything is paid at the front desk. Arabic and English throughout.
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

### Promotional Text — 112 / 170

```
مواعيد الملاعب محدّثة لحظيًا في التطبيق. اختر اليوم والموعد، ويبقى محجوزًا لك إلى أن تؤكّد. الدفع عند الاستقبال.
```

### Description — 1,650 / 4,000

```
تطبيق تتش بادل لنادي تتش بادل في العراق: احجز ملعبًا، وانضم إلى مباراة مفتوحة، واحجز حصة تدريبية، وشارك في بطولة، واحمل بطاقة النادي في جيبك.

احجز خلال ثوانٍ
افتح التطبيق واختر اليوم، وستجد كل مواعيد ذلك اليوم مع أسعارها. اضغط على الموعد الذي تريده، وسيبقى محجوزًا لك أثناء مراجعة التفاصيل، فلا يسبقك إليه أحد وأنت تقرّر.

المباريات المفتوحة
ابدأ مباراة في أي وقت متاح أو انضم إلى واحدة. يحجز أربعة لاعبين الملعب معًا، ويدفع كلٌّ حصته عند الاستقبال.

الدفع في النادي
لا يوجد دفع إلكتروني في هذا التطبيق، ولا تُطلب منك بيانات أي بطاقة أبدًا. تدفع ثمن الملاعب ومقاعد المباريات والحصص ورسوم البطولات كلها في الاستقبال عند وصولك.

حصص مع مدربينا
تعرّف على مدربي النادي والحصص التي يقدّمونها والمواعيد التي ما زالت فيها أماكن، واحجز مكانك.

البطولات
اطّلع على البطولات القادمة، وسجّل فيها أو انضم إلى قائمة الانتظار أو انسحب، وتابع الجدول والترتيب.

بطاقة النادي
اعرض بطاقة العضوية عند الصندوق لتجمع النقاط وتستخدم مكافآتك. واعرف موقعك في ترتيب لاعبي النادي، وتصفّح منيو الكافيه قبل أن تأتي.

حجوزاتك في مكان واحد
المباريات القادمة والمباريات المفتوحة والحصص والبطولات التي سجّلت فيها، والمباريات التي لعبتها، وما أُلغي من حجوزات: كلٌّ منها في قائمة مستقلة، مع رقم الحجز الذي يطلبه الاستقبال.

إلغاء مجاني
ألغِ الحجز من التطبيق مجانًا خلال مهلة الإلغاء التي يحددها المكان. وبعد انتهائها يظل بإمكان الاستقبال مساعدتك.

تذكيرات مفيدة فقط
تأكيد عند الحجز، وتذكير قبل موعدك، وتنبيه إذا تغيّر شيء. لا شيء غير ذلك.

بالعربية والإنجليزية
صُمّم التطبيق كله باللغتين، بما في ذلك الاتجاه من اليمين إلى اليسار، وليس ترجمة أُضيفت إلى تطبيق إنجليزي. غيّر اللغة متى شئت من الإعدادات.

تتش بادل مخصص لنادي تتش بادل فقط. وهو ليس منصة تجمع عدة أماكن، ولا يعرض أماكن أخرى.
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

احجز ملعب بادل في تتش بادل: عرض مباشر للأوقات المتاحة، وحجز مؤقت للموعد إلى أن تؤكّد، وإلغاء مجاني خلال مهلة الإلغاء التي يحددها المكان، وتذكيرات قبل موعدك. ابدأ مباراة مفتوحة أو انضم إليها، واحجز حصصًا مع مدربي النادي، وشارك في البطولات، واحمل بطاقة العضوية لتجمع النقاط والمكافآت. الدفع كله في الاستقبال. بالعربية والإنجليزية في كل شاشة.
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

- **No café ordering and no QR anything.** The app shows the café menu to look at,
  in the Club tab, and nothing is ordered from it (`apps/mobile/app/cafe-menu.tsx`). Say "look
  through the café menu", never "order", "basket" or "scan to order": ordering lives on the website,
  and a description promising it gets rejected against a binary that cannot do it.
- **No prices in the description.** Court rates are venue config, they change,
  and a listing change needs a review. The app shows live prices; the listing
  says "with its price".
- **No online payment in this version (F-02/F-03, Majed 2026-11-01).** Say "paid at the front desk" or
  "pay at the club", and nothing else about payment. Never Qi Card, deposits, tickets, "in-app purchase",
  "top-up", "credit" or "checkout". Open match seats are paid at the desk too (0370); this build has no
  ticket wallet. When a later reviewed build turns online payment on, the line becomes: online payment is
  Qi Card, for court deposits, lessons and open-match tickets, for a service used at the venue (3.1.3(e));
  the listing, the review notes and §1 of `app-store-submission.md` change in the same release.
- **No other venues, no city-wide claims.** One venue. Saying otherwise makes it
  a marketplace, which is a different review conversation entirely.
- **No unreleased features** — no leagues, no **level-based** matchmaking (OM-16), no café ordering,
  however certain they feel for phase 2. Open matches, the Ranks leaderboard and tournaments ship in 1.1.0
  and may be named.
- **Open matches, the line both descriptions carry** (EN and AR, **DRAFT-AR**; store marketing copy, where
  the imperative is the listing's register). "Each pays their share at the desk" is exact: no seat is paid
  in the app in this build.

  ```
  Open matches: start a game at any free time, or join one. Four players book the court together, and each pays their share at the desk.
  ```

  ```
  المباريات المفتوحة: ابدأ مباراة في أي وقت متاح أو انضم إلى واحدة. يحجز أربعة لاعبين الملعب معًا، ويدفع كلٌّ حصته عند الاستقبال.
  ```
