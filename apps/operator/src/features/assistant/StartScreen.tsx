/**
 * A new paid chat (owner call 2026-10-20, design C): "What do you want to
 * know?", then the ready questions on six coloured cards; the composer sits at
 * the foot of the thread, where it is in an open chat (Sait, 2026-10-20). Each
 * card says what it reads; pressing a question sets the chat to exactly that
 * and asks it at once. Typing your own needs a pick first (the composer is
 * locked until then), so nothing is ever read that the owner did not choose.
 */
import type { ReactNode } from 'react';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { STARTER_TOPICS } from './starters';
import { scopeLabel } from './Sources';

/** --tp-card-1..6 in order, as the Breakdown cards name them. */
const TONES = ['green', 'violet', 'rose', 'sky', 'teal', 'gold'] as const;

export function StartScreen({
  footer,
  onAsk,
  disabled,
  compact,
}: {
  /** What the chat reads, the billing line and the month's cost, at the foot. */
  footer?: ReactNode;
  onAsk: (scopes: readonly AssistantScope[], question: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <div data-assistant-start="" style={{ display: 'flex', flexDirection: 'column', gap: compact ? 'var(--tp-sp-3)' : 'var(--tp-sp-5)', alignItems: 'center', flex: 1, boxSizing: 'border-box', paddingBlockStart: compact ? 'var(--tp-sp-3)' : 'calc(var(--tp-sp-6) * 2)', paddingBlockEnd: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'center', textAlign: 'center', maxInlineSize: '40rem' }}>
        {compact ? (
          <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>{tr('ws.owner.assistant.start.title')}</h2>
        ) : (
          <h1 style={{ margin: 0, fontSize: 'var(--tp-fs-3xl)', fontWeight: 700 }}>{tr('ws.owner.assistant.start.title')}</h1>
        )}
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.start.lead')}</p>
      </div>

      <div
        style={{
          inlineSize: '100%',
          maxInlineSize: '65rem',
          display: 'grid',
          gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(17rem, 1fr))',
          // In the middle of the room between the heading and the footer (Sait, 2026-10-20).
          marginBlock: 'auto',
          gap: 'var(--tp-sp-3)',
        }}
      >
        {STARTER_TOPICS.map((topic) => (
          // Dressed as a Breakdown card (Sait, 2026-10-20): the colour as a title
          // band, a wash of it behind the questions, the questions as rows
          // divided by rules.
          <section
            key={topic.key}
            data-starter={topic.key}
            className="tp-breakdown-card"
            data-tone={TONES[topic.card - 1]}
            aria-labelledby={`starter-${topic.key}`}
            style={{ borderRadius: 'var(--tp-radius-panel)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <h3
              id={`starter-${topic.key}`}
              className="tp-breakdown-head"
              style={{ margin: 0, paddingBlock: 'var(--tp-sp-2-5)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-lg)', fontWeight: 700, display: 'grid', gap: '0.15rem' }}
            >
              {tr(`ws.owner.assistant.starters.${topic.key}.title`)}
              {/* What it reads, on its own line under the title (Sait, 2026-10-20). */}
              <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 500 }}>
                {tr('ws.owner.assistant.start.reads', { scopes: topic.scopes.map((s) => scopeLabel(tr, s)).join(', ') })}
              </span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {topic.questions.map((q) => {
                const question = tr(`ws.owner.assistant.starters.${topic.key}.questions.${q}` as never);
                return (
                  <button key={q} type="button" className="tp-starter-row" disabled={disabled} title={tr('ws.owner.assistant.start.askHint')} onClick={() => onAsk(topic.scopes, question)}>
                    {question}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {footer && <div style={{ paddingBlockStart: 'var(--tp-sp-3)' }}>{footer}</div>}
    </div>
  );
}
