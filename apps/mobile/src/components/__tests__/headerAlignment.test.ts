import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARABIC PAGE HEADERS.
 *
 * Every screen's own header is `<Title>` (Book, My Bookings, Profile, and the
 * auth screens' `plain` variant). It set case, tracking and line-height from
 * the locale but never `textAlign`, so the Arabic heading rendered against the
 * physical LEFT edge while the body beneath it read right-to-left.
 *
 * An unset `textAlign` cannot be relied on to fix that: RN resolves it through
 * `I18nManager.isRTL`, a boot-time flag that lags the CHOSEN language by one JS
 * load (see reconcileRtl in src/lib/bootPrefs.ts, and the release build where
 * `reloadForRtl` returns false and the session runs Arabic with the flag still
 * false). The same reasoning already governs MicroLabel, SectionLabel and Input
 * — this pins Title to it, plus the two header ROWS whose children would
 * otherwise keep their physical order.
 *
 * Alignment is a native layout property, invisible to typecheck and lint, so
 * these read the source the way headerDirection.test.ts does.
 */
const UI = readFileSync(join(__dirname, '..', 'ui.tsx'), 'utf8');
const TITLE = UI.slice(UI.indexOf('export function Title('), UI.indexOf('export function Card('));

describe('Title (every page header)', () => {
  it('aligns its text from the locale, not the native RTL flag', () => {
    expect(TITLE).toMatch(/textAlign: rtl \? 'right' : 'left'/);
    expect(TITLE).not.toContain('I18nManager');
  });

  it('stretches the Text, so textAlign has a box to align within', () => {
    // alignItems: 'flex-end' on the wrapper shrink-wraps the Text to its
    // content; without this a wrapped second line would still align left.
    expect(TITLE).toContain("alignSelf: 'stretch'");
  });

  it('carries the squiggle to the same edge as the heading', () => {
    // TitleSquiggle is a fixed-width child: it mirrors its own path already,
    // but sits where the wrapper's cross-axis alignment puts it.
    expect(TITLE).toMatch(/alignItems: rtl \? 'flex-end' : 'flex-start'/);
  });

  it('derives rtl from the locale context', () => {
    expect(TITLE).toContain("const rtl = dir === 'rtl';");
    expect(TITLE).toContain('const { dir } = useLocale();');
  });
});

describe('header rows mirror their children', () => {
  /**
   * A `flexDirection: 'row'` is NOT swapped for us, for the same boot-order
   * reason: these two rows are headers whose children must lead from the right
   * in Arabic — the Book tab's logo + open-now pill, and Settings' icon +
   * group label above each card.
   */
  const HOME = readFileSync(join(__dirname, '..', '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
  const SETTINGS = readFileSync(join(__dirname, '..', '..', '..', 'app', 'settings.tsx'), 'utf8');

  it('the Book tab header row reverses under Arabic', () => {
    expect(HOME).toMatch(/flexDirection: dir === 'rtl' \? 'row-reverse' : 'row'/);
    expect(HOME).toContain('const { t, dir } = useLocale();');
  });

  it("Settings' group labels put the icon beside the right-aligned text", () => {
    const group = SETTINGS.slice(SETTINGS.indexOf('const groupLabel'));
    expect(group).toMatch(/flexDirection: dir === 'rtl' \? 'row-reverse' : 'row'/);
  });
});
