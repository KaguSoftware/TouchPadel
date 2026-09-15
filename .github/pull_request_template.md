## What and why

<!-- One or two sentences. The reviewer should not have to read the diff to know
     what this is for. -->

## How it was verified

<!-- What you RAN, not what you believe. "594 tests green" beats "should be fine".
     If the local stack was not up, say so — a box ticked from reading the code
     is how migration 0069 reached `main` with a relation that does not exist. -->

- [ ] `pnpm turbo lint typecheck test build`
- [ ] `pnpm --filter @touch/db test` (needs `pnpm db:start && pnpm db:reset && pnpm db:fixtures`)
- [ ] `pnpm e2e` — or "not touched"

---

## Security checklist — Security Layer §11.4

Delete a line only if it is genuinely not applicable, and say why. Leaving one
unticked and unexplained is the review signal.

### Data and access

- [ ] **A new table has RLS enabled, with a policy per operation** — not one
      blanket `using (true)`. A table with RLS on and no policy is closed; a
      table with RLS off and a grant is wide open.
- [ ] **A new guest-writable field is declared** in `packages/db/tests/stored-fields.test.ts`
      (`GUEST_DATA`), with its store data-safety category, its purpose, and its
      erasure route. The test fails until it is.
- [ ] **A new guest-writable TEXT field is sanitised** — `app.safe_line` /
      `app.safe_text` (0080). Bidi overrides in a name spoof the desk display.
- [ ] **Anything a guest can delete about themselves** is handled by
      `app.delete_my_account` (0077), and proved by its test.

### Authorization

- [ ] **A new RPC is classified** in `packages/db/fixtures/rpc-allowlist.json` —
      `guarded`, or `publicByDesign` WITH the reason written next to it. CI fails
      on an unclassified one.
- [ ] **A new RPC has a rule in `tests/rls-matrix.ts`** exercising all eight
      principals, and the coverage floor was ratcheted (`--update-floor`).
- [ ] **The role guard is the FIRST statement** in the function body, before any
      argument validation. `check:authz` calls every RPC with NULL arguments as
      a real anonymous guest and expects a refusal.
- [ ] **A guest holds `authenticated` exactly as staff do.** If the only thing
      protecting this is "the UI does not show the button", it is not protected.

### The one rule with no exception

- [ ] **No column, form field, note field or log line can hold a card number.**
      Payments are cash and card-present only; this system never sees a PAN.

### Migrations

- [ ] Opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`
- [ ] No `CREATE INDEX` without `CONCURRENTLY` (and a concurrent index needs its
      own migration — it cannot run in a transaction).
- [ ] No `ADD CONSTRAINT` without `NOT VALID` + a separate `VALIDATE`.
- [ ] **No edit to a migration that has already been applied.** Fix forward with
      a new one — and re-issue the WHOLE current function body, because
      `create or replace` replaces all of it (that is how 0075 silently reverted
      0071's guard).
- [ ] The hosted project is the venue's LIVE database. There is no staging (D1).

### Clients

- [ ] No secret in a `NEXT_PUBLIC_*` / `VITE_*` / `EXPO_PUBLIC_*` name.
- [ ] Errors reaching a guest carry no stack trace, no raw Postgres error and no
      constraint name (SEC-36, `pnpm security:quiet-errors`). Map with
      `mapErrorToKey` / `rpcErrorKey`; send the original to the tracker.
- [ ] A KDS/floor broadcast payload names only what the screen needs — never a
      price, a total or a guest field (`check:broadcast`).

---

<!-- If a migration in this PR must run out of order against the hosted project,
     say so here and name the reason:
     MIGRATION-RISK-ACCEPTED: <why this is safe to run against the live venue database>
-->
