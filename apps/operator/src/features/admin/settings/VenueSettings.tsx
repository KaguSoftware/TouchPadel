/**
 * VenueSettingsScreen (spec 06.49) — one screen, four tabs:
 *   Hours & closed days  → OpeningHoursEditor (set_opening_hours; also at /admin/hours)
 *   Trading              → currency, tax per item group, booking policy (read-only)
 *   Cafe                 → CafeSettingsTab (set_cafe_setting(s), set_waiter_call_cooldown)
 *   Contact              → venue name, phone, timezone (read-only)
 * Dirty / discard / save live inside the tab that owns the write.
 */
import { useState } from 'react';
import { useLocale } from '../../../lib/i18n';
import { Tabs } from '../../../components/ui';
import { PageHeader } from '../../../components/kit';
import { OpeningHoursEditor } from '../OpeningHoursEditor';
import { CafeSettingsTab } from './CafeSettingsTab';
import { ContactTab } from './ContactTab';
import { TradingTab } from './TradingTab';

type SettingsTab = 'hours' | 'trading' | 'cafe' | 'contact';

export function VenueSettingsScreen() {
  const { tr } = useLocale();
  const [tab, setTab] = useState<SettingsTab>('hours');
  return (
    <div>
      <PageHeader title={tr('ws.owner.settings.title')} subtitle={tr('ws.owner.settings.lead')} />
      <Tabs<SettingsTab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'hours', label: tr('ws.owner.settings.tabs.hours') },
          { id: 'trading', label: tr('ws.owner.settings.tabs.trading') },
          { id: 'cafe', label: tr('ws.owner.settings.tabs.cafe') },
          { id: 'contact', label: tr('ws.owner.settings.tabs.contact') },
        ]}
      />
      {tab === 'hours' && <OpeningHoursEditor />}
      {tab === 'trading' && <TradingTab />}
      {tab === 'cafe' && <CafeSettingsTab />}
      {tab === 'contact' && <ContactTab />}
    </div>
  );
}
