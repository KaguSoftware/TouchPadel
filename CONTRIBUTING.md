# Contributing — Touch Padel Phase 1

## One-time setup (Windows)

1. **Docker Desktop** with the WSL2 backend (Settings → General → "Use the WSL 2 based engine").
   If WSL2 is missing: `wsl --install` in an elevated terminal, reboot.
2. **Node 20+** and **pnpm 9** (`corepack enable` gives you the pinned pnpm).
3. **Supabase CLI**: `pnpm dlx supabase --version` works without a global install; a global
   install (`scoop install supabase` or the .exe from GitHub releases) is faster day-to-day.
4. Clone, then:
   ```
   pnpm install
   pnpm db:start        # supabase start — first run pulls ~2GB of images
   pnpm db:reset        # applies migrations + seed; re-run any time
   ```
5. Gate (week-1, day-1): `supabase start` must be green on your machine before writing code.
   If Docker fights you for more than 2 hours, say so — the fallback is a shared Kagu-hosted dev
   project (schema stays migration-first either way).

## Rules that are enforced, not suggested

- **Commits**: authored by you, no AI co-author trailers. Small, present-tense messages.
- **Schema**: migrations only (`packages/db/supabase/migrations/`). Never edit the local DB or any
  dashboard by hand. After a migration: `pnpm db:types` and commit the regenerated
  `types.gen.ts` (CI fails on drift).
- **Money**: only `packages/core/src/money/` does arithmetic on money. Integer IQD everywhere.
- **Writes from the operator app**: through the IPC queue bridge — never `supabase.from(...).insert`
  in the renderer, even for "quick" things. Reads are fine.
- **Styling**: CSS logical properties only (`margin-inline-start`, not `margin-left`) — lint
  enforces it. Test every screen you touch in Arabic (`/ar`) before calling it done.
- **Bilingual content**: `_en` and `_ar` are both `NOT NULL` on new content tables — no
  English-only rows.
- **Secrets**: `.env*` and `station.json` are gitignored; the service-role key exists only in edge
  function secrets and CI. If you find one in a file, stop and flag it.

## Where things are decided

- Schema truth: `docs/design/design-data.md` (19-migration plan, RLS matrix).
- Architecture truth: `docs/design/design-arch.md`.
- Who does what, week by week: `docs/design/design-delivery.md`.
- When docs disagree: the "Resolved design calls" table in the approved plan / `HANDOFF.md`.
