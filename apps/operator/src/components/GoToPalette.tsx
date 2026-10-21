/**
 * Go to (management rebuild, 2026-10-17; brief §5 "Everywhere: Go to"): one
 * search over every page, family tab and setting the signed-in person may
 * open in this workspace. Before the rebuild owners could not find a page
 * they knew existed ("where are the deposit rules?"); a name typed here opens
 * it, in English or Arabic, whichever language the station is in.
 *
 * Opened from the rail's "Go to…" row and with Ctrl+G (⌘G on a Mac). Not
 * Ctrl+K: that is the assistant's (features/assistant/AssistantDrawer.tsx).
 * G is the Go To key of Office and VS Code. Offered on Management and
 * Operations only: the till and the desk keep their own keys.
 *
 * The entries are the rail itself (lib/workspaces.ts), so a page is findable
 * the moment it has a row or a tab, and a page the person cannot open is never
 * offered. With nothing typed the list is the whole workspace, in rail order:
 * a map of where everything is.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { makeT, type MessageKey } from '@touch/i18n';
import { useAuth, canAccess } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { useTabOpen } from '../lib/navAccess';
import { WORKSPACES, rowShown, type NavItem, type NavLabelKey, type NavTab, type SectionKey, type WorkspaceKey } from '../lib/workspaces';
import { Modal } from './ui';
import { Icon } from './icons';
import { navButtonStyle, railLabelStyle } from './railStyles';

/**
 * Extra words people use for a page, beside its name (both languages are always
 * searched). A page renamed by the page map (2026-10-17) keeps its old name
 * here, so "day close" still finds End of day count.
 */
