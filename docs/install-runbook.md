# Operator desktop — install runbook (Windows)

The operator app installs on Touch's three machines: the **till** (REG/TILL),
the **desk** machine, and the **kitchen screen** (KDS). One installer, three
station roles — the role lives in `station.json`, not in the build.

## 1. Get the installer

- CI: push a tag `operator-vX.Y.Z` → the `operator-release` workflow attaches
  `Touch Padel Operator Setup X.Y.Z.exe` to a GitHub release. The hosted
  Supabase env is baked in from repo secrets (`OPERATOR_SUPABASE_URL`,
  `OPERATOR_SUPABASE_ANON_KEY`, `OPERATOR_GUEST_SITE_URL`).
- Local: `pnpm --filter @touch/operator-shell dist` (set `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_GUEST_SITE_URL` in the environment of the
  operator build first — a build without them **crashes at startup by design**
  rather than silently pointing at localhost). Output: `apps/operator-shell/release/`.

## 2. SmartScreen

There is **no code-signing certificate** (owner decision pending). On first
launch Windows shows "Windows protected your PC" — click **More info → Run
anyway**. This is expected; revisit if the client sources a cert.

## 3. Station identity (per machine, once)

Preferred — run the installer, then launch once from a shortcut with flags
(writes `%APPDATA%/touch-padel-operator/station.json` on first run):

```
# till
"Touch Padel Operator.exe" --station-id=TILL-01 --station-mode=till --lan-psk=<GENERATED-PSK>
# desk
"Touch Padel Operator.exe" --station-id=DESK-01 --station-mode=desk
# kitchen screen
"Touch Padel Operator.exe" --station-id=KDS-01 --station-mode=kds --till-host=<TILL-LAN-IP> --lan-psk=<SAME-PSK>
```

Manual alternative: copy `station.json.example` (shipped beside the app in
`resources/`) to `%APPDATA%/touch-padel-operator/station.json` and edit it.

Generate ONE random PSK for the venue (e.g. `openssl rand -hex 24`) and use it
on the till and every KDS. The till binds its LAN server to the first private
IPv4 automatically; pin it with `--lan-bind=<ip>` / `"lan_bind"` if the machine
has several NICs. Give the till a **static LAN IP** (router reservation) so the
KDS's `till_host` never moves.

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
4. Record the machine's `station.json` values in the venue sheet.

## 6. Updating

Re-run the newer installer (one-click, replaces in place; `queue.db` and
`station.json` live in `%APPDATA%` and survive). Auto-update is deliberately
not wired in phase 1.
