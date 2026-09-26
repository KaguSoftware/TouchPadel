/**
 * "On your phone": a read-only copy of the pages each role works on the staff
 * phone (build-contracts-2026-09-23 §5.4, #11). Checklists, shopping, the
 * driver's purchases, marketing's take and drafts, requests, item notes, and
 * the role spec's pages (teachings, stock, recipes, recipe changes, ideas,
 * suggestions, requests to marketing and results) read here exactly as the
 * phone reads them, from the same RPCs, and nothing here writes: a list is
 * ticked, an answer given, a teaching or a suggestion written on the phone.
 *
 * One section shows at a time, so a role with nine of them makes one read,
 * not nine; checklists come first for everyone. A long copy (every recipe, the
 * whole stock list) shows its first rows until asked for the rest.
 */
import { useMemo, useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { EmptyState, Panel, StatusBadge } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { useStockFormat } from '../stock/stockUi';
import { RK } from '../roleExtras/keys';
import { phoneRead, phoneRows, phoneSectionKeys, phoneSectionsFor, type PhoneSection } from './tasksLogic';

/** Rows a copy shows before "Show all". */
const FIRST_ROWS = 25;

export function PhoneCopies() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const sections = useMemo(() => phoneSectionsFor(staff?.role), [staff?.role]);
  const [picked, setPicked] = useState<PhoneSection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const section = picked && sections.includes(picked) ? picked : (sections[0] ?? null);
  const read = section ? phoneRead(section, staff?.role) : null;
  const fmt = useStockFormat();

  const q = useQuery({
    queryKey: RK.phone(`${section ?? 'none'}:${staff?.role ?? ''}`),
    queryFn: () => appRpc<unknown>(read!.fn, read!.args),
    enabled: read !== null,
    refetchInterval: 60_000,
  });
  const rows = useMemo(
    () => (section && q.data !== undefined ? phoneRows(section, q.data, { tr, locale, qty: (n, u) => (u ? fmt.qty(n, u) : fmt.num(n)) }) : []),
    // fmt is rebuilt every render but reads only the locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, q.data, tr, locale],
  );

  if (!section) return null;

  return (
    <Panel
      title={<CardTitle icon="phone">{tr('ws.rolePages.phone.title')}</CardTitle>}
      actions={<StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.rolePages.phone.readOnly')} />}
      data-testid="phone-copies"
    >
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.rolePages.phone.lead')}</p>
      {/* A role has up to ten copies. As a row of pills they wrapped into a
          wall; as one column beside the copy they scan top to bottom and the
          chosen one stays in view next to what it shows. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-4)', alignItems: 'flex-start' }}>
        <div role="group" aria-label={tr('ws.rolePages.phone.title')} style={{ flex: '0 1 13rem', minInlineSize: '11rem', display: 'grid', gap: 'var(--tp-sp-0)' }}>
          {sections.map((s) => (
            <Button
              key={s}
              kind="ghost"
              aria-pressed={s === section}
              onClick={() => {
                setPicked(s);
                setExpanded(false);
              }}
              data-testid={`phone.${s}`}
              style={{ justifyContent: 'flex-start', textAlign: 'start', inlineSize: '100%', fontSize: 'var(--tp-fs-sm)' }}
            >
              {tr(phoneSectionKeys(s).tab)}
            </Button>
          ))}
        </div>
        <div aria-live="polite" style={{ flex: '1 1 24rem', minInlineSize: 0 }}>
          {q.isError ? (
            <ErrorText error={q.error} />
          ) : q.isPending ? (
            <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
          ) : rows.length === 0 ? (
            <EmptyState compact kind="nothingToDo" titleAs="h3" title={tr(phoneSectionKeys(section).empty)} />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              {(expanded ? rows : rows.slice(0, FIRST_ROWS)).map((r, i) => (
                <li
                  key={r.id || i}
                  style={{
                    display: 'grid',
                    gap: 'var(--tp-sp-0)',
                    paddingBlock: 'var(--tp-sp-2)',
                    paddingInline: 'var(--tp-sp-2)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                  }}
                >
                  <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <bdi style={{ fontWeight: 600 }}>{r.title}</bdi>
                    {r.detail && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{r.detail}</span>}
                    {r.status && (
                      <span style={{ marginInlineStart: 'auto' }}>
                        <StatusBadge size="sm" tone={r.status.tone} label={r.status.label} />
                      </span>
                    )}
                  </span>
                  {r.body && (
                    <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--tp-fs-sm)' }}>
                      {r.body}
                    </p>
                  )}
                  {r.lines && r.lines.length > 0 && (
                    <ul style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                      {r.lines.map((l, j) => (
                        <li key={j}>
                          <bdi>{l}</bdi>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!expanded && rows.length > FIRST_ROWS && (
            <div style={{ marginBlockStart: 'var(--tp-sp-2)' }}>
              <Button size="sm" kind="ghost" icon="chevronDown" onClick={() => setExpanded(true)} data-testid="phone.show-all">
                {tr('ws.rolePages.phone.showAll', { count: formatNumber(rows.length, locale) })}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
