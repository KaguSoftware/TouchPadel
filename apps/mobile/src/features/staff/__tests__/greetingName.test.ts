import { describe, expect, it } from 'vitest';
import { greetingName } from '../greetingName';

describe('greetingName', () => {
  it('is the first name and the surname initial', () => {
    expect(greetingName('Sait Aydin')).toBe('Sait.A');
    expect(greetingName('  Sait   Aydin ')).toBe('Sait.A');
    expect(greetingName('Ali Bin Hassan')).toBe('Ali.H');
  });
  it('capitalises Latin names however they were typed', () => {
    expect(greetingName('sait aydin')).toBe('Sait.A');
    expect(greetingName('SAIT AYDIN')).toBe('Sait.A');
  });
  it('keeps Arabic as is, with no capitals', () => {
    expect(greetingName('سعيد الأحمد')).toBe('سعيد.ا');
  });
  it('leaves a single word as written', () => {
    expect(greetingName('Sait')).toBe('Sait');
    expect(greetingName('')).toBe('');
  });
});
