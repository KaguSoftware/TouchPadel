# Mobile brand assets

Everything native here needs a **new EAS build** to take effect — icons and the
splash are baked into the binary; an OTA update never changes them.

| File | Used by | Source |
| --- | --- | --- |
| `icon.png` (1024², opaque) | `icon` in `app.config.ts` — iOS icon, Android fallback | `docs/brand/touch_padel_logo_transparent.png` on white |
| `adaptive-icon.png` (1024², alpha) | `android.adaptiveIcon.foregroundImage` (over `#FFFFFF`) | same lockup, inside the safe zone |
| `adaptive-icon-monochrome.png` (1024², alpha) | `android.adaptiveIcon.monochromeImage` (Android 13+ themed icons) | same lockup, white silhouette |
| `notification-icon.png` (96², white on alpha) | `expo-notifications` plugin `icon` (Android status bar) | `brand/notification.svg` |
| `logo-white.png` (900×332) | splash image (`expo-splash-screen` plugin) and the Welcome screen | brand lockup, white — its vector twin is `src/features/courtTransition/logoPaths.ts` (same crop; the boot loading screen draws that at the splash width, so the two must stay identical) |
| `logo.png` (900×332) | in-app wordmark (courts + profile headers) | brand lockup, colour |
| `fonts/LamaSans-*.ttf` | `BRAND_FONTS` (`src/theme/fonts.ts`) | `docs/brand/lama-sans` |

The launcher icon is the full-colour Touch Padel lockup on white — the same mark
as the web app's icon — chosen by the owner on 2026-09-12, replacing the padel-ball
placeholder of 2026-09-06. The notification glyph stays the ball: a wordmark is
illegible at 24 dp.

## Regenerating

```sh
pnpm --filter @touch/mobile icons     # renders the four PNGs from docs/brand + brand/notification.svg
```

## Swapping in official art

1. Drop a finished **1024×1024 PNG, square, no rounded corners, no
   transparency** onto `icon.png`. iOS and Android apply their own corner masks.
2. If the mark changed shape, update `adaptive-icon.png` (the mark inside the
   central 66 % of the canvas, transparent elsewhere),
   `adaptive-icon-monochrome.png` (white silhouette) and `notification-icon.png`
   (white on transparent, 96²) — or replace the brand file and re-run the script.
3. Run `npx expo config --type prebuild` from `apps/mobile` to confirm the
   paths resolve, then build (`eas build --profile development` for a device
   check, `production` for the stores).
