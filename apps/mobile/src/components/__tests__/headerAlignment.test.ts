import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NOTHING MIRRORS BY HAND.
 *
 * Every screen's header is `<Title>`, and for a while it — with MicroLabel,
 * SectionLabel, the Book tab's header row and Settings' group labels — mirrored
 * itself: `textAlign: rtl ? 'right' : 'left'`, `alignItems: rtl ? 'flex-end' :
 * 'flex-start'`, `flexDirection: dir === 'rtl' ? 'row-reverse' : 'row'`. That
 * compensated for a native RTL flag that lagged the chosen language by a JS
 * load.
 *
 * The layout direction now lives on the root view (src/i18n/direction.tsx),
 * and under a real direction those compensations DOUBLE-FLIP: Fabric swaps an
 * explicit textAlign left/right inside an RTL paragraph, and Yoga resolves
 * `row-reverse` against the direction. So they must not come back — the layout
 * mirrors on its own, and a Text leaves `textAlign` unset unless centred.
 *
 * Alignment is a native layout property, invisible to typecheck; lint bans the
 * literal forms (packages/config/src/eslint.js), and these read the source for
 * the shapes lint cannot express.
 */

const ROOT = join(__dirname, '..', '..', '..');
const UI = readFileSync(join(__dirname, '..', 'ui.tsx'), 'utf8');
const TITLE = UI.slice(UI.indexOf('export function Title('), UI.indexOf('export function Card('));
const FIELD = UI.slice(UI.indexOf('export function Field('), UI.indexOf('export function SegmentedControl'));

function walk(d: string, out: string[] = []): string[] {
  for (const name of readdirSync(d)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))];
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

describe('Title (every page header)', () => {
  it('leaves alignment to the layout direction', () => {
    expect(TITLE).not.toMatch(/textAlign/);
    expect(TITLE).not.toContain('I18nManager');
  });

  it('leaves the heading box full-width, so the direction has room to work', () => {
    // Checked against a real Yoga layout pass: the wrapper is a column child of
    // a full-width Screen, so the Text box already measures the full content
    // width. `alignItems` on the wrapper would shrink-wrap it to its text.
    const wrapper = TITLE.slice(TITLE.indexOf('<View style='), TITLE.indexOf('<Text'));
    expect(wrapper).not.toContain('alignItems');
    const text = TITLE.slice(TITLE.indexOf('<Text'), TITLE.indexOf('{children}'));
    expect(text).not.toContain('alignSelf');
  });

  it('carries the squiggle to the leading edge with a logical alignment', () => {
    // TitleSquiggle is a fixed-width SVG on its own row; `flex-start` is
    // logical in Yoga, so it lands on the heading's edge in both languages.
    const tail = TITLE.slice(TITLE.indexOf('{squiggle'));
    expect(tail).toMatch(/alignItems: 'flex-start'/);
    expect(tail).not.toContain('flex-end');
  });

  it('keeps uppercase and negative tracking on the Latin branch only', () => {
    // Cairo has no letter case and breaks apart when tracked; Archivo needs
    // both. Pinned so the rtl rename cannot invert it.
    expect(TITLE).toContain("const rtl = dir === 'rtl';");
    expect(TITLE).toMatch(/textTransform: rtl \? 'none' : 'uppercase'/);
    expect(TITLE).toMatch(/letterSpacing: plain \|\| rtl \? 0 : tracking\(-0\.26\)/);
  });

  it('keeps the tighter all-caps line box on the Latin branch', () => {
    expect(TITLE).toMatch(/dir === 'rtl' \? 1\.45 : 1\.05/);
  });
});

describe('nothing mirrors by hand', () => {
  it('has no row-reverse anywhere — a plain row already mirrors', () => {
    for (const f of SOURCES) {
      expect(readFileSync(f, 'utf8'), rel(f)).not.toContain('row-reverse');
    }
  });

  it("has no physical textAlign on a Text — Field's TextInput is the one exception", () => {
    // TextInput is the one element whose textAlign stays physical on both
    // platforms (Fabric never feeds an input its layout direction), so Field
    // keys it off the locale: one ternary, plus the Latin-content override.
    const physical = /textAlign:[^,\n]*'(left|right)'/g;
    for (const f of SOURCES) {
      const hits = readFileSync(f, 'utf8').match(physical) ?? [];
      expect(hits.length, rel(f)).toBe(rel(f) === 'src/components/ui.tsx' ? 2 : 0);
    }
    expect(FIELD.match(physical)).toHaveLength(2);
    expect(FIELD).toContain('writingDirection: dir');
  });

  it('has no direction-keyed cross-axis alignment', () => {
    for (const f of SOURCES) {
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/\?\s*'flex-(end|start)'\s*:\s*'flex-(start|end)'/);
    }
  });
});
