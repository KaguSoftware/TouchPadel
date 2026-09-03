import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LIVE DIRECTION.
 *
 * The layout direction is app state: `useLocale().dir` → `DirectionRoot`, a
 * Yoga `direction` style on the root view, mirrored by Fabric for every
 * descendant the moment the language changes. What Yoga does not mirror —
 * drawings, decorative art in physical coordinates — is handled explicitly.
 * These pin the wiring, which no typecheck can see.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const LAYOUT = read('app', '_layout.tsx');
const DIRECTION = read('src', 'i18n', 'direction.tsx');
const ICONS = read('src', 'components', 'icons.tsx');
const WELCOME = read('app', 'welcome.tsx');
const COURT = read('src', 'components', 'CourtIllustration.tsx');

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
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Files that draw in physical coordinates on purpose (eslint override, same list). */
const PHYSICAL_ART = new Set(['src/components/CourtIllustration.tsx']);
const isGeometry = (f: string) => f.startsWith('src/features/courtTransition/');

describe('DirectionRoot', () => {
  it('renders the direction the locale resolves to', () => {
    expect(DIRECTION).toContain('const { dir } = useLocale();');
    expect(DIRECTION).toMatch(/direction: dir \}/);
  });

  it('crossfades with an opaque cover, never with the tree\'s own opacity', () => {
    // The tree hosts UIKit material (native bar, tab-bar blur, BlurView), which
    // breaks under an ancestor alpha below 1.
    const root = DIRECTION.slice(DIRECTION.indexOf('export function DirectionRoot('), DIRECTION.indexOf('export function LtrIsland('));
    expect(root).toContain('useLocaleSwitch()');
    expect(root.indexOf('{children}')).toBeLessThan(root.indexOf('opacity: cover'));
    expect(root).toMatch(/<View style=\{\{ flex: 1, direction: dir \}\}>/);
  });

  it('wraps the navigator, the offline banner and the toast host', () => {
    const order = ['<LocaleProvider', '<DirectionRoot>', '<ToastProvider>', '<RootStack', '<ConnectivityBanner', '</ToastProvider>', '</DirectionRoot>'];
    const app = LAYOUT.slice(LAYOUT.indexOf('function AppRoot('));
    let last = -1;
    for (const marker of order) {
      const at = app.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
  });

  it('is the shell of the two fallback screens too', () => {
    const shell = LAYOUT.slice(LAYOUT.indexOf('function FallbackShell('), LAYOUT.indexOf('export function ErrorBoundary('));
    expect(shell).toContain('const locale = lastKnownLocale();');
    expect(shell).toContain('<LocaleProvider key={locale} initialLocale={locale}>');
    expect(shell).toContain('<DirectionRoot>');
    for (const screen of ['export function ErrorBoundary(', 'function ConfigErrorScreen()']) {
      const body = LAYOUT.slice(LAYOUT.indexOf(screen));
      expect(body.slice(0, body.indexOf('\n}\n')), screen).toContain('<FallbackShell>');
    }
  });
});

describe('drawings mirror themselves — Yoga never flips path data', () => {
  it('every directional icon passes flip', () => {
    expect(ICONS).toMatch(/export const ChevronIcon = [^\n]*\bflip\b/);
    expect(ICONS).toMatch(/export const BackChevronIcon = [^\n]*\bflip\b/);
    expect(ICONS.slice(ICONS.indexOf('function StrokeIcon('), ICONS.indexOf('export const CalendarIcon'))).toContain('flip ? mirror(dir)');
    expect(ICONS.slice(ICONS.indexOf('export function TitleSquiggle('))).toContain('mirror(dir)');
  });

  it('never mirrors the Google mark (brand rule)', () => {
    const mark = ICONS.slice(ICONS.indexOf('export const GoogleGMark'));
    expect(mark).not.toMatch(/mirror|flip|scaleX/);
  });

  it('mirrors the welcome underline stroke, and only that', () => {
    // The padel ball is symmetric about its axis (and a brand mark): no flip.
    expect(WELCOME.match(/mirror\(dir\)/g)).toHaveLength(1);
    const underline = WELCOME.slice(WELCOME.indexOf('<Svg'), WELCOME.indexOf('</Svg>'));
    expect(underline).toContain('mirror(dir)');
    const ball = WELCOME.slice(WELCOME.indexOf('<PadelBallIcon') - 400, WELCOME.indexOf('<PadelBallIcon'));
    expect(ball).not.toContain('mirror(dir)');
  });

  it('hand-rolls no scaleX flip anywhere else', () => {
    for (const f of SOURCES) {
      if (rel(f) === 'src/i18n/direction.tsx') continue;
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/scaleX:\s*(-1|dir)/);
    }
  });
});

describe('physical art lives on an LTR island', () => {
  it('CourtIllustration roots in LtrIsland', () => {
    expect(COURT).toContain("import { LtrIsland } from '../i18n/direction';");
    expect(COURT).toMatch(/<LtrIsland\s/);
    expect(COURT).toContain('</LtrIsland>');
  });

  it('keeps physical left/right styles inside the island files', () => {
    for (const f of SOURCES) {
      const r = rel(f);
      if (PHYSICAL_ART.has(r) || isGeometry(r)) continue;
      expect(readFileSync(f, 'utf8'), r).not.toMatch(/^\s+(left|right|marginLeft|marginRight|paddingLeft|paddingRight):/m);
    }
  });
});

