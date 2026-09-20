/**
 * `/assistant` and `/assistant/$id` (plan §5.1): the chat list beside the
 * thread. One component for both URLs — the layout route renders it and only
 * the `$id` param changes — so a first question that creates a conversation
 * and moves the URL to `/assistant/<id>` does not unmount the stream.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Kbd, PageHeader } from '../../components/kit';
import { Button } from '../../components/ui';
import { ConversationList } from './ConversationList';
import { loadOpen, saveOpen } from './Disclosure';
import { Thread } from './Thread';
import { initialScopes, saveSessionConversation } from './scopes';

export function AssistantPageScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id?: string };
  const conversationId = id ?? null;
  const [newScopes, setNewScopes] = useState<AssistantScope[]>(() => initialScopes('/assistant', staff?.id ?? ''));
  // The chat list folds to a narrow strip (owner call 2026-09-21); a station preference like the workspace.
  const [listOpen, setListOpen] = useState(() => loadOpen('page-list', true));
  const toggleList = () => setListOpen((o) => { saveOpen('page-list', !o); return !o; });

  const goTo = (next: string | null) => {
    saveSessionConversation(next);
    if (next) void navigate({ to: '/assistant/$id', params: { id: next } as never });
    else {
      setNewScopes(initialScopes('/assistant', staff?.id ?? ''));
      void navigate({ to: '/assistant' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', blockSize: '100%', minBlockSize: 0 }}>
      <PageHeader
        title={tr('ws.owner.assistant.title')}
        subtitle={tr('ws.owner.assistant.lead')}
        actions={
          <>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
              <Kbd>Ctrl/⌘ K</Kbd>
            </span>
            <Link to="/assistant/usage" className="tp-link">
              <Button kind="soft" icon="chart">
                {tr('ws.owner.assistant.usage.open')}
              </Button>
            </Link>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: listOpen ? 'minmax(14rem, 18rem) minmax(0, 1fr)' : 'auto minmax(0, 1fr)', gap: 'var(--tp-sp-4)', flex: 1, minBlockSize: 0 }}>
        <aside data-chat-list={listOpen ? 'open' : 'closed'} style={{ borderInlineEnd: '1px solid var(--tp-border)', paddingInlineEnd: 'var(--tp-sp-3)', minBlockSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2)' }}>
          <Button
            size="sm"
            kind="ghost"
            icon={listOpen ? 'chevronDown' : 'chevronEnd'}
            onClick={toggleList}
            aria-expanded={listOpen}
            aria-label={tr(listOpen ? 'ws.owner.assistant.conversations.hideList' : 'ws.owner.assistant.conversations.showList')}
            title={tr(listOpen ? 'ws.owner.assistant.conversations.hideList' : 'ws.owner.assistant.conversations.showList')}
            style={{ justifySelf: 'start' }}
          >
            {listOpen ? tr('ws.owner.assistant.conversations.title') : ''}
          </Button>
          {listOpen ? (
            <ConversationList activeId={conversationId} onSelect={(next) => goTo(next)} onNew={() => goTo(null)} onArchived={(archived) => archived === conversationId && goTo(null)} />
          ) : (
            <Button size="sm" kind="primary" icon="plus" onClick={() => goTo(null)} aria-label={tr('ws.owner.assistant.newChat')} title={tr('ws.owner.assistant.newChat')} />
          )}
        </aside>
        <section aria-label={tr('ws.owner.assistant.title')} style={{ minBlockSize: 0, minInlineSize: 0 }}>
          <Thread conversationId={conversationId} onConversation={(next) => goTo(next)} newScopes={newScopes} onNewScopesChange={setNewScopes} autoFocus />
        </section>
      </div>
    </div>
  );
}
