# Store screenshots

Renders the App Store / Play screenshot set from the app's own design tokens,
the app's own strings and (when you supply them) the app's own pixels.

```bash
pnpm --filter @touch/mobile run store                        # both locales, iPhone 6.9"
pnpm --filter @touch/mobile run store -- --locale ar         # Arabic only
pnpm --filter @touch/mobile run store -- --frame 1-book      # one frame, while iterating
pnpm --filter @touch/mobile run store -- --size play-phone   # Google Play phone frames
pnpm --filter @touch/mobile run store -- --html              # dump HTML instead of PNG
pnpm --filter @touch/mobile run store:strings-check          # copy + palette drift guard
pnpm --filter @touch/mobile run store:copy-check             # listing field lengths
```

Keep the `run`: `pnpm … store` without it is pnpm's own `store` command and
fails with "Unknown option: 'recursive'".

Output lands in `out/<size>/<locale>/<slug>.png`. The generator is the source of
truth, but the `iphone-6.9` set uploaded to App Store Connect is committed so the live
listing's images are in the repo. Re-render and commit them together with any frame change.

After changing the listing docs or re-rendering, regenerate the App Store Connect
browser-agent prompt (`docs/client/store-release-chrome-prompt.md`):

```bash
pnpm --filter @touch/mobile run store:copy-check      # listing field limits
pnpm --filter @touch/mobile run store:strings-check   # in-phone copy + palette vs the app
pnpm --filter @touch/mobile run store:chrome-prompt   # fills the prompt from the docs + renders
```

## What comes out

**Since 2026-11-17 every frame is a real device capture** (`capture/<locale>/<slug>.png`, shot list in
`capture/README.md`). The renderer skips a frame with no capture and exits 1 listing what is missing;
`--draft` draws the old HTML recreations (September's three-tab bar) for a preview only.

12 posters: six frames × `en` and `ar`, at **1290×2796** (6.9" iPhone, the only iPhone set App Store
Connect requires) and, with `--size play-phone`, 1080×1920 for Google Play. Play also takes
`node store/feature-graphic.mjs` (1024×500, `out/play-feature-graphic/<locale>.png`) and
`node store/play-icon.mjs` (512×512, `out/play-icon-512.png`). All of these are committed.

| # | slug | screen | says (EN) |
|---|------|--------|-----------|
| 1 | `1-book` | Book tab | Book a court from your phone. |
| 2 | `2-pick-a-time` | Check availability | Your slot is held while you decide. |
| 3 | `3-join` | Join tab | Start a match, or join one. |
| 4 | `4-ranks` | Rankings tab | See where you stand. |
| 5 | `5-coaches` | Coaches tab | Lessons with our coaches. |
| 6 | `6-club` | Club tab, member card | Points and rewards at the till. |

Frame 1 is the one that shows in search results. It carries the whole pitch.

## The data every frame shares

One scenario, so no frame contradicts another — all of it in `frames.mjs`:

- "now" is **Tue 22 Sep 2026, 9:41 AM** (Baghdad);
- Touch's own venue: **2 courts** (Court 1 / Court 2), **60 min only**, open
  **09:00–02:00** (`packages/db/client-data/courts.sql`, `supabase/seed.sql`);
- cancellation window **4 h**, hold **300 s** (venue_settings);
- prices are the **dev fixtures'** 60-minute rates (40,000 / 50,000 / 60,000
  IQD) because Touch has not sent real rate rules yet — **swap them for the
  real rates before submitting**;
- the venue phone on Settings is the one the intake pack gave (still marked
  UNVERIFIED in seed.sql), and the version line reads `v1.0.0 (9)` — set `build`
  in `frames.mjs` to the build you actually submit.

## How it is put together

| file | what it owns |
|---|---|
| `frames.mjs` | Marketing copy, UI strings + scenario data per locale, `DATA_KEYS`, frame order, output sizes |
| `screens.mjs` | The six in-device screens, in HTML/CSS at 393×852 pt, iOS 26 system chrome |
| `template.mjs` | The poster: ground, eyebrow, headline, device frame, geometry |
| `tokens.mjs` | The app palette, transcribed from `src/theme/tokens.ts` |
| `render.mjs` | Playwright: one page per locale, one PNG per frame |
| `strings-check.mjs` | Fails when in-phone copy or palette drifts from the app |
| `capture/` | Real device screenshots, which override the recreations |

Playwright comes from the repo root (the `e2e/` workspace already depends on
it). This directory adds no dependency of its own; `strings-check` uses the
repo's `typescript` to read the catalogs.

## The recreation caveat — read this before you submit

The in-device art is a **recreation** of shipped screens: real palette, real
strings lifted from `packages/i18n`, layout taken from the React Native source,
drawn in HTML rather than photographed off a device. Nothing in it is a feature
the app does not have.

Where it is least exact, and a real capture matters most:

- **1-book** — the court is a 2D projection of the three.js scene (same camera,
  same geometry, approximate lighting; the rackets and ball are stand-ins for
  the animated rally).
- **iOS chrome everywhere** — the Liquid Glass tab bar and navigation bar, and
  the SF Symbols in the tab bar, are drawn by hand.
- **Arabic tab bar order** — drawn left-to-right (the native root is pinned
  LTR); confirm on a device.

**Before the final submission, put real captures in
`capture/<locale>/<slug>.png`** and re-render — see `capture/README.md`. The
renderer prints which frames used real pixels every time it runs, so the state
is never a guess.

## Keeping it honest

1. **Copy.** Every `t.*` value in `frames.mjs` that is not in `DATA_KEYS` is
   verbatim from `packages/i18n/src/catalogs/{en,ar}.ts` with placeholders
   filled the way the app fills them (Latin digits, Baghdad time, 12-hour clock,
   unit-last money — `packages/i18n/src/formatting.ts`). `store:strings-check`
   enforces it. It cannot know whether a filled number is still right (a "4" in
   the cancellation line matches `{hours}` whatever the venue's window is), so
   the scenario above still has to be read against the database.
2. **Palette.** `tokens.mjs` is a hand copy of `src/theme/tokens.ts`;
   `store:strings-check` diffs every hex.
3. **Layout.** Nothing checks this. When a screen is redesigned, its frame is
   stale until someone re-renders and looks at it — `--frame` makes that a
   ten-second loop.