const KEYWORDS: Partial<Record<NavLabelKey, readonly string[]>> = {
  panel: ['home', 'management panel', 'dashboard', 'لوحة الإدارة'],
  analytics: ['analytics', 'charts', 'growth', 'التحليلات'],
  assistant: ['assistant', 'ai', 'المساعد'],
  dayClose: ['day close', 'close the day', 'reconcile', 'end of day', 'إغلاق اليوم', 'مطابقة'],
  safe: ['safe', 'main cash', 'القاصة', 'الصندوق الرئيسي'],
  billsSuppliers: ['supplier', 'pay a supplier', 'bill', 'rent', 'repair', 'cost', 'expense', 'مورد', 'إيجار', 'مصاريف', 'تكاليف'],
  cashDrawer: ['drawer', 'till', 'shift', 'درج', 'وردية'],
  wages: ['salary', 'payroll', 'advance', 'pay day', 'راتب', 'سلفة'],
  attendance: ['late', 'early', 'lateness', 'تأخير', 'انصراف'],
  rewards: ['rewards', 'bonus', 'prize', 'مكافأة', 'جائزة'],
  deductions: ['penalty', 'fine', 'غرامة', 'عقوبة'],
  rates: ['court price', 'peak', 'hourly', 'rate', 'سعر الملعب', 'ذروة'],
  genderHours: ['women only', 'men only', 'ladies', 'gender', 'للسيدات', 'للرجال', 'نساء'],
  menuItems: ['price', 'item', 'drink', 'food', 'سعر', 'صنف', 'مشروب'],
  categories: ['categories', 'الفئات'],
  addons: ['add-ons', 'addons', 'modifiers', 'extra'],
  suggested: ['suggested items', 'upsell', 'الأصناف المقترحة'],
  revenue: ['revenue', 'income', 'sales', 'money', 'الإيرادات', 'دخل', 'مبيعات'],
  courtSales: ['court report', 'bookings income', 'تقرير الملاعب'],
  cafeSales: ['cafe', 'cafe report', 'coffee sales', 'تقرير الكافيه'],
  whoIsOn: ['who is on', 'online', 'last seen', 'monitor', 'activity', 'آخر ظهور', 'متصل', 'نشاط'],
  whatTheyDid: ['activity', 'voids', 'discounts', 'authorised', 'نشاط', 'إلغاء', 'خصم'],
  requests: ['leave', 'swap', 'advance', 'correction', 'إجازة', 'تبديل', 'سلفة'],
  incidents: ['incident', 'accident', 'الحوادث'],
  suggestions: ['suggestions', 'ideas', 'الاقتراحات'],
  protocols: ['protocol', 'protocols', 'checklist', 'البروتوكولات'],
  tills: ['tills', 'tabs', 'bills', 'الصناديق'],
  telegram: ['bot', 'group', 'messages', 'بوت', 'مجموعة', 'رسائل'],
  campaigns: ['marketing', 'campaign', 'posts', 'تسويق', 'حملة', 'منشورات'],
  promotions: ['promotion', 'promotions', 'discount', 'offer', 'happy hour', 'العروض', 'خصم'],
  audit: ['audit log', 'log', 'history', 'who changed', 'سجل التدقيق', 'من غيّر'],
  onHand: ['on hand', 'stock', 'inventory', 'المتوفر', 'مخزون', 'جرد'],
  alerts: ['alerts', 'low', 'out of stock', 'warning', 'التنبيهات', 'نفد', 'تنبيه'],
  expiry: ['expiry', 'expire', 'out of date', 'الصلاحية'],
  goodsIn: ['goods in', 'delivery', 'receive', 'receipt', 'supplier', 'استلام البضائع', 'توريد', 'استلام', 'فاتورة'],
  wasteProduction: ['waste', 'spoiled', 'production', 'هدر', 'تالف', 'تحضير'],
  stockCount: ['count', 'stocktake', 'جرد'],
  countDifferences: ['count differences', 'variance', 'difference', 'فروقات الجرد', 'فرق'],
  margins: ['margins', 'profit', 'cost', 'الهوامش', 'ربح', 'تكلفة'],
  stockValue: ['worth', 'value', 'قيمة'],
  staff: ['employee', 'account', 'pin', 'access', 'role', 'موظف', 'حساب', 'رقم سري', 'صلاحية'],
  lessonTypes: ['lesson types', 'lesson price', 'أنواع الحصص'],
  lessonRules: ['coach share', 'lesson payment', 'حصة المدرب', 'دفع الحصص'],
  coachHours: ['schedule', 'time off', 'جدول', 'إجازة'],
  bookingRules: ['cancellation', 'cancel', 'hold', 'how far ahead', 'إلغاء', 'حجز مسبق'],
  onlineDeposit: ['deposit', 'qi card', 'online payment', 'عربون', 'كي كارد', 'دفع إلكتروني'],
  openMatches: ['match', 'ticket', 'مباراة', 'تذكرة'],
  tournamentRules: ['tournament', 'tournaments', 'entry fee', 'البطولات'],
  branches: ['branch', 'location', 'club', 'open branch', 'فرع', 'فروع', 'النادي'],
  venueDetails: ['venue','details', 'name', 'phone', 'tax', 'currency', 'timezone', 'البيانات', 'اسم', 'هاتف', 'ضريبة', 'عملة'],
  openingHours: ['hours', 'closed days', 'holiday', 'open', 'ساعات', 'عطلة', 'أيام الإغلاق'],
  businessDay: ['business day', 'midnight', 'waiter call', 'يوم العمل', 'منتصف الليل', 'نداء النادل'],
  analyticsSettings: ['analytics', 'exclude', 'leave out', 'استبعاد'],
  guestApp: ['guest site', 'home screen', 'hero', 'website', 'ticker', 'موقع الضيوف', 'الشاشة الرئيسية', 'موقع'],
  tables: ['qr', 'table card', 'tables', 'رمز', 'طاولة'],
  devices: ['devices', 'version', 'heartbeat', 'reporting', 'الأجهزة', 'إصدار'],
  stations: ['stations', 'register', 'till', 'المحطات', 'تسجيل', 'صندوق'],
  kitchenScreens: ['kds', 'pair', 'pairing', 'kitchen', 'ربط', 'المطبخ'],
  offlineMode: ['offline', 'internet', 'connection', 'وضع عدم الاتصال', 'انترنت', 'اتصال'],
  loyalty: ['loyalty', 'points', 'tiers', 'الولاء', 'نقاط', 'مستويات'],
  courts: ['court', 'ملعب'],
  coaches: ['coach', 'lesson', 'مدرب', 'حصة'],
};

