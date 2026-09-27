/**
 * Telegram (owner, operator-slice.md §3f): on/off, the staff group, message
 * language, "send test" (enqueue → poll the outbox row for 20 s), the sent
 * messages, and Diagnose (migration 0091).
 *
 * WHY THIS LAYOUT
 *
 * The screen answers three questions, top to bottom:
 *
 *  1. **Are staff being told?** One panel, first. A sentence that says whether
 *     notifications are working, then the three facts it rests on — which
 *     group they go to (by NAME), what happened to the last message, and when
 *     a button tap last reached the app — with the test button beside them.
 *     The old screen never said this anywhere: an owner had to read a switch,
 *     a chat id, a "Webhook — Last write-back: never" line and the Outbox tab
 *     and put the answer together themselves.
 *  2. **What is it set to?** The switch, the group and the language, in the
 *     order they are set up. The group is PICKED from the groups the bot has
 *     joined; typing the numeric id is still possible but folded away, because
 *     typing it is how the placeholder id ended up saved on 2026-09-13.
 *  3. **Why is it not working?** Diagnose, on request.
 *
 * "Webhook" is not said to the owner: what they can observe is whether a tap
 * on a button in the group reaches the app, so that is what the row is called.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate, formatTime, isolate, type MessageKey } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useCafeSettings, useSetCafeSetting, type TelegramLang } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, Field, Select, Skeleton, Spinner, Tabs, inputStyle } from '../../../components/ui';
import { PageHeader, Panel, StatusBadge } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { CardTitle, FigureRow, MARK, MARK_FG, RowList } from '../../ops/OpsVisuals';
import { SettingsGroup, SettingsRow, settingField } from '../settings/SettingsList';
import { isValidChatId, normalizeChatId } from './chatId';
import { OUTBOX_QUERY_KEY, OutboxList, StatusChip, useOutbox, type OutboxRow, type OutboxStatus } from './OutboxList';
import { DetectedGroups, useTelegramChats } from './DetectedGroups';
import { DiagnosePanel } from './DiagnosePanel';
import { ButtonPeople } from './ButtonPeople';
import { HEALTH_TONE, PLACEHOLDER_CHAT_ID, telegramHealth, type TelegramHealth } from './telegramStatus';

const POLL_MS = 2_000;
const POLL_FOR_MS = 20_000;

type TestState =
  | { phase: 'idle' }
  | { phase: 'polling'; id: number; status: OutboxStatus; lastError: string | null }
  | { phase: 'done'; status: OutboxStatus; lastError: string | null }
  | { phase: 'timeout'; status: OutboxStatus; lastError: string | null };

const HEALTH_ICON: Record<TelegramHealth, Parameters<typeof Icon>[0]['name']> = {
  off: 'minus',
  noGroup: 'alert',
  untested: 'info',
  failing: 'alert',
  stuck: 'alert',
  sending: 'clock',
  working: 'checkCircle',
};

export function TelegramSettings() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { settings, isLoading } = useCafeSettings();
  const setSetting = useSetCafeSetting();
  const outboxQ = useOutbox();
  const chatsQ = useTelegramChats();
  const [tab, setTab] = useState<'setup' | 'outbox'>('setup');
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
    await storeChatId(chatId.trim() === '' ? null : chatId.trim());
  }

  /** Save a chat id picked from the group list or offered by Diagnose; the field follows. */
  async function storeChatId(value: string | null) {
    if (value !== null && !isValidChatId(value)) return;
    try {
      await setSetting.mutateAsync({ key: 'telegram_chat_id', value });
      setChatId(value ?? '');
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
          .select('id, kind, chat_id, status, attempts, last_error, created_at, sent_at')
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

  const at = (iso: string) => {
    const d = new Date(iso);
    return `${formatDate(d, locale)} ${formatTime(d, locale)}`;
  };
  const savedChat = settings.telegram_chat_id ?? null;
  const savedGroup = savedChat ? (chatsQ.data ?? []).find((c) => c.chat_id === savedChat) : undefined;
  const latest = outboxQ.data?.[0] ?? null;
  const health = telegramHealth({ enabled: settings.telegram_enabled, chatId: savedChat }, latest, Date.now());
  const configured = settings.telegram_enabled && !!savedChat;
  const tone = HEALTH_TONE[health];

  const groupValue = !savedChat ? (
    <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.settings.telegram.status.groupNone')}</span>
  ) : savedChat === PLACEHOLDER_CHAT_ID ? (
    <span style={{ color: MARK_FG.warn }}>{tr('ws.manager.settings.telegram.status.groupPlaceholder')}</span>
  ) : savedGroup?.title ? (
    <bdi>{isolate(savedGroup.title)}</bdi>
  ) : (
    <span dir="ltr">{savedChat}</span>
  );

  const lastValue = !latest ? (
    <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.settings.telegram.status.lastNone')}</span>
  ) : (
    <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <StatusChip status={latest.status} />
      <span style={{ fontWeight: 400 }}>{at(latest.sent_at ?? latest.created_at)}</span>
    </span>
  );

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-wide)' }}>
      <PageHeader title={tr('op.telegram.title')} subtitle={tr('ws.manager.settings.telegram.lead')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'setup', label: tr('op.telegram.settingsTab') },
          { id: 'outbox', label: tr('op.telegram.outbox') },
        ]}
      />

      {tab === 'setup' && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', marginBlockStart: 'var(--tp-sp-3)' }}>
          <Panel title={<CardTitle icon="bell">{tr('ws.manager.settings.telegram.status.title')}</CardTitle>}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
              <p
                data-health={health}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-2)', fontWeight: 600, color: tone === 'neutral' ? 'var(--tp-fg)' : MARK_FG[tone] }}
              >
                <Icon name={HEALTH_ICON[health]} size={18} style={{ color: MARK[tone], flex: '0 0 auto', marginBlockStart: '0.1rem' }} />
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  {tr(`ws.manager.settings.telegram.health.${health}` as MessageKey)}
                  <span style={{ fontWeight: 400, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    {tr(`ws.manager.settings.telegram.health.${health}Hint` as MessageKey)}
                  </span>
                </span>
              </p>

              <RowList chevrons={false}>
                <FigureRow label={tr('ws.manager.settings.telegram.status.group')} value={groupValue} />
                <FigureRow label={tr('ws.manager.settings.telegram.status.last')} value={lastValue} />
                <FigureRow
                  label={tr('ws.manager.settings.telegram.status.taps')}
                  hint={tr('ws.manager.settings.telegram.status.tapsHint')}
                  value={
                    settings.telegram_last_callback_at ? (
                      <span style={{ fontWeight: 400 }}>{at(settings.telegram_last_callback_at)}</span>
                    ) : (
                      <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.settings.telegram.status.tapsNone')}</span>
                    )
                  }
                />
              </RowList>

              <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  icon="bell"
                  kind={health === 'untested' ? 'primary' : 'default'}
                  disabled={!configured || test.phase === 'polling'}
                  disabledReason={
                    test.phase === 'polling' ? tr('ws.manager.settings.telegram.testRunning') : !configured ? tr('ws.manager.settings.telegram.testDisabled') : undefined
                  }
                  onClick={() => void sendTest()}
                >
                  {tr('op.telegram.sendTest')}
                </Button>
                {test.phase === 'polling' && (
                  <>
                    <Spinner size="xs" />
                    <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.sending')}</span>
                  </>
                )}
                {test.phase === 'done' && <StatusChip status={test.status} />}
                {test.phase === 'timeout' && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.testTimeout')}</span>}
                <Button kind="ghost" size="sm" icon="fileText" style={{ marginInlineStart: 'auto' }} onClick={() => setTab('outbox')}>
                  {tr('ws.manager.settings.telegram.status.seeSent')}
                </Button>
              </div>
              {test.phase !== 'idle' && test.lastError && (
                <StatusBadge tone="danger" size="sm" icon="alert" label={`${tr('op.telegram.lastError')}: ${test.lastError}`} style={{ whiteSpace: 'normal' }} />
              )}
            </div>
          </Panel>

          <SettingsGroup title={tr('ws.manager.settings.telegram.channel')}>
            {/* Rulebook 2.5: a toggle says what changes when it is on. */}
            <SettingsRow description={tr('ws.manager.settings.telegram.enabledHint')}>
              <Switch
                checked={settings.telegram_enabled}
                label={tr('op.telegram.enabled')}
                onChange={async (next) => {
                  await setSetting.mutateAsync({ key: 'telegram_enabled', value: next });
                }}
              />
            </SettingsRow>

            <SettingsRow>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.manager.settings.telegram.groupTitle')}</span>
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.settings.telegram.groups.lead')}</span>
              </div>
              <DetectedGroups currentChatId={savedChat} busy={setSetting.isPending} onUse={(id) => void storeChatId(id)} />
              <details style={{ fontSize: 'var(--tp-fs-sm)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--tp-accent)', minBlockSize: 'var(--tp-row-h-dense)', display: 'list-item' }}>
                  {tr('op.telegram.howToFind')}
                </summary>
                <ol style={{ paddingInlineStart: 'var(--tp-sp-5)', lineHeight: 1.6 }}>
                  {/* Numeric catalog keys fall outside the `MessageKey` path type; the runtime lookup handles them. */}
                  {(['1', '2', '3', '4', '5'] as const).map((n) => (
                    <li key={n}>{tr(`op.telegram.steps.${n}` as unknown as MessageKey)}</li>
                  ))}
                </ol>
              </details>
              <details style={{ fontSize: 'var(--tp-fs-sm)' }} open={chatDirty || (chatId !== '' && !chatValid)}>
                <summary style={{ cursor: 'pointer', color: 'var(--tp-accent)', minBlockSize: 'var(--tp-row-h-dense)', display: 'list-item' }}>
                  {tr('ws.manager.settings.telegram.typeId')}
                </summary>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-2)' }}>
                  <Field
                    label={tr('op.telegram.chatId')}
                    hint={tr('op.telegram.chatIdHint')}
                    // Field ties this to the input and marks it invalid.
                    error={chatId !== '' && !chatValid ? tr('op.telegram.chatIdInvalid') : undefined}
                    style={settingField}
                  >
                    <input
                      style={{ ...inputStyle, maxInlineSize: '16rem', fontVariantNumeric: 'tabular-nums' }}
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      value={chatId}
                      onChange={(e) => setChatId(normalizeChatId(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && chatDirty && (chatValid || chatId === '')) void saveChatId();
                      }}
                    />
                  </Field>
                  {chatDirty && (
                    <Button
                      kind="primary"
                      style={{ marginBlockStart: '1.6rem' }}
                      disabled={(chatId !== '' && !chatValid) || setSetting.isPending}
                      disabledReason={chatId !== '' && !chatValid ? tr('ws.manager.settings.telegram.chatIdInvalid') : undefined}
                      busy={setSetting.isPending}
                      onClick={() => void saveChatId()}
                    >
                      {tr('common.save')}
                    </Button>
                  )}
                </div>
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
                  onChange={(next) => setSetting.mutateAsync({ key: 'telegram_lang', value: next }).catch((e) => toast.err(e))}
                />
              </Field>
            </SettingsRow>
          </SettingsGroup>

          <ButtonPeople />

          <DiagnosePanel onUseChatId={storeChatId} />
        </div>
      )}

      {tab === 'outbox' && <OutboxList />}
    </div>
  );
}
