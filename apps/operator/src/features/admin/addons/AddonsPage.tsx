/**
 * /admin/addons — left: two lists (Item groups = linked to ≥ 1 item;
 * Sub-groups = zero links, reveal-only); right: GroupEditor + OptionsEditor
 * (with per-option Reveals) for the selected group.
 */
import { useState } from 'react';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../../components/ui';
import { partitionGroups } from './addonsLogic';
import { GroupEditor } from './GroupEditor';
import { OptionsEditor } from './OptionsEditor';
import { useAddons, type GroupRow } from './useAddons';

type Selection = { kind: 'group'; id: string } | { kind: 'new'; sub: boolean } | null;

export function AddonsPage() {
  const { tr, locale } = useLocale();
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

  function GroupList({ title, hint, groups, emptyAction }: { title: string; hint?: string; groups: GroupRow[]; emptyAction: React.ReactNode }) {
    return (
      <section style={{ marginBlockEnd: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {emptyAction}
        </div>
        {hint && <p style={{ margin: 0, marginBlockStart: '0.2rem', fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>{hint}</p>}
        {groups.length === 0 && (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>{tr('op.common.none')}</p>
        )}
        {groups.map((g) => {
          const active = selection?.kind === 'group' && selection.id === g.id;
          return (
            <Button
              key={g.id}
              kind={active ? 'primary' : 'default'}
              style={{ display: 'flex', inlineSize: '100%', justifyContent: 'space-between', gap: '0.5rem', textAlign: 'start', marginBlockStart: '0.3rem' }}
              onClick={() => setSelection({ kind: 'group', id: g.id })}
            >
              <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickName(locale, g)}</span>
              <span dir="ltr" style={{ fontSize: '0.75rem', opacity: 0.8, whiteSpace: 'nowrap' }}>
                {g.min_select}–{g.max_select} · {optionCount(g)} · {linkCount(g)}
              </span>
            </Button>
          );
        })}
      </section>
    );
  }

  return (
    <div>
      <h2 style={{ marginBlockStart: 0 }}>{tr('op.adminNav.addons')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(16rem, 20rem) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div>
          <GroupList
            title={tr('op.addons.groups')}
            groups={itemGroups}
            emptyAction={
              <Button onClick={() => setSelection({ kind: 'new', sub: false })}>{tr('op.addons.newGroup')}</Button>
            }
          />
          <GroupList
            title={tr('op.addons.subGroups')}
            hint={tr('op.addons.subGroupsHint')}
            groups={subGroups}
            emptyAction={
              <Button onClick={() => setSelection({ kind: 'new', sub: true })}>{tr('op.addons.newSubGroup')}</Button>
            }
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
