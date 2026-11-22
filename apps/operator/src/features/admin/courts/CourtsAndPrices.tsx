/**
 * Courts (`/admin/courts`): two cards, the courts the club has and what each
 * costs. They were two tabs (Court prices, Courts) for one job, setting up what
 * a guest can book and what it costs; each card is the old screen, unchanged.
 */
import { PageHeader } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import { CourtsAdmin } from './CourtsAdmin';
import { RateRuleEditor } from '../RateRuleEditor';

export function CourtsAndPrices() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr('op.courts.title')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <CourtsAdmin embedded />
        <RateRuleEditor embedded />
      </div>
    </div>
  );
}
