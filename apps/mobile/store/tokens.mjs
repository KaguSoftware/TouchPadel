/**
 * The store pack's copy of the app's design tokens.
 *
 * These are transcribed from `apps/mobile/src/theme/tokens.ts` — `palettes.dark`
 * ("blue mode") and `brand`, the SAME closed palette the app ships. They are
 * duplicated rather than imported because this generator runs in plain Node
 * against a browser, with no TypeScript build and no React Native resolver in
 * the way. `pnpm --filter @touch/mobile store:strings-check` diffs every hex
 * below against tokens.ts, so the copy cannot silently drift.
 *
 * If a colour changes in the app, change it here too — a marketing screenshot in
 * last month's palette is worse than no screenshot.
 */

/** Blue mode ("dark") — the theme every store screenshot is shot in. */
export const dark = {
  page: '#172C4F',
  bg: '#1C355E',
  card: '#224072',
  sub: '#274982',
  tint: '#284B86',
  seg: '#152847',
  line: '#2D5495',
  line2: '#3360AB',
  ink: '#FFFFFF',
  mut: '#BCBDBF',
  mut2: '#E0E0E1',
  fnt: '#ACADAF',
  fnt2: '#919396',
  fnt3: '#696A6E',
  blue: '#FFFFFF',
  gtint: '#334918',
  gline: '#4C6C23',
  gtext: '#A5D06F',
  gtext2: '#B7D98C',
  gstrong: '#BCDC93',
  gph: '#90C54E',
  amb: '#4F380D',
  ambline: '#7B5714',
  ambtext: '#E9BF72',
  ambstrong: '#E3AF4F',
  redtint: '#4A2A3A',
  redline: '#7A4658',
  redtext: '#E9A6AA',
  danger: '#C93B30',
  tabBg: '#1C355EF2',
};

/**
 * The two light-palette greens the My reservations hero borrows in blue mode
 * (components/booking.tsx NextUpCard: the green card takes `palettes.light`'s
 * ramp, measured against a light ground).
 */
export const lightGreens = {
  gtext2: '#3D541F',
  gph: '#657F45',
};

/** Theme-invariant brand constants. */
export const brand = {
  green: '#A5D06F',
  greenInk: '#000000',
  blue: '#3360AB',
  navy: '#172C4F',
  navyCard: '#1E3966',
  navyText: '#BCBDBF',
  navyMuted: '#9C9DA0',
  navyLine: '#274982',
  navyTrack: '#234276',
  white: '#FFFFFF',
  leaf: '#A5D06F',
};

export const space = { xs: 4, s: 8, sm: 12, m: 14, l: 16, xl: 20, xxl: 26 };
export const radius = { cell: 12, button: 14, card: 16, sheet: 20, pill: 99 };

/**
 * The device the inner screen is authored at: iPhone 15/16 Pro logical points,
 * with its safe-area insets (59 top, 34 bottom). Screen CSS is written in these
 * units so a value here means the same thing it means in the React Native
 * stylesheet.
 */
export const DEVICE_PT = { width: 393, height: 852, insetTop: 59, insetBottom: 34 };
