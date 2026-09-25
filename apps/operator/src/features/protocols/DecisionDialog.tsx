/**
 * The decision on a sent step (build-contracts-2026-09-23 §5.4, adapted from
 * the staff requests' DecisionDialog): Approve, Send back or Stop.
 *
 *  - Send back and Stop need a reason, which the sender reads; the form says
 *    so before the server would (REASON_REQUIRED).
 *  - Send back names where the work goes: this step, or a finished step before
 *    it (`can.send_back_targets`).
 *  - There is no override (Q12): a decider approves or sends back, and never
 *    changes the figures here.
 *  - Nobody decides their own step: the dialog is only offered when the engine
 *    returns `decide_submission_id`, which it never does for one's own.
 *  - Approving a new-item proposal files the draft in a cafe section, which
 *    the decider picks (the release `propose` decision data, §2.8).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, type MessageKey } from '@touch/i18n';
import { validateDecision, type DecisionChoice, type ProtocolKind, type StepRow } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { invalidateProtocols, useCafeCategories } from './api';
import { protocolErrorKey } from './errors';
import { pickText } from './protocolLogic';

export function DecisionDialog({
  kind,
  step,
  submissionId,
  submittedBy,
  submittedAt,
  targets,
  proposedCategory,
  initial = 'approve',
  onClose,
}: {
  kind: ProtocolKind;
  step: StepRow;
  submissionId: string;
  submittedBy: string | null;
  submittedAt: string | null;
  /** Where Send back may send the work, in run order. */
  targets: readonly Pick<StepRow, 'id' | 'name_en' | 'name_ar'>[];
  /** A proposal's own section, when the sender named one. */
  proposedCategory?: string | null;
  initial?: DecisionChoice;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<DecisionChoice>(initial);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<string>(step.id);
  const [category, setCategory] = useState<string>(proposedCategory ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const asksCategory = kind === 'product_release' && step.step_key === 'propose' && choice === 'approve';
  const categories = useCafeCategories(asksCategory);

  const issues = validateDecision(kind, step.step_key, {
    decision: choice,
    note,
    sendBackTo: choice === 'send_back' ? target : null,
    sendBackTargets: targets.map((t) => t.id),
    data: asksCategory ? { category_id: category } : undefined,
  });
  const issueOf = (field: string) => (tried ? issues.find((i) => i.field === field) ?? null : null);

  async function send() {
    setTried(true);
    if (issues.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('decide_step', {
        p_submission_id: submissionId,
        p_decision: choice,
        p_note: note.trim() === '' ? null : note.trim(),
        p_send_back_to: choice === 'send_back' ? target : null,
        p_data: asksCategory ? { category_id: category } : {},
      });
      toast.ok(tr(`ws.protocols.decision.done.${choice}` as MessageKey));
      await invalidateProtocols(qc);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const stepName = pickText(locale, step.name_en, step.name_ar);
  const noteIssue = issueOf('note');
  return (
    <Modal
      title={tr('ws.protocols.decision.title', { step: stepName })}
      onClose={onClose}
      dismissible={!busy}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          {/* Only Stop is red: sending work back is part of the job, not a loss (the phone's DecisionBar agrees). */}
          <Button kind={choice === 'stop' ? 'danger' : 'primary'} busy={busy} onClick={() => void send()} data-testid="decision-send">
            {tr(`ws.protocols.decision.send.${choice}` as MessageKey)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {submittedBy && submittedAt && (
          <p style={{ margin: 0 }}>{tr('ws.protocols.decision.lead', { name: submittedBy, date: formatDateTime(new Date(submittedAt), locale) })}</p>
        )}
        <Field label={tr('ws.protocols.decision.choice')} group>
          <SegmentedControl<DecisionChoice>
            value={choice}
            onChange={(c) => {
              setChoice(c);
              setTried(false);
            }}
            options={[
              { value: 'approve', label: tr('work.protocol.action.approve') },
              { value: 'send_back', label: tr('work.protocol.action.sendBack') },
              { value: 'stop', label: tr('work.protocol.action.stop') },
            ]}
          />
        </Field>
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.protocols.decision.explain.${choice}` as MessageKey)}</p>

        {asksCategory && (
          <Field label={tr('ws.protocols.decision.category')} hint={tr('ws.protocols.decision.categoryHint')} required error={issueOf('category_id') ? tr('ws.protocols.form.fieldInvalid') : undefined}>
            <Select<string>
              value={category}
              placeholder={tr('ws.protocols.form.choose')}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: pickText(locale, c.name_en, c.name_ar) }))}
              onChange={setCategory}
            />
          </Field>
        )}

        {choice === 'send_back' && targets.length > 1 && (
          <Field label={tr('ws.protocols.decision.target')} hint={tr('ws.protocols.decision.targetHint')} required>
            <Select<string>
              value={target}
              options={targets.map((t) => ({
                value: t.id,
                label: t.id === step.id ? tr('ws.protocols.decision.thisStep', { step: pickText(locale, t.name_en, t.name_ar) }) : pickText(locale, t.name_en, t.name_ar),
              }))}
              onChange={setTarget}
            />
          </Field>
        )}

        <Field
          label={tr(choice === 'approve' ? 'ws.protocols.decision.note' : 'ws.protocols.decision.reason')}
          hint={tr('ws.protocols.decision.readBySender')}
          required={choice !== 'approve'}
          optional={choice === 'approve'}
          error={noteIssue ? tr(`op.errors.${noteIssue.code}` as MessageKey) : undefined}
        >
          <textarea value={note} rows={3} disabled={busy} style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }} dir="auto" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {/* The two price steps: the owner approves or sends back, never retypes a figure (Q12). */}
        {choice === 'approve' && (step.step_key === 'analysis' || step.step_key === 'numbers') && (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.decision.noOverride')}</p>
        )}
        {error != null && (
          <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr(protocolErrorKey(error))}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A reason prompt: skipping an optional step, stopping a whole protocol. */
export function ReasonDialog({
  title,
  body,
  confirm,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const missing = reason.trim() === '';
  const tooLong = [...reason.trim()].length > 1000;
  return (
    <Modal
      title={title}
      onClose={onClose}
      dismissible={!busy}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setTried(true);
              if (missing || tooLong) return;
              setBusy(true);
              setError(null);
              try {
                await onSubmit(reason.trim());
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>{body}</p>
      <Field
        label={tr('ws.protocols.decision.reason')}
        hint={tr('ws.protocols.decision.readBySender')}
        required
        error={tried && missing ? tr('op.errors.REASON_REQUIRED') : tried && tooLong ? tr('op.errors.TEXT_TOO_LONG') : undefined}
      >
        <textarea value={reason} rows={3} dir="auto" disabled={busy} style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error != null && <ErrorText error={error} />}
    </Modal>
  );
}
