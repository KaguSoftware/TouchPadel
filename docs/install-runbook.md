# Operator desktop — install runbook (Windows)

The operator app installs on Touch's three machines: the **till** (REG/TILL),
the **desk** machine, and the **kitchen screen** (KDS). One installer, three
station roles — the role is chosen on the machine's first launch and lives in
`station.json`, not in the build.

## 1. Get the installer

- **Staff download page:** `https://<guest-site>/download` (e.g.
  `https://touch-padel-web.vercel.app/download`, later `https://touch-padel.com/download`).
  The Windows button is a stable link that always serves the newest release:
  `https://github.com/KaguSoftware/touchpadel-releases/releases/latest/download/Touch-Padel-Operator-Setup.exe`
- **Installing:** the installer is the assisted kind (`oneClick: false`), not
  one click: a welcome page, then **Choose Installation Options**. Run it from
  the Windows account the station logs in with and pick **Only for me**, never
  **Anyone who uses this computer (all users)**: an all-users install cannot
  update itself at start (§6). Keep the default folder; the last page starts
  the app.
- **All versions:** `https://github.com/KaguSoftware/touchpadel-releases/releases`
  (public repo; also the auto-update feed). To roll back, install an older
  `Touch-Padel-Operator-Setup.exe` from there. It replaces the installed
  version in place; §6 says what the station does after a rollback.
- **Cutting a release** = pushing a tag on this repo: `git tag operator-vX.Y.Z && git push origin operator-vX.Y.Z`.
  The `operator-release` workflow stamps X.Y.Z into the installer, the sidebar
  version line and `device_heartbeats.app_version`, and publishes to the public
  repo. Owner-side prerequisites (secrets, the public repo, signing) are in
  `docs/client/operator-download-2026-09-05.md`.
