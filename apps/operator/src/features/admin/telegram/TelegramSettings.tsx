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
import { Button, Field, Select, Skeleton, Spinner, Tabs, inputStyle } from '../../../components/ui';
import { PageHeader, StatusBadge } from '../../../components/kit';
import { SettingsGroup, SettingsRow, settingField } from '../settings/SettingsList';
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
    <div style={{ maxInlineSize: 'var(--tp-measure-form)' }}>
      <PageHeader title={tr('op.telegram.title')} subtitle={tr('ws.manager.settings.telegram.lead')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'settings', label: tr('op.telegram.settingsTab') },
          { id: 'outbox', label: tr('op.telegram.outbox') },
        ]}
      />

      {tab === 'settings' && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <SettingsGroup title={tr('ws.manager.settings.telegram.channel')}>
            {/* Rulebook 2.5: a toggle says what changes when it is on. This one
                used to sit alone in a card with nothing but its own name. */}
            <SettingsRow description={tr('ws.manager.settings.telegram.enabledHint')}>
              <Switch
                checked={settings.telegram_enabled}
                label={tr('op.telegram.enabled')}
                onChange={async (next) => {
                  await setSetting.mutateAsync({ key: 'telegram_enabled', value: next });
                }}
              />
            </SettingsRow>

            <SettingsRow
              end={
                <Button
                  kind="primary"
                  disabled={!chatDirty || (chatId !== '' && !chatValid) || setSetting.isPending}
                  disabledReason={
                    chatId !== '' && !chatValid
                      ? tr('ws.manager.settings.telegram.chatIdInvalid')
                      : !chatDirty
                        ? tr('ws.manager.settings.noChanges')
                        : undefined
                  }
                  busy={setSetting.isPending}
                  onClick={() => void saveChatId()}
                >
                  {tr('common.save')}
                </Button>
              }
            >
              <Field
                label={tr('op.telegram.chatId')}
                hint={tr('op.telegram.chatIdHint')}
                // Was a paragraph that turned red — meaning by colour alone, and
                // never announced. Field ties this to the input and marks it invalid.
                error={chatId !== '' && !chatValid ? tr('op.telegram.chatIdInvalid') : undefined}
                style={settingField}
              >
                <input
                  style={{ ...inputStyle, maxInlineSize: '16rem', fontVariantNumeric: 'tabular-nums' }}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="-1001234567890"
                  value={chatId}
                  onChange={(e) => setChatId(normalizeChatId(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatDirty && (chatValid || chatId === '')) void saveChatId();
                  }}
                />
              </Field>
              <details style={{ fontSize: 'var(--tp-fs-sm)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--tp-accent)', minBlockSize: 'var(--tp-row-h-dense)' }}>
                  {tr('op.telegram.howToFind')}
                </summary>
                <ol style={{ paddingInlineStart: 'var(--tp-sp-5)', lineHeight: 1.6 }}>
                  {/* Numeric catalog keys fall outside the `MessageKey` path type; the runtime lookup handles them. */}
                  {(['1', '2', '3', '4', '5'] as const).map((n) => (
                    <li key={n}>{tr(`op.telegram.steps.${n}` as unknown as MessageKey)}</li>
                  ))}
                </ol>
              </details>
            </SettingsRow>

            <SettingsRow>
              <Field label={tr('op.telegram.lang')} hint={tr('ws.manager.settings.telegram.langHint')} style={settingField}>
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
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={tr('ws.manager.settings.telegram.check')}>
            <SettingsRow
              description={
                <>
                  <strong>{tr('op.telegram.webhook')}</strong> — {tr('op.telegram.webhookHint')}{' '}
                  <span dir="ltr">{lastCallback}</span>
                </>
              }
            >
              <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  icon="bell"
                  disabled={!configured || test.phase === 'polling'}
                  disabledReason={
                    test.phase === 'polling'
                      ? tr('ws.manager.settings.telegram.testRunning')
                      : tr('ws.manager.settings.telegram.testDisabled')
                  }
                  onClick={() => void sendTest()}
                >
                  {tr('op.telegram.sendTest')}
                </Button>
                {test.phase === 'polling' && (
                  <>
                    <Spinner size="xs" />
                    <StatusChip status={test.status} />
                    <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.sending')}</span>
                  </>
                )}
                {(test.phase === 'done' || test.phase === 'timeout') && <StatusChip status={test.status} />}
                {test.phase === 'timeout' && (
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.testTimeout')}</span>
                )}
              </div>
              {test.phase !== 'idle' && test.lastError && (
                <StatusBadge
                  tone="danger"
                  size="sm"
                  icon="alert"
                  label={`${tr('op.telegram.lastError')}: ${test.lastError}`}
                  style={{ whiteSpace: 'normal' }}
                />
              )}
            </SettingsRow>
          </SettingsGroup>
        </div>
      )}

      {tab === 'outbox' && <OutboxList />}
    </div>
  );
}
