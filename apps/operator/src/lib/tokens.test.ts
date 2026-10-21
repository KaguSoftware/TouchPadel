import { describe, expect, it } from 'vitest';
import { OPERATOR_SCOPE_GROUNDS, operatorBlueVars, operatorPalette, operatorVars, themeCss } from '@touch/ui';

// apps/operator/CLAUDE.md "i18n and styling": every new colour token needs a
// blue-mode value in operatorBlue.ts. The coaching lesson family
// (docs/design/coaching/operator.md §5.8, §1.11) is pinned here so a later
// edit cannot leave lesson tiles painted in paper colours on the blue page.

const paper = operatorVars as Record<string, string>;
const blue = operatorBlueVars as Record<string, string>;

describe('lesson tokens (coaching operator.md §5.8)', () => {
  const lessonNames = Object.keys(paper).filter((name) => name.startsWith('--tp-lesson'));

  it('declares the two lesson tokens on paper', () => {
    expect(lessonNames.sort()).toEqual(['--tp-lesson', '--tp-lesson-soft']);
  });

  it('gives every --tp-lesson* token a blue-mode value', () => {
    for (const name of lessonNames) {
      expect(blue[name], name).toBeTruthy();
      expect(blue[name], name).not.toBe(paper[name]);
    }
  });

  it('keeps the lesson hue (318) on paper, clear of the accent, green, warn and danger hues', () => {
    expect(paper['--tp-lesson']).toMatch(/ 318\)$/);
    expect(paper['--tp-lesson-soft']).toMatch(/ 318\)$/);
  });
});

describe('tournament tokens (tournaments build contracts §1.11)', () => {
  const names = Object.keys(paper).filter((name) => name.startsWith('--tp-tournament'));

  it('declares the two tournament tokens on paper, each with a blue-mode value', () => {
    expect(names.sort()).toEqual(['--tp-tournament', '--tp-tournament-soft']);
    for (const name of names) {
      expect(blue[name], name).toBeTruthy();
      expect(blue[name], name).not.toBe(paper[name]);
    }
  });

  it('keeps the tournament hue (195) on paper, clear of the lesson violet', () => {
    expect(paper['--tp-tournament']).toMatch(/ 195\)$/);
    expect(paper['--tp-tournament-soft']).toMatch(/ 195\)$/);
  });
});

// ---------------------------------------------------------------------------
// Panel colours pass (owner, 2026-10-17). Every text pair clears WCAG AA 4.5:1
// and every boundary / dot / pill clears 3:1, in both appearances, computed
// from the token values themselves so a later edit cannot drift under them.
// ---------------------------------------------------------------------------

const operatorTheme = { ...(operatorPalette as Record<string, string>), ...paper };

function resolve(name: string, vars: Record<string, string>, depth = 0): string {
  const raw = vars[name] ?? operatorTheme[name];
  if (!raw) throw new Error(`no token ${name}`);
  const ref = /^var\((--tp-[\w-]+)\)$/.exec(raw.trim());
  if (ref && depth < 8) return resolve(ref[1]!, vars, depth + 1);
  return raw.trim();
}

function srgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
  }
  const ok = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (ok) {
    const L = Number(ok[1]) / 100;
    const C = Number(ok[2]);
    const h = (Number(ok[3]) * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return lin.map((c) => {
      const v = Math.min(1, Math.max(0, c));
      return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    }) as [number, number, number];
  }
  throw new Error(`cannot measure ${value}`);
}

