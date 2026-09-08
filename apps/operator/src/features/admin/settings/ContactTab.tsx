/** Contact tab (spec 06.49): venue name, phone and timezone from `venue_settings`. Read-only until a write RPC exists. */
import { useQuery } from '@tanstack/react-query';
import { useLocale } from '../../../lib/i18n';
import { Skeleton } from '../../../components/ui';
import { AsyncStateWrapper, DescriptionList, MessagePresenter, Panel, StatusBadge, asyncStatus } from '../../../components/kit';
import { VENUE_ADMIN_KEY, fetchVenueAdmin } from './venueQueries';

export function ContactTab() {
  const { tr } = useLocale();
  const venueQ = useQuery({ queryKey: VENUE_ADMIN_KEY, queryFn: fetchVenueAdmin, staleTime: 60_000 });
  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)' }}>
      <AsyncStateWrapper status={asyncStatus(venueQ, () => false)} error={venueQ.error} onRetry={() => void venueQ.refetch()} skeleton={<Skeleton lines={4} />}>
        {/* Was titled "Settings" — the panel is the CONTACT details, and a
            section named after the page it sits on tells the reader nothing
            (rulebook 2.5: label by effect). */}
        {venueQ.data && (
          <Panel title={tr('ws.owner.settings.tabs.contact')} actions={<StatusBadge tone="neutral" size="sm" label={tr('ws.kit.common.readOnly')} />}>
            <DescriptionList
              items={[
                { label: tr('ws.owner.settings.contact.venueName'), value: <bdi>{venueQ.data.venue_name}</bdi> },
                {
                  label: tr('ws.owner.settings.contact.phone'),
                  value: venueQ.data.phone ? <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{venueQ.data.phone}</span> : <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.settings.contact.phoneNone')}</span>,
                },
                { label: tr('ws.owner.settings.contact.timezone'), value: <span dir="ltr">{venueQ.data.timezone}</span> },
              ]}
            />
            <MessagePresenter tone="info" message={tr('ws.owner.settings.contact.readOnlyNote')} style={{ marginBlockStart: 'var(--tp-sp-3)' }} />
          </Panel>
        )}
      </AsyncStateWrapper>
    </div>
  );
}
