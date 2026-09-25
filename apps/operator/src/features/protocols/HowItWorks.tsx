/**
 * How it works — the owner's editor of a protocol's template
 * (build-contracts-2026-09-23 §5.4, §2.7 `save_protocol_template`, Q7, #58;
 * `editProtocols`).
 *
 * What the owner may change on a built-in step: its name, "Needs my OK"
 * (hidden where the def fixes it: the two price steps always need it, and the
 * owner does the launch and the hire), and its checklist. Who does a built-in
 * step and whether it is optional are fixed, and it cannot be removed. The
 * owner's own steps are theirs: add, rename, choose who does them, move and
 * delete. A move is offered only where it keeps the order that matters (the
 * first step first, the last step last, every step after what it depends on).
 *
 * A save replaces the template as a whole and bumps its version; running
 * protocols keep the steps they started with.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import type { ProtocolKind, TournamentVariant } from '@touch/core/protocols';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, SegmentedControl, StatusBadge, asyncStatus } from '../../components/kit';
import { SortButtons } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { SettingsGroup, SettingsRow, settingField } from '../admin/settings/SettingsList';
import { invalidateProtocols, useTemplateDetail } from './api';
import { PK } from './keys';
import {
  TEMPLATE_CAPS,
  canMoveStep,
  draftFromTemplate,
  draftProblems,
  hasDraftProblems,
  insertOwnerStep,
  moveStep,
  newOwnerStep,
  pickText,
  templateChanged,
  templatePayload,
  type DraftStep,
  type OverviewTemplate,
  type StepDef,
  type TemplateDetail,
  type TemplateDraft,
} from './protocolLogic';
import { ItemsEditor, RolePicker } from './RunEdits';

export function HowItWorksSheet({
  kind,
  templates,
  variant: variantIn,
  onClose,
}: {
  kind: ProtocolKind;
  templates: readonly OverviewTemplate[];
  variant?: TournamentVariant | null;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [variant, setVariant] = useState<TournamentVariant | null>(kind === 'tournament' ? variantIn ?? 'type1' : null);
  const template = templates.find((t) => (kind === 'tournament' ? t.variant === variant : true)) ?? null;
  const [drafts, setDrafts] = useState<Record<string, { draft: TemplateDraft; base: TemplateDraft; version: number }>>({});
  const dirty = Object.values(drafts).some((d) => templateChanged(d.draft, d.base));
  const confirm = useConfirm();

  async function close() {
    if (dirty && !(await confirm({ title: tr('ws.protocols.how.leaveTitle'), body: tr('ws.protocols.how.leaveBody'), confirmLabel: tr('ws.protocols.how.leave'), kind: 'danger' }))) return;
    onClose();
  }

  return (
    <Modal title={tr('ws.protocols.how.title', { kind: tr(`work.protocol.kind.${kind}`) })} subtitle={tr('ws.protocols.how.lead')} onClose={() => void close()} size="xl">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="how-it-works">
        {kind === 'tournament' && (
          <SegmentedControl<TournamentVariant>
            value={variant ?? 'type1'}
            onChange={setVariant}
            aria-label={tr('ws.protocols.start.variant')}
            options={(['type1', 'type2', 'type3'] as const).map((v) => ({ value: v, label: tr(`work.protocol.variant.${v}`) }))}
          />
        )}
        {template ? (
          <TemplateEditor
            key={template.template_id}
            templateId={template.template_id}
            state={drafts[template.template_id] ?? null}
            onState={(next) => setDrafts((all) => ({ ...all, [template.template_id]: next }))}
          />
        ) : (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.protocols.how.noTemplate')}</p>
        )}
      </div>
    </Modal>
  );
}

interface EditorState {
  draft: TemplateDraft;
  base: TemplateDraft;
  version: number;
}

function TemplateEditor({ templateId, state, onState }: { templateId: string; state: EditorState | null; onState: (next: EditorState) => void }) {
  const q = useTemplateDetail(templateId);
  const qc = useQueryClient();

  // The first read starts the draft; later ones (after a save) do not overwrite typing.
  useEffect(() => {
    if (q.data && !state) {
      const base = draftFromTemplate(q.data);
      onState({ draft: base, base, version: q.data.template.version });
    }
  }, [q.data, state, onState]);

  return (
    <AsyncStateWrapper status={asyncStatus(q, () => false)} error={q.error} onRetry={() => void q.refetch()}>
      {q.data && state && (
        <DraftEditor
          detail={q.data}
          state={state}
          onState={onState}
          onReload={async () => {
            await qc.invalidateQueries({ queryKey: PK.template(templateId) });
            const fresh = await q.refetch();
            if (fresh.data) {
              const base = draftFromTemplate(fresh.data);
              onState({ draft: base, base, version: fresh.data.template.version });
            }
          }}
        />
      )}
    </AsyncStateWrapper>
  );
}

function DraftEditor({ detail, state, onState, onReload }: { detail: TemplateDetail; state: EditorState; onState: (next: EditorState) => void; onReload: () => Promise<void> }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { draft } = state;
  const defs = detail.defs;
  const problems = draftProblems(draft, defs);
  const invalid = hasDraftProblems(problems);
  const dirty = templateChanged(draft, state.base);
  const stale = error instanceof AppRpcError && error.code === 'TEMPLATE_CHANGED';
  const full = draft.steps.length >= TEMPLATE_CAPS.steps;

  const set = (part: Partial<TemplateDraft>) => onState({ ...state, draft: { ...draft, ...part } });
  const setStep = (key: string, part: Partial<DraftStep>) => set({ steps: draft.steps.map((s) => (s.key === key ? { ...s, ...part } : s)) });

  async function save() {
    setTried(true);
    if (invalid) return;
    const ok = await confirm({ title: tr('ws.protocols.how.saveTitle'), body: tr('ws.protocols.how.saveBody'), confirmLabel: tr('ws.protocols.how.save'), kind: 'primary' });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ template_id: string; version: number }>('save_protocol_template', {
        p_template_id: detail.template.id,
        p_expected_version: state.version,
        ...templatePayload(draft),
      });
      onState({ draft, base: draft, version: res.version });
      setTried(false);
      toast.ok(tr('ws.protocols.how.saved'));
      await invalidateProtocols(qc);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const nameProblem = tried ? problems.name : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {detail.template.updated_at
            ? detail.template.updated_by_name
              ? tr('ws.protocols.how.savedBy', {
                  name: isolate(detail.template.updated_by_name),
                  date: formatDateTime(new Date(detail.template.updated_at), locale),
                  version: formatNumber(state.version, locale),
                })
              : tr('ws.protocols.how.savedAt', { date: formatDateTime(new Date(detail.template.updated_at), locale), version: formatNumber(state.version, locale) })
            : null}
        </span>
        {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Field label={tr('ws.protocols.how.nameEn')} required error={nameProblem ? tr(`ws.protocols.how.problem.${nameProblem}` as MessageKey) : undefined}>
          <input style={inputStyle} dir="ltr" maxLength={140} value={draft.name_en} disabled={busy} onChange={(e) => set({ name_en: e.target.value })} />
        </Field>
        <Field label={tr('ws.protocols.how.nameAr')} required error={nameProblem ? tr(`ws.protocols.how.problem.${nameProblem}` as MessageKey) : undefined}>
          <input style={inputStyle} dir="rtl" maxLength={140} value={draft.name_ar} disabled={busy} onChange={(e) => set({ name_ar: e.target.value })} />
        </Field>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {draft.steps.map((s, index) => (
          <StepEditor
            key={s.key}
            step={s}
            index={index}
            def={s.step_key ? defs.find((d) => d.step_key === s.step_key) ?? null : null}
            canUp={canMoveStep(draft.steps, defs, index, 'up')}
            canDown={canMoveStep(draft.steps, defs, index, 'down')}
            onMove={(dir) => set({ steps: moveStep(draft.steps, index, dir) })}
            onChange={(part) => setStep(s.key, part)}
            onRemove={() => set({ steps: draft.steps.filter((x) => x.key !== s.key) })}
            problem={tried ? problems.steps.get(s.key) ?? null : null}
            itemProblems={tried ? problems.items : undefined}
            tooManyItems={problems.tooManyItems.has(s.key)}
            disabled={busy}
          />
        ))}
      </ol>
      {full ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.how.fullSteps', { max: formatNumber(TEMPLATE_CAPS.steps, locale) })}</p>
      ) : (
        <div>
          <Button size="sm" icon="plus" disabled={busy} onClick={() => set({ steps: insertOwnerStep(draft.steps, newOwnerStep()) })}>
            {tr('ws.protocols.how.addStep')}
          </Button>
        </div>
      )}

      {tried && problems.order && <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.errors.PROTOCOL_ORDER_INVALID')}</p>}
      {stale ? (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          <Button
            size="sm"
            icon="refresh"
            onClick={() => {
              setError(null);
              setTried(false);
              void onReload();
            }}
          >
            {tr('ws.protocols.how.reload')}
          </Button>
        </div>
      ) : (
        <ErrorText error={error} />
      )}
      <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.how.saveBody')}</p>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button
          kind="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setTried(false);
            setError(null);
            onState({ ...state, draft: state.base });
          }}
        >
          {tr('ws.protocols.how.discard')}
        </Button>
        <Button kind="primary" icon="check" busy={busy} disabled={!dirty} disabledReason={!dirty ? tr('ws.manager.disabled.noChanges') : undefined} onClick={() => void save()} data-testid="how-save">
          {tr('ws.protocols.how.save')}
        </Button>
      </div>
      {tried && invalid && <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', textAlign: 'end' }}>{tr('ws.protocols.form.checkMarked')}</p>}
    </div>
  );
}

function StepEditor({
  step,
  index,
  def,
  canUp,
  canDown,
  onMove,
  onChange,
  onRemove,
  problem,
  itemProblems,
  tooManyItems,
  disabled,
}: {
  step: DraftStep;
  index: number;
  def: StepDef | null;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: 'up' | 'down') => void;
  onChange: (part: Partial<DraftStep>) => void;
  onRemove: () => void;
  problem: string | null;
  itemProblems?: Map<string, string>;
  tooManyItems: boolean;
  disabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const builtIn = step.step_key !== null;
  const n = formatNumber(index + 1, locale);
  const nameProblem = problem === 'both' || problem === 'tooLong' ? problem : null;
  const named = pickText(locale, step.name_en, step.name_ar) || tr('ws.protocols.how.ownStep');
  return (
    <li data-testid="how-step" data-step={step.step_key ?? 'own'}>
      <SettingsGroup
        level={3}
        title={tr('ws.protocols.how.stepTitle', { n, name: named })}
        actions={
          <>
            <StatusBadge size="sm" dot={false} tone={builtIn ? 'neutral' : 'accent'} label={tr(builtIn ? 'ws.protocols.how.builtIn' : 'ws.protocols.how.ownStep')} />
            {def?.fixed && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.protocols.how.fixed.${def.fixed}` as MessageKey)}</span>}
            <SortButtons onUp={() => onMove('up')} onDown={() => onMove('down')} disabledUp={disabled || !canUp} disabledDown={disabled || !canDown} />
            {!builtIn && (
              <Button size="sm" kind="ghost" icon="trash" disabled={disabled} aria-label={tr('ws.protocols.how.removeStep', { n })} title={tr('ws.protocols.how.removeStep', { n })} onClick={onRemove} />
            )}
          </>
        }
      >
        <SettingsRow>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
            <Field label={tr('ws.protocols.how.stepNameEn')} required style={settingField} error={nameProblem ? tr(`ws.protocols.how.problem.${nameProblem}` as MessageKey) : undefined}>
              <input style={inputStyle} dir="ltr" maxLength={140} value={step.name_en} disabled={disabled} onChange={(e) => onChange({ name_en: e.target.value })} />
            </Field>
            <Field label={tr('ws.protocols.how.stepNameAr')} required style={settingField} error={nameProblem ? tr(`ws.protocols.how.problem.${nameProblem}` as MessageKey) : undefined}>
              <input style={inputStyle} dir="rtl" maxLength={140} value={step.name_ar} disabled={disabled} onChange={(e) => onChange({ name_ar: e.target.value })} />
            </Field>
          </div>
        </SettingsRow>
        {builtIn ? (
          <SettingsRow description={tr('ws.protocols.how.actorsFixed')}>
            <span style={{ fontWeight: 600 }}>
              {tr('ws.protocols.how.doneBy', { roles: step.actor_roles.map((r) => tr(`op.roles.${r}`)).join(tr('ws.protocols.view.listJoin')) })}
              {step.optional && ` · ${tr('work.protocol.optional')}`}
            </span>
          </SettingsRow>
        ) : (
          <SettingsRow>
            <RolePicker value={step.actor_roles} onChange={(roles) => onChange({ actor_roles: roles })} invalid={problem === 'actors'} disabled={disabled} />
          </SettingsRow>
        )}
        {/* Who decides follows the switch (§2.7 "Who decides"): the owner when it is on, else a manager. */}
        <SettingsRow description={def?.ok_fixed ? undefined : tr('ws.protocols.how.okHint')}>
          {def?.ok_fixed ? (
            <span style={{ fontWeight: 600 }} data-testid="ok-fixed">
              {tr(def.actor_roles.includes('owner') ? 'ws.protocols.how.okYours' : 'ws.protocols.how.okAlways')}
            </span>
          ) : (
            <Switch checked={step.needs_owner_ok} label={tr('ws.protocols.how.needsOk')} disabled={disabled} onChange={(next) => onChange({ needs_owner_ok: next })} />
          )}
        </SettingsRow>
        {!builtIn && (
          <SettingsRow description={tr('ws.protocols.how.optionalHint')}>
            <Switch checked={step.optional} label={tr('ws.protocols.how.optional')} disabled={disabled} onChange={(next) => onChange({ optional: next })} />
          </SettingsRow>
        )}
        <SettingsRow>
          <details open={step.items.length > 0}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.protocols.how.checklistCount', { count: formatNumber(step.items.length, locale) })}
            </summary>
            <div style={{ paddingBlockStart: 'var(--tp-sp-2)' }}>
              <ItemsEditor items={step.items} onChange={(items) => onChange({ items })} disabled={disabled} problems={itemProblems} />
              {tooManyItems && <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.errors.LIST_TOO_LONG')}</p>}
            </div>
          </details>
        </SettingsRow>
      </SettingsGroup>
    </li>
  );
}