function luminance(value: string): number {
  const [r, g, b] = srgb(value).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(fg: string, bg: string, vars: Record<string, string>): number {
  const x = luminance(resolve(fg, vars));
  const y = luminance(resolve(bg, vars));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['--tp-fg', '--tp-bg'],
  ['--tp-fg', '--tp-surface'],
  ['--tp-fg', '--tp-surface-2'],
  ['--tp-muted-fg', '--tp-bg'],
  ['--tp-muted-fg', '--tp-surface'],
  ['--tp-muted-fg', '--tp-surface-2'],
  ['--tp-hover-fg', '--tp-hover'],
  ['--tp-accent-soft-fg', '--tp-accent-soft'],
  ['--tp-accent-contrast', '--tp-accent'],
  ['--tp-danger-contrast', '--tp-danger'],
  ['--tp-rail-fg', '--tp-rail'],
  ['--tp-rail-muted', '--tp-rail'],
  ['--tp-rail-fg', '--tp-rail-2'],
  ['--tp-rail-active-fg', '--tp-rail-active'],
  ['--tp-accent-2-contrast', '--tp-accent-2'],
  ['--tp-success-fg', '--tp-success-soft'],
  ['--tp-warn-fg', '--tp-warn-soft'],
  ['--tp-danger-fg', '--tp-danger-soft'],
  ['--tp-neutral-fg', '--tp-neutral-soft'],
  ['--tp-info-fg', '--tp-info-soft'],
  ['--tp-heading', '--tp-bg'],
  ['--tp-panel-head-fg', '--tp-panel-head'],
  ['--tp-group-head-fg', '--tp-group-head'],
  ['--tp-fg', '--tp-panel-body'],
  ['--tp-table-head-fg', '--tp-table-head'],
  ['--tp-selected-fg', '--tp-selected'],
  ['--tp-table-total-fg', '--tp-table-total'],
  ['--tp-total-card-fg', '--tp-total-card'],
  ['--tp-total-card-muted', '--tp-total-card'],
  ['--tp-seg-fg', '--tp-seg-track'],
  ['--tp-seg-fg', '--tp-seg-hover'],
  ['--tp-seg-on-fg', '--tp-seg-on'],
];

const MARK_PAIRS: Array<[string, string]> = [
  ['--tp-border-input', '--tp-surface'],
  ['--tp-border-input', '--tp-bg'],
  ['--tp-rail-active', '--tp-rail'],
  ['--tp-success-mark', '--tp-surface'],
  ['--tp-warn-mark', '--tp-surface'],
  ['--tp-danger-mark', '--tp-surface'],
];

describe.each([
  ['paper', {} as Record<string, string>],
  ['blue mode', blue],
])('panel colours (2026-10-17): %s', (_mode, overrides) => {
  const vars = { ...operatorTheme, ...overrides };

  it.each(TEXT_PAIRS)('%s on %s clears 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg, vars)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARK_PAIRS)('%s against %s clears 3:1', (fg, bg) => {
    expect(contrast(fg, bg, vars)).toBeGreaterThanOrEqual(3);
  });
});

describe('panel colours (2026-10-17): where the real blue sits', () => {
  it('paints the paper rail and the blue-mode page in Touch Blue itself', () => {
    expect(resolve('--tp-rail', {})).toBe('#3360AB');
    expect(resolve('--tp-bg', blue)).toBe('#3360AB');
  });

  it('makes the blue-mode rail darker than the page it frames', () => {
    expect(luminance(resolve('--tp-rail', blue))).toBeLessThan(luminance(resolve('--tp-bg', blue)));
  });

  it('marks the current page with Padel Green in both modes', () => {
    expect(resolve('--tp-rail-active', {})).toBe('#A5D06F');
    expect(resolve('--tp-rail-active', blue)).toBe('#A5D06F');
  });
});

// ---------------------------------------------------------------------------
// Round 3 cross scopes (2026-10-18): a solid band or selected row borrows the
// other mode's palette for its contents. Those contents must read on it.
// ---------------------------------------------------------------------------

describe('panel colours round 3: the cross scopes', () => {
  const paperVars = { ...operatorTheme };
  const blueVars = { ...operatorTheme, ...blue };
  const INK = ['--tp-fg', '--tp-muted-fg', '--tp-accent'];

  it.each(INK)('blue-mode %s reads on the paper Touch Blue panel band', (ink) => {
    expect(ratioOf(resolve(ink, blueVars), resolve('--tp-panel-head', paperVars))).toBeGreaterThanOrEqual(4.5);
  });

  // Blue mode's band is navy (Sait, 2026-10-21) and keeps its own palette.
  it.each(INK)('blue-mode %s reads on the blue-mode navy band', (ink) => {
    expect(ratioOf(resolve(ink, blueVars), resolve('--tp-panel-head', blueVars))).toBeGreaterThanOrEqual(4.5);
  });

  // The selected row is Padel Green in both modes (Sait, 2026-10-19): paper
  // ink on it, with grey text and accent ink pinned to the row's navy.
  it.each(INK)('%s reads on the green selected row in both modes', (ink) => {
    const onRow = { '--tp-muted-fg': 'var(--tp-selected-fg)', '--tp-accent': 'var(--tp-selected-fg)' };
    for (const vars of [paperVars, blueVars]) {
      expect(ratioOf(resolve(ink, { ...paperVars, ...onRow }), resolve('--tp-selected', vars))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('emits both scopes and leaves the grounds to their own mode', () => {
    expect(themeCss).toContain("[data-theme='operator'][data-mode='blue'] .tp-paper");
    expect(themeCss).toContain("[data-theme='operator']:not([data-mode='blue']) .tp-band");
    expect(themeCss).not.toContain("[data-theme='operator'][data-mode='blue'] .tp-band");
    expect(themeCss).toContain("[data-theme='operator'][data-mode='blue'] .tp-table tbody tr[data-selected='true']");
    expect(themeCss).toContain('--tp-muted-fg: var(--tp-selected-fg);');
    const scopes = themeCss.slice(themeCss.indexOf("[data-mode='blue'] .tp-paper"));
    const firstBlock = scopes.slice(0, scopes.indexOf('}'));
    for (const ground of OPERATOR_SCOPE_GROUNDS) expect(firstBlock).not.toContain(`${ground}:`);
    expect(firstBlock).toContain('--tp-fg:');
  });
});

function ratioOf(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
