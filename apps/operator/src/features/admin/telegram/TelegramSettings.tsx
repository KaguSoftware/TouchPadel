/**
 * Telegram (owner, operator-slice.md §3f): enable switch, group chat id,
 * language, "send test" (enqueue → poll the outbox row for 20 s), outbox
 * viewer, and a webhook-health line from `telegram_last_callback_at`.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate, formatTime, type MessageKey } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useCafeSettings, useSetCafeSetting, type TelegramLang } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, Field, Select, Skeleton, Spinner, Tabs, card, inputStyle } from '../../../components/ui';
import { isValidChatId, normalizeChatId } from './chatId';
import { OUTBOX_QUERY_KEY, OutboxList, StatusChip, type OutboxRow, type OutboxStatus } from './OutboxList';

const POLL_MS = 2_000;
const POLL_FOR_MS = 20_000;

type TestState =
  | { phase: 'idle' }
  | { phase: 'polling'; id: number; status: OutboxStatus; lastError: string | null }
  | { phase: 'done'; status: OutboxStatus; lastError: string | null }
  | { phase: 'timeout'; status: OutboxStatus; lastError: string | null };

export function TelegramSettings() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { settings, isLoading } = useCafeSettings();
  const setSetting = useSetCafeSetting();
  const [tab, setTab] = useState<'settings' | 'outbox'>('settings');
  const [chatId, setChatId] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLoading && chatId === null) setChatId(settings.telegram_chat_id ?? '');
  }, [isLoading, settings.telegram_chat_id, chatId]);
  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  const chatValid = chatId !== null && isValidChatId(chatId);
  const chatDirty = chatId !== null && chatId.trim() !== (settings.telegram_chat_id ?? '');

  async function saveChatId() {
    if (chatId === null) return;
    const value = chatId.trim() === '' ? null : chatId.trim();
    if (value !== null && !isValidChatId(value)) return;
    try {
      await setSetting.mutateAsync({ key: 'telegram_chat_id', value });
      toast.ok(tr('op.toast.saved'));
    } catch (e) {
      toast.err(e);
    }
  }

  async function sendTest() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    try {
      const { outbox_id } = await appRpc<{ outbox_id: number }>('telegram_send_test');
      setTest({ phase: 'polling', id: outbox_id, status: 'queued', lastError: null });
      void queryClient.invalidateQueries({ queryKey: OUTBOX_QUERY_KEY });
      const startedAt = Date.now();
      pollTimer.current = setInterval(async () => {
        const { data } = await supabase
          .from('telegram_outbox')
          .select('id, kind, status, attempts, last_error, created_at, sent_at')
          .eq('id', outbox_id)
          .maybeSingle();
        const row = (data ?? null) as OutboxRow | null;
        const status = row?.status ?? 'queued';
        const lastError = row?.last_error ?? null;
        if (status === 'sent' || status === 'failed' || status === 'skipped') {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setTest({ phase: 'done', status, lastError });
          if (status === 'sent') toast.ok(tr('op.telegram.testSent'));
          else toast.err(tr('op.telegram.testFailed'));
          void queryClient.invalidateQueries({ queryKey: OUTBOX_QUERY_KEY });
        } else if (Date.now() - startedAt >= POLL_FOR_MS) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setTest({ phase: 'timeout', status, lastError });
        } else {
          setTest({ phase: 'polling', id: outbox_id, status, lastError });
        }
      }, POLL_MS);
    } catch (e) {
      toast.err(e);
    }
  }

  if (isLoading || chatId === null) return <Skeleton lines={5} />;

  const lastCallback = settings.telegram_last_callback_at
    ? `${formatDate(new Date(settings.telegram_last_callback_at), locale)} ${formatTime(new Date(settings.telegram_last_callback_at), locale)}`
    : tr('op.telegram.never');
  const configured = settings.telegram_enabled && !!settings.telegram_chat_id;

  return (
    <div style={{ maxInlineSize: '44rem' }}>
      <h2 style={{ marginBlockStart: 0 }}>{tr('op.telegram.title')}</h2>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'settings', label: tr('op.telegram.settingsTab') },
          { id: 'outbox', label: tr('op.telegram.outbox') },
        ]}
      />

      {tab === 'settings' && (
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          <section style={card}>
            <Switch
              checked={settings.telegram_enabled}
              label={tr('op.telegram.enabled')}
              onChange={async (next) => {
                await setSetting.mutateAsync({ key: 'telegram_enabled', value: next });
              }}
            />
          </section>

          <section style={card}>
            <Field label={tr('op.telegram.chatId')}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="-1001234567890"
                  value={chatId}
                  aria-invalid={chatId !== '' && !chatValid}
                  onChange={(e) => setChatId(normalizeChatId(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatDirty && (chatValid || chatId === '')) void saveChatId();
                  }}
                />
                <Button
                  kind="primary"
                  disabled={!chatDirty || (chatId !== '' && !chatValid) || setSetting.isPending}
                  onClick={() => void saveChatId()}
                >
                  {tr('common.save')}
                </Button>
              </div>
            </Field>
            <p style={{ margin: 0, fontSize: '0.8rem', color: chatId !== '' && !chatValid ? 'var(--tp-danger)' : 'var(--tp-muted-fg)' }}>
              {chatId !== '' && !chatValid ? tr('op.telegram.chatIdInvalid') : tr('op.telegram.chatIdHint')}
            </p>
            <details style={{ marginBlockStart: '0.6rem', fontSize: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--tp-accent)' }}>{tr('op.telegram.howToFind')}</summary>
              <ol style={{ paddingInlineStart: '1.2rem', lineHeight: 1.6 }}>
                {/* Numeric catalog keys fall outside the `MessageKey` path type; the runtime lookup handles them. */}
                {(['1', '2', '3', '4', '5'] as const).map((n) => (
                  <li key={n}>{tr(`op.telegram.steps.${n}` as unknown as MessageKey)}</li>
                ))}
              </ol>
            </details>
          </section>

          <section style={card}>
            <Field label={tr('op.telegram.lang')}>
              <Select<TelegramLang>
                value={settings.telegram_lang}
                style={{ maxInlineSize: '12rem' }}
                options={[
                  { value: 'ar', label: tr('op.telegram.langAr') },
                  { value: 'en', label: tr('op.telegram.langEn') },
                ]}
                onChange={(next) =>
                  setSetting.mutateAsync({ key: 'telegram_lang', value: next }).catch((e) => toast.err(e))
                }
              />
            </Field>
          </section>

          <section style={card}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button disabled={!configured || test.phase === 'polling'} onClick={() => void sendTest()}>
                {tr('op.telegram.sendTest')}
              </Button>
              {test.phase === 'polling' && (
                <>
                  <Spinner size="xs" />
                  <StatusChip status={test.status} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.sending')}</span>
                </>
              )}
              {(test.phase === 'done' || test.phase === 'timeout') && <StatusChip status={test.status} />}
              {test.phase === 'timeout' && (
                <span style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.testTimeout')}</span>
              )}
              {test.phase !== 'idle' && test.lastError && (
                <span dir="ltr" style={{ fontSize: '0.85rem', color: 'var(--tp-danger)' }}>
                  {tr('op.telegram.lastError')}: {test.lastError}
                </span>
              )}
            </div>
            <p style={{ margin: 0, marginBlockStart: '0.6rem', fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
              <strong>{tr('op.telegram.webhook')}</strong> — {tr('op.telegram.webhookHint')}{' '}
              <span dir="ltr">{lastCallback}</span>
            </p>
          </section>
        </div>
      )}

      {tab === 'outbox' && <OutboxList />}
    </div>
  );
}