export interface GoToEntry {
  id: string;
  /** The page's name in the station's language. */
  label: string;
  /** Where it lives: "Financial › Cash". */
  trail: string;
  to: string;
  search?: Readonly<Record<string, string>>;
  /** Everything a person might type for it, normalised, both languages. */
  haystack: string;
}

/** Lower case, no Arabic diacritics or tatweel, one spelling per letter family, single spaces. */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[’'`&›»«“”".,()/\-…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Translate = (key: MessageKey) => string;

/**
 * Every place in the workspace the person may open, in rail order: the
 * workspace's own rows, then each section's rows, a family as one entry per
 * tab. A path reached twice (the manager's Stock row and the Stock section's
 * On hand tab) is one entry that answers to both names.
 */
export function buildGoToEntries(
  workspaceKey: WorkspaceKey,
  tr: Translate,
  translations: readonly Translate[],
  canOpenRow: (row: NavItem) => boolean,
  canOpenTab: (tab: NavTab) => boolean,
  /** Only this section's pages (Setup's "Find a setting"). */
  onlySection?: SectionKey,
): GoToEntry[] {
  const ws = WORKSPACES[workspaceKey];
  const out: GoToEntry[] = [];
  const byTarget = new Map<string, GoToEntry>();
  const navKey = (k: NavLabelKey) => `ws.shell.nav.${k}` as MessageKey;
  const words = (keys: readonly MessageKey[], extra: readonly string[]) =>
    normalizeQuery([...translations.flatMap((t) => keys.map((k) => t(k))), ...extra].join(' '));

  function add(to: string, search: Readonly<Record<string, string>> | undefined, labelKey: NavLabelKey, trailKeys: readonly MessageKey[]) {
    const id = `${to}?${new URLSearchParams(search ?? {}).toString()}`;
    const haystack = words([navKey(labelKey), ...trailKeys], KEYWORDS[labelKey] ?? []);
    const seen = byTarget.get(id);
    if (seen) {
      seen.haystack = `${seen.haystack} ${haystack}`;
      return;
    }
    const entry: GoToEntry = {
      id,
      label: tr(navKey(labelKey)),
      trail: trailKeys.map((k) => tr(k)).join(' › '),
      to,
      ...(search ? { search } : {}),
      haystack,
    };
    byTarget.set(id, entry);
    out.push(entry);
  }

  function addRow(row: NavItem, trail: readonly MessageKey[]) {
    if (row.hidden) return;
    if (row.tabs?.length) {
      for (const tab of row.tabs) if (canOpenTab(tab)) add(tab.to, tab.search, tab.labelKey, [...trail, navKey(row.labelKey)]);
    } else if (canOpenRow(row)) {
      add(row.to, undefined, row.labelKey, trail);
    }
  }

  const workspaceName = `ws.shell.workspace.${workspaceKey}` as MessageKey;
  if (!onlySection) for (const group of ws.groups) for (const row of group.items) addRow(row, [workspaceName]);
  for (const section of ws.sections ?? []) {
    if (onlySection && section.key !== onlySection) continue;
    const sectionName = `ws.shell.section.${section.key}` as MessageKey;
    for (const row of section.items) addRow(row, [sectionName]);
  }
  return out;
}

/**
 * The entries that match, best first. Every typed word must appear somewhere
 * (name, place, other words for it); a name that starts with the query beats
 * one that contains it, which beats a match on the place or another word.
 */
export function rankEntries(entries: readonly GoToEntry[], query: string): GoToEntry[] {
  const q = normalizeQuery(query);
  if (!q) return [...entries];
  const terms = q.split(' ');
  const scored: { entry: GoToEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    if (!terms.every((term) => entry.haystack.includes(term))) return;
    const label = normalizeQuery(entry.label);
    const score = label.startsWith(q) ? 3 : label.split(' ').some((w) => w.startsWith(terms[0]!)) ? 2 : label.includes(q) ? 1 : 0;
    scored.push({ entry, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.entry);
}

/** Ctrl+G (⌘G) opens Go to, where `enabled`. */
export function useGoToShortcut(enabled: boolean, onOpen: () => void): void {
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        open.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Both catalogs, so a name is found in either language whichever the station shows. */
export const T_EN = makeT('en') as (k: MessageKey) => string;
export const T_AR = makeT('ar') as (k: MessageKey) => string;

export function GoToPalette({ workspaceKey, onClose }: { workspaceKey: WorkspaceKey; onClose: () => void }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const canOpenTab = useTabOpen(true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);

  const entries = useMemo(
    () =>
      buildGoToEntries(
        workspaceKey,
        (k) => tr(k),
        [T_EN, T_AR],
        (row) => rowShown(row, (p) => canAccess(staff, p), canOpenTab),
        canOpenTab,
      ),
    [workspaceKey, tr, staff, canOpenTab],
  );
  const results = useMemo(() => rankEntries(entries, query), [entries, query]);
  const current = results[Math.min(active, results.length - 1)];

  // The highlighted row stays in view as the arrows move it.
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector(`[data-entry="${CSS.escape(current.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(entry: GoToEntry | undefined) {
    if (!entry) return;
    onClose();
    void navigate({ to: entry.to as never, search: (entry.search ?? {}) as never });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (Math.min(i, results.length - 1) + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(current);
    } else if (e.key === 'Escape' && query) {
      // First Esc clears what was typed; the next one closes.
      e.stopPropagation();
      setQuery('');
      setActive(0);
    }
  }

  return (
    <Modal title={tr('ws.shell.goTo.title')} onClose={onClose}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Icon name="search" size={18} style={{ position: 'absolute', insetInlineStart: '0.75rem', color: 'var(--tp-muted-fg)', pointerEvents: 'none' }} />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? `${listId}-${results.indexOf(current)}` : undefined}
            aria-label={tr('ws.shell.goTo.placeholder')}
            placeholder={tr('ws.shell.goTo.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            data-testid="goto.input"
            className="tp-goto-input"
          />
        </span>
        {results.length === 0 ? (
          <p role="status" style={{ color: 'var(--tp-muted-fg)', paddingBlock: 'var(--tp-sp-3)' }}>
            {tr('ws.shell.goTo.none', { query: query.trim() })}
          </p>
        ) : (
          <ul id={listId} ref={listRef} role="listbox" aria-label={tr('ws.shell.goTo.results')} className="tp-goto-list">
            {results.map((entry, i) => (
              <li
                key={entry.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={entry === current}
                data-entry={entry.id}
                className="tp-goto-option"
                onMouseMove={() => setActive(i)}
                onClick={() => go(entry)}
              >
                <span style={{ fontWeight: 600 }}>{entry.label}</span>
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{entry.trail}</span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.shell.goTo.hint')}</p>
      </div>
    </Modal>
  );
}

/** The rail's "Go to…" row, with its key beside it. */
export function GoToRailButton({ onOpen }: { onOpen: () => void }) {
  const { tr } = useLocale();
  return (
    <button
      type="button"
      className="tp-nav-item tp-goto-rail"
      style={navButtonStyle}
      onClick={onOpen}
      aria-keyshortcuts="Control+G"
      data-testid="rail.goTo"
    >
      <Icon name="search" size={17} />
      <span style={{ ...railLabelStyle, textAlign: 'start' }}>
        {tr('ws.shell.goTo.open')}
      </span>
      <kbd className="tp-goto-kbd" dir="ltr">
        {tr('ws.shell.goTo.shortcut')}
      </kbd>
    </button>
  );
}
