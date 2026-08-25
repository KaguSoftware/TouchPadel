import { describe, expect, it } from 'vitest';
import { isValidChatId, normalizeChatId } from './chatId';

describe('chat id', () => {
  it('accepts group (negative) and private ids of 5–20 digits', () => {
    expect(isValidChatId('-1001234567890')).toBe(true);
    expect(isValidChatId('12345')).toBe(true);
    expect(isValidChatId('-12345')).toBe(true);
    expect(isValidChatId('1'.repeat(20))).toBe(true);
  });

  it('rejects short, long, and non-numeric values', () => {
    expect(isValidChatId('1234')).toBe(false);
    expect(isValidChatId('1'.repeat(21))).toBe(false);
    expect(isValidChatId('--12345')).toBe(false);
    expect(isValidChatId('abc12345')).toBe(false);
    expect(isValidChatId('')).toBe(false);
    expect(isValidChatId('12345.6')).toBe(false);
  });

  it('normalizes Arabic-Indic digits and whitespace', () => {
    expect(normalizeChatId(' -١٠٠١٢٣٤٥ ')).toBe('-10012345');
    expect(isValidChatId(normalizeChatId('-١٠٠١٢٣٤٥'))).toBe(true);
  });
});