- **Local build** (no publishing): `pnpm --filter @touch/operator-shell dist`
  with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GUEST_SITE_URL` set
  in the operator build's environment first — a build without them **crashes at
  startup by design** rather than silently pointing at localhost. Output:
  `apps/operator-shell/release/`. Note `apps/operator/.env` on a dev machine
  points the guest site at localhost; do not hand a local build to the venue.

## 2. SmartScreen (until the build is signed)

Windows signing is wired but conditional on a certificate the owner has not
sourced yet (`docs/client/operator-download-2026-09-05.md` §4). Until then, on
first launch Windows shows "Windows protected your PC" — click **More info →
Run anyway**. Once a signing route is configured the warning stops on the next
release; then flip `SHOW_SMARTSCREEN_NOTE` on the download page to `false`.

## 3. Station identity (per machine, once)

The installer launches the app when it finishes. With no `station.json` yet,
the app opens the **station setup screen** instead of sign-in:

1. **Till** → keep or edit the station id (`TILL-01`) → **Finish setup**. The
   app restarts as a kiosk. It has minted its own pairing code.
2. **Desk** → station id (`DESK-01`) → **Finish setup**.
3. **Kitchen screen** → station id (`KDS-01`) → type the **pairing code** shown
   on the till (sidebar → **Pair a kitchen screen**, manager PIN) → **Finish
   setup**. The kitchen screen finds the till on the LAN by itself; if it
   cannot, **Advanced: till address** takes the till's LAN IP, and "Save
   anyway" keeps it even while the till is off.

The first launch is a normal, closable window; kiosk mode starts on the
restart after setup. Windows Firewall asks once, on the till, to allow the app
on private networks (the LAN server on port 47810) — allow it.

Scripted alternative (unchanged): launch once from a shortcut with flags, which
writes `station.json` and skips the screen:

```text
# till
"Touch Padel Operator.exe" --station-id=TILL-01 --station-mode=till --lan-psk=<CODE>
# desk
"Touch Padel Operator.exe" --station-id=DESK-01 --station-mode=desk
# kitchen screen
"Touch Padel Operator.exe" --station-id=KDS-01 --station-mode=kds --till-host=<TILL-LAN-IP> --lan-psk=<SAME-CODE>
```

Use a 10-character pairing code (Crockford base32, e.g. `ABCDEFGHJK`) as the
`--lan-psk` if you want the till's "Pair a kitchen screen" card to work; any
other value works for the LAN but the card will say the key is custom.

Manual alternative: copy `station.json.example` (shipped beside the app in
`resources/`) to `%APPDATA%/touch-padel-operator/station.json` and edit it.

The till binds its LAN server to the first private IPv4 automatically; pin it
with `--lan-bind=<ip>` / `"lan_bind"` if the machine has several NICs. Give the
till a **static LAN IP** (router reservation) so the KDS's `till_host` never
moves. To re-do setup on a machine, delete `station.json` and relaunch.

## 4. Kiosk behaviour

- Every configured station is a kiosk, in every mode (till, desk and kitchen
  screen) and on every platform (owner call, 2026-09-23): no frame, it cannot
  be minimised, and the window cannot be closed.
- There are two ways out: **Quit to desktop** (in the sidebar, and in the top
  corner of the sign-in screen) and **Exit forced full screen**. Both take a
  manager's PIN, and it cannot be the PIN of the person signed in. On the
  sign-in screen any manager's PIN works.
- If an update is waiting, Quit to desktop installs it and the app opens again
  by itself (§6).
- Launch-on-boot registers itself on every packaged start
  (`app.setLoginItemSettings`); no Task Scheduler entry needed.

## 5. Day-one checklist (per station)

1. Launch and sign in **while online** — the sync worker and the offline
   caches are fed by a signed-in session. The till and the desk sign in with
   the station's staff account. The kitchen board is signed in by whoever runs
   it, with their own account: every bar and kitchen worker has one (head
   barista, barista, head chef, chef), created on the Staff page, and a prep
   account is moved to barista or chef first (Setup ▸ Worth checking lists
   them). Personal work (tasks, checklists, the shopping list, requests) is on
   the staff area of the phone app, not on the station
   (`docs/design/protocols/plan-2026-09-23.md` §9).
2. Till: confirm the banner is absent (venue not degraded) and open the day.
3. KDS: confirm a test ticket appears; unplug the WAN briefly and confirm the
   board switches to LAN tickets.
4. Record the machine's station id and the sidebar's version line in the venue
   sheet.

## 6. Updating

Every packaged station checks the public releases repo when the app starts
(again 30 s later if that check could not reach it) and then every 6 hours,
and downloads a newer installer silently. Nothing installs by itself while the
app is open. A downloaded update goes in one of three ways:

- **Update ready.** The sidebar shows an **Update ready** row; the kitchen
  screen, which has no sidebar, shows a pill in the corner. Tapping it closes
  the app, installs the update and opens the app again on the new version.
- **Quit to desktop.** While an update is ready, the Quit dialog says so:
  quitting installs it, and then the app opens again by itself. On a locked
  station (every configured one) Quit needs the PIN of a manager other than
  the person signed in.
- **The next start.** When the app starts and finds an update an earlier
  session downloaded, it installs it before the window opens. Nothing shows
  on screen for a few seconds (up to 15 s while it checks the feed), then the
  installer runs silently and opens the app on the new version, usually about
  a minute later. Do not switch the machine off or click the shortcut during
  that minute. With no network at start, the window opens after the 15 s and
  the update waits for later.

A Windows shutdown or restart does not install anything on the way down. The
app starts again at login, and that start installs it. So restarting a till is
enough to update it.

A start installs an update only when all of these hold:

- **The app was installed Only for me.** An install for all users makes the
  installer ask Windows for administrator approval, and at a start nobody is
  there to give it. Such a machine never installs at start: use Update ready
  or Quit to desktop with someone there to approve the prompt (the app reopens
  only if they do), or reinstall it Only for me. Uninstall the all-users copy
  first (Settings > Apps); `queue.db` and `station.json` are kept.
- **No earlier start tried that version.** A start gets one try per version.
  If the station comes back still on the old version (the installer failed),
  later starts leave that version alone and **Update ready** stays in the
  sidebar for someone to tap. The next release gets its own try.
  `updater.log`, beside `station.json`, records what happened.
- **The version is above every version this station has run.** See rolling
  back below.

**Rolling back.** Run an older `Touch-Padel-Operator-Setup.exe` from the
releases page (§1) over the installed app. The station then stays on that
version across restarts, because a start never installs a version the station
has already run. The feed still offers the newer release, though: **Update
ready** comes back, and tapping it or quitting to the desktop installs that
release again. To stop a bad release everywhere, publish a fixed one with a
higher version number, or take the bad release down in the releases repo.
Never reuse a version number: a station that has run it will not take it at a
start.

`queue.db` and `station.json` live in `%APPDATA%` and survive every update and
every rollback. Re-running any installer by hand (newer or older) still works
and replaces in place. There are no scheduled update windows: an update
mid-ticket is the operator's call, and a start is the only moment one installs
on its own.
