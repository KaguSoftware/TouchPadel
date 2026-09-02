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
const HOME = readFileSync(join(__dirname, '..', '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
const SETTINGS = readFileSync(join(__dirname, '..', '..', '..', 'app', 'settings.tsx'), 'utf8');

describe('Title (every page header)', () => {
  it('aligns its text from the locale, not the native RTL flag', () => {
    expect(TITLE).toMatch(/textAlign: rtl \? 'right' : 'left'/);
    expect(TITLE).not.toContain('I18nManager');
  });

  it('leaves the heading box full-width, so textAlign has room to work', () => {
    // A first pass added `alignItems: 'flex-end'` to the wrapper and
    // `alignSelf: 'stretch'` to the Text. Checked against a real Yoga layout
    // pass, neither is needed: the wrapper is a column child of a full-width
    // Screen, so the Text box already measures the full content width and
    // `textAlign` alone places the glyphs. `alignItems: flex-end` would in fact
    // shrink-wrap the box to its text. Keep both off the heading.
    const wrapper = TITLE.slice(TITLE.indexOf('<View style='), TITLE.indexOf('<Text'));
    expect(wrapper).not.toContain('alignItems');
    const text = TITLE.slice(TITLE.indexOf('<Text'), TITLE.indexOf('{children}'));
    expect(text).not.toContain('alignSelf');
  });

  it('carries the squiggle to the same edge as the heading', () => {
    // TitleSquiggle is a fixed-width SVG. `textAlign` does not reach it, so it
    // gets its own full-width row that aligns it on the cross axis.
    const tail = TITLE.slice(TITLE.indexOf('{squiggle'));
    expect(tail).toMatch(/alignItems: rtl \? 'flex-end' : 'flex-start'/);
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
  it('the Book tab header row reverses under Arabic', () => {
    expect(HOME).toMatch(/flexDirection: dir === 'rtl' \? 'row-reverse' : 'row'/);
    expect(HOME).toContain('const { t, dir } = useLocale();');
  });

  it("Settings' group labels put the icon beside the right-aligned text", () => {
    const group = SETTINGS.slice(SETTINGS.indexOf('const groupLabel'));
    expect(group).toMatch(/flexDirection: dir === 'rtl' \? 'row-reverse' : 'row'/);
  });
});

describe('English is untouched by the RTL fix', () => {
  /**
   * The point of keying every one of these off `dir` rather than letting RN's
   * `isRTL` swap them: the LTR branch must be exactly what it was before. A
   * logical property (`textAlign: 'start'`, `paddingStart`) would have been the
   * usual way to write this, but RN resolves those through the same lagging
   * native flag — so these are hard 'left'/'right' ternaries, and the risk is
   * getting a branch backwards. That is invisible to typecheck: both branches
   * are the same type. So assert the LTR side by name.
   */
  it('leaves the English heading and squiggle on the left', () => {
    expect(TITLE).toMatch(/textAlign: rtl \? 'right' : 'left'/);
    const tail = TITLE.slice(TITLE.indexOf('{squiggle'));
    expect(tail).toMatch(/alignItems: rtl \? 'flex-end' : 'flex-start'/);
  });

  it('keeps uppercase and negative tracking on the Latin branch only', () => {
    // Cairo has no letter case and breaks apart when tracked; Archivo needs
    // both. Predates this change — pinned so the rtl rename cannot invert it.
    expect(TITLE).toMatch(/textTransform: rtl \? 'none' : 'uppercase'/);
    expect(TITLE).toMatch(/letterSpacing: plain \|\| rtl \? 0 : tracking\(-0\.26\)/);
  });

  it('keeps the tighter all-caps line box on the Latin branch', () => {
    expect(TITLE).toMatch(/dir === 'rtl' \? 1\.45 : 1\.05/);
  });

  it('leaves the English header rows in source order', () => {
    // `row`, not `row-reverse`, is the LTR branch of both header rows.
    for (const src of [HOME, SETTINGS]) {
      expect(src).toMatch(/flexDirection: dir === 'rtl' \? 'row-reverse' : 'row'/);
      expect(src).not.toMatch(/flexDirection: dir === 'rtl' \? 'row' : 'row-reverse'/);
    }
  });
});
