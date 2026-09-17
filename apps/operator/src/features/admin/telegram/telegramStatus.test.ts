import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CHAT_ID, STUCK_AFTER_MS, telegramHealth } from './telegramStatus';

// "Are staff being told?" is answered from the saved settings and the newest
// outbox row alone, so each state below must come out of exactly that.

const NOW = Date.parse('2026-09-17T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const on = { enabled: true, chatId: '-1002233445566' };

describe('telegramHealth', () => {
  it('off wins over everything: a switched-off channel is a choice', () => {
    expect(telegramHealth({ enabled: false, chatId: null }, { status: 'failed', created_at: ago(0) }, NOW)).toBe('off');
  });

  it('on with no group, or with the example number, has nowhere to send', () => {
    expect(telegramHealth({ enabled: true, chatId: null }, null, NOW)).toBe('noGroup');
    expect(telegramHealth({ enabled: true, chatId: '  ' }, null, NOW)).toBe('noGroup');
    expect(telegramHealth({ enabled: true, chatId: PLACEHOLDER_CHAT_ID }, { status: 'sent', created_at: ago(0) }, NOW)).toBe('noGroup');
  });

  it('reads the newest message: none or skipped is untested, failed is failing, sent is working', () => {
    expect(telegramHealth(on, null, NOW)).toBe('untested');
    expect(telegramHealth(on, { status: 'skipped', created_at: ago(0) }, NOW)).toBe('untested');
    expect(telegramHealth(on, { status: 'failed', created_at: ago(0) }, NOW)).toBe('failing');
    expect(telegramHealth(on, { status: 'sent', created_at: ago(0) }, NOW)).toBe('working');
  });

  it('a queued message is on its way until it has waited too long', () => {
    expect(telegramHealth(on, { status: 'queued', created_at: ago(10_000) }, NOW)).toBe('sending');
    expect(telegramHealth(on, { status: 'queued', created_at: ago(STUCK_AFTER_MS + 1) }, NOW)).toBe('stuck');
  });
});
