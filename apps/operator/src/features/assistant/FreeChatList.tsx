/**
 * The free AI's chats (2026-10-20) in the same list as the paid ones (design
 * L1, ChatListView), but its own list: these live on this computer
 * (freeChats.ts) and never mix with the paid chats. Delete asks first; it is a
 * real delete, there is nowhere to archive to.
 */
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import type { FreeChat } from './freeChats';
import { ChatListView } from './ChatListView';

export function FreeChatList({ chats, activeId, onSelect, onDelete }: { chats: readonly FreeChat[]; activeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();

  const del = async (id: string) => {
    const ok = await confirm({
      title: tr('ws.assistantFree.chats.deleteTitle'),
      body: tr('ws.assistantFree.chats.deleteBody'),
      confirmLabel: tr('ws.assistantFree.chats.deleteConfirm'),
      kind: 'danger',
    });
    if (!ok) return;
    onDelete(id);
    toast.ok(tr('ws.assistantFree.chats.deleted'));
  };

  return (
    <nav aria-label={tr('ws.assistantFree.chats.title')} data-free-chats="" style={{ display: 'flex', flexDirection: 'column', minBlockSize: 0, flex: 1 }}>
      <ChatListView
        items={chats.map((c) => ({ id: c.id, title: c.title, at: new Date(c.updatedAt) }))}
        activeId={activeId}
        onSelect={onSelect}
        emptyText={tr('ws.assistantFree.chats.empty')}
        rowAction={(item) => (
          <button type="button" className="tp-chat-act-btn" aria-label={tr('ws.assistantFree.chats.delete')} title={tr('ws.assistantFree.chats.delete')} onClick={() => void del(item.id)}>
                    <Icon name="trash" size={14} />
                  </button>
        )}
        footer={<span style={{ flex: 1 }}>{tr('ws.assistantFree.chats.footer', { n: `⁨${chats.length}⁩` })}</span>}
      />
    </nav>
  );
}
