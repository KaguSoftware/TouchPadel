import { describe, expect, it } from 'vitest';
import { decimalKeystroke } from './decimalInput';

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
