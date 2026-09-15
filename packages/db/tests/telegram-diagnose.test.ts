/**
 * Pure interpretation tests for `_shared/telegramDiagnose.ts` (no DB, no
 * network). The Bot API envelopes below are the real shapes Telegram answers
 * with — including the one that started this: `chat not found` for the
 * placeholder chat id that an e2e run saved on the hosted project.
 */
import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_CHAT_ID,
  WEBHOOK_ALLOWED_UPDATES,
  checkAllowlist,
  checkBot,
  checkChat,
  checkMembership,
  checkOutbox,
  checkSettings,
  checkToken,
  checkWebhook,
  migrateToChatId,
  webhookUrl,
} from '../supabase/functions/_shared/telegramDiagnose';

const URL_OK = 'https://ref.supabase.co/functions/v1/telegram-callback';

describe('token + bot', () => {
  it('missing or blank token fails', () => {
    expect(checkToken('').status).toBe('fail');
    expect(checkToken('   ').code).toBe('TOKEN_MISSING');
    expect(checkToken('123:abc').code).toBe('TOKEN_SET');
  });

  it('getMe ok names the bot', () => {
    expect(checkBot({ ok: true, result: { id: 7, username: 'touchcafe_orders_bot' } })).toEqual({
      id: 'bot', status: 'ok', code: 'BOT_OK', params: { username: 'touchcafe_orders_bot' },
    });
  });

  it('getMe 401 is a revoked / wrong token', () => {
    expect(checkBot({ ok: false, error_code: 401, description: 'Unauthorized' }).code).toBe('BOT_UNAUTHORIZED');
  });

  it('a transport failure keeps its message', () => {
    const c = checkBot({ ok: false, transport: 'fetch: timed out' });
    expect(c.code).toBe('BOT_ERROR');
    expect(c.params?.error).toBe('fetch: timed out');
  });
});

describe('settings', () => {
  it('flags the placeholder id before anything else', () => {
    expect(checkSettings(true, PLACEHOLDER_CHAT_ID)).toMatchObject({ status: 'fail', code: 'CHAT_ID_PLACEHOLDER' });
  });
  it('missing id fails, disabled warns, otherwise ok', () => {
    expect(checkSettings(true, null).code).toBe('CHAT_ID_MISSING');
    expect(checkSettings(false, '-5203171937')).toMatchObject({ status: 'warn', code: 'DISABLED' });
    expect(checkSettings(true, '-5203171937')).toMatchObject({ status: 'ok', params: { chatId: '-5203171937' } });
  });
});

