/**
 * The owner's chats (plan §5.1), newest first, with what each may read and
 * what it has cost. Archive is a move out of this list, never a delete
 * (decision 7), and it asks first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Spinner } from '../../components/ui';
import { formatUsd } from '../../lib/assistantPricing';
import { QK, archiveConversation, fetchConversations, type ConversationRow } from './api';
import { scopeLabel } from './Sources';

export function ConversationList({ activeId, onSelect, onNew, onArchived }: { activeId: string | null; onSelect: (id: string) => void; onNew: () => void; onArchived?: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QK.conversations, queryFn: fetchConversations });

  const archive = useMutation({
    mutationFn: (id: string) => archiveConversation(id),
    onSuccess: (_d, id) => {
      toast.ok(tr('ws.owner.assistant.conversations.archived'));
      void qc.invalidateQueries({ queryKey: QK.conversations });
      onArchived?.(id);
    },
  });

  const onArchive = async (row: ConversationRow) => {
    const ok = await confirm({
      title: tr('ws.owner.assistant.conversations.archiveTitle'),
      body: tr('ws.owner.assistant.conversations.archiveBody'),
      confirmLabel: tr('ws.owner.assistant.conversations.archiveConfirm'),
      kind: 'primary',
    });
    if (ok) archive.mutate(row.id);
  };

  return (
    <nav aria-label={tr('ws.owner.assistant.conversations.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2)', minBlockSize: 0 }}>
      <Button kind="primary" icon="plus" onClick={onNew} style={{ justifyContent: 'center' }}>
        {tr('ws.owner.assistant.newChat')}
      </Button>
      {q.isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 'var(--tp-sp-3)' }}>
          <Spinner />
        </div>
      )}
      {q.isError && <ErrorText error={q.error} />}
      {q.data && q.data.length === 0 && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.conversations.empty')}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', overflowY: 'auto', minBlockSize: 0 }}>
        {(q.data ?? []).map((row) => {
          const active = row.id === activeId;
          const cost = row.tokens.cost_micros ?? 0;
          return (
            <li key={row.id} data-conversation={row.id}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'start',
                  gap: 'var(--tp-sp-1)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  background: active ? 'var(--tp-accent-soft, var(--tp-surface-2))' : 'transparent',
                  border: `1px solid ${active ? 'var(--tp-border-strong)' : 'transparent'}`,
                  paddingBlock: 'var(--tp-sp-1)',
                  paddingInline: 'var(--tp-sp-1-5)',
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-current={active ? 'true' : undefined}
                  style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', minInlineSize: 0, display: 'grid', gap: '0.1rem' }}
                >
                  <bdi style={{ fontWeight: active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {row.title?.trim() || tr('ws.owner.assistant.conversations.untitled')}
                  </bdi>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {formatDate(new Date(row.updated_at ?? row.created_at), locale)}
                    {cost > 0 && <> · {`⁨${formatUsd(cost)}⁩`}</>}
                  </span>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {tr('ws.owner.assistant.conversations.scopesLine', { scopes: row.scopes.map((s) => scopeLabel(tr, s)).join(', ') })}
                  </span>
                </button>
                <Button size="sm" kind="ghost" icon="box" aria-label={tr('ws.owner.assistant.conversations.archive')} title={tr('ws.owner.assistant.conversations.archive')} onClick={() => void onArchive(row)} busy={archive.isPending && archive.variables === row.id} />
              </div>
            </li>
          );
        })}
      </ul>
      {archive.isError && <ErrorText error={archive.error} />}
    </nav>
  );
}
