import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PhoneField renders its country chip as `Field`'s `lead` adornment: one flex
 * row, wrapped by one border. None of what keeps that correct is typecheckable,
 * so it is read from the source instead:
 *
 *  - the layout must stay measurement-free (the earlier absolute overlay
 *    double-counted padding and flashed the digits under the chip);
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

describe('PhoneField', () => {
  it('lays the chip out as a real row child, not a measured overlay', () => {
    // The overlay version grew the input's paddingStart to the chip's
    // onLayout width. That double-counted the chip's trailing padding, and on
    // the first render the width was still 0 so the digits sat under the chip.
    // Both bugs are structural, so they are pinned structurally.
    expect(PHONE_CODE).not.toContain('onLayout');
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
    expect(FIELD).toMatch(/lead\s*\n?\s*\?\s*\[chrome, ring/);
  });

  it('scales the divider with the field height instead of a flat inset', () => {
    // A fixed number suited one of the two field sizes and rode too low on
    // the other; it is now the field's own vertical padding, trimmed.
    expect(PHONE_CODE).toContain('const DIVIDER_TRIM');
    expect(PHONE_CODE).toMatch(/dividerInset\s*=\s*\(dense \? 13 : 14\) - DIVIDER_TRIM/);
    expect(PHONE_CODE).not.toContain('DIVIDER_INSET');
  });

  it('positions the divider with logical insets, so it mirrors on its own', () => {
    expect(PHONE).toMatch(/\bend: 0/);
    expect(PHONE).not.toMatch(/\b(left|right): 0/);
  });
});
