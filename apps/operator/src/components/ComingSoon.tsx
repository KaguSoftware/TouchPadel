// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/<section>
// Keeps every admin/analytics URL routable now so the sub-nav is complete;
// later waves swap each route's component for the real feature module.
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { card } from './ui';

export function ComingSoon({ titleKey }: { titleKey: MessageKey }) {
  const { tr } = useLocale();
  return (
    <section style={card}>
      <h1 style={{ marginBlockStart: 0, fontSize: '1.3rem' }}>{tr(titleKey)}</h1>
      <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('op.common.comingSoon')}</p>
    </section>
  );
}
