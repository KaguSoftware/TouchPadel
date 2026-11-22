/**
 * /admin/addons — left: two lists (Item groups = linked to ≥ 1 item;
 * Sub-groups = zero links, reveal-only); right: the selected group at a glance
 * (its rule, options and items), or a prompt to pick one. Every change, new or
 * edit, is made in GroupWizard (the stepped dialog), never in fields on the page.
 *
 * Each group row says what it is in words — its rule, how many options, and
 * how many items offer it (or, for a sub-group, which options ask for it).
 * It printed "0–2 · 1 · 5", which only the person who wrote it could read.
 */
import { useState, type ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button, card } from '../../../components/ui';
import type { BreakdownTone } from '../../../components/BreakdownCards';
import {
  AsyncStateWrapper,
  EmptyState,
  PageHeader,
  Panel,
  asyncStatus,
} from '../../../components/kit';
import { ChevronForward } from '../../../components/icons';
import { partitionGroups, revealersOf } from './addonsLogic';
import { useChoiceRuleText } from './ChoiceLimits';
import { GroupWizard, type GroupWizardStep } from './GroupWizard';
import { OptionsList } from './OptionsList';
import { useAddons, type AddonsData, type GroupRow } from './useAddons';

type Selection = { kind: 'group'; id: string } | null;
type WizardState = {
  group: GroupRow | null;
  sub: boolean;
  start?: GroupWizardStep;
  option?: string;
};

export function AddonsPage() {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const addons = useAddons();
  const [selection, setSelection] = useState<Selection>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const status = asyncStatus(addons, () => false);
  const data = addons.data;

  return (
    <div>
      <PageHeader title={tr('op.adminNav.addons')} subtitle={tr('op.addons.lead')} />
      <AsyncStateWrapper status={status} error={addons.error} onRetry={() => void addons.refetch()}>
        {data && (
          <AddonsBody
            data={data}
            selection={selection}
            setSelection={setSelection}
            openWizard={setWizard}
            canEdit={can.editMenu}
            tr={tr}
            locale={locale}
          />
        )}
        {data && wizard && (
          <GroupWizard
            key={wizard.group?.id ?? (wizard.sub ? 'new-sub' : 'new')}
            group={wizard.group}
            subGroup={wizard.sub}
            data={data}
            startAt={wizard.start}
            startOption={wizard.option}
            onClose={() => setWizard(null)}
            onSaved={(id) => setSelection({ kind: 'group', id })}
          />
        )}
      </AsyncStateWrapper>
    </div>
  );
}

function AddonsBody({
  data,
  selection,
  setSelection,
  openWizard,
  canEdit,
  tr,
  locale,
}: {
  data: AddonsData;
  selection: Selection;
  setSelection: (s: Selection) => void;
  openWizard: (w: WizardState) => void;
  canEdit: boolean;
  tr: ReturnType<typeof useLocale>['tr'];
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  const byName = (a: GroupRow, b: GroupRow) =>
    pickName(locale, a).localeCompare(pickName(locale, b));
  const { itemGroups, subGroups } = partitionGroups(data.groups, data.links);
  itemGroups.sort(byName);
  subGroups.sort(byName);

  const selectedGroup =
    selection?.kind === 'group' ? (data.groups.find((g) => g.id === selection.id) ?? null) : null;
  const n = (v: number) => formatNumber(v, locale);
  const optionCount = (g: GroupRow) => data.modifiers.filter((m) => m.group_id === g.id).length;
  const linkCount = (g: GroupRow) =>
    new Set(data.links.filter((l) => l.group_id === g.id).map((l) => l.item_id)).size;
  const itemMeta = (g: GroupRow) =>
    tr('op.addons.meta', { options: n(optionCount(g)), items: n(linkCount(g)) });
  const subMeta = (g: GroupRow) => {
    const askers = revealersOf(g.id, data.reveals, data.modifiers).map((m) => pickName(locale, m));
    return askers.length === 0
      ? tr('op.addons.subMetaNone', { options: n(optionCount(g)) })
      : tr('op.addons.subMeta', {
          options: n(optionCount(g)),
          names: askers.join(locale === 'ar' ? '، ' : ', '),
        });
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(16rem, 22rem) minmax(0, 1fr)',
        gap: 'var(--tp-sp-4)',
        alignItems: 'start',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-3)',
          maxBlockSize: 'calc(100vh - 13rem)',
          overflowY: 'auto',
          paddingInlineEnd: 'var(--tp-sp-1)',
        }}
      >
        <GroupList
          title={tr('op.addons.groups')}
          groups={itemGroups}
          selectedId={selection?.kind === 'group' ? selection.id : null}
          onSelect={(id) => setSelection({ kind: 'group', id })}
          meta={itemMeta}
          action={
            <Button
              size="sm"
              icon="plus"
              disabled={!canEdit}
              onClick={() => openWizard({ group: null, sub: false })}
            >
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
            <Button
              size="sm"
              icon="plus"
              disabled={!canEdit}
              onClick={() => openWizard({ group: null, sub: true })}
            >
              {tr('op.addons.newSubGroup')}
            </Button>
          }
        />
      </div>
      <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {selectedGroup && (
          <>
            <GroupSummary
              group={selectedGroup}
              data={data}
              sub={!data.links.some((l) => l.group_id === selectedGroup.id)}
              canEdit={canEdit}
              onEdit={() => openWizard({ group: selectedGroup, sub: false })}
            >
              <OptionsList
                group={selectedGroup}
                data={data}
                onEdit={(option) =>
                  openWizard({ group: selectedGroup, sub: false, start: 'options', option })
                }
              />
            </GroupSummary>
          </>
        )}
        {!selection && <EmptyState icon="note" title={tr('op.addons.pick')} />}
      </div>
    </div>
  );
}

