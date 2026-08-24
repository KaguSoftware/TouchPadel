import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute, RequireRole } from './__root';
import { useLocale } from '../lib/i18n';
import { Button } from '../components/ui';
import { MenuEditor } from '../features/admin/MenuEditor';
import { RateRuleEditor } from '../features/admin/RateRuleEditor';
import { OpeningHoursEditor } from '../features/admin/OpeningHoursEditor';
import { DayClose } from '../features/admin/DayClose';

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (
    <RequireRole route="/admin">
      <AdminScreen />
    </RequireRole>
  ),
});

type AdminTab = 'menu' | 'rates' | 'hours' | 'dayClose';

function AdminScreen() {
  const { tr } = useLocale();
  const [tab, setTab] = useState<AdminTab>('menu');
  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'menu', label: tr('op.admin.menuTab') },
    { id: 'rates', label: tr('op.admin.ratesTab') },
    { id: 'hours', label: tr('op.admin.hoursTab') },
    { id: 'dayClose', label: tr('op.admin.dayCloseTab') },
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBlockEnd: '0.8rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', marginInlineEnd: '0.8rem' }}>
          {tr('admin.title')}
        </h1>
        {tabs.map((entry) => (
          <Button
            key={entry.id}
            kind={tab === entry.id ? 'primary' : 'default'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      {tab === 'menu' && <MenuEditor />}
      {tab === 'rates' && <RateRuleEditor />}
      {tab === 'hours' && <OpeningHoursEditor />}
      {tab === 'dayClose' && <DayClose />}
    </div>
  );
}
