/**
 * Today's pages as groups (owner, 2026-10-01, design option A): Today shows
 * one tile per group, and a tile opens its rows in a sheet (app/staff-group.tsx).
 * Both screens read the rows, their labels and the waiting counts from here,
 * so a tile's count and its sheet's rows never disagree.
 */
import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MenuRow } from '../../components/booking';
import { useTheme } from '../../theme';
import { ListCard } from './protocols/parts';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  BellIcon,
  CalendarIcon,
  CardIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  DeductionIcon,
  EnvelopeIcon,
  GlobeIcon,
  ImageIcon,
  LockIcon,
  PencilIcon,
  PhoneIcon,
  PlusSquareIcon,
  ReceiptIcon,
  RoofIcon,
  SearchIcon,
  SlidersIcon,
  StopwatchIcon,
  SunIcon,
  SwapIcon,
  TableIcon,
  TagIcon,
  WarningIcon,
  type IconProps,
} from '../../components/icons';
import { useStaffStatus } from './StaffStatusProvider';
import { staffKeys } from './keys';
import { todayRows, type StaffRowDef } from './rows';
import { fetchRuns } from './protocols/api';
import { fetchNoteItems } from './notes/api';
import { CALL_ROLES } from './calls/logic';
import { useOpenCallCount } from './calls/useOpenCallCount';
import { reviewsIncidents } from './incidents/logic';
import { useToReviewCount } from './incidents/useToReviewCount';
import { useContentRowCount } from './content/useContentRowCount';

/**
 * The icon of each row; a page lane adds its row's icon with the row. No two
 * rows one role sees share an icon, and none is the Settings sliders.
 */
export const ROW_ICONS: Record<string, ComponentType<IconProps>> = {
  protocols: ClockIcon,
  start: PencilIcon,
  production: StopwatchIcon,
  shopping: TagIcon,
  run: TagIcon,
  purchases: CardIcon,
  marketing: GlobeIcon,
  requests: EnvelopeIcon,
  notes: CalendarIcon,
  ideas: SunIcon,
  teachings: CheckIcon,
  recipes: SearchIcon,
  'recipe-changes': LockIcon,
  stock: RoofIcon,
  suggestions: BellIcon,
  'ask-marketing': GlobeIcon,
  'marketing-inbox': CheckIcon,
  // Wave 5, lane R: a guest's call comes from the phone at the table.
  calls: PhoneIcon,
  // Wave 5, lane P: people records.
  deductions: DeductionIcon,
  incidents: WarningIcon,
  content: ImageIcon,
  // Wave 5, lane S: the two stores.
  'stock-log': PlusSquareIcon,
  'stock-move': SwapIcon,
  'stock-count': ClipboardIcon,
  // Place an order (0251); Phase 2 Milestone 4b: the receipt camera page.
  order: TableIcon,
  receipt: ReceiptIcon,
};

export const rowIcon = (id: string): ComponentType<IconProps> => ROW_ICONS[id] ?? SlidersIcon;

/**
 * Today's pages in short lists rather than one of up to twenty rows: the floor,
 * the protocols and what feeds them, stock and supplies, recipes, the rest of
 * the day's work, and what the person asks of others. A row this table does
 * not name (a page lane's new row) joins the day's work, so it is never lost.
 * Order inside a group is rows.ts's.
 */
export const ROW_GROUPS = [
  // Wave 5, lane R (§2.1.8): a waiter's guest calls come first: the
  // `waiter_call_new` push lands on Today. Placing an order (0251) is floor
  // work too.
  { key: 'floor', titleKey: 'staff.calls.group', icon: TableIcon, ids: ['calls', 'order'] },
  {
    key: 'protocols',
    titleKey: 'staff.shell.today.groups.protocols',
    icon: ClockIcon,
    ids: ['protocols', 'start', 'ideas', 'notes'],
  },
  // Buying, making and counting the stock: the long tail of a head's day.
  {
    key: 'supplies',
    titleKey: 'staff.shell.today.groups.supplies',
    icon: RoofIcon,
    ids: [
      'production',
      'shopping',
      'run',
      'purchases',
      'receipt',
      'stock',
      'stock-log',
      'stock-move',
      'stock-count',
    ],
  },
  {
    key: 'recipes',
    titleKey: 'staff.shell.today.groups.recipes',
    icon: SearchIcon,
    ids: ['recipes', 'recipe-changes', 'teachings'],
  },
  { key: 'daily', titleKey: 'staff.shell.today.groups.daily', icon: CalendarIcon, ids: null },
  // Wave 5, lane P: a deduction is proposed about someone, like a request (§5.3).
  {
    key: 'team',
    titleKey: 'staff.shell.today.groups.team',
    icon: EnvelopeIcon,
    ids: ['requests', 'deductions', 'suggestions', 'ask-marketing'],
  },
] as const satisfies readonly {
  key: string;
  titleKey: MessageKey;
  icon: ComponentType<IconProps>;
  ids: readonly string[] | null;
}[];

