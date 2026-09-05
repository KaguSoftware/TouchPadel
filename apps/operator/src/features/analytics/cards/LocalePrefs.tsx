/**
 * What each language audience does: how many sessions, how long they stay and
 * which items they gravitate to. Two audiences with different favourites is a
 * reason to feature a different item per language, not to translate harder.
 */
import { useLocale } from '../../../lib/i18n';
import type { RawAnalytics } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';
import { StatusBadge } from '../../../components/kit';

export function LocalePrefs({ raw, state, f }: { raw: RawAnalytics | null; state: CardState; f: Formatters }) {
  const { tr } = useLocale();
  const rows = raw?.posthog?.localePreferences ?? [];
  const label = (code: string) => (code === 'ar' ? tr('settings.arabic') : code === 'en' ? tr('settings.english') : code);

  return (
    <CardShell
      title={tr('analytics.cards.locale')}
      state={state === 'ready' && rows.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.engagement"
    >
      <div style={{ display: 'grid', gap: '0.55rem' }}>
        {rows.map((row) => (
          <div key={row.locale}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
              <StatusBadge size="sm" tone="accent" dot={false} label={label(row.locale)} />
              <span style={muted}>
                {f.num(row.sessions)} {tr('analytics.cards.sessions').toLowerCase()} · {f.duration(row.medianSeconds)}
              </span>
            </div>
            <ul style={{ margin: '0.2rem 0 0', paddingInlineStart: '1.1rem', fontSize: 'var(--tp-fs-sm)' }}>
              {row.topItems.slice(0, 3).map((item) => (
                <li key={item.id}>
                  {item.name || item.id} <span style={muted}>{f.pct(Math.round(item.rate * 100))}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CardShell>
  );
}
