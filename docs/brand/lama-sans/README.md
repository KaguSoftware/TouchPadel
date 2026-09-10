# Lama Sans — the brand family

**Lama Sans** is the face every app now renders in. It was supplied by Touch on 2026-09-05 and
wired through on the same day.

Its provenance is not reconciled with the brand decks, and that is written down here rather than
smoothed over, because anyone who reads the decks first will come looking for two different names.
What is actually established:

- The typography boards in `full-brand2.pdf` (p11) and `identity.pdf` (p10) specify **Next Art**
  (Latin) and **Frutiger LT Arabic** (Arabic). Lama Sans appears on neither board, and the string
  does not occur anywhere in either deck's 52 pages.
- The decks are not a clean two-face system in practice. Their embedded font resources are Next Art
  and Frutiger LT Arabic _alongside_ Alexandria, GE Dinkum, IBM Plex Sans Arabic, Araboto and Adobe
  Arabic — a two-face board over a seven-face document, and four different Arabic faces across the
  two files.
- Lama Sans is what was supplied and what the apps use.

Those three facts do not settle which face is the brand's; that is Touch's call, and it has not been
recorded in this repo. Nothing here should be read as a claim that the deck pair was superseded, or
as a claim about who holds a licence for what — neither has been established. If the decks are
confirmed outdated, re-typesetting them is a handover item for the designer. Risk R10 in
`docs/design/design-delivery.md` tracks the licensing question and is still open.

The property that matters architecturally is that Lama Sans is **dual-script**. Every weight carries
Latin _and_ Arabic in the same file, so the interface does not change family when it changes
language. That is what collapsed the two-stack Latin/Arabic apparatus in
`packages/ui/src/tokens/typography.ts` — the Latin token and the Arabic token now resolve to the
same family, and they survive only so the ~200 existing call sites keep working and so the fallback
tails can differ.

## Coverage

- **Latin**: the full set the UI needs, roman and italic.
- **Arabic**: 97 codepoints with real `init` / `medi` / `fina` shaping and `rlig` ligatures — a
  genuinely shaped Arabic face, not a Latin face with Arabic glyphs bolted on. Arabic-Indic
  (`٠١٢…`) and extended Arabic-Indic (`۰۱۲…`) digits are present alongside the Latin ones.
- **OpenType features**: `aalt` `case` `ccmp` `dlig` `fina` `init` `locl` `medi` `pnum` `rlig` `salt`
  `ss01` `tnum`. `tnum` is the one the product leans on — every price, quantity and total in the
  till, the KDS and the bill is tabular, and it is a real feature here rather than a synthesised
  approximation.
- **Embedding**: `fsType` is `0` (installable embedding). The faces may ship inside the app binary,
  the web bundle and a `data:` URL document, which is exactly what the Electron receipt pipeline
  does.

## The seven faces that ship

| File                     | Weight | Style  | Used for                          |
| ------------------------ | ------ | ------ | --------------------------------- |
| `LamaSans-Regular`       | 400    | normal | Body copy everywhere; first paint |
| `LamaSans-Medium`        | 500    | normal | Labels, table headers             |
| `LamaSans-SemiBold`      | 600    | normal | Buttons, headings, status chips   |
| `LamaSans-Bold`          | 700    | normal | Headings, totals; first paint     |
| `LamaSans-ExtraBold`     | 800    | normal | Cafe display headlines            |
| `LamaSans-Black`         | 900    | normal | The wordmark and hero type        |
| `LamaSans-RegularItalic` | 400    | italic | The five muted "note" lines       |

Regular and Bold lead the load order and are the two in `PRELOAD_FACES`: they are what the first
paint needs on every surface, and the two the receipt pipeline inlines.

The italic is in the set on purpose. Without a real italic face the browser synthesises an oblique
by shearing the roman, and a sheared _Arabic_ note is a conspicuous artefact — worse here than the
same trick would be in a Latin-only product.

## What was cut, and why it is not an accident

The drop from Touch was ~29 MB: **3 widths × 9 weights × roman/italic × 4 formats** (OTF, TTF,
WOFF, WOFF2). The working set is 1.4 MB. Cut, deliberately:

- **The condensed and expanded widths.** Nothing in the design uses them. Three widths at standard
  weight coverage is three times the bytes on every cold load for a variant no screen asks for.
- **Weights 100 / 200 / 300.** No call site anywhere in the repo. Hairline weights also fail on the
  thermal printer, which is 1-bit at 203 dpi.
- **Every italic except Regular.** Italic appears in exactly five muted note lines, all at body
  weight.
- **OTF, WOFF and plain TTF for the web.** WOFF2 for web (Next and Vite both serve it), TTF for
  mobile (Metro and `expo-font` want the TTF).

**These faces are not lost, they are unimported.** The full drop stays out-of-band with Touch. Do not
re-import a width or a weight without a call site that needs it; do not assume a missing weight was
an oversight.

## Where the files live

```
packages/ui/fonts/lama/woff2/   canonical — web
packages/ui/fonts/lama/ttf/     canonical — mobile
        │
        ├─ apps/web/public/fonts/lama/        (Next.js  → /fonts/lama/…)
        ├─ apps/operator/public/fonts/lama/   (Vite     → /fonts/lama/…)
        └─ apps/mobile/assets/fonts/          (Metro / expo-font)
```

The copies are **committed, not generated at build time**: Next has no asset copy step of its own,
Metro will not follow a workspace package for a binary asset under pnpm's symlinked layout, and a
font that only exists after a predev hook is a font that is missing in CI.

- `pnpm fonts:sync` — copy canonical → app static roots.
- `pnpm fonts:check` — verify the copies byte for byte; non-zero on drift. Runs in CI (the `checks`
  job), because a face updated in one place and not the others ships two typefaces and every file
  involved is still a valid font.

## The swap point

Two files, and nothing else in the repo spells a family name:

- `packages/ui/src/tokens/typography.ts` — the stacks and `BRAND_FAMILY`; emitted as the
  `--tp-font-*` CSS vars.
- `packages/ui/src/fontFace.ts` — `FONT_FACES` (the seven specs), `PRELOAD_FACES`, `fontFaceCss()`
  and `fontFaceCssFrom()` for surfaces whose URLs are not paths (bundler-hashed imports, or the
  base64 data URIs the origin-less Electron receipt document needs).

`themeCss` begins with `fontFaceCss()`, so any surface that already inlines or injects the theme
registers the faces with it.

## Adding a weight back

1. Drop the face into **both** `packages/ui/fonts/lama/woff2/` and `packages/ui/fonts/lama/ttf/`,
   named `LamaSans-<Style>.{woff2,ttf}`. Both, always — the sync script treats a face present in
   one format and not the other as drift, which is the point.
2. Add its spec to `FONT_FACES` in `packages/ui/src/fontFace.ts` (`{ file, weight, style }`). It
   will not be preloaded — `PRELOAD_FACES` is a filter on roman 400/700 — and that is usually
   right; widen the filter only for a face above the fold on a surface people wait for, because
   every preload competes with the two that already matter.
3. `pnpm fonts:sync`, then commit the copies it writes.

Mobile additionally needs the face registered with `expo-font` — `apps/mobile/src/theme/` is where
the map lives.

## The specimen

`docs/brand/lama-sans/LamaSans-specimen.pdf` — every weight, both scripts, the numeral sets.

**It is not in git.** `*.pdf` is gitignored repo-wide (owner decision 2026-08-24: the brand decks are
far over GitHub's limits), so the specimen exists on a working machine or not at all. If it is not
beside this file, ask Parsa for it out-of-band rather than searching the history for it.
