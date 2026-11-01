import { describe, expect, it } from 'vitest';
import { decimalKeystroke, digitsProblem, hasNonEnglishDigits } from './decimalInput';

describe('decimalKeystroke', () => {
  it('keeps digits and one decimal point, and drops everything else', () => {
    expect(decimalKeystroke('1500')).toBe('1500');
    expect(decimalKeystroke('20.')).toBe('20.');
    expect(decimalKeystroke('1.2.3')).toBe('1.23');
    expect(decimalKeystroke('12 kg')).toBe('12');
    expect(decimalKeystroke('-5')).toBe('5');
    expect(decimalKeystroke('')).toBe('');
  });

  it('reads Arabic-Indic and Persian digits, and the Arabic decimal separator, as a number', () => {
    expect(decimalKeystroke('١٥٠٠')).toBe('1500');
    expect(decimalKeystroke('۱۲۳')).toBe('123');
    expect(decimalKeystroke('٢٫٥')).toBe('2.5');
    expect(decimalKeystroke('٣5')).toBe('35');
  });

  it('stops at ten digits, the point not counted', () => {
    expect(decimalKeystroke('12345678901')).toBe('1234567890');
    expect(decimalKeystroke('123456789.012')).toBe('123456789.0');
    expect(decimalKeystroke('١٢٣٤٥٦٧٨٩٠١')).toBe('1234567890');
  });
});

describe('English digits only (F-35)', () => {
  it('finds Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
    expect(hasNonEnglishDigits('٢٥٠٠٠')).toBe(true);
    expect(hasNonEnglishDigits('۱۲')).toBe(true);
    expect(hasNonEnglishDigits('1٫5')).toBe(true);
    expect(hasNonEnglishDigits('25000')).toBe(false);
    expect(hasNonEnglishDigits('')).toBe(false);
  });
  it('names the problem so the box can say it', () => {
    expect(digitsProblem('٣')).toBe('englishDigits');
    expect(digitsProblem('3')).toBeNull();
  });
});
