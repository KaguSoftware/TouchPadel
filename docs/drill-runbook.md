# The disconnection drill — runbook

The Module 7 acceptance script (SOW L659-665, design-delivery.md §5): run on
Kagu hardware in W4, on the venue's machines in W5, and live with Mustafa at
acceptance. Every step names what to see; a step that shows anything else is a
defect, stop and record it.

**Setup**: till + KDS installed per `docs/install-runbook.md` (same LAN PSK,
KDS `till_host` → till's static IP), both signed in **while online**, day open,
at least one PIN-gated action performed online today (feeds the offline PIN
cache). A phone with the guest app, and the website open on a laptop.

| # | Action | Expect |
|---|--------|--------|
| 1 | Trade normally: open a tab, send an order | Ticket on the KDS within a second; no banner anywhere |
| 2 | **Pull the WAN cable** (leave the LAN switch on) | Within ~45 s the till banner goes red: station cannot reach the server |
| 3 | Phone: try to book **tonight** | Refused server-side with the venue phone number shown |
| 4 | Phone: book **next Saturday** | Succeeds — only the protected horizon locks |
| 5 | Website: try to order | Ordering blocked with the desk message |
| 6 | Till: open a NEW tab (table), add items, send | Tab appears in the rail marked ⟳; banner queued count rises; **ticket appears on the KDS over the LAN** |
| 7 | KDS: bump the LAN ticket to Ready | Status flips on the KDS; till queued count rises by one more (the bump rides the till's queue) |
| 8 | Till: PIN discount on the offline tab | Accepted (offline PIN cache); queued |
| 9 | Till: settle the offline tab, cash | Change computed; tab leaves the rail; queued count rises |
| 10 | **Kill the till's power mid-order** (basket filled, Send pressed, then yank) | — |
| 11 | Power the till back on (still no WAN) | App auto-launches; offline tabs are back in the rail; queued count matches before the cut; **nothing confirmed is missing, nothing unconfirmed appears** |
| 12 | Admin → Day close | Blocked: the queue card lists every unsynced row |
| 13 | **Reconnect the WAN** | Banner clears ≤ 45 s; queued count drains to 0; the offline tab's orders/settle appear in the server data **exactly once** (check the tab in /till or the DB) |
| 14 | Check stock (once module 5 ships) / audit log | One deduction per item; the discount shows its authoriser and reason |
| 15 | Booking placed on the phone inside the heartbeat gap (optional, two people) | If it collided with a desk write: a **conflict surfaces at the desk** (banner attention count + day-close list), never an overwrite |
| 16 | Day close again | Succeeds; totals reconcile against counted cash |

**Reset after a failed run**: fix, then `DELETE FROM mutation_queue` is NOT the
move on a real till — replay or resolve every row; on a test rig, wipe
`%APPDATA%/touch-padel-operator/queue.db` and the localStorage offline tabs
(sign out/in clears selection; DevTools → Application → Local Storage →
`touch-operator-offline-tabs`).

**What is automated already** (belt to this manual braces):
`sync-worker.test.ts` (strict order, resume-inflight, 409/4xx/5xx map,
backoff, exactly-once via idempotency), `lan-kds.test.ts` (PSK, snapshot,
broadcast, single-writer bump), `queue.test.ts` (fsync pragmas, v-migrations,
blocking rows), replay-idempotency DB suite (server two-layer dedupe).
