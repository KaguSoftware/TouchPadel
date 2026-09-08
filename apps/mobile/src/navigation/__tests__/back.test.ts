import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE BACK BUTTON IS UIKit's OWN, and these tests keep it that way.
 *
 * `src/navigation/back.ts` is the single home for leaving a screen. The rules
 * below are native-layout and cross-file properties that neither typecheck nor
 * lint can see, so the tests read the source.
 */

const ROOT = join(__dirname, '..', '..', '..');
const BACK = readFileSync(join(ROOT, 'src', 'navigation', 'back.ts'), 'utf8');

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
/** Code only: the design is explained in comments naming the very tokens forbidden below. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (f: string) => stripComments(readFileSync(f, 'utf8'));

describe('back navigation lives in one module', () => {
  it('is the only place router.back / canGoBack is called', () => {
    // A screen calling router.back() directly dead-ends when it was reached by
    // a deep link with no history beneath it — the case useBack() exists for.
    const callers = SOURCES.filter((f) => /router\.back\(\)|canGoBack\(\)/.test(code(f))).map(rel);
    expect(callers).toEqual(['src/navigation/back.ts']);
  });

  it('is the only place beforeRemove is intercepted for navigation', () => {
    // review.tsx also listens, but to RELEASE ITS HOLD on the way out — it
    // never calls preventDefault, so the departure is not guarded.
    const guards = SOURCES.filter((f) => /preventDefault\(\)/.test(code(f))).map(rel);
    expect(guards).toEqual(['src/navigation/back.ts']);
  });

  it('keeps navigation helpers out of the UI primitives', () => {
    const ui = code(join(ROOT, 'src', 'components', 'ui.tsx'));
    expect(ui).not.toMatch(/useRouter|router\.back|useNavigation/);
  });
});

describe('the native back item is never replaced', () => {
  it('never uses usePreventRemove', () => {
    // It registers the route as prevented, and NativeStackView then forces
    // headerBackButtonMenuEnabled: false regardless of what the screen passes.
    // react-native-screens reads that as `disableBackButtonMenu` and swaps
    // UIKit's back item for a plain UIBarButtonItem — a bordered capsule with
    // NO CHEVRON, in the default tint. `beforeRemove` is the event that hook
    // wraps and costs nothing.
    for (const f of SOURCES) {
      expect(code(f), rel(f)).not.toMatch(/\busePreventRemove\b/);
    }
  });

  it('never hand-draws a back item into the header', () => {
    // A JS headerLeft loses the system material, the push/pop animation and
    // the interactive edge-swipe. Every screen is on the root stack precisely
    // so UIKit draws its own (routes.test.ts pins that structure).
    for (const f of SOURCES) {
      expect(code(f), rel(f)).not.toMatch(/headerLeft\s*[:=]/);
    }
  });

  it('never customizes the back title font, which would cost the chevron', () => {
    // `configureBackItem` builds a CUSTOM UIBarButtonItem — again, no chevron —
    // as soon as backTitleFontFamily is anything but "System", or a
    // backTitleFontSize is set. Leaving headerBackTitleStyle unset keeps the
    // native item. See RNSScreenStackHeaderConfig.mm.
    for (const f of SOURCES) {
      expect(code(f), rel(f)).not.toMatch(/headerBackTitleStyle/);
    }
  });
});

describe('the guard cannot trap the user', () => {
  it('ignores the departure it has already released', () => {
    // Without this the action a guard replays is intercepted by that same
    // guard, and the screen can never be left.
    expect(BACK).toMatch(/if \(lifted\.current\) return;/);
  });

  it('replays the blocked action rather than assuming it was a pop', () => {
    // The edge-swipe, the back item and a deep link pushing elsewhere all
    // arrive here; popping regardless would send the user to the wrong place.
    expect(BACK).toContain('navigation.dispatch(action)');
  });

  it('falls back to a real destination when there is no history', () => {
    // Default the tabs; Review overrides it with the availability grid.
    expect(BACK).toMatch(/fallback: Href = '\/\(tabs\)'/);
    expect(BACK).toContain('router.replace(fallback)');
  });
});
