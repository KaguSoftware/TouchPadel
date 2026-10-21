/**
 * The owner's chats (plan §5.1) as design L1 (2026-10-20): grouped by day,
 * each row its title, cost, what it reads and its time (ChatListView), with
 * Archive on hover. Archive is a move out of this list, never a delete
 * (decision 7), and it asks first. The footer counts the chats, says what the
 * month has cost, and opens the archived ones, which can be read but not yet
 * brought back (no RPC restores one).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VENUE_TZ } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { QK as SHARED_QK, fetchVenueSettings } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { ErrorText, Spinner } from '../../components/ui';
import { formatUsd } from '../../lib/assistantPricing';
import { QK, archiveConversation, fetchArchivedConversations, fetchConversations, fetchUsage, type ConversationRow } from './api';
import { ChatListView, type ChatItem } from './ChatListView';
import { monthSoFar } from './usageDates';

const toItem = (row: ConversationRow, untitled: string): ChatItem => ({
  id: row.id,
  title: row.title?.trim() || untitled,
  at: new Date(row.updated_at ?? row.created_at),
  scopes: row.scopes,
  cost: (row.tokens.cost_micros ?? 0) > 0 ? `⁨${formatUsd(row.tokens.cost_micros ?? 0)}⁩` : null,
});

export function ConversationList({
  activeId,
  onSelect,
  onArchived,
  showArchived,
  onShowArchived,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onArchived?: (id: string) => void;
  /** The archived view; the drawer's header turns into "Back to chats" for it (the page holds the flag). */
  showArchived: boolean;
  onShowArchived: (show: boolean) => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QK.conversations, queryFn: fetchConversations });
  const archivedQ = useQuery({ queryKey: QK.archivedConversations, queryFn: fetchArchivedConversations, enabled: showArchived });

  // The month's spend for the footer: the same query the thread's meter reads.
  const settings = useQuery({ queryKey: SHARED_QK.venueSettings, queryFn: fetchVenueSettings });
  const month = monthSoFar(settings.data?.timezone ?? VENUE_TZ);
  const usage = useQuery({ queryKey: QK.usage(month.from, month.to), queryFn: () => fetchUsage(month.from, month.to), staleTime: 60_000 });

  const archive = useMutation({
    mutationFn: (id: string) => archiveConversation(id),
    onSuccess: (_d, id) => {
      toast.ok(tr('ws.owner.assistant.conversations.archived'));
      void qc.invalidateQueries({ queryKey: QK.conversations });
      onArchived?.(id);
    },
  });

  const onArchive = async (id: string) => {
    const ok = await confirm({
      title: tr('ws.owner.assistant.conversations.archiveTitle'),
      body: tr('ws.owner.assistant.conversations.archiveBody'),
      confirmLabel: tr('ws.owner.assistant.conversations.archiveConfirm'),
      kind: 'primary',
    });
    if (ok) archive.mutate(id);
  };

  const untitled = tr('ws.owner.assistant.conversations.untitled');
  const source = showArchived ? archivedQ : q;
  const items = (source.data ?? []).map((r) => toItem(r, untitled));
  const n = (q.data ?? []).length;
  const monthCost = usage.data ? `⁨${formatUsd(usage.data.month.cost_micros)}⁩` : null;

  return (
    <nav aria-label={tr(showArchived ? 'ws.owner.assistant.conversations.archivedTitle' : 'ws.owner.assistant.conversations.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2)', minBlockSize: 0, flex: 1 }}>
      {showArchived && <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.conversations.archivedNote')}</p>}
      {source.isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 'var(--tp-sp-3)' }}>
          <Spinner />
        </div>
      )}
      {source.isError && <ErrorText error={source.error} />}
      {!source.isLoading && (
        <ChatListView
          items={items}
          activeId={activeId}
          onSelect={onSelect}
          emptyText={tr(showArchived ? 'ws.owner.assistant.conversations.archivedEmpty' : 'ws.owner.assistant.conversations.empty')}
          rowAction={
            showArchived
              ? undefined
              : (item) => (
                  <button type="button" className="tp-chat-act-btn" aria-label={tr('ws.owner.assistant.conversations.archive')} title={tr('ws.owner.assistant.conversations.archive')} onClick={() => void onArchive(item.id)}>
                    <Icon name="box" size={14} />
                  </button>
                )
          }
          footer={
            <>
              <span style={{ flex: 1 }}>
                {monthCost
                  ? tr('ws.owner.assistant.conversations.footer', { n: `⁨${n}⁩`, cost: monthCost })
                  : tr('ws.owner.assistant.conversations.footerCount', { n: `⁨${n}⁩` })}
              </span>
              {!showArchived && (
                <button type="button" className="tp-link" onClick={() => onShowArchived(true)} style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--tp-accent)', cursor: 'pointer' }}>
                  {tr('ws.owner.assistant.conversations.archivedLink')}
                </button>
              )}
            </>
          }
        />
      )}
      {archive.isError && <ErrorText error={archive.error} />}
    </nav>
  );
}