describe('chat', () => {
  it('chat not found', () => {
    expect(checkChat({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })).toEqual({
      id: 'chat', status: 'fail', code: 'CHAT_NOT_FOUND',
    });
  });

  it('a supergroup upgrade carries the new id', () => {
    const res = {
      ok: false,
      error_code: 400,
      description: 'Bad Request: group chat was upgraded to a supergroup chat',
      parameters: { migrate_to_chat_id: -1002233445566 },
    };
    expect(migrateToChatId(res)).toBe('-1002233445566');
    expect(checkChat(res)).toMatchObject({ status: 'fail', code: 'CHAT_MIGRATED', newChatId: '-1002233445566' });
  });

  it('no migration id on success or on an unrelated error', () => {
    expect(migrateToChatId({ ok: true })).toBeNull();
    expect(migrateToChatId({ ok: false, parameters: { retry_after: 3 } })).toBeNull();
    expect(migrateToChatId(null)).toBeNull();
  });

  it('403 is a removed bot', () => {
    expect(checkChat({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the group chat' }).code).toBe(
      'CHAT_FORBIDDEN',
    );
  });

  it('ok names the group', () => {
    expect(checkChat({ ok: true, result: { id: -5203171937, title: 'Touch Cafe — Orders', type: 'group' } })).toMatchObject({
      status: 'ok', params: { title: 'Touch Cafe — Orders', type: 'group' },
    });
  });
});

describe('membership', () => {
  it.each(['creator', 'administrator', 'member'])('%s can post', (status) => {
    expect(checkMembership({ ok: true, result: { status } }).status).toBe('ok');
  });
  it.each(['left', 'kicked', 'restricted'])('%s cannot', (status) => {
    expect(checkMembership({ ok: true, result: { status } })).toMatchObject({ status: 'fail', code: 'NOT_MEMBER' });
  });
});

describe('webhook', () => {
  it('builds the callback url without doubling slashes', () => {
    expect(webhookUrl('https://ref.supabase.co/')).toBe(URL_OK);
  });

  it('ok when url matches and both update types are allowed', () => {
    expect(
      checkWebhook({ ok: true, result: { url: URL_OK, allowed_updates: [...WEBHOOK_ALLOWED_UPDATES], pending_update_count: 0 } }, URL_OK)
        .code,
    ).toBe('WEBHOOK_OK');
  });

  it('omitted allowed_updates means all types: ok', () => {
    expect(checkWebhook({ ok: true, result: { url: URL_OK } }, URL_OK).code).toBe('WEBHOOK_OK');
  });

  it('missing, wrong url, delivery error, callback_query only, backlog', () => {
    expect(checkWebhook({ ok: true, result: { url: '' } }, URL_OK).code).toBe('WEBHOOK_MISSING');
    expect(checkWebhook({ ok: true, result: { url: 'https://elsewhere.example/hook' } }, URL_OK)).toMatchObject({
      status: 'fail', code: 'WEBHOOK_WRONG_URL',
    });
    expect(
      checkWebhook({ ok: true, result: { url: URL_OK, last_error_message: 'Wrong response from the webhook: 401 Unauthorized' } }, URL_OK)
        .code,
    ).toBe('WEBHOOK_DELIVERY_ERROR');
    expect(checkWebhook({ ok: true, result: { url: URL_OK, allowed_updates: ['callback_query'] } }, URL_OK)).toMatchObject({
      status: 'warn', code: 'WEBHOOK_UPDATES',
    });
    expect(checkWebhook({ ok: true, result: { url: URL_OK, pending_update_count: 40 } }, URL_OK).code).toBe('WEBHOOK_PENDING');
  });
});

describe('outbox', () => {
  it('empty and sent are ok', () => {
    expect(checkOutbox([], '-5203171937').code).toBe('OUTBOX_EMPTY');
    expect(checkOutbox([{ chat_id: '-5203171937', status: 'sent', last_error: null }], '-5203171937').code).toBe('OUTBOX_OK');
  });

  it('failures addressed to another chat are stale, not the current failure', () => {
    const rows = [
      { chat_id: PLACEHOLDER_CHAT_ID, status: 'failed', last_error: 'HTTP 400: Bad Request: chat not found' },
      { chat_id: PLACEHOLDER_CHAT_ID, status: 'failed', last_error: 'HTTP 400: Bad Request: chat not found' },
      { chat_id: '-5203171937', status: 'sent', last_error: null },
    ];
    expect(checkOutbox(rows, '-5203171937')).toEqual({
      id: 'outbox', status: 'warn', code: 'OUTBOX_STALE', params: { count: 2, chatId: PLACEHOLDER_CHAT_ID },
    });
  });

  it('a failure on the saved chat is a failure', () => {
    const rows = [{ chat_id: PLACEHOLDER_CHAT_ID, status: 'failed', last_error: 'HTTP 400: Bad Request: chat not found' }];
    expect(checkOutbox(rows, PLACEHOLDER_CHAT_ID)).toMatchObject({
      status: 'fail', code: 'OUTBOX_FAILING', params: { error: 'HTTP 400: Bad Request: chat not found' },
    });
  });
});

describe('allowlist', () => {
  it('empty warns: every tap is refused', () => {
    expect(checkAllowlist([]).code).toBe('ALLOWLIST_EMPTY');
    expect(checkAllowlist([{ is_active: false, staff_active: true }]).code).toBe('ALLOWLIST_EMPTY');
  });
  it('active rows pointing at inactive staff warn', () => {
    expect(
      checkAllowlist([
        { is_active: true, staff_active: true },
        { is_active: true, staff_active: false },
      ]),
    ).toMatchObject({ status: 'warn', code: 'ALLOWLIST_INACTIVE_STAFF', params: { count: 1 } });
  });
  it('ok counts the active rows', () => {
    expect(checkAllowlist([{ is_active: true, staff_active: true }])).toMatchObject({ status: 'ok', params: { count: 1 } });
  });
});
