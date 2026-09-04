/**
 * CourtsReportScreen (spec 06.41): occupancy by court and by hour, revenue per
 * court and per available hour, volumes, cancellations, peak vs off-peak.
 *
 * Each view declares the columns it is about (rulebook 6.1): the court or the
 * hour first, because that is the row's identity, then the figure the view is
 * named after, then the context that figure is read against. Everything the
 * server also sends stays one click away behind "Show all columns" and is
 * always in the CSV.
 */
import { useLocale } from '../../lib/i18n';
import { ReportScreen } from './ReportScreen';

export function CourtsReportScreen() {
  const { tr } = useLocale();
  return (
    <ReportScreen
      name="courts"
      rpc="report_courts"
      fields={['court', 'group']}
      views={[
        {
          id: 'byCourt',
          label: tr('ws.reports.views.courts.byCourt'),
          columns: ['court', 'occupancy_pct', 'booked_hours', 'available_hours', 'revenue_iqd', 'revenue_per_hour_iqd'],
        },
        {
          id: 'byHour',
          label: tr('ws.reports.views.courts.byHour'),
          bars: { labelKey: 'hour', valueKey: 'occupancy_pct' },
          columns: ['hour', 'occupancy_pct', 'bookings', 'booked_hours', 'revenue_iqd'],
        },
        {
          id: 'volumes',
          label: tr('ws.reports.views.courts.volumes'),
          columns: ['court', 'date', 'period', 'bookings', 'booked_hours', 'utilisation_pct', 'revenue_iqd'],
        },
        {
          id: 'cancellations',
          label: tr('ws.reports.views.courts.cancellations'),
          columns: ['court', 'bookings', 'cancellations', 'cancellation_rate_pct', 'no_shows', 'no_show_rate_pct'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'peak',
          label: tr('ws.reports.views.courts.peak'),
          columns: ['court', 'peak_bookings', 'peak_iqd', 'off_peak_bookings', 'off_peak_iqd'],
        },
      ]}
    />
  );
}
