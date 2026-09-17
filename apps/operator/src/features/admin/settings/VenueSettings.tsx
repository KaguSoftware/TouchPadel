/**
 * VenueSettingsScreen (spec 06.49) — one screen, four tabs, split by what the
 * owner can DO on each:
 *
 *   Opening hours      → OpeningHoursEditor (set_opening_hours; also at /admin/hours)
 *   Day & service      → DayServiceTab (business-day start, waiter-call wait)
 *   Analytics          → AnalyticsTab (excluded items, guest-app data start) — owner only
 *   Venue details      → VenueDetailsTab (currency, tax, booking rules, contact) — read-only
 *
 * The tabs used to be Hours / Trading / Cafe / Contact. Two of the four were
 * entirely read-only yet looked like settings, each with its own "changing
 * this needs a migration" note; the "Cafe" tab held the business-day start,
 * which moves the day boundary for the panel, analytics and reports and has
 * nothing to do with the cafe. Everything fixed at setup now sits on one tab
 * that says so once, and the tabs that change something say what they change.
 *
 * Analytics is hidden from a manager rather than shown locked: every row on it
 * is the owner's, and the analytics screens themselves are owner-only.
 */
import { useState } from 'react';
import { useAuth, canAccess } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { Tabs } from '../../../components/ui';
import { PageHeader } from '../../../components/kit';
import { OpeningHoursEditor } from '../OpeningHoursEditor';
import { AnalyticsTab } from './AnalyticsTab';
import { DayServiceTab } from './DayServiceTab';
import { VenueDetailsTab } from './VenueDetailsTab';

type SettingsTab = 'hours' | 'day' | 'analytics' | 'details';

export function VenueSettingsScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const showAnalytics = canAccess(staff?.role, '/analytics');
  const [tab, setTab] = useState<SettingsTab>('hours');
  return (
    <div>
      <PageHeader title={tr('ws.owner.settings.title')} subtitle={tr('ws.owner.settings.lead')} />
      <Tabs<SettingsTab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'hours', label: tr('ws.owner.settings.tabs.hours') },
          { id: 'day', label: tr('ws.owner.settings.tabs.day') },
          ...(showAnalytics ? [{ id: 'analytics' as const, label: tr('ws.owner.settings.tabs.analytics') }] : []),
          { id: 'details', label: tr('ws.owner.settings.tabs.details') },
        ]}
      />
      {tab === 'hours' && <OpeningHoursEditor />}
      {tab === 'day' && <DayServiceTab />}
      {tab === 'analytics' && showAnalytics && <AnalyticsTab />}
      {tab === 'details' && <VenueDetailsTab />}
    </div>
  );
}
