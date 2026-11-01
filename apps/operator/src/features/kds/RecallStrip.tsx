/**
 * F-57 (0396): "Just completed" — the tickets this board saw completed in the
 * last ten minutes, each with a Bring back button (recall.ts, app.recall_ticket).
 * A slim row under the ticket grid: it is there for the one mistaken tap, not
 * a second board. Not shown while the board works from the LAN (KdsBoard).
 */
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';

export interface RecallItem {
  id: string;
  /** Where it goes ("Table 4", a court), as the card said it. */
  label: string;
  /** "2× Latte · 1× Toast". */
  summary: string;
  minutesAgo: number;
}

export interface RecallStripProps {
  items: readonly RecallItem[];
  busyId: string | null;
  /** The last recall was queued (no connection): it comes back when the connection does. */
  queued: boolean;
  onRecall: (ticketId: string) => void;
}

export function RecallStrip({ items, busyId, queued, onRecall }: RecallStripProps) {
  const { tr, locale } = useLocale();
  if (items.length === 0 && !queued) return null;
  return (
    <section
      aria-label={tr('ws.prep.recall.title')}
      data-testid="kds-recall"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--tp-sp-2) var(--tp-sp-3)',
        paddingBlock: 'var(--tp-sp-2)',
        marginBlockStart: 'var(--tp-sp-2)',
        borderBlockStart: '1px solid var(--tp-kds-border)',
        fontSize: 'var(--tp-fs-kds-sm)',
        color: 'var(--tp-kds-muted)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: 700 }}>
        <Icon name="undo" size={20} />
        {tr('ws.prep.recall.title')}
      </span>
      <span>{queued ? tr('ws.prep.recall.queued') : tr('ws.prep.recall.hint')}</span>
      <ul style={{ display: 'contents', listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li key={item.id} style={{ display: 'inline-flex' }}>
            <button
              type="button"
              data-testid="kds-recall-button"
              data-ticket-id={item.id}
              disabled={busyId !== null}
              aria-busy={busyId === item.id}
              aria-label={tr('ws.prep.recall.actionLabel', { tag: item.label })}
              onClick={() => onRecall(item.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                fontFamily: 'inherit',
                fontSize: 'var(--tp-fs-kds-sm)',
                color: 'var(--tp-kds-fg)',
                border: '1px solid var(--tp-kds-border)',
                background: 'var(--tp-kds-card)',
                borderRadius: 'var(--tp-radius-pill)',
                paddingInline: 'var(--tp-sp-3)',
                minBlockSize: 'var(--tp-row-h)',
                maxInlineSize: '28rem',
                cursor: busyId !== null ? 'progress' : 'pointer',
                opacity: busyId !== null && busyId !== item.id ? 0.6 : 1,
              }}
            >
              <bdi style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{item.label}</bdi>
              <bdi style={{ color: 'var(--tp-kds-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.summary}
              </bdi>
              <span style={{ color: 'var(--tp-kds-muted)', whiteSpace: 'nowrap' }}>
                {tr('ws.prep.recall.ago', { min: formatNumber(item.minutesAgo, locale) })}
              </span>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', whiteSpace: 'nowrap' }}>
                <Icon name="undo" size={18} />
                {tr('ws.prep.recall.action')}
              </strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
