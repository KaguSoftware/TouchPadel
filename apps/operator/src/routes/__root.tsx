import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { touch } from '../ipc/bridge';

export const rootRoute = createRootRoute({
  component: RootShell,
});

const NAV = [
  ['/till', 'till.title'],
  ['/desk', 'desk.title'],
  ['/kds', 'kds.title'],
  ['/stock', 'stock.title'],
  ['/admin', 'admin.title'],
] as const;

// Role-based nav shell. TODO(W2+): filter NAV by station mode (getStation — a KDS1
// machine boots straight into /kds) and by unlocked staff role (design-arch.md §2.1, §4).
// Inline styles below use logical properties only (HANDOFF conventions).
function RootShell() {
  const station = touch.getStation();
  return (
    <div style={{ display: 'flex', minBlockSize: '100vh' }}>
      <nav
        style={{
          inlineSize: '13rem',
          borderInlineEnd: '1px solid #ccc',
          paddingBlock: '1rem',
          paddingInline: '1rem',
        }}
      >
        <p style={{ fontWeight: 700 }}>{t('en', 'operator.appName')}</p>
        <p style={{ fontSize: '0.8rem' }}>
          {station.stationId} · {station.mode}
        </p>
        {NAV.map(([to, key]) => (
          <Link key={to} to={to} style={{ display: 'block', paddingBlock: '0.5rem' }}>
            {t('en', key)}
          </Link>
        ))}
      </nav>
      <main style={{ flex: 1, paddingBlock: '1rem', paddingInline: '1rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
