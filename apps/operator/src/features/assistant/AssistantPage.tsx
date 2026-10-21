/**
 * `/assistant` and `/assistant/$id` (plan §5.1). One component for both URLs —
 * the layout route renders it and only the `$id` param changes — so a first
 * question that creates a conversation and moves the URL to `/assistant/<id>`
 * does not unmount the stream. When the owner has picked "The free AI"
 * (useAssistantMode) the page holds the free thread instead; the page itself
 * stays owner-only.
 *
 * Since 2026-10-20 the page follows the owner's two picks: a new chat (C) has
 * no header or toolbar, only a slim strip with Chats and New chat beside the
 * start screen; an open chat (D) has the thread's toolbar with Chats and New
 * chat at its start. Chats opens the list as a drawer (ChatsDrawer), never a
 * column. A new chat reads nothing until the owner picks (NEW_CHAT_SCOPES).
 * The free AI has the same strip, toolbar and drawer, over its own chats
 * (freeChats.ts, on this computer); the two lists never mix.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { ChatsDrawer, type ChatsDrawerHandle } from './ChatsDrawer';
import { ConversationList } from './ConversationList';
import { QK, fetchConversations } from './api';
import { FreeChatList } from './FreeChatList';
import { useFreeChats } from './freeChats';
import { Thread } from './Thread';
import { FreeThread } from './FreeThread';
import { useAssistantMode } from './useAssistantMode';
import { NEW_CHAT_SCOPES, saveSessionConversation } from './scopes';

export function AssistantPageScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const { mode, setMode, canUsePaid } = useAssistantMode();
  const isFree = mode === 'free';
  // The free AI's chats live on this computer and are listed apart (freeChats.ts).
  const free = useFreeChats(staff?.id ?? '');
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id?: string };
  const conversationId = id ?? null;
  const [newScopes, setNewScopes] = useState<AssistantScope[]>(() => [...NEW_CHAT_SCOPES]);
  // The paid list's archived view: the drawer's header becomes "Back to chats" for it.
  const [archivedView, setArchivedView] = useState(false);
  // The drawer keeps its own open state, so opening it does not re-render this page.
  const chats = useRef<ChatsDrawerHandle>(null);
  const openChats = () => chats.current?.open();

  const goTo = (next: string | null) => {
    saveSessionConversation(next);
    if (next) void navigate({ to: '/assistant/$id', params: { id: next } as never });
    else {
      setNewScopes([...NEW_CHAT_SCOPES]);
      void navigate({ to: '/assistant' });
    }
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // New chat for whichever assistant is showing.
  const startNew = () => (isFree ? free.startNew() : goTo(null));
  const showChatsLabel = tr(isFree ? 'ws.assistantFree.chats.show' : 'ws.owner.assistant.conversations.showList');

  const chatsButton = (
    <Button kind="default" icon="panelOpen" onClick={openChats} title={showChatsLabel} data-testid="assistant-chats" style={{ fontWeight: 600 }}>
      {tr('ws.owner.assistant.conversations.title')}
    </Button>
  );
  const newChatButton = (
    <Button kind="primary" icon="plus" className="tp-assistant-green tp-assistant-new" onClick={startNew} style={{ fontWeight: 600 }}>
      {tr('ws.owner.assistant.newChat')}
    </Button>
  );
  const isNew = isFree ? free.activeId === null : conversationId === null;
  // The two lists never mix: the paid chats from the database, the free ones
  // from this computer. Memoised, so opening the drawer leaves the list alone.
  const list = useMemo(
    () =>
      isFree ? (
        <FreeChatList
          chats={free.chats}
          activeId={free.activeId}
          onSelect={(next) => {
            free.select(next);
            chats.current?.close();
          }}
          onDelete={free.remove}
        />
      ) : (
        <ConversationList
          activeId={conversationId}
          onSelect={(next) => {
            goToRef.current(next);
            chats.current?.close();
          }}
          onArchived={(archived) => archived === conversationId && goToRef.current(null)}
          showArchived={archivedView}
          onShowArchived={setArchivedView}
        />
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's actions are stable; goTo is read through a ref
    [isFree, free.chats, free.activeId, conversationId, archivedView],
  );
  // The drawer's title line (design L1): "Chats · N", then "+ New", then hide.
  const paidChats = useQuery({ queryKey: QK.conversations, queryFn: fetchConversations });
  const chatCount = isFree ? free.chats.length : paidChats.data?.length;
  const drawerNew = (
    <Button
      kind="primary"
      icon="plus"
      className="tp-assistant-green tp-assistant-new"
      onClick={() => {
        startNew();
        chats.current?.close();
      }}
      style={{ fontWeight: 600 }}
    >
      {tr('ws.owner.assistant.conversations.newShort')}
    </Button>
  );
  // Top-right corner (Sait, 2026-10-20): the paid assistant's way to the free
  // AI, and in the same place on the free AI, the way back.
  const goFreeButton =
    mode === 'paid' && canUsePaid ? (
      <Button kind="soft" icon="spark" className="tp-assistant-green" onClick={() => setMode('free')} title={`${tr('ws.assistantFree.name')} · ${tr('ws.assistantFree.hint')}`} data-testid="assistant-go-free" style={{ fontWeight: 600 }}>
        {tr('ws.owner.assistant.toolbar.goFree')}
      </Button>
    ) : null;
  const goPaidButton =
    mode === 'free' && canUsePaid ? (
      <Button kind="soft" icon="spark" className="tp-assistant-green" onClick={() => setMode('paid')} data-testid="assistant-go-paid" style={{ fontWeight: 600 }}>
        {tr('ws.owner.assistant.toolbar.goPaid')}
      </Button>
    ) : null;

  return (
    // `relative`: the chat drawer slides inside this page, not over the rail.
    <div style={{ position: 'relative', display: 'flex', blockSize: '100%', minBlockSize: 0, gap: 'var(--tp-sp-4)' }}>
      {isNew && (
        // The chats drawer, closed (Sait, 2026-10-20): flush against the rail
        // and the status strip like the open drawer (it reaches out over
        // #tp-main's padding), on the drawer's own surface, its buttons where
        // the open drawer's are, so opening reads as this strip widening.
        <aside
          data-chat-strip=""
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--tp-sp-2)',
            alignItems: 'flex-start',
            marginBlock: 'calc(-1 * var(--tp-sp-4))',
            marginInlineStart: 'calc(-1 * var(--tp-sp-5))',
            paddingBlock: 'var(--tp-sp-3)',
            paddingInline: 'var(--tp-sp-3)',
            background: 'var(--tp-surface)',
            borderInlineEnd: '1px solid var(--tp-border)',
          }}
        >
          <Button kind="default" icon="panelOpen" onClick={openChats} aria-label={showChatsLabel} title={showChatsLabel} data-testid="assistant-chats" />
          <Button kind="primary" icon="plus" className="tp-assistant-green tp-assistant-new" onClick={startNew} aria-label={tr('ws.owner.assistant.newChat')} title={tr('ws.owner.assistant.newChat')} />
        </aside>
      )}
      {/* Only on a new chat, in the page's corner; an open chat does not
          offer it (Sait, 2026-10-20). */}
      {isNew && !isFree && goFreeButton && <div style={{ position: 'absolute', insetBlockStart: 0, insetInlineEnd: 0, zIndex: 1 }}>{goFreeButton}</div>}
      <section aria-label={tr('ws.owner.assistant.title')} style={{ flex: 1, minBlockSize: 0, minInlineSize: 0 }}>
        {mode === 'free' ? (
          <FreeThread
            autoFocus
            headerEnd={goPaidButton}
            toolbarStart={
              <>
                {chatsButton}
                {newChatButton}
              </>
            }
          />
        ) : (
          <Thread
            conversationId={conversationId}
            onConversation={(next) => goTo(next)}
            newScopes={newScopes}
            onNewScopesChange={setNewScopes}
            autoFocus
            toolbarStart={
              <>
                {chatsButton}
                {newChatButton}
              </>
            }
          />
        )}
      </section>
      <ChatsDrawer
        ref={chats}
        title={tr(isFree ? 'ws.assistantFree.chats.title' : 'ws.owner.assistant.conversations.title')}
        count={chatCount}
        actions={drawerNew}
        header={
          !isFree && archivedView ? (
            <Button kind="soft" icon="arrowStart" className="tp-assistant-green" onClick={() => setArchivedView(false)} style={{ fontWeight: 600 }}>
              {tr('ws.owner.assistant.conversations.backToChats')}
            </Button>
          ) : undefined
        }
        closeLabel={tr(isFree ? 'ws.assistantFree.chats.hide' : 'ws.owner.assistant.conversations.hideList')}
      >
        {list}
      </ChatsDrawer>
    </div>
  );
}
