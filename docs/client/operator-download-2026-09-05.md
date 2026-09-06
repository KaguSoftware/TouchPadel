# Operator desktop app — making it downloadable (owner checklist, 2026-09-05)

Everything in the code is done: a tag push builds the Windows installer, signs
it if a certificate exists, publishes it to a public download page, and the
installed app updates itself. What remains is account work only the owner can
do. Steps 1–3 are required for the first release; 4 and 5 can come later and
take effect on the next tag push without any code change.

## 1. Create the public releases repo (5 min)

- On GitHub, under the `KaguSoftware` organisation, create a **public** repo
  named exactly `touchpadel-releases`. Tick "Add a README" — the repo must have
  at least one commit before the first release can be created against it.
- Nothing else goes in it. Releases (installer, update feed) are created by
  the workflow; humans never push to it.

Why public: the source repo is private, and GitHub does not serve release
files from a private repo without a login. The download link on the staff
page must work from any venue PC.

## 2. Create the publishing token (5 min)

GitHub → your profile → Settings → Developer settings → Personal access tokens
→ **Fine-grained tokens** → Generate:

- Resource owner: `KaguSoftware`. Repository access: **only** `touchpadel-releases`.
- Permissions → Repository → **Contents: Read and write**. Nothing else.
- Expiry: 1 year (put a reminder in the calendar; a release run fails loudly
  with "RELEASES_GH_TOKEN missing"/401 when it lapses).

If the org disallows fine-grained tokens, a classic token with only the
`public_repo` scope works.

## 3. Add the secrets to the source repo (5 min)

`KaguSoftware/TouchPadel` → Settings → Secrets and variables → Actions.

| Name | Kind | Value | Required |
|---|---|---|---|
| `OPERATOR_SUPABASE_URL` | secret | hosted project URL (Supabase → Project Settings → API) | yes |
| `OPERATOR_SUPABASE_ANON_KEY` | secret | the anon / publishable key from the same page | yes |
| `OPERATOR_GUEST_SITE_URL` | secret | guest site origin, no trailing slash (e.g. `https://touch-padel-web.vercel.app`) | yes |
| `RELEASES_GH_TOKEN` | secret | the token from step 2 | yes |

The release workflow refuses to build without the first two (the app would
crash at startup) or without the token (nothing could be published).

**Then cut the first release:**

```
git tag operator-v0.2.0
git push origin operator-v0.2.0
```

Watch Actions → `operator-release`. When it is green, the release appears at
`https://github.com/KaguSoftware/touchpadel-releases/releases` with
`Touch-Padel-Operator-Setup.exe`, `latest.yml` and a `.blockmap`, and the
staff page `https://<guest-site>/download` serves it. Until step 4 is done,
Windows shows the SmartScreen "More info → Run anyway" prompt once per machine.

To re-cut the **same** version (rare), delete both the release and its tag in
`touchpadel-releases` first; otherwise bump the version.

## 4. Code signing (removes the SmartScreen prompt) — pick one route

Both routes are already wired. Add the secrets and the next tag push signs.

### Route A — Azure Trusted Signing (recommended)

Roughly US$10/month; no hardware token; SmartScreen trusts it quickly.

1. An Azure subscription (any; pay-as-you-go is fine).
2. Create a **Trusted Signing account** (Basic tier). Complete **identity
   validation** for the organisation — Microsoft asks for the company's legal
   registration documents; allow several days. (Individual validation is also
   offered if the company route is blocked.)
3. In the account, create a **certificate profile** of type *Public Trust*.
4. In Microsoft Entra, create an **app registration** with a client secret,
   and give that app the *Trusted Signing Certificate Profile Signer* role on
   the Trusted Signing account.
5. Add to the source repo:

| Name | Kind | Value |
|---|---|---|
| `AZURE_TENANT_ID` | secret | Entra tenant id |
| `AZURE_CLIENT_ID` | secret | the app registration's client id |
| `AZURE_CLIENT_SECRET` | secret | its client secret |
| `AZURE_CODE_SIGNING_ENDPOINT` | **variable** | the account's endpoint URL, e.g. `https://weu.codesigning.azure.net` |
| `AZURE_CODE_SIGNING_ACCOUNT_NAME` | **variable** | the Trusted Signing account name |
| `AZURE_CERTIFICATE_PROFILE_NAME` | **variable** | the certificate profile name |
| `WIN_SIGN_PUBLISHER_NAME` | **variable** | the certificate's exact CN (e.g. `Kagu Software Ltd`), so installed apps verify updates |

### Route B — a certificate file (OV/EV from a certificate authority)

Roughly US$200–500/year. Since 2023 most CAs deliver on a USB token, which a
build server cannot use; ask for a **cloud-HSM or exportable .pfx** OV
certificate. OV builds SmartScreen reputation over weeks; EV is trusted at once.

1. Buy the certificate; complete the CA's organisation validation.
2. Export as `.pfx` with a password, then base64 it:
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard` (PowerShell).
3. Add `WIN_CSC_LINK` (secret, the base64 text) and `WIN_CSC_KEY_PASSWORD` (secret).

When either route is configured, ask the developer to flip
`SHOW_SMARTSCREEN_NOTE` on the download page.

## 5. macOS (optional; only if a Mac will ever run the operator app)

The mac build is scaffolded and runs only when all five secrets below exist.
An unsigned mac app cannot be opened on current macOS and cannot update
itself, so there is no unsigned interim like on Windows.

1. **Apple Developer Program**, US$99/year. An organisation account needs a
   D-U-N-S number and Apple's approval takes one to two weeks.
2. In the developer account, create a **Developer ID Application**
   certificate; install it in Keychain on any Mac; export it as a `.p12` with a
   password; base64 it (`base64 -i cert.p12 | pbcopy`).
3. Create an **app-specific password** for the Apple ID
   (appleid.apple.com → Sign-In and Security → App-Specific Passwords).
4. Note the **Team ID** (developer.apple.com → Membership).
5. Add to the source repo:

| Name | Kind |
|---|---|
| `MAC_CSC_LINK` | secret (the base64 .p12) |
| `MAC_CSC_KEY_PASSWORD` | secret |
| `APPLE_ID` | secret (the Apple ID email) |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret |
| `APPLE_TEAM_ID` | secret |

The next tag push then also publishes `Touch-Padel-Operator-arm64.dmg`
(Apple silicon) and `Touch-Padel-Operator-x64.dmg` (Intel), signed and
notarized, plus the zip files the mac updater uses. The download page's
"Mac downloads" button already points at the releases page.

## 6. Swapping the placeholder app icon

The installer currently carries a placeholder (the padel ball on a Touch Blue
tile). To use the official mark: replace
`apps/operator-shell/assets/icon.png` with a 1024×1024 PNG (or replace
`assets/icon.svg` and run `pnpm --filter @touch/operator-shell icon`), commit,
and tag the next release. Windows `.ico` and macOS `.icns` are derived
automatically.
