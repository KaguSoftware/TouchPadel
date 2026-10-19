/**
 * The family heading and tabs of a page (management rebuild, 2026-10-17;
 * docs/design/operator-ui/management-rebuild-brief-2026-10-16.md §5).
 *
 * A rail row is one job; when the job has several pages, the row carries them
 * as `tabs` (lib/workspaces.ts) and every one of those pages shows the same
 * heading: the family's name small above (the rail row's words), the page's
 * name as the title (the tab's words), and the tabs under it. Before the
 * rebuild one place could go by three names: the rail said "Staff activity",
 * the page said "Activity monitor", a card said something else. Here the rail
 * row, the eyebrow, the selected tab and the title are the same words by
 * construction.
 *
 * This replaced three strips (the report switcher, the menu and guest-app
 * strip above /admin screens, the stock sub-nav) and two in-page tab sets
 * that kept their page in local state.
 *
 * The shell computes it (useFamilyHeader) and hands it to PageHeader through
 * PageFamilyContext (kit.tsx), so a page never places it and cannot forget
 * it. There is none:
 *   - off a family (a page that stands alone);
 *   - on a page UNDER a tab rather than on it (a promotion's editor under
 *     Promotions), where the row stays lit but tabs would lead away from an
 *     unsaved form;
 *   - when the person may open only one of the family's pages.
 *
 * Tabs are links, one URL each, so Back, reloads and shared links land on the
 * right tab. A `nav` with `aria-current`, not a tablist: each tab is its own
 * page, not a panel of this one. Arrow keys move along the strip (mirrored in
 * Arabic), Home and End jump to its ends.
 */
import { useMemo, type KeyboardEvent } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { useTabOpen } from '../lib/navAccess';
import { useBadgeSum } from '../lib/navBadges';
import { WORKSPACES, activeTab, familyRowForPath, type NavItem, type NavTab, type WorkspaceKey } from '../lib/workspaces';
import type { PageFamily } from './kit';

/** The family heading for the page being shown, or null when it stands alone. */
export function useFamilyHeader(workspaceKey: WorkspaceKey): PageFamily | null {
  const { tr } = useLocale();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as Readonly<Record<string, unknown>>;
  const canOpen = useTabOpen(workspaceKey === 'management');

  const row = familyRowForPath(WORKSPACES[workspaceKey], path, search);
  const current = row?.tabs ? activeTab(row.tabs, path, search) : null;
  // The page being shown always keeps its tab, even when its condition is off
  // (a direct link to the online deposit while payments are paused).
  const tabs = row?.tabs && current ? row.tabs.filter((tab) => tab === current || canOpen(tab)) : [];

  return useMemo(() => {
    if (!row || !current || tabs.length < 2) return null;
    return {
      eyebrow: tr(`ws.shell.nav.${row.labelKey}`),
      title: tr(`ws.shell.nav.${current.labelKey}`),
      tabs: <FamilyTabStrip row={row} tabs={tabs} current={current} />,
    };
    // `tabs` is rebuilt every render; its members are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, current, tabs.map((t) => t.labelKey).join(','), tr]);
}

function FamilyTabStrip({ row, tabs, current }: { row: NavItem; tabs: readonly NavTab[]; current: NavTab }) {
  const { tr, dir } = useLocale();

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>('a'));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (e.key === forward) next = Math.min(index + 1, links.length - 1);
    else if (e.key === backward) next = Math.max(index - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = links.length - 1;
    else return;
    e.preventDefault();
    links[next]?.focus();
  }

  return (
    <nav
      data-no-print
      data-testid="family-tabs"
      aria-label={tr(`ws.shell.nav.${row.labelKey}`)}
      className="tp-family-tabs"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <FamilyTab key={`${tab.to}?${tab.labelKey}`} tab={tab} selected={tab === current} />
      ))}
    </nav>
  );
}

/** Keeps what `keepSearch` names from the current query, then sets the tab's own. */
function tabSearch(tab: NavTab) {
  return (prev: Record<string, unknown>) => {
    const next: Record<string, unknown> = {};
    for (const key of tab.keepSearch ?? []) if (prev[key] !== undefined) next[key] = prev[key];
    return { ...next, ...(tab.search ?? {}) };
  };
}

function FamilyTab({ tab, selected }: { tab: NavTab; selected: boolean }) {
  const { tr, locale } = useLocale();
  const count = useBadgeSum(tab.badge ? [tab.badge] : []);
  return (
    <Link
      to={tab.to as never}
      search={tabSearch(tab) as never}
      className="tp-family-tab"
      aria-current={selected ? 'page' : undefined}
      data-testid={`family-tab-${tab.labelKey}`}
    >
      {tr(`ws.shell.nav.${tab.labelKey}`)}
      {count > 0 && (
        <>
          <span className="tp-family-tab-count" aria-hidden="true">
            {formatNumber(count, locale)}
          </span>
          <span className="tp-sr-only">{tr('ws.shell.nav.badge', { count: formatNumber(count, locale) })}</span>
        </>
      )}
    </Link>
  );
}
