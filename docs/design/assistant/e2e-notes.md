# Owner assistant — Playwright smoke notes (2026-09-20)

Spec: `e2e/tests/assistant.spec.ts` (plan §8 Playwright bullet, adapted to a
stack with **no Anthropic key**: a real question answers 503 `NOT_CONFIGURED`
and the thread must show `ws.owner.assistant.message.errors.NOT_CONFIGURED`;
the `dry_run` pack sizing and the `assistant_usage` / `assistant_models` RPCs
work without a key and are asserted for real).

## Run

Local stack (`supabase start`) + `supabase functions serve` without
`ANTHROPIC_API_KEY`; Playwright starts both dev servers itself (config
`webServer`, `reuseExistingServer: false` — stop any Vite on :5174 first).

```
pnpm exec playwright test --config e2e/playwright.config.ts e2e/tests/assistant.spec.ts
```

Result 2026-09-20: 8 passed (13.7 s).

| # | project | test |
|---|---------|------|
| 1 | chromium-en | rail button opens the drawer with Cafe + how-to pre-checked and the Cafe pack size |
| 2 | chromium-en | Ctrl/⌘ K opens and closes the drawer |
| 3 | chromium-en | presets: Just help leaves only how-to; Everything checks all |
| 4 | chromium-en | a question with no key shows the not-configured sentence, no usage footer, no Stop |
| 5 | chromium-en | /assistant lists no chats for a fresh owner; /assistant/usage shows cap, pricing and default model |
| 6 | chromium-en | cashier: no rail button, no shortcut, /assistant is refused |
| 7 | chromium-ar | rail button opens the drawer with المقهى + how-to pre-checked and the pack size |
| 8 | chromium-ar | a question with no key shows the Arabic not-configured sentence |

No `test.fixme` — nothing in the app blocked a case.

## Findings (not blockers)

1. **`pnpm e2e -- <file>` runs the whole suite.** The `--` reaches Playwright
   as a bare argument and the file filter is dropped, so the first run drove
   all 56 tests against the shared local DB (and surfaced the pre-existing
   `operator-journey.spec.ts` court_desk walk-in cancel timeout, unrelated to
   the assistant). Use `pnpm exec playwright test --config e2e/playwright.config.ts <file>`
   or `pnpm e2e <file>` without the `--`.

2. **The scope catalog is a moving target.** `ASSISTANT_SCOPES`
   (`packages/core/src/assistant/tools.ts`) gained `engagement` ("Guest
   engagement (PostHog)") between the spec being written and first run, so the
   strip rendered 14 boxes against a hardcoded 13. The spec now measures the
   strip: test 1 asserts exactly 2 checked and more than 2 present; "Everything"
   asserts checked count == total count.

3. **Scopes the dry run omits print nothing, not "no pack".**
   `assistant-chat` `dry_run` returned packs for cafe, courts, money, stock,
   staff, marketing, settings, system only. For howto, customers, audit,
   engagement, docs, tables `packs[scope]` stays `undefined`, and
   `ScopeStrip.tsx` renders `''` once measuring ends — the `scopes.packNone`
   string ("no pack") is only reached for a returned size of 0. Either the
   edge function should return `tokens_est: 0` for pack-less scopes or the
   strip should treat "measured, absent" as `packNone`. Cosmetic; the spec
   asserts only the Cafe row.

4. **Drawer starts with the strip folded.** In `compact` mode
   (`Thread.tsx` `stripOpen = !compact`) the checkboxes sit behind the
   "Context · n · ≈ … tokens" toggle. The spec expands it via that button's
   `aria-pressed`. If the plan meant the scopes to be visible on open, that is
   a product call, not a test one.

5. **Cashier refusal markup.** `RequireRole` (`routes/__root.tsx`) wraps
   `PermissionRefusedNotice` (`role="note"`) in a `role="alert"` card — the spec
   locates `alert` filtered by an inner `note`, asserting "Not allowed for your
   role" and the named role "Owner". Works; noting the nested live-region roles
   in case an a11y pass wants one of them gone.

## Strings the spec depends on

EN: `ws.shell.nav.assistant`, `ws.owner.assistant.{title,scopes.toggle,scopes.cafe,scopes.howto,scopes.presets.*,scopes.packSize,composer.ask,composer.stop,meter.thisMessage,message.errors.NOT_CONFIGURED,conversations.{title,empty},usage.{title,cap,capLine,capNone,pricingTitle},model.defaultTitle}`,
`ws.kit.refused.title`, `op.roles.owner`, `ws.shell.nav.language`.
AR: the same keys from `owner.ar.ts` / `shell.ar.ts`.
Test ids: `model-claude-opus-5`, `model-claude-sonnet-5` (`ModelSwitch.tsx`).
