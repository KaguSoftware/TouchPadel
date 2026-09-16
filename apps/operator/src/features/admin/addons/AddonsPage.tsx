/**
 * /admin/addons — left: two lists (Item groups = linked to ≥ 1 item;
 * Sub-groups = zero links, reveal-only); right: GroupEditor + OptionsEditor
 * (with per-option Reveals) for the selected group, or a prompt to pick one.
 *
 * Each group row says what it is in words — its rule, how many options, and
 * how many items offer it (or, for a sub-group, which options ask for it).
 * It printed "0–2 · 1 · 5", which only the person who wrote it could read.
 */
import { useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button } from '../../../components/ui';
import { AsyncStateWrapper, EmptyState, PageHeader, Panel, asyncStatus } from '../../../components/kit';
import { ChevronForward } from '../../../components/icons';
import { partitionGroups, revealersOf } from './addonsLogic';
import { useChoiceRuleText } from './ChoiceLimits';
import { GroupEditor } from './GroupEditor';
import { OptionsEditor } from './OptionsEditor';
import { useAddons, type AddonsData, type GroupRow } from './useAddons';

type Selection = { kind: 'group'; id: string } | { kind: 'new'; sub: boolean } | null;

export function AddonsPage() {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const addons = useAddons();
  const [selection, setSelection] = useState<Selection>(null);
  const status = asyncStatus(addons, () => false);
  const data = addons.data;

  return (
    <div>
      <PageHeader title={tr('op.adminNav.addons')} subtitle={tr('op.addons.lead')} />
      <AsyncStateWrapper status={status} error={addons.error} onRetry={() => void addons.refetch()}>
        {data && <AddonsBody data={data} selection={selection} setSelection={setSelection} canEdit={can.editMenu} tr={tr} locale={locale} />}
      </AsyncStateWrapper>
    </div>
  );
}

function AddonsBody({
  data,
  selection,
  setSelection,
  canEdit,
  tr,
  locale,
}: {
  data: AddonsData;
  selection: Selection;
  setSelection: (s: Selection) => void;
  canEdit: boolean;
  tr: ReturnType<typeof useLocale>['tr'];
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  const byName = (a: GroupRow, b: GroupRow) => pickName(locale, a).localeCompare(pickName(locale, b));
  const { itemGroups, subGroups } = partitionGroups(data.groups, data.links);
  itemGroups.sort(byName);
  subGroups.sort(byName);

  const selectedGroup = selection?.kind === 'group' ? (data.groups.find((g) => g.id === selection.id) ?? null) : null;
  const n = (v: number) => formatNumber(v, locale);
  const optionCount = (g: GroupRow) => data.modifiers.filter((m) => m.group_id === g.id).length;
  const linkCount = (g: GroupRow) => new Set(data.links.filter((l) => l.group_id === g.id).map((l) => l.item_id)).size;
  const itemMeta = (g: GroupRow) => tr('op.addons.meta', { options: n(optionCount(g)), items: n(linkCount(g)) });
  const subMeta = (g: GroupRow) => {
    const askers = revealersOf(g.id, data.reveals, data.modifiers).map((m) => pickName(locale, m));
    return askers.length === 0
      ? tr('op.addons.subMetaNone', { options: n(optionCount(g)) })
      : tr('op.addons.subMeta', { options: n(optionCount(g)), names: askers.join(locale === 'ar' ? '، ' : ', ') });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(16rem, 22rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', maxBlockSize: 'calc(100vh - 13rem)', overflowY: 'auto', paddingInlineEnd: 'var(--tp-sp-1)' }}>
        <GroupList
          title={tr('op.addons.groups')}
          groups={itemGroups}
          selectedId={selection?.kind === 'group' ? selection.id : null}
          onSelect={(id) => setSelection({ kind: 'group', id })}
          meta={itemMeta}
          action={
            <Button size="sm" icon="plus" disabled={!canEdit} onClick={() => setSelection({ kind: 'new', sub: false })}>
              {tr('op.addons.newGroup')}
            </Button>
          }
        />
        <GroupList
          title={tr('op.addons.subGroups')}
          hint={tr('op.addons.subGroupsHint')}
          groups={subGroups}
          selectedId={selection?.kind === 'group' ? selection.id : null}
          onSelect={(id) => setSelection({ kind: 'group', id })}
          meta={subMeta}
          action={
            <Button size="sm" icon="plus" disabled={!canEdit} onClick={() => setSelection({ kind: 'new', sub: true })}>
              {tr('op.addons.newSubGroup')}
            </Button>
          }
        />
      </div>
      <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {selection?.kind === 'new' && (
          <GroupEditor
            key={selection.sub ? 'new-sub' : 'new'}
            group={null}
            links={data.links}
            items={data.items}
            subGroup={selection.sub}
            onSaved={(id) => setSelection({ kind: 'group', id })}
            onCancel={() => setSelection(null)}
          />
        )}
        {selectedGroup && (
          <>
            <GroupEditor key={selectedGroup.id} group={selectedGroup} links={data.links} items={data.items} onSaved={() => undefined} />
            <OptionsEditor group={selectedGroup} data={data} />
          </>
        )}
        {!selection && <EmptyState icon="note" title={tr('op.addons.pick')} />}
      </div>
    </div>
  );
}

/**
 * Declared at module scope on purpose. It used to be a closure inside
 * AddonsPage, so React saw a NEW component type on every render and threw the
 * whole list away and rebuilt it — losing focus mid-keyboard-navigation. Every
 * value it needs arrives as a prop.
 */
function GroupList({
  title,
  hint,
  groups,
  selectedId,
  onSelect,
  meta,
  action,
}: {
  title: string;
  hint?: string;
  groups: GroupRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  meta: (g: GroupRow) => string;
  action: React.ReactNode;
}) {
  const { tr, locale } = useLocale();
  const ruleText = useChoiceRuleText();
  return (
    <Panel title={title} actions={action} padded={false}>
      {hint && (
        <p style={{ paddingBlockStart: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{hint}</p>
      )}
      {groups.length === 0 ? (
        // "None" in muted body text was indistinguishable from a value; the
        // empty state teaches the action beside it instead (rulebook 9.2).
        <div style={{ padding: 'var(--tp-sp-2)' }}>
          <EmptyState compact titleAs="h4" kind="initial" icon="plus" title={tr('op.common.none')} />
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--tp-sp-1-5)', display: 'grid', gap: 'var(--tp-sp-0)' }}>
          {groups.map((g) => {
            const selected = selectedId === g.id;
            return (
              <li key={g.id} className="tp-row" data-clickable="true" data-selected={selected ? 'true' : undefined} style={{ borderRadius: 'var(--tp-radius-ctl)' }}>
                <button
                  type="button"
                  aria-current={selected || undefined}
                  onClick={() => onSelect(g.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-2)',
                    inlineSize: '100%',
                    textAlign: 'start',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    font: 'inherit',
                    cursor: 'pointer',
                    paddingBlock: 'var(--tp-sp-1-5)',
                    paddingInline: 'var(--tp-sp-2)',
                  }}
                >
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, flex: 1 }}>
                    <bdi style={{ fontWeight: selected ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickName(locale, g)}</bdi>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{ruleText(g.min_select, g.max_select)}</span>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                      <bdi>{meta(g)}</bdi>
                    </span>
                  </span>
                  <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
