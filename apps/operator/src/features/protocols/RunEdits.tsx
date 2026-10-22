/**
 * The owner's changes to ONE running protocol (build-contracts-2026-09-23
 * §2.7, Q11; `editProtocols`), and their only surface — they are managing, not
 * a step, so the phone does not have them:
 *
 *  - a step's checklist (app.edit_run_items): up to 12 lines in both
 *    languages; a line kept keeps its tick;
 *  - a step of the owner's own (app.add_run_step): named in both languages,
 *    done by a hireable role, placed after a step where nothing below it has
 *    started (the engine never takes a started step back), and never after the
 *    last step.
 *
 * Neither touches the template: How it works is where every new run changes.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { countPhrase, formatNumber, type MessageKey } from '@touch/i18n';
import type { StepRow } from '@touch/core/protocols';
import type { StaffRole } from '@touch/core/staff/roles';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { BilingualFields, SortButtons } from '../../components/inputs';
import { ReviewList, StepWizard, WizardChips, WizardChoice, WizardChoices, WizardNote, WizardToggle, type WizardStep } from '../../components/StepWizard';
import { invalidateProtocols } from './api';
import { OWNER_STEP_ROLES, TEMPLATE_CAPS, localKey, moveStep, pickText, type DraftItem } from './protocolLogic';

function itemProblems(items: readonly DraftItem[]): Map<string, 'both' | 'tooLong'> {
  const out = new Map<string, 'both' | 'tooLong'>();
  for (const i of items) {
    const en = i.text_en.trim();
    const ar = i.text_ar.trim();
    if (en === '' && ar === '') continue;
    if (en === '' || ar === '') out.set(i.key, 'both');
    else if ([...en].length > TEMPLATE_CAPS.item || [...ar].length > TEMPLATE_CAPS.item) out.set(i.key, 'tooLong');
  }
  return out;
}

/** A checklist editor: lines in both languages, move, remove, at most 12. Shared by How it works. */
export function ItemsEditor({ items, onChange, disabled, problems }: { items: DraftItem[]; onChange: (next: DraftItem[]) => void; disabled?: boolean; problems?: Map<string, string> }) {
  const { tr, locale } = useLocale();
  const full = items.length >= TEMPLATE_CAPS.items;
  const set = (key: string, part: Partial<DraftItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...part } : i)));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      {items.length === 0 && <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.items.none')}</p>}
      {items.map((i, index) => {
        const n = formatNumber(index + 1, locale);
        const p = problems?.get(i.key);
        return (
          <div key={i.key} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ inlineSize: '1.5rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{n}</span>
              <input
                style={{ ...inputStyle, flex: '1 1 10rem', minInlineSize: 0 }}
                dir="ltr"
                aria-label={tr('ws.protocols.items.lineEn', { n })}
                placeholder={tr('ws.protocols.items.lineEn', { n })}
                value={i.text_en}
                maxLength={TEMPLATE_CAPS.item + 20}
                disabled={disabled}
                onChange={(e) => set(i.key, { text_en: e.target.value })}
              />
              <input
                style={{ ...inputStyle, flex: '1 1 10rem', minInlineSize: 0 }}
                dir="rtl"
                aria-label={tr('ws.protocols.items.lineAr', { n })}
                placeholder={tr('ws.protocols.items.lineAr', { n })}
                value={i.text_ar}
                maxLength={TEMPLATE_CAPS.item + 20}
                disabled={disabled}
                onChange={(e) => set(i.key, { text_ar: e.target.value })}
              />
              <SortButtons
                onUp={() => onChange(moveStep(items, index, 'up'))}
                onDown={() => onChange(moveStep(items, index, 'down'))}
                disabledUp={disabled || index === 0}
                disabledDown={disabled || index === items.length - 1}
              />
              <Button
                size="sm"
                kind="ghost"
                icon="x"
                disabled={disabled}
                aria-label={tr('ws.protocols.items.remove', { n })}
                title={tr('ws.protocols.items.remove', { n })}
                onClick={() => onChange(items.filter((x) => x.key !== i.key))}
              />
            </div>
            {p && <span style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', paddingInlineStart: 'calc(1.5rem + var(--tp-sp-1-5))' }}>{tr(`ws.protocols.how.problem.${p}` as MessageKey)}</span>}
          </div>
        );
      })}
      {!full && !disabled && (
        <div>
          <Button size="sm" icon="plus" onClick={() => onChange([...items, { key: localKey(), text_en: '', text_ar: '' }])}>
            {tr('ws.protocols.items.add')}
          </Button>
        </div>
      )}
      {full && <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.items.full', { max: formatNumber(TEMPLATE_CAPS.items, locale) })}</p>}
    </div>
  );
}

/** Items as the RPCs take them: blank lines dropped, kept ids kept. */
function itemsPayload(items: readonly (DraftItem & { id?: string | null })[]) {
  return items
    .filter((i) => i.text_en.trim() !== '' || i.text_ar.trim() !== '')
    .map((i) => ({ ...(i.id !== undefined ? { id: i.id } : {}), text_en: i.text_en.trim(), text_ar: i.text_ar.trim() }));
}

export function EditItemsDialog({ step, onClose }: { step: StepRow; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [items, setItems] = useState<(DraftItem & { id: string | null })[]>(() =>
    step.items.map((i) => ({ key: localKey(), id: i.id, text_en: i.text_en, text_ar: i.text_ar })),
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problems = itemProblems(items);

  async function save() {
    setTried(true);
    if (problems.size > 0) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('edit_run_items', { p_run_step_id: step.id, p_items: itemsPayload(items) });
      toast.ok(tr('ws.protocols.edits.itemsSaved'));
      await invalidateProtocols(qc);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.protocols.edits.itemsTitle', { step: pickText(locale, step.name_en, step.name_ar) })}
      subtitle={tr('ws.protocols.edits.onlyThisRun')}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()}>
            {tr('common.save')}
          </Button>
        </>
      )}
    >
      <ItemsEditor
        items={items}
        onChange={(next) => setItems(next.map((n) => ({ ...n, id: (n as DraftItem & { id?: string | null }).id ?? null })))}
        disabled={busy}
        problems={tried ? problems : undefined}
      />
      {error != null && <ErrorText error={error} />}
    </Modal>
  );
}