export type GroupKey = (typeof ROW_GROUPS)[number]['key'];

export interface TodayGroup {
  key: GroupKey;
  titleKey: MessageKey;
  icon: ComponentType<IconProps>;
  rows: StaffRowDef[];
}

/** The groups that have at least one of `rows`, in ROW_GROUPS order. */
export function groupRows(rows: readonly StaffRowDef[]): TodayGroup[] {
  const named = new Set<string>(ROW_GROUPS.flatMap((g) => (g.ids ? [...g.ids] : [])));
  return ROW_GROUPS.map((g) => ({
    key: g.key,
    titleKey: g.titleKey,
    icon: g.icon,
    rows: rows.filter((r) =>
      g.ids ? (g.ids as readonly string[]).includes(r.id) : !named.has(r.id),
    ),
  })).filter((g) => g.rows.length > 0);
}

/**
 * The person's groups, each row's label (with its waiting count where it has
 * one) and whether a group holds anything waiting on them. Empty for a
 * non-staff status; RequireStaff keeps those off both screens anyway.
 */
export function useTodayGroups(): {
  groups: TodayGroup[];
  label: (row: StaffRowDef) => string;
  waiting: (group: TodayGroup) => boolean;
} {
  const { t, locale } = useLocale();
  const { status, venueId } = useStaffStatus();
  const staffRole = status.kind === 'staff' ? status.staff.role : null;
  // Wave 5, lane R (§2.1.8): the open-call count on the waiter's calls row.
  const openCalls = useOpenCallCount(venueId, staffRole !== null && CALL_ROLES.includes(staffRole));
  // Wave 5, lane P (§5.3): management's reports to review, and the content
  // waiting on the owner or sent back to marketing.
  const toReview = useToReviewCount(venueId, staffRole !== null && reviewsIncidents(staffRole));
  const content = useContentRowCount(venueId, staffRole);
  // Two rows depend on the day, not the role (rows.ts todayRows): Protocols
  // while a run in progress involves the person (management always), and
  // Notes on new items while one is at its feedback stage. The same cache
  // entries as the runs page's "In progress" and the notes page.
  const involvedRuns = useQuery({
    queryKey: staffKeys.runs(venueId ?? '', 'active'),
    queryFn: () => fetchRuns(venueId ?? '', 'active'),
    enabled: !!venueId && staffRole !== null && staffRole !== 'manager' && staffRole !== 'owner',
  });
  const noteItems = useQuery({
    queryKey: staffKeys.notes(venueId ?? ''),
    queryFn: () => fetchNoteItems(venueId ?? ''),
    enabled: !!venueId && staffRole !== null,
  });

  const groups =
    staffRole === null
      ? []
      : groupRows(
          todayRows(staffRole, {
            runs: involvedRuns.data ? involvedRuns.data.total : null,
            notes: noteItems.data ? noteItems.data.length : null,
          }),
        );

  const count = (id: string): number =>
    id === 'calls'
      ? openCalls
      : id === 'incidents'
        ? toReview
        : id === 'content'
          ? content.count
          : 0;

  const label = (row: StaffRowDef): string => {
    const n = count(row.id);
    if (n === 0) return t(row.labelKey);
    const value = { count: formatNumber(n, locale) };
    if (row.id === 'calls') return t('staff.calls.rowCount', value);
    if (row.id === 'incidents') return t('staff.incidents.rowCount', value);
    return t(content.changes ? 'staff.content.rowChanges' : 'staff.content.rowCount', value);
  };

  return { groups, label, waiting: (group) => group.rows.some((r) => count(r.id) > 0) };
}

/**
 * A group's pages as one card of rows: the body of the group sheet on both
 * platforms (app/staff-group.tsx on iOS, the modal on Today on Android).
 */
export function GroupRows({
  group,
  label,
  onOpen,
}: {
  group: TodayGroup;
  label: (row: StaffRowDef) => string;
  onOpen: (row: StaffRowDef) => void;
}) {
  const { colors } = useTheme();
  return (
    <ListCard>
      {group.rows.map((row, i) => {
        const Icon = rowIcon(row.id);
        return (
          <MenuRow
            key={row.id}
            testID={row.testID}
            icon={<Icon size={15} color={colors.gstrong} />}
            label={label(row)}
            onPress={() => onOpen(row)}
            last={i === group.rows.length - 1}
          />
        );
      })}
    </ListCard>
  );
}
