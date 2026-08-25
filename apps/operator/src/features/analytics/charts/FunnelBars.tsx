/**
 * Engagement funnel — hand-rolled (no Recharts): a funnel is a list of shrinking
 * proportional bars plus a step-to-step drop-off, which plain flex boxes express
 * better than any chart primitive, and it keeps the lazy chunk smaller.
 */
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import type { FunnelStep } from '../shape';
import type { Formatters } from '../format';
import { BLUE } from './colors';

const STEP_KEYS: Record<string, MessageKey> = {
  view: 'analytics.kpi.views',
  basket: 'analytics.cards.funnel',
  call: 'analytics.kpi.calls',
};

export function FunnelBars({ steps, f }: { steps: readonly FunnelStep[]; f: Formatters }) {
  const { tr } = useLocale();
  const top = steps[0]?.sessions ?? 0;
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {steps.map((step, i) => {
        const ratio = top > 0 ? step.sessions / top : 0;
        const prev = i > 0 ? steps[i - 1]!.sessions : 0;
        const drop = i > 0 && prev > 0 ? Math.round(((prev - step.sessions) / prev) * 100) : null;
        return (
          <div key={step.step}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBlockEnd: '0.15rem' }}>
              <span>{STEP_KEYS[step.step] ? tr(STEP_KEYS[step.step]!) : step.step}</span>
              <span style={{ color: 'var(--tp-muted-fg)' }}>
                {f.num(step.sessions)}
                {drop !== null && drop > 0 ? ` · −${f.num(drop)}%` : ''}
              </span>
            </div>
            <div style={{ background: 'var(--tp-surface)', borderRadius: '0.25rem', blockSize: '1.1rem' }}>
              <div
                style={{
                  inlineSize: `${Math.max(2, Math.round(ratio * 100))}%`,
                  blockSize: '100%',
                  background: BLUE,
                  borderRadius: '0.25rem',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
