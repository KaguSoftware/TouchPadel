# Real device captures

Drop a real screenshot here and the renderer stops drawing the HTML recreation
for that frame and frames the real pixels instead. Nothing else changes — same
poster, same headline, same output path.

```
capture/<locale>/<slug>.png
```

`<locale>` is `en` or `ar`. `<slug>` is the frame slug from `../frames.mjs`:

| slug             | screen to capture                                                        |
|------------------|--------------------------------------------------------------------------|
| `1-book`         | Book tab, court at rest, venue open, sheet closed                         |
| `2-availability` | Availability for a day with a mix of free / 1-left / booked times         |
| `3-review`       | Review & confirm, hold timer running, a player count picked               |
| `4-success`      | Court reserved                                                            |
| `5-bookings`     | My reservations, Upcoming selected, a Next up card + ≥3 more bookings     |
| `6-settings`     | Settings, notifications enabled, About card visible                       |

## Requirements

- **Any iPhone screenshot works.** The frame fills the screen and centre-crops
  (it never letterboxes). Every current iPhone is within 0.3 % of the 393:852
  shape the frame is built on:
  - iPhone 13 / 13 Pro / 14 (**1170×2532**) — loses under one poster pixel down
    each side at 6.9"; nothing visible;
  - iPhone 15 Pro / 16 Pro (1179×2556) — exact;
  - 15 Pro Max / 16 Plus (1290×2796) — exact.
  Do not use an iPad or a non-iPhone ratio: the crop would cut real content.
- **One device for the whole set.** An iPhone 13 has a notch and no Dynamic
  Island, so its status bar differs from the recreated frames (drawn on a
  Dynamic Island phone). Mixing a 13 capture with recreations shows; replace
  all six in a locale, or shoot them on an iPhone 16 Pro simulator.
- **Dark theme** (Settings → Appearance → Dark). The whole pack is in blue mode;
  a light-theme capture will look like a different app next to the other five.
- **Real data, no debug UI.** No degraded banner, no dev menu, no placeholder
  names, and real prices (not the "Call only" cells a venue without rate rules
  shows).
- **Status bar:** 9:41, full signal, full battery. On a simulator:
  `xcrun simctl status_bar booted override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4`.
  On a physical phone this cannot be set; any clean status bar is acceptable.

## Getting them

On the iPhone 13: press **side button + volume up**, then AirDrop the PNGs to
the Mac/PC and rename them to the slugs above. Screenshots keep the native
1170×2532 resolution.

On a simulator:

```
xcrun simctl boot "iPhone 16 Pro"
xcrun simctl io booted screenshot 1-book.png
```

The Arabic set is the same six screens with the in-app language switched to
العربية (Settings → Language) — the app's own direction state, not an RTL
simulator, because `app.config.ts` pins the native RTL flag to LTR on purpose.

Once a capture is in place, re-run `pnpm --filter @touch/mobile run store` and
the console reports which frames used real pixels.
