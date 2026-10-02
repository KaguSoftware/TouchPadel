/**
 * The two notices every coaching read shares (docs/design/coaching/operator.md
 * §5.5), the MatchReadNotice twin: a first read that failed says so, with
 * Retry ("Lessons can't be shown without a connection"), and data kept from an
 * earlier read carries a muted "Last updated {time}". Absent (RPC_MISSING),
 * loading and fresh data render nothing here; the surface decides what those
 * look like.
 *
 * Feed it `useLessonRead(query)`.
 */
import { formatTime } from '@touch/i18n';
import { MessagePresenter } from '../../components/kit';
import { Button } from '../../components/ui';
import { useLocale } from '../../lib/i18n';
import type { LessonReadStatus } from './useCoaching';

export function LessonReadNotice({
  status,
  onRetry,
  tz,
  compact,
}: {
  status: LessonReadStatus<unknown>;
  onRetry: () => void;
  /** The branch's timezone for the "Last updated" time. */
  tz?: string;
  /** One muted line instead of the presenter (a strip or a panel header). */
  compact?: boolean;
}) {
  const { tr, locale } = useLocale();
  if (status.kind === 'failed') {
    if (compact) {
      return (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.coaching.offline.readFailed')}
        </p>
      );
    }
    return (
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <MessagePresenter
          tone="refused"
          icon="wifiOff"
          message={tr('ws.coaching.offline.readFailed')}
          style={{ flex: 1 }}
        />
        <Button size="sm" icon="refresh" onClick={onRetry}>
          {tr('common.retry')}
        </Button>
      </div>
    );
  }
  if (status.kind === 'ready' && status.stale && status.updatedAt > 0) {
    return (
      <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.coaching.offline.lastUpdated', {
          time: formatTime(new Date(status.updatedAt), locale, tz),
        })}
      </p>
    );
  }
  return null;
}
