@AGENTS.md

# apps/web — rules for every change

Next.js guest site under `app/[locale]/`: the root menu page, the QR table menu (`t/[token]`),
`download`, `privacy` and `support`. `AGENTS.md` above is Next's generated guide to this Next
version; read it before touching routing, caching or server code. Written 2026-09-20 (Phase 2,
Milestone 0 item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20 code verification. Database-side
rules are in `packages/db/CLAUDE.md`.

## Commits

- No AI co-author trailer of any kind (`Co-Authored-By: Claude …`, Copilot, …). If a harness appends
  one, strip it. Root `CLAUDE.md`.
- Commit and push only when Parsa says "commit" or "push". Never run `git add`, `commit`, `stash`,
  `checkout`, `reset` or `clean` on your own.
- One commit carries the page, its keys in `packages/i18n/src/catalogs/en.ts` and `ar.ts`, and, when
  an RPC changed, the regenerated `packages/db/src/types.gen.ts`.

## Routing and rendering

- Every page lives under `app/[locale]/…`; the locale is the URL prefix (`/ar/...`), never a header
  or cookie. Test every touched screen at `/ar` before calling it done (`CONTRIBUTING.md`).
- `app/[locale]/layout.tsx:104` reads `headers()` for the CSP nonce, which makes the whole tree
  dynamic today (C11). Do not add another `headers()` or `cookies()` read in a layout, and do not
  claim ISR for a page until C11 is fixed.
- A server read returns an explicit status union (`MenuStatus = 'ok' | 'empty' | 'error'`,
  `src/lib/menu.server.ts:20`) and the page renders each state; never a silent blank.
- Security headers and CSP live in `src/lib/security/headers.ts` (`buildCsp`,
  `STATIC_SECURITY_HEADERS`, `TABLE_ROUTE_HEADERS`) and are applied by `proxy.ts` (`config.matcher` at
  the bottom of the file; since 2026-09-20 it excludes only `_next/` and paths whose last segment is
  dotted, i.e. real files). Do not widen the matcher exclusions: a path it skips renders with no CSP
  (S8). `app/[locale]/t/[token]/route.ts` is a route handler, not a page, and every page calls
  `requireLocale()` (`src/lib/locales.ts`) so a foreign locale segment 404s instead of coercing to Arabic.
- `e2e/tests/web-security-headers.spec.ts` and `pnpm security:web`
  (`scripts/security/check-web-security.mjs`) check the headers; run both after touching either
  file.

## Data

- Every write is an `app.*` RPC through `appRpc` (`src/lib/appRpc.ts:9`); a failure's P0001 code
  maps through `RPC_ERROR_KEYS` (`:21`) to a catalog key, fallback `errors.generic`. A new code gets
  an entry and both catalogs.
- One realtime channel per bound guest session: `src/hooks/cafe/useSessionChannel.ts`
  (`session:{id}`, private; `realtime.setAuth()` before subscribe). New live data fans out from it;
  never open a second channel.
- `createClient` from `@supabase/supabase-js` is a restricted import outside
  `src/lib/supabase/{client,server,static}.ts` (`eslint.config.mjs:33-58`); use those factories.
- The service-role key never reaches this package; `clientSecrets` lint (`@touch/config/eslint`)
  fails on it and CI runs `scripts/security/check-artifact-secrets.mjs --only=web` on the build
  (`ci.yml:170`).

## i18n and styling

- Strings come from `packages/i18n/src/catalogs/en.ts` + `ar.ts`;
  `packages/i18n/src/__tests__/t.test.ts:35` asserts key parity.
- Styles are template-string CSS in `src/styles/**/*.css.ts`, logical properties only, colours only
  via `var(--tp-*)` (`src/styles/cafe/base.css.ts` header). `rtlGuardRules` from
  `packages/config/src/eslint.js` fails `lint` on `marginLeft`, `textAlign: 'left'` and the rest;
  `e2e/tests/cafe-rtl-layout.spec.ts` checks the rendered layout.
- Never spell a font family in app code; use the `--tp-font-*` tokens from
  `packages/ui/src/tokens/typography.ts`. `pnpm fonts:check` runs in CI (`ci.yml:160`).
- `src/components/cafe/useCafeActions.ts` recreates its callbacks every render (C10); fix by
  memoising the deps object, not by adding another ref workaround.

## Tests

- Unit tests are `src/**/*.test.ts` under node (`vitest.config.ts`). No component tests exist (Q1);
  Milestone 0 item 11 adds jsdom for `*.test.tsx` from `apps/operator/vitest.config.ts:27`. A new
  component ships with one.
- Playwright: `e2e/tests/cafe-*.spec.ts`, EN and AR projects (`e2e/playwright.config.ts:55-64`);
  `pnpm e2e` from the root.
- Run `pnpm --filter @touch/web typecheck`, `lint` and `test`, then `pnpm security:web` from the
  root. Report the exact result.
