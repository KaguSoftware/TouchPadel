/** /admin/hours on its own: the opening hours editor under a page header. */
import { useLocale } from '../../lib/i18n';
import { PageHeader } from '../../components/kit';
import { OpeningHoursEditor } from './OpeningHoursEditor';

export function OpeningHoursPage() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr('op.hours.title')} subtitle={tr('op.hours.lead')} />
      <OpeningHoursEditor />
    </div>
  );
}
