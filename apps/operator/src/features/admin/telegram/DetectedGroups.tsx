/**
 * Settings → Telegram → Detected groups. Every group the bot has been added to
 * or removed from (`telegram_chats`, written by telegram-callback from
 * `my_chat_member`, migration 0091; RLS manager|owner read). The owner picks the
 * staff group here instead of reading an id out of Bot API getUpdates — which
 * stops answering the moment a webhook is registered.
 */
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { formatDate, formatTime, isolate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText } from '../../../components/ui';
import { AsyncStateWrapper, EmptyState, StatusBadge, asyncStatus } from '../../../components/kit';
import { SettingsGroup } from '../settings/SettingsList';

export const TELEGRAM_CHATS_QUERY_KEY: QueryKey = ['telegramChats'];

export interface TelegramChatRow {
  chat_id: string;
  title: string | null;
  type: string;
  bot_status: string;
  updated_at: string;
}

/** Statuses in which the bot can post (Bot API ChatMember.status). */
const PRESENT = new Set(['creator', 'administrator', 'member']);

export function DetectedGroups({
  currentChatId,
  onUse,
  busy,
}: {
  currentChatId: string | null;
  onUse: (chatId: string) => void;
  busy: boolean;
}) {
  const { tr, locale } = useLocale();

  const chatsQ = useQuery({
    queryKey: TELEGRAM_CHATS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_chats')
        .select('chat_id, title, type, bot_status, updated_at')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as TelegramChatRow[];
    },
    // The group shows up seconds after the bot is added; keep the list live while the screen is open.
    refetchInterval: 5_000,
  });

  const rows = chatsQ.data ?? [];

  return (
    <SettingsGroup title={tr('ws.manager.settings.telegram.groups.title')} description={tr('ws.manager.settings.telegram.groups.lead')}>
      <ErrorText error={chatsQ.error} />
      <AsyncStateWrapper
        status={asyncStatus(chatsQ, (d) => d.length === 0)}
        error={chatsQ.error}
        onRetry={() => void chatsQ.refetch()}
        emptyContent={
          <EmptyState
            compact
            icon="users"
            title={tr('ws.manager.settings.telegram.groups.emptyTitle')}
            body={tr('ws.manager.settings.telegram.groups.emptyBody')}
          />
        }
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {rows.map((row) => {
            const present = PRESENT.has(row.bot_status);
            const inUse = row.chat_id === currentChatId;
            const seen = new Date(row.updated_at);
            return (
              <li
                key={row.chat_id}
                data-chat={row.chat_id}
                style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                  <strong>{isolate(row.title ?? row.chat_id)}</strong>
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.chat_id}</span>
                    {' · '}
                    {tr('ws.manager.settings.telegram.groups.updated', {
                      when: `${formatDate(seen, locale)} ${formatTime(seen, locale)}`,
                    })}
                  </span>
                </div>
                {inUse ? (
                  <StatusBadge tone="success" size="sm" label={tr('ws.manager.settings.telegram.groups.inUse')} />
                ) : present ? (
                  <Button size="sm" kind="primary" disabled={busy} onClick={() => onUse(row.chat_id)}>
                    {tr('ws.manager.settings.telegram.groups.use')}
                  </Button>
                ) : (
                  <StatusBadge tone="neutral" size="sm" label={tr('ws.manager.settings.telegram.groups.removed')} />
                )}
              </li>
            );
          })}
        </ul>
      </AsyncStateWrapper>
    </SettingsGroup>
  );
}