/** The selected group in one panel: its rule, items and options (the list passed in). */
function GroupSummary({
  group,
  data,
  sub,
  canEdit,
  onEdit,
  children,
}: {
  group: GroupRow;
  data: AddonsData;
  sub: boolean;
  canEdit: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const { tr, locale } = useLocale();
  const ruleText = useChoiceRuleText();
  const n = (v: number) => formatNumber(v, locale);
  const itemIds = new Set(data.links.filter((l) => l.group_id === group.id).map((l) => l.item_id));
  const items = data.items.filter((i) => itemIds.has(i.id));
  const options = data.modifiers.filter((m) => m.group_id === group.id).length;
  // Coloured like the analytics tiles: a card colour's band with the label, the value under it.
  const tile = (tone: BreakdownTone, label: string, value: ReactNode) => (
    <div
      className="tp-breakdown-card"
      data-tone={tone}
      style={{
        ...card,
        background: undefined,
        border: undefined,
        overflow: 'hidden',
        minInlineSize: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--tp-sp-3)',
      }}
    >
      <span
        className="tp-breakdown-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          marginInline: 'calc(-1 * var(--tp-sp-3))',
          marginBlockStart: 'calc(-1 * var(--tp-sp-3))',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-3)',
          minBlockSize: '2.75rem',
          fontSize: 'var(--tp-fs-sm)',
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <div style={{ fontWeight: 400, minInlineSize: 0 }}>{value}</div>
    </div>
  );
  return (
    <Panel
      title={<bdi>{pickName(locale, group)}</bdi>}
      actions={
        <Button size="sm" disabled={!canEdit} onClick={onEdit}>
          {tr('op.common.edit')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {!sub &&
          tile(
            'green',
            tr('op.addons.stepItems'),
            <>
              {items.length === 0 ? (
                <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
                  {items.map((i) => (
                    <bdi
                      key={i.id}
                      className="tp-item-pill"
                      dir={locale === 'ar' ? 'rtl' : 'ltr'}
                      style={{
                        paddingBlock: 'var(--tp-sp-0)',
                        paddingInline: 'var(--tp-sp-2-5)',
                        borderRadius: 'var(--tp-radius-pill)',
                        fontSize: 'var(--tp-fs-xs)',
                        fontWeight: 400,
                      }}
                    >
                      {pickName(locale, i)}
                    </bdi>
                  ))}
                </div>
              )}
            </>,
          )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
            gap: 'var(--tp-sp-2)',
          }}
        >
          {tile(
            'violet',
            tr('op.addons.stepChoices'),
            ruleText(group.min_select, group.max_select),
          )}
          {tile('rose', tr('op.addons.stepOptions'), n(options))}
          {!sub && tile('sky', tr('op.addons.stepItems'), n(items.length))}
        </div>
      </div>
      {children}
    </Panel>
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
        <p
          style={{
            paddingBlockStart: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
            fontSize: 'var(--tp-fs-sm)',
            color: 'var(--tp-muted-fg)',
          }}
        >
          {hint}
        </p>
      )}
      {groups.length === 0 ? (
        // "None" in muted body text was indistinguishable from a value; the
        // empty state teaches the action beside it instead (rulebook 9.2).
        <div style={{ padding: 'var(--tp-sp-2)' }}>
          <EmptyState
            compact
            titleAs="h4"
            kind="initial"
            icon="plus"
            title={tr('op.common.none')}
          />
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 'var(--tp-sp-1-5)',
            display: 'grid',
            gap: 'var(--tp-sp-0)',
          }}
        >
          {groups.map((g) => {
            const selected = selectedId === g.id;
            return (
              <li
                key={g.id}
                className="tp-row"
                data-clickable="true"
                data-selected={selected ? 'true' : undefined}
                style={{ borderRadius: 'var(--tp-radius-ctl)' }}
              >
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
                  <span
                    style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, flex: 1 }}
                  >
                    <bdi
                      dir={locale === 'ar' ? 'rtl' : 'ltr'}
                      style={{
                        fontWeight: selected ? 700 : 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pickName(locale, g)}
                    </bdi>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                      {ruleText(g.min_select, g.max_select)}
                    </span>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                      <bdi>{meta(g)}</bdi>
                    </span>
                  </span>
                  <ChevronForward
                    size={14}
                    style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
