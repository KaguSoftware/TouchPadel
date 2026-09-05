/**
 * /admin/addons — left: two lists (Item groups = linked to ≥ 1 item;
 * Sub-groups = zero links, reveal-only); right: GroupEditor + OptionsEditor
 * (with per-option Reveals) for the selected group.
 */
import { useState } from 'react';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../../components/ui';
import { EmptyState, PageHeader, ResultCount } from '../../../components/kit';
import { partitionGroups } from './addonsLogic';
import { GroupEditor } from './GroupEditor';
import { OptionsEditor } from './OptionsEditor';
import { useAddons, type GroupRow } from './useAddons';

type Selection = { kind: 'group'; id: string } | { kind: 'new'; sub: boolean } | null;

export function AddonsPage() {
  const { tr } = useLocale();
  const addons = useAddons();
  const [selection, setSelection] = useState<Selection>(null);

  if (addons.isPending) return <Skeleton lines={6} />;
  if (addons.error) return <ErrorText error={addons.error} />;
  const data = addons.data;

  const byName = (a: GroupRow, b: GroupRow) => a.name_en.localeCompare(b.name_en);
  const { itemGroups, subGroups } = partitionGroups(data.groups, data.links);
  itemGroups.sort(byName);
  subGroups.sort(byName);

  const selectedGroup =
    selection?.kind === 'group' ? data.groups.find((g) => g.id === selection.id) ?? null : null;
  const linkCount = (g: GroupRow) => new Set(data.links.filter((l) => l.group_id === g.id).map((l) => l.item_id)).size;
  const optionCount = (g: GroupRow) => data.modifiers.filter((m) => m.group_id === g.id).length;

  return (
    <div>
      <PageHeader title={tr('op.adminNav.addons')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(16rem, 20rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
        <div>
          <GroupList
            title={tr('op.addons.groups')}
            groups={itemGroups}
            selectedId={selection?.kind === 'group' ? selection.id : null}
            onSelect={(id) => setSelection({ kind: 'group', id })}
            optionCount={optionCount}
            linkCount={linkCount}
            action={<Button icon="plus" onClick={() => setSelection({ kind: 'new', sub: false })}>{tr('op.addons.newGroup')}</Button>}
          />
          <GroupList
            title={tr('op.addons.subGroups')}
            hint={tr('op.addons.subGroupsHint')}
            groups={subGroups}
            selectedId={selection?.kind === 'group' ? selection.id : null}
            onSelect={(id) => setSelection({ kind: 'group', id })}
            optionCount={optionCount}
            linkCount={linkCount}
            action={<Button icon="plus" onClick={() => setSelection({ kind: 'new', sub: true })}>{tr('op.addons.newSubGroup')}</Button>}
          />
        </div>
        <div style={{ minInlineSize: 0 }}>
          {selection?.kind === 'new' && (
            <GroupEditor
              key="new"
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
              <GroupEditor
                key={selectedGroup.id}
                group={selectedGroup}
                links={data.links}
                items={data.items}
                onSaved={() => undefined}
              />
              <OptionsEditor group={selectedGroup} data={data} />
            </>
          )}
        </div>
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
  optionCount,
  linkCount,
  action,
}: {
  title: string;
  hint?: string;
  groups: GroupRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  optionCount: (g: GroupRow) => number;
  linkCount: (g: GroupRow) => number;
  action: React.ReactNode;
}) {
  const { tr, locale } = useLocale();
  return (
    <section style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)' }}>{title}</h3>
        {action}
      </div>
      {hint && <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{hint}</p>}
      <ResultCount shown={groups.length} total={groups.length} style={{ display: 'block', marginBlockStart: 'var(--tp-sp-1)' }} />
      {groups.length === 0 ? (
        // "None" in muted body text was indistinguishable from a value; the
        // empty state teaches the action beside it instead (rulebook 9.2).
        <EmptyState compact titleAs="h4" kind="initial" icon="plus" title={tr('op.common.none')} style={{ marginBlockStart: 'var(--tp-sp-2)' }} />
      ) : (
        groups.map((g) => (
          <Button
            key={g.id}
            kind={selectedId === g.id ? 'primary' : 'default'}
            style={{ display: 'flex', inlineSize: '100%', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', textAlign: 'start', marginBlockStart: 'var(--tp-sp-1)' }}
            onClick={() => onSelect(g.id)}
          >
            <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickName(locale, g)}</span>
            <span dir="ltr" style={{ fontSize: 'var(--tp-fs-xs)', opacity: 0.8, whiteSpace: 'nowrap' }}>
              {g.min_select}–{g.max_select} · {optionCount(g)} · {linkCount(g)}
            </span>
          </Button>
        ))
      )}
    </section>
  );
}
