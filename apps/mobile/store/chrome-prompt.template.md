# Claude-in-Chrome prompt — App Store Connect, Touch Padel iOS 1.0.0

Generated from `docs/store/app-store-listing.md` and `docs/store/app-store-submission.md` (character counts
verified by `pnpm --filter @touch/mobile store:copy-check`). If those docs change, regenerate. Don't hand-edit the
copy below.

**Before pasting this, have ready:** the review account's phone and password (from
`node scripts/create-review-account.mjs`), a processed build ≥ 9 (or accept that task 6.4 will be BLOCKED), and
the screenshot PNGs rendered in `apps/mobile/store/out/iphone-6.9/`.

Copy everything below the line into Claude in Chrome.

---

You are preparing the **Touch Padel** iOS app for App Store review in App Store Connect, and doing two small
related settings in the Apple Developer portal and Supabase. Touch Padel is a court-booking app for one padel venue
in Iraq. Work through the tasks in order, in the browser.

## Ground rules

- **Never click "Add for Review", "Submit for Review", "Submit to App Review" or "Release".** The job ends with
  everything saved and the version ready to submit. I press the button myself.
- **Never invent a value.** Every text you enter is given below. Paste it exactly (including line breaks), and
  don't reword, translate, trim or "improve" it. If a field isn't covered here, stop and ask me.
- If a page needs a login, 2FA code, password, payment, or legal agreement acceptance: **stop, tell me exactly
  what you need, and wait.**
- **Don't download, view, copy or paste any private key.** Where a task says a key is created, I download it.
- Don't delete or change anything not named in a task (other apps, users, certificates, identifiers, builds).
- Don't cancel, expire or delete any build.
- After filling each page, click **Save** (top right) and confirm the save took (no red error banner) before
  moving on.
- Keep a running log. At the very end output ONE report in exactly this shape:

  ```
  ## COLLECTED
  NAME = value            (one per line)

  ## DONE IN-BROWSER
  - <each setting you changed>

  ## BLOCKED
  - <task> — <what stopped you and what you need from me>

  ## REMAINING WARNINGS
  - <every warning/red text App Store Connect still shows on the version page, verbatim>
  ```

The app: App Store Connect app id **6809045183**, bundle id **com.kagu.touchpadel**, team **BR42V976FS**.
Direct link: https://appstoreconnect.apple.com/apps/6809045183/distribution/ios/version/inflight

---

## Task 1 — Supabase: remove the Expo Go client id from Sign in with Apple

1. Go to https://supabase.com/dashboard/project/lczijabnorujcgmbuqlw/auth/providers
2. Open the **Apple** provider.
3. In **Client IDs** (a comma-separated list), if `host.exp.Exponent` is present, remove only that entry. Keep
   `com.kagu.touchpadel` and every other entry exactly as they are. Save.
4. Report the Client IDs value before and after. If `host.exp.Exponent` wasn't there, change nothing and
   say so.

## Task 2 — Apple Developer: Sign in with Apple key (for account-deletion token revocation)

1. Go to https://developer.apple.com/account/resources/authkeys/list (team BR42V976FS).
2. If a key named `Touch Padel SIWA Revoke` already exists, don't create another. Record its Key ID and skip to
   step 6.
3. Click **+** (Create a key). Key name: `Touch Padel SIWA Revoke`.
4. Tick **Sign in with Apple** → **Configure** → Primary App ID: the one with bundle id `com.kagu.touchpadel`
   → Save.
5. Continue → Register.
6. **STOP on the "Download Your Key" page. Do not click Download.** Record the **Key ID** (10 characters) as
   `APPLE_KEY_ID`, then tell me: "Key created. Download it now, it can only be downloaded once." Wait for me to
   say I've downloaded it before continuing.

## Task 3 — App Information

Open https://appstoreconnect.apple.com/apps/6809045183/distribution/info (left sidebar: **General → App
Information**).

### 3.1 English (U.S.) localization
The language picker is at the top right of the page. Make sure **English (U.S.)** is selected, and that it is
the Primary Language.

- **Name:**
  ```
  {{EN:App Name}}
  ```
  If Apple says the name is taken, stop and tell me. Don't try variants.
- **Subtitle:**
  ```
  {{EN:Subtitle}}
  ```
- **Privacy Policy URL:** `https://touch-padel-web.vercel.app/en/privacy`
- **Privacy Choices URL:** leave empty.

### 3.2 Add the Arabic localization
In the language picker choose **Add Language → Arabic**, then with Arabic selected:

- **Name:**
  ```
  {{AR:App Name}}
  ```
- **Subtitle:**
  ```
  {{AR:Subtitle}}
  ```
- **Privacy Policy URL:** `https://touch-padel-web.vercel.app/ar/privacy`

### 3.3 General information (language-independent)
- **Category:** Primary **Sports**, Secondary **Health & Fitness**.
- **Content Rights:** "No, it does not contain, show, or access third-party content."
- **Age Rating → Edit:** answer **None** or **No** to every question: all violence questions, profanity or crude
  humour, mature/suggestive themes, horror/fear, medical or treatment information, health or wellness topics,
  alcohol/tobacco/drug use, sexual content or nudity, simulated gambling, real gambling, contests, loot boxes,
  **unrestricted web access: No**, **user-generated content: No**, **messaging and chat: No**,
  **advertising: No**, parental controls: No, age assurance: No. Not "Made for Kids". The result must be **4+**.
  If it comes out higher, stop and report which answer caused it.
