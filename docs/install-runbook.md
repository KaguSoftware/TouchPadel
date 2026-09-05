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
- **All versions:** `https://github.com/KaguSoftware/touchpadel-releases/releases`
  (public repo; also the auto-update feed). To roll back, install an older
  `Touch-Padel-Operator-Setup.exe` from there — one-click, replaces in place.
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

- Till and KDS run full kiosk (no frame, no menu); the desk keeps a frame.
- The window is **not closable**: staff leave via the sidebar's
  **Quit to desktop**, which takes a manager PIN. (Online it verifies against
  the server; during an outage it accepts a manager PIN that has been used
  successfully on this station in the last 14 days.)
- Launch-on-boot registers itself on every packaged start
  (`app.setLoginItemSettings`); no Task Scheduler entry needed.

## 5. Day-one checklist (per station)

1. Launch, sign in with the station's staff account **while online** — the
   sync worker and the offline caches are fed by a signed-in session.
2. Till: confirm the banner is absent (venue not degraded) and open the day.
3. KDS: confirm a test ticket appears; unplug the WAN briefly and confirm the
   board switches to LAN tickets.
4. Record the machine's station id and the sidebar's version line in the venue
   sheet.

## 6. Updating

Automatic. Every packaged station checks the public releases repo 30 s after
launch and every 6 hours, downloads a newer installer silently, and then
waits: the sidebar shows **Update ready** (the kitchen screen shows a pill).
Tapping it restarts into the new version; **Quit to desktop** (manager PIN)
also installs a waiting update on the way out, as does an OS shutdown. No
scheduled update windows — a restart mid-ticket is the operator's call.
`queue.db` and `station.json` live in `%APPDATA%` and survive every update.

Re-running any installer by hand (newer or older) still works and replaces in
place.
