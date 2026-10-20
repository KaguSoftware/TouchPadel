/**
 * The chat list as design L1 (2026-10-20), shared by the paid chats
 * (ConversationList) and the free AI's (FreeChatList): a search field, the
 * chats grouped Today / Yesterday / Earlier this week / Earlier, each row its
 * title and cost over what it reads (coloured dots) and its time, the open one
 * marked with a bar; its action (archive, delete) shows on hover or focus;
 * a footer bar closes the drawer.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { scopeLabel } from './Sources';
import { groupByDay, matchesQuery, rowTime } from './chatListLogic';

export interface ChatItem {
  id: string;
  title: string;
  at: Date;
  scopes?: readonly string[];
  cost?: string | null;
}

/** A scope's dot: the Breakdown tones the starter cards use, muted for the rest. */
const SCOPE_DOT: Record<string, string> = {
  cafe: 'var(--tp-card-1)',
  courts: 'var(--tp-card-2)',
  money: 'var(--tp-card-3)',
  stock: 'var(--tp-card-4)',
  staff: 'var(--tp-card-5)',
  howto: 'var(--tp-card-6)',
};

export function ChatListView({
  items,
  activeId,
  onSelect,
  rowAction,
  emptyText,
  footer,
}: {
  items: readonly ChatItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** The row's own action (Archive, Delete), shown on hover or focus. */
  rowAction?: (item: ChatItem) => ReactNode;
  emptyText: string;
  footer?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const now = new Date();
    return groupByDay(
      items.filter((i) => matchesQuery(i.title, query)),
      (i) => i.at,
      now,
    );
  }, [items, query]);
  const now = new Date();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2-5)', minBlockSize: 0, flex: 1 }}>
      <label htmlFor="tp-chat-search" style={{ position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {tr('ws.owner.assistant.conversations.search')}
      </label>
      <input
        id="tp-chat-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr('ws.owner.assistant.conversations.search')}
        style={{ blockSize: '38px', borderRadius: 'var(--tp-radius-panel)', border: '1px solid var(--tp-border-input)', paddingInline: 'var(--tp-sp-3)', font: 'inherit', background: 'var(--tp-surface)', color: 'var(--tp-fg)' }}
      />

      <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
        {items.length === 0 && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', padding: 'var(--tp-sp-2)' }}>{emptyText}</p>}
        {items.length > 0 && groups.length === 0 && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', padding: 'var(--tp-sp-2)' }}>{tr('ws.owner.assistant.conversations.noMatch')}</p>}
        {groups.map((g, gi) => (
          <section key={g.group} aria-label={tr(`ws.owner.assistant.conversations.groups.${g.group}`)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
            {/* The day, then a rule running to the row's end, pinned while its
                chats scroll by (Sait, 2026-10-20). */}
            <h3
              className="tp-chat-day"
              style={{ margin: 0, position: 'sticky', insetBlockStart: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', paddingBlock: gi === 0 ? '6px 4px' : '12px 4px', paddingInline: 'var(--tp-sp-2)', background: 'var(--tp-surface)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {tr(`ws.owner.assistant.conversations.groups.${g.group}`)}
              <span aria-hidden="true" className="tp-chat-day-rule" style={{ flex: 1, blockSize: '1px' }} />
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
              {g.items.map((item) => {
                const active = item.id === activeId;
                const action = rowAction?.(item);
                return (
                  <li key={item.id} className="tp-chat-row" data-active={active ? '' : undefined} data-conversation={item.id} style={{ position: 'relative', borderRadius: 'var(--tp-radius-panel)' }}>
                    {active && <span aria-hidden="true" className="tp-chat-bar" style={{ position: 'absolute', insetInlineStart: 0, insetBlock: '8px', inlineSize: '3px', borderRadius: '3px' }} />}
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={active ? 'true' : undefined}
                      style={{
                        inlineSize: '100%',
                        textAlign: 'start',
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        cursor: 'pointer',
                        paddingBlock: '10px',
                        paddingInlineStart: '14px',
                        paddingInlineEnd: '12px',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: '2px 10px',
                      }}
                    >
                      <bdi style={{ fontSize: 'var(--tp-fs-md)', fontWeight: active ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</bdi>
                      {/* Top end: the cost, which hover hands to the row's action (as drawn). */}
                      <span className={action ? 'tp-chat-cost' : undefined} style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: active ? 600 : 400, color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)' }}>{item.cost ?? ''}</span>
                      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', display: 'flex', alignItems: 'center', gap: '6px', minInlineSize: 0, overflow: 'hidden' }}>
                        {(item.scopes ?? []).slice(0, 4).map((s) => (
                          <span key={s} aria-hidden="true" style={{ inlineSize: '8px', blockSize: '8px', flexShrink: 0, borderRadius: '50%', background: SCOPE_DOT[s] ?? 'var(--tp-border-strong)' }} />
                        ))}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(item.scopes ?? []).map((s) => scopeLabel(tr, s)).join(' · ')}</span>
                      </span>
                      {/* Bottom end: the time; on hover the cost moves down here. */}
                      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap', display: 'grid', justifyItems: 'end' }}>
                        <span className={action ? 'tp-chat-time' : undefined} style={{ gridArea: '1 / 1' }}>{rowTime(item.at, now, locale)}</span>
                        {action && <span className="tp-chat-cost-low" style={{ gridArea: '1 / 1' }}>{item.cost ?? ''}</span>}
                      </span>
                    </button>
                    {action && (
                      <span className="tp-chat-act" style={{ position: 'absolute', insetInlineEnd: '12px', insetBlockStart: '7px' }}>
                        {action}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {footer && (
        <footer style={{ marginInline: 'calc(-1 * var(--tp-sp-3))', marginBlockEnd: 'calc(-1 * var(--tp-sp-3))', borderBlockStart: '1px solid var(--tp-bg)', padding: 'var(--tp-sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {footer}
        </footer>
      )}
    </div>
  );
}
