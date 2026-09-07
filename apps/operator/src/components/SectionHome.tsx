/**
 * The landing screen shared by Management's three sections (Financial,
 * Observation, Setup).
 *
 * A section's rail can only print a name, and a name is not an answer: "Tables
 * & QR" does not tell an owner that this is where a lost table card is
 * revoked, and "Day close" does not say whether it is where the money is
 * counted or where the reasons are read. So the section's landing screen is
 * one card per destination, each saying what the screen DECIDES, in the same
 * order as the rail beside it.
 *
 * Destinations come from lib/workspaces.ts rather than a list held here, so a
 * rail row and its card can never disagree about what the section contains.
 * Three are dropped: the section's own overview (this screen — a card back to
 * itself is a loop), anything `hidden` (reached from inside another screen),
 * and anything the signed-in role may not open, because a card is a link and
 * offering a link to a refusal is the dead end the rulebook forbids (4.3).
 *
 * `children` renders above the grid: Financial puts its headline figures
 * there, Observation puts what is waiting on a decision.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth, canAccess } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { WORKSPACES, type NavItem, type SectionKey } from '../lib/workspaces';
import { PageHeader } from './kit';
import { ChevronForward, Icon } from './icons';

/** A section's card destinations: its rail minus itself, minus what is hidden. */
export function sectionDestinations(key: SectionKey): readonly NavItem[] {
  const section = WORKSPACES.owner.sections?.find((s) => s.key === key);
  return (section?.items ?? []).filter((item) => !item.hidden && item.labelKey !== 'overview');
}

export function SectionHome({
  sectionKey,
  title,
  lead,
  card,
  children,
}: {
  sectionKey: SectionKey;
  title: string;
  lead: string;
  /** Card copy for a destination, keyed by its nav labelKey. */
  card: (labelKey: string) => string;
  children?: ReactNode;
}) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const items = sectionDestinations(sectionKey).filter((item) => canAccess(staff?.role, item.to));

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader title={title} subtitle={lead} />
      {children}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="tp-tile"
            style={{
              background: 'var(--tp-surface)',
              border: '1px solid var(--tp-border)',
              borderRadius: 'var(--tp-radius-panel)',
              padding: 'var(--tp-sp-4)',
              display: 'grid',
              gap: 'var(--tp-sp-2)',
              alignContent: 'start',
              color: 'var(--tp-fg)',
              textDecoration: 'none',
              minBlockSize: 'var(--tp-tile-min-block)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  inlineSize: '2.25rem',
                  blockSize: '2.25rem',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  background: 'var(--tp-rail)',
                  color: 'var(--tp-rail-green)',
                }}
              >
                <Icon name={item.icon} size={18} />
              </span>
              <ChevronForward size={16} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-lg)' }}>
              {tr(`ws.shell.nav.${item.labelKey}`)}
            </span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{card(item.labelKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
