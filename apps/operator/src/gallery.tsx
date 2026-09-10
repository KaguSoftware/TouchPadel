/**
 * Dev-only surface gallery — `pnpm dev` then open /gallery.html.
 *
 * Renders the real shared primitives with static props, so the design of the
 * rail, the table, the status vocabulary, the four async states and the
 * kitchen board can be LOOKED at without a backend, a session or fixtures.
 * It imports the same components the app does, so what it shows is what
 * ships; it is not a mock and it must never be given its own styles.
 *
 * Not referenced by main.tsx and not in the app bundle. Delete freely.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@touch/ui';
import { LocaleProvider, useLocale } from './lib/i18n';
import { GlobalStyles } from './components/GlobalStyles';
import { Button, Field, Skeleton, Spinner, Tabs, card, inputStyle } from './components/ui';
import {
  DataTable,
  EmptyState,
  FilterChips,
  MessagePresenter,
  PageHeader,
  Panel,
  ResultCount,
  RowActions,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  type Column,
} from './components/kit';
import { BrandBall, BrandLockup, BrandSwoosh } from './components/brand';
import { CourtLines, Icon } from './components/icons';

interface Row {
  ref: string;
  guest: string;
  court: string;
  time: string;
  status: string;
  amount: string;
}
const ROWS: Row[] = [
  { ref: 'B-4182', guest: 'Mohammed Al-Rashid', court: 'Court 1', time: '18:00 – 19:30', status: 'arrived', amount: '45,000' },
  { ref: 'B-4183', guest: 'Sara Hussein', court: 'Court 2', time: '18:00 – 19:30', status: 'confirmed', amount: '45,000' },
  { ref: 'B-4184', guest: 'Ali Kareem', court: 'Court 1', time: '19:30 – 21:00', status: 'pending', amount: '52,000' },
  { ref: 'B-4185', guest: 'Noor Abdullah', court: 'Court 3', time: '20:00 – 21:00', status: 'cancelled', amount: '0' },
];
const TONES = ['neutral', 'accent', 'success', 'warn', 'danger', 'info'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBlockEnd: '2rem' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-lg)', marginBlockEnd: '0.75rem', color: 'var(--tp-muted-fg)' }}>{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  const { tr, toggleLocale } = useLocale();
  const columns: Column<Row>[] = [
    { key: 'ref', header: 'Booking' },
    { key: 'guest', header: 'Guest' },
    { key: 'court', header: 'Court' },
    { key: 'time', header: 'Time' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={r.status === 'arrived' ? 'success' : r.status === 'pending' ? 'warn' : r.status === 'cancelled' ? 'danger' : 'accent'} label={r.status} /> },
    { key: 'amount', header: 'Amount', numeric: true },
  ];

  return (
    <div style={{ display: 'flex', minBlockSize: '100vh', alignItems: 'stretch' }}>
      {/* --- the rail, as the shell builds it --- */}
      <nav
        style={{
          inlineSize: 'var(--tp-rail-w)',
          flexShrink: 0,
          background: 'var(--tp-rail)',
          color: 'var(--tp-rail-fg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', paddingBlock: '1rem 0.9rem', paddingInline: '0.9rem', borderBlockEnd: '1px solid var(--tp-rail-border)', overflow: 'hidden' }}>
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <CourtLines opacity={0.16} />
          </div>
          <div style={{ position: 'relative' }}>
            <BrandLockup size={28} tone="onDark" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBlockStart: '0.6rem' }}>
              <span style={{ display: 'inline-flex', color: 'var(--tp-rail-green)' }}>
                <Icon name="today" size={16} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)', color: 'var(--tp-brand-white)' }}>Court desk</span>
            </div>
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', marginBlockStart: '0.15rem' }}>Bookings, arrivals and guests</p>
          </div>
        </div>
        <div style={{ flex: 1, paddingBlock: '0.6rem', paddingInline: '0.5rem', display: 'grid', gap: '2px', alignContent: 'start' }}>
          {[
            ['today', 'Today', true],
            ['calendar', 'Calendar', false],
            ['users', 'Customers', false],
            ['repeat', 'New series', false],
            ['ban', 'Block court', false],
          ].map(([icon, label, active]) => (
            <a key={label as string} href="#" className="tp-nav-item" data-active={active ? 'true' : undefined}>
              <Icon name={icon as 'today'} size={17} />
              <span>{label as string}</span>
            </a>
          ))}
        </div>
      </nav>

      <main style={{ flex: 1, minInlineSize: 0, paddingBlock: '1.25rem', paddingInline: '1.5rem' }}>
        <PageHeader
          title="Today's bookings"
          subtitle="Everything on the courts today, and who has arrived."
          actions={
            <>
              <Button icon="printer">Print sheet</Button>
              <Button kind="primary" icon="plus">Add booking</Button>
            </>
          }
        />

        <Section title="Status vocabulary">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {TONES.map((t) => (
              <StatusBadge key={t} tone={t} label={t} />
            ))}
          </div>
        </Section>

        <Section title="Actions">
          <Toolbar>
            <Button kind="primary">Primary</Button>
            <Button>Default</Button>
            <Button kind="soft">Soft</Button>
            <Button kind="ghost">Ghost</Button>
            <Button kind="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button busy>Busy</Button>
            <Button kind="primary" busy>Saving</Button>
            <Button icon="search" aria-label="Search" />
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </Toolbar>
        </Section>

        <Section title="List anatomy — count, filter chips, table, row actions">
          <Toolbar end={<ResultCount shown={4} total={248} />}>
            <FilterChips
              chips={[
                { id: 'court', label: 'Court 1', text: 'Court 1', onRemove: () => {} },
                { id: 'status', label: 'Arrived', text: 'Arrived', onRemove: () => {} },
              ]}
              onClearAll={() => {}}
            />
          </Toolbar>
          <DataTable
            columns={[
              ...columns,
              {
                key: 'actions',
                header: '',
                align: 'end',
                render: (r) => (
                  <RowActions
                    label={r.guest}
                    actions={[
                      { id: 'open', label: 'Open booking', icon: 'arrowUpRight', onSelect: () => {} },
                      { id: 'arrive', label: 'Mark arrived', icon: 'check', onSelect: () => {} },
                      { id: 'move', label: 'Move booking', icon: 'repeat', onSelect: () => {} },
                      { id: 'cancel', label: 'Cancel booking', icon: 'ban', danger: true, onSelect: () => {} },
                    ]}
                  />
                ),
              },
            ]}
            rows={ROWS}
            rowKey={(r) => r.ref}
            onRowClick={() => {}}
            aria-label="Bookings"
          />
        </Section>

        <Section title="Messages and reasons">
          <div style={{ display: 'grid', gap: '0.6rem', maxInlineSize: 'var(--tp-measure-form)' }}>
            <MessagePresenter tone="success" message="Booking B-4182 marked arrived." />
            <MessagePresenter tone="refused" message="Refunds need a manager. Ask a manager to sign in." />
            <MessagePresenter tone="error" message="That court was booked by another station a moment ago." />
            <MessagePresenter tone="info" message="Rates change at 18:00 tonight." />
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBlockStart: '0.5rem' }}>
              <Button kind="danger" disabled disabledReason="Already paid — refund instead.">Void booking</Button>
              <Button kind="primary" disabled disabledReason="The day is closed. Reopen it first.">Take payment</Button>
            </div>
          </div>
        </Section>

        <Section title="Waiting, and nothing there">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Panel title="Loading">
              <TableSkeleton columns={columns} rows={3} />
              <div style={{ blockSize: '0.75rem' }} />
              <Skeleton lines={2} />
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBlockStart: '1rem' }}>
                <Spinner size="lg" />
                <Spinner size="md" />
                <Spinner size="sm" />
                <Spinner size="xs" />
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>lg · md · sm · xs</span>
              </div>
            </Panel>
            <EmptyState icon="today" title="No bookings today" body="Nothing is on the courts. Add a booking when a guest calls." action={<Button kind="primary" icon="plus">Add booking</Button>} />
          </div>
        </Section>

        <Section title="Form">
          <div style={{ ...card, maxInlineSize: 'var(--tp-measure-form)' }}>
            <Field label="Guest name" required>
              <input style={inputStyle} defaultValue="Mohammed Al-Rashid" />
            </Field>
            <Field label="Phone" hint="Iraqi mobile, with or without the leading zero.">
              <input style={inputStyle} defaultValue="0770 123 4567" dir="ltr" />
            </Field>
            <Field label="Court" error="That court is already booked at this time.">
              <select style={inputStyle} defaultValue="1">
                <option value="1">Court 1</option>
                <option value="2">Court 2</option>
              </select>
            </Field>
            <Tabs value="a" onChange={() => {}} items={[{ id: 'a', label: 'Details' }, { id: 'b', label: 'Payments', count: 2 }, { id: 'c', label: 'History' }]} />
          </div>
        </Section>

        <Section title="Brand — the six sanctioned surfaces">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ background: 'var(--tp-rail)', borderRadius: 'var(--tp-radius-panel)', padding: '1.5rem', display: 'grid', gap: '1.25rem', justifyItems: 'start' }}>
              <BrandLockup size={40} tone="onDark" />
              <BrandLockup size={22} tone="onDark" />
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <BrandBall size={32} />
                <BrandBall size={20} />
                <BrandBall size={14} />
                <BrandBall size={24} spin />
              </div>
            </div>
            <div style={{ background: 'var(--tp-surface)', border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', padding: '1.5rem', display: 'grid', gap: '1.25rem', justifyItems: 'start' }}>
              <BrandLockup size={40} />
              <BrandLockup size={22} />
              <div style={{ inlineSize: '100%', blockSize: '6rem' }}>
                <BrandSwoosh opacity={0.9} />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Kitchen board">
          <div data-workspace="prep" style={{ background: 'var(--tp-kds-bg)', borderRadius: 'var(--tp-radius-panel)', padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {(['fresh', 'warm', 'late'] as const).map((state) => (
              <div key={state} style={{ background: 'var(--tp-kds-card)', border: '1px solid var(--tp-kds-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'hidden' }}>
                <div style={{ background: `var(--tp-kds-${state})`, color: 'var(--tp-kds-on-fill)', paddingBlock: '0.5rem', paddingInline: '0.75rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 'var(--tp-fs-kds)' }}>
                  <span>Table 4</span>
                  <span>{state === 'fresh' ? '1:20' : state === 'warm' ? '6:05' : '12:44'}</span>
                </div>
                <div style={{ padding: '0.75rem', color: 'var(--tp-kds-fg)', fontSize: 'var(--tp-fs-kds-sm)', display: 'grid', gap: '0.35rem' }}>
                  <span>2 × Cappuccino</span>
                  <span>1 × Club sandwich</span>
                  <span style={{ color: 'var(--tp-kds-muted)' }}>no onions</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Button onClick={toggleLocale} icon="globe">{tr('ws.shell.nav.language')}</Button>
        <div style={{ blockSize: '3rem' }} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider theme="operator" dir="ltr">
        <GlobalStyles />
        <Gallery />
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
);
