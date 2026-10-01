/** "3 days overdue" (red), "due today" (amber) or "due in 2 days", from the server's days_left. */
import { countPhrase } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { dueWhen } from './wagesLogic';

export function DueWhenText({ daysLeft }: { daysLeft: number | null }) {
  const { tr, locale } = useLocale();
  const when = dueWhen(daysLeft);
  if (when === null) return null;
  const text =
    when.kind === 'overdue'
      ? countPhrase('ws.wages.count.overdueDays', when.days, locale)
      : when.kind === 'today'
        ? tr('ws.wages.due.today')
        : countPhrase('ws.wages.count.inDays', when.days, locale);
  const color = when.kind === 'overdue' ? 'var(--tp-danger-fg)' : when.kind === 'today' ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)';
  return <span style={{ color, fontWeight: when.kind === 'in' ? 400 : 600, whiteSpace: 'nowrap' }}>{text}</span>;
}
