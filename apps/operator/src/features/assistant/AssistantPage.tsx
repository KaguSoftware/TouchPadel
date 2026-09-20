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
import { Thread } from './Thread';
import { initialScopes, saveSessionConversation } from './scopes';

export function AssistantPageScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id?: string };
  const conversationId = id ?? null;
  const [newScopes, setNewScopes] = useState<AssistantScope[]>(() => initialScopes('/assistant', staff?.id ?? ''));

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
      >
        {/* Decision 10: a re-check button on a saved answer is v1.1; say so rather than grey one out. */}
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.recheckAbsent')}</p>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(14rem, 18rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', flex: 1, minBlockSize: 0 }}>
        <aside style={{ borderInlineEnd: '1px solid var(--tp-border)', paddingInlineEnd: 'var(--tp-sp-3)', minBlockSize: 0, display: 'flex', flexDirection: 'column' }}>
          <ConversationList activeId={conversationId} onSelect={(next) => goTo(next)} onNew={() => goTo(null)} onArchived={(archived) => archived === conversationId && goTo(null)} />
        </aside>
        <section aria-label={tr('ws.owner.assistant.title')} style={{ minBlockSize: 0, minInlineSize: 0 }}>
          <Thread conversationId={conversationId} onConversation={(next) => goTo(next)} newScopes={newScopes} onNewScopesChange={setNewScopes} autoFocus />
        </section>
      </div>
    </div>
  );
}