export function AddStepDialog({ runId, after, onClose }: { runId: string; after: readonly StepRow[]; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [afterId, setAfterId] = useState<string>(after[after.length - 1]?.id ?? '');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>(['manager']);
  const [ok, setOk] = useState(false);
  const [optional, setOptional] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameMissing = nameEn.trim() === '' || nameAr.trim() === '';
  const problems = itemProblems(items);
  const invalid = nameMissing || roles.length === 0 || problems.size > 0 || afterId === '';

  async function save() {
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('add_run_step', {
        p_run_id: runId,
        p_after_run_step_id: afterId,
        p_step: { name_en: nameEn.trim(), name_ar: nameAr.trim(), actor_roles: roles, needs_owner_ok: ok, optional, items: itemsPayload(items) },
      });
      toast.ok(tr('ws.protocols.edits.stepAdded'));
      await invalidateProtocols(qc);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const afterStep = after.find((s) => s.id === afterId);
  const stepName = pickText(locale, nameEn.trim(), nameAr.trim());
  const roleNames = roles.map((r) => tr(`op.roles.${r}`)).join(', ');
  const lines = itemsPayload(items).length;
  const linesText = countPhrase('ws.protocols.edits.lines', lines, locale);

  const steps: WizardStep[] = [
    {
      key: 'where',
      label: tr('ws.protocols.edits.steps.where'),
      note: afterStep ? tr('ws.protocols.edits.afterNote', { step: pickText(locale, afterStep.name_en, afterStep.name_ar) }) : null,
      problems: afterId === '' ? [tr('ws.protocols.edits.pickAfter')] : [],
      content: (
        <>
          <Field label={tr('ws.protocols.edits.after')} group style={{ marginBlockEnd: 0 }}>
            <WizardChoices small label={tr('ws.protocols.edits.after')}>
              {after.map((s) => (
                <WizardChoice
                  key={s.id}
                  on={afterId === s.id}
                  title={<bdi>{pickText(locale, s.name_en, s.name_ar)}</bdi>}
                  body={tr('ws.protocols.edits.stepN', { n: formatNumber(s.position, locale) })}
                  disabled={busy}
                  onPick={() => setAfterId(s.id)}
                />
              ))}
            </WizardChoices>
          </Field>
          <WizardNote>{tr('ws.protocols.edits.afterHint')}</WizardNote>
        </>
      ),
    },
    {
      key: 'who',
      label: tr('ws.protocols.edits.steps.who'),
      note: roles.length > 0 ? roleNames : null,
      problems: [
        ...(nameMissing ? [tr('op.errors.TEXT_BOTH_LANGUAGES_REQUIRED')] : []),
        ...(roles.length === 0 ? [tr('ws.protocols.how.problem.actors')] : []),
      ],
      content: (
        <>
          <BilingualFields
            labelEn={tr('ws.protocols.how.stepNameEn')}
            labelAr={tr('ws.protocols.how.stepNameAr')}
            en={nameEn}
            ar={nameAr}
            onEn={setNameEn}
            onAr={setNameAr}
            maxLength={140}
            disabled={busy}
          />
          <Field label={tr('ws.protocols.how.actors')} group style={{ marginBlockEnd: 0 }}>
            <WizardChips<StaffRole>
              label={tr('ws.protocols.how.actors')}
              value={roles}
              options={OWNER_STEP_ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`), disabled: busy }))}
              onChange={(r) => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
            />
          </Field>
          {/* The two switches side by side, as the preview's two-up row. */}
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2) var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
            <WizardToggle checked={ok} label={tr('ws.protocols.how.needsOk')} hint={tr('ws.protocols.edits.needsOkHint')} disabled={busy} onChange={setOk} />
            <WizardToggle checked={optional} label={tr('ws.protocols.how.optional')} hint={tr('ws.protocols.edits.optionalHint')} disabled={busy} onChange={setOptional} />
          </div>
        </>
      ),
    },
    {
      key: 'checklist',
      label: tr('ws.protocols.how.checklist'),
      note: linesText,
      problems: problems.size > 0 ? [...new Set([...problems.values()])].map((p) => tr(`ws.protocols.how.problem.${p}` as MessageKey)) : [],
      content: (
        <Field label={tr('ws.protocols.how.checklist')} optional group style={{ marginBlockEnd: 0 }}>
          <ChecklistLines items={items} onChange={setItems} problems={problems} disabled={busy} />
        </Field>
      ),
    },
  ];

  return (
    <StepWizard
      title={tr('ws.protocols.edits.wizardTitle')}
      lead={tr('ws.protocols.edits.wizardLead')}
      steps={steps}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr('ws.protocols.edits.after'), value: afterStep ? <bdi>{pickText(locale, afterStep.name_en, afterStep.name_ar)}</bdi> : '—', step: 'where' },
            { label: tr('ws.protocols.edits.review.step'), value: <bdi>{stepName}</bdi>, step: 'who' },
            { label: tr('ws.protocols.how.actors'), value: roleNames || '—', step: 'who' },
            { label: tr('ws.protocols.how.checklist'), value: linesText, step: 'checklist' },
          ]}
        />
      )}
      submitLabel={tr('ws.protocols.edits.add')}
      onSubmit={() => void save()}
      busy={busy}
      notice={error != null ? <ErrorText error={error} /> : null}
      onClose={onClose}
      testId="protocols.addStep"
    />
  );
}

/**
 * The wizard's checklist, as the preview draws it: a row per line (its number,
 * the English box, the Arabic box, remove), "Add a line" under them and the
 * cap under that. A line missing a language marks both its boxes; the footer
 * says why when the person moves on.
 */
function ChecklistLines({ items, onChange, problems, disabled }: { items: DraftItem[]; onChange: (next: DraftItem[]) => void; problems: Map<string, string>; disabled?: boolean }) {
  const { tr, locale } = useLocale();
  const full = items.length >= TEMPLATE_CAPS.items;
  const set = (key: string, part: Partial<DraftItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...part } : i)));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {items.map((i, index) => {
            const n = formatNumber(index + 1, locale);
            const bad = problems.has(i.key) || undefined;
            return (
              <div key={i.key} style={{ display: 'grid', gridTemplateColumns: '1.6rem minmax(0, 1fr) minmax(0, 1fr) auto', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                <b style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{n}</b>
                <input
                  style={inputStyle}
                  dir="ltr"
                  aria-label={tr('ws.protocols.items.lineEn', { n })}
                  aria-invalid={bad}
                  value={i.text_en}
                  maxLength={TEMPLATE_CAPS.item + 20}
                  disabled={disabled}
                  onChange={(e) => set(i.key, { text_en: e.target.value })}
                />
                <input
                  style={inputStyle}
                  dir="rtl"
                  aria-label={tr('ws.protocols.items.lineAr', { n })}
                  aria-invalid={bad}
                  value={i.text_ar}
                  maxLength={TEMPLATE_CAPS.item + 20}
                  disabled={disabled}
                  onChange={(e) => set(i.key, { text_ar: e.target.value })}
                />
                <Button
                  size="sm"
                  icon="x"
                  disabled={disabled}
                  aria-label={tr('ws.protocols.items.remove', { n })}
                  title={tr('ws.protocols.items.remove', { n })}
                  onClick={() => onChange(items.filter((x) => x.key !== i.key))}
                />
              </div>
            );
          })}
        </div>
      )}
      <div>
        <Button size="sm" icon="plus" disabled={disabled || full} onClick={() => onChange([...items, { key: localKey(), text_en: '', text_ar: '' }])}>
          {tr('ws.protocols.items.add')}
        </Button>
      </div>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.protocols.items.upTo', { max: formatNumber(TEMPLATE_CAPS.items, locale) })}</span>
    </div>
  );
}

/** Who does an owner's own step: one or more hireable roles (INVALID_ROLE otherwise). */
export function RolePicker({ value, onChange, invalid, disabled }: { value: StaffRole[]; onChange: (next: StaffRole[]) => void; invalid?: boolean; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.protocols.how.actors')} required group error={invalid ? tr('ws.protocols.how.problem.actors') : undefined}>
      <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
        {OWNER_STEP_ROLES.map((r) => {
          const on = value.includes(r);
          return (
            <Button key={r} size="sm" kind={on ? 'primary' : 'default'} aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}>
              {tr(`op.roles.${r}`)}
            </Button>
          );
        })}
      </span>
    </Field>
  );
}
