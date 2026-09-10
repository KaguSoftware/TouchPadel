import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PhoneField renders its country chip as `Field`'s `lead` adornment: one flex
 * row, wrapped by one border. None of what keeps that correct is typecheckable,
 * so it is read from the source instead:
 *
 *  - the CHIP's layout must stay measurement-free (the earlier absolute
 *    overlay double-counted padding and flashed the digits under the chip);
 *    the country sheet below it does measure its own height, which is a
 *    different concern — see the note on that assertion;
 *  - the divider-to-digit gap must have exactly ONE source;
 *  - the chip must NOT restate Field's input styling — the app's one physical
 *    `textAlign` is Field's, and headerAlignment.test.ts allows it in ui.tsx
 *    alone (a fork here would be invisible to that test's per-file count).
 */
const DIR = join(__dirname, '..');
const PHONE = readFileSync(join(DIR, 'phone.tsx'), 'utf8');
/** Comments stripped: this file EXPLAINS the overlay it no longer uses. */
const PHONE_CODE = PHONE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const UI = readFileSync(join(DIR, 'ui.tsx'), 'utf8');

/**
 * Just the PhoneField component — from its export to the start of the next
 * top-level declaration. The chip's rules are about THIS component; the file
 * also holds the country-picker sheet, which plays by different ones.
 */
function phoneFieldSource(): string {
  const from = PHONE_CODE.indexOf('export function PhoneField');
  const next = PHONE_CODE.indexOf('\nconst CHIP_GAP', from);
  expect(from).toBeGreaterThan(-1);
  expect(next).toBeGreaterThan(from);
  return PHONE_CODE.slice(from, next);
}

describe('PhoneField', () => {
  it('lays the chip out as a real row child, not a measured overlay', () => {
    // The overlay version grew the input's paddingStart to the chip's
    // onLayout width. That double-counted the chip's trailing padding, and on
    // the first render the width was still 0 so the digits sat under the chip.
    // Both bugs are structural, so they are pinned structurally.
    // Scoped to PhoneField itself. The CountryPicker sheet further down the
    // file legitimately measures its own height (the drawer's slide distance
    // must be a number — the native driver ignores percentage transforms), and
    // a file-wide match would forbid that unrelated, correct use.
    expect(phoneFieldSource()).not.toContain('onLayout');
    expect(PHONE_CODE).not.toContain('chipWidth');
    expect(PHONE_CODE).toContain('lead={');
  });

  it('leaves the same gap on BOTH sides of the divider', () => {
    // The digits ran flush against the hairline once: the chip's paddingEnd
    // sits BEFORE the divider (it is drawn at the chip's trailing edge), so it
    // never spaced the text on the far side. Field supplies that half. The two
    // live in different files, so they are pinned to agree here — if they
    // drift, the separator stops being centred between code and number.
    const chip = PHONE.match(/const CHIP_GAP = (\d+);/);
    const lead = UI.match(/const LEAD_GAP = (\d+);/);
    expect(chip, 'phone.tsx still names its chip gap').not.toBeNull();
    expect(lead, 'ui.tsx still names the post-adornment gap').not.toBeNull();
    expect(Number(lead![1]), 'divider gap is symmetric').toBe(Number(chip![1]));

    // The chip's side additionally corrects for the caret's rotation overhang,
    // so the OPTICAL gap matches rather than just the declared padding.
    expect(PHONE_CODE).toContain('paddingEnd: CHIP_GAP + CHEVRON_BLEED');
  });

  it('gives the gap after the divider exactly once', () => {
    // CHIP_GAP is the whole distance from divider to first digit: Field
    // contributes no leading padding when it has an adornment. Two sources
    // for one gap is precisely what made the number look pushed off-centre.
    expect(PHONE).toMatch(/const CHIP_GAP = \d+;/);
    expect(PHONE).toContain('paddingEnd: CHIP_GAP');

    const FIELD = UI.slice(UI.indexOf('export function Field('));
    expect(FIELD, 'Field owns the gap after an adornment').toContain(
      'paddingStart: lead ? LEAD_GAP : space.m',
    );
  });

  it("starts the chip at Field's own inset, so it aligns with the fields around it", () => {
    // A literal here (13, say) would sit a pixel off the name field directly
    // above it on edit-profile.
    expect(PHONE).toContain('paddingStart: space.m');
  });

  it('reuses Field rather than forking its TextInput', () => {
    expect(PHONE).toContain('<Field');
    // The fork would show up as these: Field's own input, restated. Comments
    // are stripped first — this file explains WHY it does not set textAlign.
    expect(PHONE_CODE).not.toContain('<TextInput');
    expect(PHONE_CODE).not.toMatch(/textAlign/);
  });

  it('keeps the border around BOTH the chip and the input', () => {
    // Drawn on the wrapping row when there is an adornment — otherwise the
    // chip would sit outside a box drawn around the text alone, and the focus
    // ring would light up only half the control.
    const FIELD = UI.slice(UI.indexOf('export function Field('));
    expect(FIELD).toContain('const chrome = {');
    expect(FIELD).toContain('...(lead ? null : chrome)');
    // `chrome` and `ring` lead the wrapping row's style array. Matched as the
    // first two entries rather than the whole array, so the row may carry
    // further styles after them (it also holds the physical-direction pin for
    // `ltrBox`) without this reading as a regression.
    expect(FIELD).toMatch(/lead\s*\n?\s*\?\s*\[\s*chrome,\s*ring\b/);
  });

  it('scales the divider with the field height instead of a flat inset', () => {
    // A fixed number suited one of the two field sizes and rode too low on
    // the other; it is now the field's own vertical padding, trimmed.
    expect(PHONE_CODE).toContain('const DIVIDER_TRIM');
    expect(PHONE_CODE).toMatch(/dividerInset\s*=\s*\(dense \? 13 : 14\) - DIVIDER_TRIM/);
    expect(PHONE_CODE).not.toContain('DIVIDER_INSET');
  });

  it('keeps the digits when the country changes, re-capped for the new one', () => {
    // Typing the number first and fixing the code afterwards is the ordinary
    // filling order, and the picker used to wipe the field for it. The number
    // now survives; it is only re-sanitised, because the field's `maxLength`
    // is per-country and a longer value would be stranded above it.
    const src = phoneFieldSource();
    expect(src, 'the picker no longer clears the number').not.toContain("onChangeNational('')");
    expect(src).toContain('sanitizeNationalInput(national, next)');
  });

  it('positions the divider with logical insets, so it mirrors on its own', () => {
    expect(PHONE).toMatch(/\bend: 0/);
    expect(PHONE).not.toMatch(/\b(left|right): 0/);
  });
});

/**
 * The country sheet's motion. Frame pacing needs a device, but the things that
 * silently break it are structural and readable here — each of these pins a
 * bug that actually shipped during this component's development.
 */
describe('CountryPicker motion', () => {
  it('drives the transform with numbers, never a percentage', () => {
    // '100%' type-checks, lints and passes every unit test — and animates
    // NOTHING, because the native driver interpolates transforms numerically
    // and drops percentage strings. The sheet simply appeared and vanished.
    const ranges = [...PHONE_CODE.matchAll(/outputRange:\s*\[([^\]]*)\]/g)].map((m) => m[1]!);
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r).not.toContain('%');
  });

  it('keeps the spring rest thresholds in the units of a 0 → 1 progress', () => {
    // These are in the units of the animated value, and that value is
    // normalised. Pixel-scale thresholds (0.5 against a total range of 1.0)
    // let the spring call itself finished half a travel from home, and the
    // drawer jumped the remainder in one frame.
    const disp = PHONE_CODE.match(/restDisplacementThreshold:\s*([\d.]+)/);
    const speed = PHONE_CODE.match(/restSpeedThreshold:\s*([\d.]+)/);
    expect(disp).not.toBeNull();
    expect(speed).not.toBeNull();
    expect(Number(disp![1])).toBeLessThanOrEqual(0.01);
    expect(Number(speed![1])).toBeLessThanOrEqual(0.01);
  });

  it('stays critically damped, so the sheet never bounces onto its rest', () => {
    const k = Number(PHONE_CODE.match(/stiffness:\s*([\d.]+)/)![1]);
    const c = Number(PHONE_CODE.match(/damping:\s*([\d.]+)/)![1]);
    const m = Number(PHONE_CODE.match(/mass:\s*([\d.]+)/)![1]);
    // Stiffness and damping must move together: raising one alone to speed the
    // sheet up drops zeta below 1 and puts a bounce on the end of the travel.
    const zeta = c / (2 * Math.sqrt(k * m));
    expect(zeta).toBeGreaterThanOrEqual(0.95);
  });

  it('waits for the modal to lay out before starting the spring', () => {
    // Presenting a Modal costs several frames on both platforms. A spring
    // started in the mounting commit burns them off-screen, so the sheet
    // enters part-way up and covers only the remainder — a visible jump.
    expect(PHONE_CODE).toContain('if (visible && !staged)');
    // And the stage is per-presentation: a reopen must wait for its OWN
    // window, not ride the previous one's flag.
    expect(PHONE_CODE).toContain('if (visible) setStaged(false);');
  });

  it('gives the sheet a real height, so the flexed list can take space from it', () => {
    // `maxHeight: '85%'` sizes the sheet from its content, and a `flex: 1`
    // list inside a content-sized parent divides a space of zero — the rows
    // collapsed and the sheet opened empty on Android. The pair has to agree:
    // a real height on the box is what the list's flex draws from.
    expect(PHONE_CODE).toMatch(/height:\s*'85%'/);
    expect(PHONE_CODE).not.toMatch(/maxHeight:\s*'85%'/);
    expect(PHONE_CODE).toMatch(/style=\{\{\s*flex:\s*1,\s*marginTop/);
  });

  it('animates opacity and transform only — the native driver runs no others', () => {
    expect(PHONE_CODE).toContain('useNativeDriver: true');
    expect(PHONE_CODE).not.toContain('useNativeDriver: false');
  });
});
