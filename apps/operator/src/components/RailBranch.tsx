/**
 * The branch line in the rail header (multi-venue slice 4, plan MV1–MV8).
 *
 * - One branch: nothing (today's single-venue rail is unchanged).
 * - A registered station, or someone who works at one branch: the branch's
 *   name, so nobody wonders which location the screen is for.
 * - The owner, or a manager at two branches, on a machine that is not a
 *   registered station: a switcher. Switching reloads every screen for the
 *   new branch (lib/venue.tsx).
 */
import { useId } from 'react';
import { useLocale, pickName } from '../lib/i18n';
import { useVenue } from '../lib/venue';

export function RailBranch() {
  const { tr, locale } = useLocale();
  const { venues, current, canSwitch, setBranch } = useVenue();
  const id = useId();
  if (venues.length <= 1 || !current) return null;

  const label = (v: (typeof venues)[number]) =>
    v.status === 'preparing' ? `${pickName(locale, v)} · ${tr('ws.branches.switcher.preparing')}` : pickName(locale, v);

  if (!canSwitch) {
    return (
      <p
        data-testid="rail-branch"
        style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-brand-white)' }}
      >
        <span style={{ color: 'var(--tp-rail-muted)' }}>{tr('ws.branches.switcher.label')}: </span>
        {label(current)}
      </p>
    );
  }

  return (
    <div style={{ marginBlockStart: 'var(--tp-sp-2)', display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <label htmlFor={id} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)' }}>
        {tr('ws.branches.switcher.label')}
      </label>
      <select
        id={id}
        data-testid="rail-branch-switcher"
        value={current.id}
        onChange={(e) => setBranch(e.target.value)}
        style={{
          inlineSize: '100%',
          font: 'inherit',
          fontSize: 'var(--tp-fs-sm)',
          paddingBlock: '0.35rem',
          paddingInline: '0.5rem',
          borderRadius: 'var(--tp-radius-ctl)',
          border: '1px solid var(--tp-rail-border)',
          background: 'transparent',
          color: 'var(--tp-brand-white)',
        }}
      >
        {venues.map((v) => (
          <option key={v.id} value={v.id} style={{ color: 'initial' }}>
            {label(v)}
          </option>
        ))}
      </select>
    </div>
  );
}
