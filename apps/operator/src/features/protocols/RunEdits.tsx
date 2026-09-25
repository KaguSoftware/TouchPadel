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
import { formatNumber, type MessageKey } from '@touch/i18n';
import type { StepRow } from '@touch/core/protocols';
import type { StaffRole } from '@touch/core/staff/roles';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { SortButtons } from '../../components/inputs';
import { Switch } from '../../components/Switch';
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
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameMissing = nameEn.trim() === '' || nameAr.trim() === '';
  const problems = itemProblems(items);
  const invalid = nameMissing || roles.length === 0 || problems.size > 0 || afterId === '';

  async function save() {
    setTried(true);
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

  return (
    <Modal
      title={tr('ws.protocols.edits.addTitle')}
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
            {tr('ws.protocols.edits.add')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.protocols.edits.after')} hint={tr('ws.protocols.edits.afterHint')} required>
          <Select<string> value={afterId} disabled={busy} options={after.map((s) => ({ value: s.id, label: pickText(locale, s.name_en, s.name_ar) }))} onChange={setAfterId} />
        </Field>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
          <Field label={tr('ws.protocols.how.stepNameEn')} required error={tried && nameEn.trim() === '' ? tr('op.errors.TEXT_BOTH_LANGUAGES_REQUIRED') : undefined}>
            <input style={inputStyle} dir="ltr" maxLength={140} value={nameEn} disabled={busy} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label={tr('ws.protocols.how.stepNameAr')} required error={tried && nameAr.trim() === '' ? tr('op.errors.TEXT_BOTH_LANGUAGES_REQUIRED') : undefined}>
            <input style={inputStyle} dir="rtl" maxLength={140} value={nameAr} disabled={busy} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
        </div>
        <RolePicker value={roles} onChange={setRoles} invalid={tried && roles.length === 0} disabled={busy} />
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
          <Switch checked={ok} label={tr('ws.protocols.how.needsOk')} disabled={busy} onChange={setOk} />
          <Switch checked={optional} label={tr('ws.protocols.how.optional')} disabled={busy} onChange={setOptional} />
        </div>
        <Field label={tr('ws.protocols.how.checklist')} optional group>
          <ItemsEditor items={items} onChange={setItems} problems={tried ? problems : undefined} disabled={busy} />
        </Field>
        {error != null && <ErrorText error={error} />}
      </div>
    </Modal>
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