- **Regulated Medical Device** declaration (EU/EEA, UK, US): the app is **not** a regulated medical device.
- **App Store Regulations & Permits → Digital Services Act (trader status):** if it already shows a status,
  leave it. If it asks for one, **stop and ask me.** It publishes a name, address, phone and email on EU
  storefronts, and I decide whose.
- Save.

## Task 4 — Pricing and Availability

Left sidebar: **Pricing and Availability**.

1. **Price:** Free (USD 0.00, Tier 0). If a price is already set to free, leave it.
2. **Availability:** all countries or regions available, including future new countries or regions if offered.
3. Leave pre-orders off. Don't change tax category.
4. Save.

## Task 5 — App Privacy

Left sidebar: **App Privacy**.

1. **Privacy Policy URL** (if asked here): `https://touch-padel-web.vercel.app/en/privacy`
2. **Data Collection → Get Started / Edit.** "Do you or your third-party partners collect data from this app?"
   → **Yes, we collect data from this app.**
3. Tick exactly these data types and nothing else:
   - Contact Info → **Name**, **Email Address**, **Phone Number**
   - Identifiers → **User ID**
   - Other Data → **Other Data Types**
4. For **each** of those five, answer:
   - Purposes: **App Functionality** only.
   - Linked to the user's identity: **Yes**.
   - Used for tracking: **No**.
5. Every other data type stays unticked. In particular NOT: Location, Contacts, Photos, Health, Financial Info,
   Payment Info, Purchases, Browsing/Search History, Sensitive Info, Usage Data, Diagnostics, Device ID,
   Advertising Data.
6. Save, then **Publish** the privacy answers. Publishing privacy answers is allowed; it is not submitting the app.
7. In the report, list the final label as App Store Connect shows it ("Data Linked to You: …", "Data Used to
   Track You: none").

## Task 6 — The version page (1.0.0, "Prepare for Submission")

Open https://appstoreconnect.apple.com/apps/6809045183/distribution/ios/version/inflight

### 6.1 Version string
If the version shown is not `1.0.0` (e.g. it says `1.0`), change it to `1.0.0` and save. The build's version is
1.0.0 and must match.

### 6.2 English (U.S.) — select it in the language picker

**Screenshots — iPhone 6.9" Display.** Upload these six files **in this order** (1 first). Use the "Choose File"
button or drop zone:
```
{{SHOTS:en}}
```
If you can't operate the file picker or drop zone, **stop and ask me** to drag the six files in myself. Tell me
the exact folder, and continue once I confirm. Don't upload anything to the iPad or other device slots. The app is
iPhone-only, and 6.9" is scaled down for smaller iPhones automatically. If a 6.5" slot is shown as required, stop
and tell me. After uploading, check the order matches 1→6. Drag to reorder if not.

**Promotional Text:**
```
{{EN:Promotional Text}}
```

**Description:**
```
{{EN:Description}}
```

**Keywords** (exactly as written, no spaces after commas):
```
{{EN:Keywords}}
```

**Support URL:** `https://touch-padel-web.vercel.app/en/support`
**Marketing URL:** leave empty.

**What's New in This Version:** if the field is shown (it usually isn't on a first version), use:
```
{{EN:What's New}}
```

Save.

### 6.3 Arabic — switch the language picker to Arabic

**Screenshots — iPhone 6.9" Display**, in this order:
```
{{SHOTS:ar}}
```
Same file-picker rule as above.

**Promotional Text:**
```
{{AR:Promotional Text}}
```

**Description:**
```
{{AR:Description}}
```

**Keywords:**
```
{{AR:Keywords}}
```

**Support URL:** `https://touch-padel-web.vercel.app/ar/support`
**Marketing URL:** leave empty.

**What's New** (only if shown):
```
{{AR:What's New}}
```

Save.

### 6.4 Build
In the **Build** section click **Add Build** (or the + next to it) and select the **newest** build whose version is
**1.0.0**. Record its build number as `BUILD_NUMBER`.
- If no build is listed, or it says "Processing", mark this BLOCKED and continue with the rest. Don't wait more
  than a couple of minutes.
- If it asks about encryption / export compliance: "None of the algorithms mentioned above", i.e. the app only
  uses standard HTTPS/TLS encryption exempt under the regulations. No documentation required.

### 6.5 General App Information (on the version page)
- **Copyright:**
  ```
  {{EN:Copyright}}
  ```
- **Routing App Coverage File:** none.
- Leave Game Center off.

### 6.6 App Review Information
- **Sign-in required:** ticked.
- **User name** and **Password:** **ask me for both now.** I'll paste them from a script's output. Don't reuse
  any value from elsewhere on the page.
- **Contact Information** (first name, last name, phone, email): if already filled, keep it and report what it
  shows. If empty, ask me.
- **Notes:**
  ```
{{REVIEW_NOTES}}
  ```
- **Attachment:** none.

### 6.7 Version Release
**Manually release this version.**

### 6.8 Save
Save, then scroll the whole page top to bottom in both English and Arabic and record every warning, red message or
empty required field in the report under REMAINING WARNINGS.

## Task 7 — Stop

**Don't click "Add for Review".** Output the report in the format from Ground rules. Put these in COLLECTED:
`APPLE_KEY_ID`, `BUILD_NUMBER` (or BLOCKED), `AGE_RATING`, `SUPABASE_APPLE_CLIENT_IDS_AFTER`, `DSA_STATUS`.
