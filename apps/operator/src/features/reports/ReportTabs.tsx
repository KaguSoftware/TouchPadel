/**
 * The switcher between the five reports.
 *
 * Financial carries ONE Reports row for its three reports, so this strip is the
 * only place they are named apart — it has to read as navigation at a
 * glance. The old 2px underline tabs sat under the page title in muted grey
 * and were easy to take for a subtitle. Each report is now a bordered button
 * with its own icon, and the open one is filled in the accent colour.
 *
 * Which reports it offers depends on where the owner is. Inside a Management
 * section it offers only the reports that section owns (lib/workspaces.ts), so
 * a report is reachable from one section and never duplicated in another:
 * Financial gets revenue, courts and cafe; staff activity (Observe) and stock
 * value (Stock) are alone in theirs and get no strip at all. A workspace with
 * no sections (the manager's) offers every report. Either way, reports the
 * role cannot open are left out (rulebook 4.3) — a manager does not see
 * Revenue.
 *
 * Still a `role="tablist"`: arrow keys move between reports, dir-aware, the
 * same contract as ui.tsx's Tabs.
 */
import type { KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth, canAccess } from '../../lib/auth';
import { WORKSPACES, sectionForPath } from '../../lib/workspaces';
import { useWorkspace } from '../../routes/__root';
import { useLocale } from '../../lib/i18n';
import { Icon, type IconName } from '../../components/icons';
import type { ReportName } from './reportTypes';

const REPORT_TABS: readonly { id: ReportName; path: '/reports/revenue' | '/reports/courts' | '/reports/cafe' | '/reports/stock' | '/reports/staff'; icon: IconName }[] = [
  { id: 'revenue', path: '/reports/revenue', icon: 'chart' },
  { id: 'courts', path: '/reports/courts', icon: 'court' },
  { id: 'cafe', path: '/reports/cafe', icon: 'cake' },
  { id: 'stock', path: '/reports/stock', icon: 'package' },
  { id: 'staff', path: '/reports/staff', icon: 'users' },
];

export function ReportTabs({ value }: { value: ReportName }) {
  const { tr, dir } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const { active } = useWorkspace();
  const workspace = WORKSPACES[active];
  const here = REPORT_TABS.find((t) => t.id === value);
  const section = here ? sectionForPath(workspace, here.path) : null;
  const tabs = REPORT_TABS.filter(
    (t) => canAccess(staff?.role, t.path) && (!section || sectionForPath(workspace, t.path)?.key === section.key),
  );

  const open = (id: ReportName) => {
    const target = tabs.find((t) => t.id === id);
    if (target && id !== value) void navigate({ to: target.path });
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.id === value);
    if (index === -1) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (e.key === forward) next = (index + 1) % tabs.length;
    else if (e.key === backward) next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    open(tabs[next]!.id);
  }

  if (tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={tr('ws.reports.title')}
      onKeyDown={onKeyDown}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))',
        gap: 'var(--tp-sp-2)',
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tp-report-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => open(tab.id)}
          >
            <span className="tp-report-tab-icon" aria-hidden="true">
              <Icon name={tab.icon} size={16} />
            </span>
            <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tr(`ws.reports.nav.${tab.id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