describe('lists', () => {
  it('has no horizontal virtualized list', () => {
    // @react-native/virtualized-lists keys ALL of its horizontal RTL offset
    // math on I18nManager.isRTL, which this app pins false: under the RTL
    // root Yoga would lay cells out right-to-left while the list believed the
    // opposite (blank cells, mirrored scrollToIndex). Plain ScrollViews follow
    // the node direction natively on both platforms.
    for (const f of SOURCES) {
      const src = stripComments(readFileSync(f, 'utf8'));
      if (/<(FlatList|SectionList|VirtualizedList)\b/.test(src)) {
        expect(src, rel(f)).not.toMatch(/\bhorizontal\b/);
      }
    }
  });
});

describe('paragraphs carry a base writing direction', () => {
  /**
   * Yoga mirrors the BOX; the text engine decides where the line sits inside
   * it. With `textAlign` unset — the rule everywhere here — iOS falls back to
   * NSTextAlignmentNatural with NSWritingDirectionNatural, which reads the
   * FIRST STRONG CHARACTER of the string. So in Arabic a heading holding a
   * court name, a booking reference, a price or a person's name stayed pinned
   * to the left while its page had mirrored (Android already resolved this
   * against the layout direction). src/i18n/text.tsx names the direction
   * instead, and every screen takes Text from there.
   */
  const TEXT = read('src', 'i18n', 'text.tsx');

  it('sets the writing direction from the locale, ahead of the caller style', () => {
    expect(TEXT).toContain('const { dir } = useLocale();');
    expect(TEXT).toMatch(/style=\{\[\{ writingDirection: dir \}, style\]\}/);
  });

  it('is the only module that may import Text from react-native', () => {
    const importers = SOURCES.filter((f) =>
      /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*'react-native'/.test(readFileSync(f, 'utf8')),
    ).map(rel);
    expect(importers).toEqual(['src/i18n/text.tsx']);
  });

  it('is where every screen and component gets Text', () => {
    for (const f of SOURCES) {
      const src = stripComments(readFileSync(f, 'utf8'));
      if (!/<Text[\s/>]/.test(src) || rel(f) === 'src/i18n/text.tsx') continue;
      // `Text` among the names, not necessarily alone: the segmented control
      // takes AnimatedText from the same module in the same statement.
      expect(src, rel(f)).toMatch(/import \{[^}]*\bText\b[^}]*\} from '[^']*i18n\/text';/);
    }
  });

  /**
   * A plain function component never subscribes to an `Animated` style value,
   * so an interpolated color reaches native unresolved and paints BLACK. The
   * animated wrapper has to wrap THIS module's Text, or an animated label
   * silently loses the writing direction every other label carries.
   */
  it('offers an animated Text that keeps the direction, wrapping its own', () => {
    expect(TEXT).toMatch(/Animated\.createAnimatedComponent\(Text\)/);
    for (const f of SOURCES) {
      const src = stripComments(readFileSync(f, 'utf8'));
      if (!/<AnimatedText[\s/>]/.test(src)) continue;
      expect(src, rel(f)).toMatch(/import \{[^}]*\bAnimatedText\b[^}]*\} from '[^']*i18n\/text';/);
    }
  });

  /**
   * The whole point of the animated label: an interpolation handed to a plain
   * `Text` is the black-in-dark-mode bug. Pin the segmented control's label to
   * the animated component.
   */
  /**
   * The language picker is the ONE control whose segment order is fixed. Its
   * options are not a mirrorable list but a pair of destinations: mirroring it
   * means the app flips as the guest taps, and the option they just chose
   * swaps to the other side under their finger. Every OTHER segmented control
   * — appearance, duration — is ordinary UI and must keep mirroring, so this
   * pins both halves: the language pickers opt in, the others do not.
   */
  it('pins the language picker order and leaves every other control mirroring', () => {
    const ui = stripComments(read('src', 'components', 'ui.tsx'));
    expect(ui).toMatch(/pinOrder \? \{ direction: 'ltr' as const \} : null/);
    // A pinned track measures left-to-right, so the thumb must not fold back.
    expect(ui).toContain("const rtl = dir === 'rtl' && !pinOrder;");

    const LANGUAGE_PICKERS = ['app/settings.tsx', 'app/sign-up.tsx', 'app/complete-profile.tsx'];
    for (const f of LANGUAGE_PICKERS) {
      const src = stripComments(read(...f.split('/')));
      const locale = src.slice(src.indexOf('<SegmentedControl<Locale>'));
      expect(locale.slice(0, locale.indexOf('/>')), f).toContain('pinOrder');
    }

    // The appearance picker sits in the same file and must NOT be pinned.
    const settings = stripComments(read('app', 'settings.tsx'));
    const appearance = settings.slice(settings.indexOf('<SegmentedControl<AppearancePreference>'));
    expect(appearance.slice(0, appearance.indexOf('/>'))).not.toContain('pinOrder');
  });

  it('renders the segmented control label through the animated Text', () => {
    const ui = stripComments(read('src', 'components', 'ui.tsx'));
    expect(ui).toMatch(/<AnimatedText style=\{\[style, \{ color \}\]\}>/);
  });
});
