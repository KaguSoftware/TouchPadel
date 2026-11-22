/**
 * Customer tags with a rule (0449), on the customer record. One window does
 * both jobs: the desk ticks which of the club's tags this customer carries,
 * and a manager or the owner sets the tags up in the same place (name, % off
 * café and shop, % off the court fee) so "Family, 15% off everything" is two
 * clicks away from the person it is for. What the bills will actually get is
 * the server's answer (`effective`), never worked out here. Online only.
 */
import { useState } from 'react';
import { countPhrase, isolate } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useStationReach } from '../../../lib/stationReach';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/kit';
import {
  bpToPercentText,
  deleteCustomerTag,
  percentTextToBp,
  ruleWords,
  saveCustomerTag,
  setCustomerTags,
  useInvalidateCustomerRules,
  type CatalogTag,
  type CustomerRules,
  type TagRule,
} from './customerRules';

/** The chips beside the customer's name: each tag with its rule. */
export function TagChips({ tags }: { tags: readonly TagRule[] }) {
  const { tr, locale } = useLocale();
  return (
    <>
      {tags.map((t) => {
        const rule = t.cafe_bp === null && t.court_bp === null ? null : ruleWords(t, tr, locale);
        const label = rule ? `${t.name} · ${rule}` : t.name;
        return (
          <StatusBadge
            key={t.id}
            tone={rule ? 'accent' : 'neutral'}
            icon="tag"
            dot={false}
            size="md"
            label={label}
            title={label}
          />
        );
      })}
    </>
  );
}

/** "Their bills get: 15% off café & shop · 30% off court fee", from the server's effective discount. */
export function EffectiveLine({ rules }: { rules: CustomerRules }) {
  const { tr, locale } = useLocale();
  const eff = rules.effective;
  const pct = (p: NonNullable<CustomerRules['effective']>['cafe']) =>
    p && p.kind === 'percent' ? p.value : null;
  const parts = eff
    ? ruleWords({ cafe_bp: pct(eff.cafe), court_bp: pct(eff.court) }, tr, locale)
    : null;
  const hasAmount =
    eff && ((eff.cafe && eff.cafe.kind === 'amount') || (eff.court && eff.court.kind === 'amount'));
  const ownPart =
    eff && ((eff.cafe && eff.cafe.tag === null) || (eff.court && eff.court.tag === null));
  if (!eff || (!parts && !hasAmount)) {
    return (
      <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
        {tr('ws.customerRules.tags.nowGetsNothing')}
      </p>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }} data-testid="tags-effective">
      <span style={{ fontWeight: 600 }}>
        {tr('ws.customerRules.tags.nowGets', { parts: parts ?? '' })}
      </span>
      {ownPart && (
        <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.customerRules.tags.ownWins')}
        </span>
      )}
    </div>
  );
}

type Draft = { id: string | null; name: string; cafe: string; court: string; same: boolean };
const blankDraft = (): Draft => ({ id: null, name: '', cafe: '', court: '', same: true });

export function TagsDialog({
  customerId,
  name,
  rules,
  self,
  canManage,
  onClose,
}: {
  customerId: string;
  name: string;
  rules: CustomerRules;
  /** The customer is the person signed in: no discount tags on yourself. */
  self: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const invalidate = useInvalidateCustomerRules();
  const { reachable } = useStationReach();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rules.tags.map((t) => t.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<unknown>(null);
  const [draftTried, setDraftTried] = useState(false);
  const [deleting, setDeleting] = useState<CatalogTag | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const offline = tr('ws.customerRules.offline');
  const carried = new Set(rules.tags.map((t) => t.id));
  const hasRule = (t: TagRule) => t.cafe_bp !== null || t.court_bp !== null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setCustomerTags(customerId, [...picked]);
      toast.ok(tr('ws.customerRules.tags.saved'));
      invalidate(customerId);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // The tag form (manager, owner).
  const cafeBp = draft ? percentTextToBp(draft.cafe) : null;
  const courtBp = draft ? (draft.same ? cafeBp : percentTextToBp(draft.court)) : null;
  const nameMissing = draft ? draft.name.trim() === '' : false;
  const badPercent = cafeBp === 'invalid' || courtBp === 'invalid';

  async function saveDraft() {
    if (!draft) return;
    setDraftTried(true);
    if (nameMissing || badPercent) return;
    setDraftBusy(true);
    setDraftError(null);
    try {
      const saved = await saveCustomerTag({
        id: draft.id,
        name: draft.name.trim(),
        cafe_bp: cafeBp as number | null,
        court_bp: courtBp as number | null,
      });
      toast.ok(
        tr(
          draft.id
            ? 'ws.customerRules.tags.manage.updated'
            : 'ws.customerRules.tags.manage.created',
        ),
      );
      // A tag made from this customer's window is most likely meant for them.
      if (!draft.id && saved?.id && !(self && hasRule(saved)))
        setPicked((p) => new Set(p).add(saved.id));
      setDraft(null);
      setDraftTried(false);
      invalidate(customerId);
    } catch (e) {
      setDraftError(e);
    } finally {
      setDraftBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteCustomerTag(deleting.id);
      toast.ok(tr('ws.customerRules.tags.manage.deleted'));
      setPicked((p) => {
        const n = new Set(p);
        n.delete(deleting.id);
        return n;
      });
      setDeleting(null);
      invalidate(customerId);
    } catch (e) {
      setDeleteError(e);
    } finally {
      setDeleteBusy(false);
    }
  }

  const editing = (t: CatalogTag) =>
    setDraft({
      id: t.id,
      name: t.name,
      cafe: bpToPercentText(t.cafe_bp),
      court: bpToPercentText(t.court_bp),
      same: t.cafe_bp === t.court_bp,
    });
  const anyBusy = busy || draftBusy || deleteBusy;

  return (
    <Modal
      title={tr('ws.customerRules.tags.title', { name: isolate(name) })}
      subtitle={tr('ws.customerRules.tags.lead')}
      dismissible={!anyBusy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={anyBusy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!reachable || draftBusy}
            disabledReason={offline}
            onClick={() => void save()}
            data-testid="tags-save"
          >
            {tr('ws.customerRules.tags.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <EffectiveLine rules={rules} />

        {rules.catalog.length === 0 ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="tags-empty">
            <strong>{tr('ws.customerRules.tags.empty')}</strong>
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {canManage
                ? tr('ws.customerRules.tags.emptyManager')
                : tr('ws.customerRules.tags.emptyStaff')}
            </span>
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 'var(--tp-sp-1)',
            }}
          >
            {rules.catalog.map((t) => {
              // Self: a discount tag they do not carry yet cannot be ticked (SELF_DISCOUNT).
              const locked = self && hasRule(t) && !carried.has(t.id);
              return (
                <li
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-3)',
                    padding: 'var(--tp-sp-2) var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: picked.has(t.id) ? 'var(--tp-accent-soft)' : 'transparent',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      gap: 'var(--tp-sp-3)',
                      alignItems: 'center',
                      flex: '1 1 auto',
                      minInlineSize: 0,
                      cursor: locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(t.id)}
                      disabled={anyBusy || locked}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(t.id);
                          else n.delete(t.id);
                          return n;
                        })
                      }
                      data-testid={`tag-${t.id}`}
                    />
                    <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
                      <span style={{ fontWeight: 600 }}>
                        <bdi>{t.name}</bdi>
                      </span>
                      <span
                        style={{
                          fontSize: 'var(--tp-fs-sm)',
                          color: hasRule(t) ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
                        }}
                      >
                        {ruleWords(t, tr, locale)}
                        {canManage && (
                          <span style={{ color: 'var(--tp-muted-fg)' }}>
                            {' '}
                            · {countPhrase('ws.customerRules.tags.members', t.members, locale)}
                          </span>
                        )}
                      </span>
                      {locked && (
                        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                          {tr('ws.customerRules.tags.selfDiscount')}
                        </span>
                      )}
                    </span>
                  </label>
                  {canManage && (
                    <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flex: 'none' }}>
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="note"
                        disabled={anyBusy}
                        aria-label={tr('ws.customerRules.tags.manage.edit', { name: t.name })}
                        onClick={() => editing(t)}
                      />
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        disabled={anyBusy || !reachable}
                        aria-label={tr('ws.customerRules.tags.manage.delete', { name: t.name })}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(t);
                        }}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ErrorText error={error} />

        {canManage &&
          (draft ? (
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-3)',
                paddingBlockStart: 'var(--tp-sp-3)',
                borderBlockStart: '1px solid var(--tp-border)',
              }}
              data-testid="tag-form"
            >
              <strong>
                {draft.id
                  ? tr('ws.customerRules.tags.manage.edit', { name: draft.name })
                  : tr('ws.customerRules.tags.manage.newTag')}
              </strong>
              <Field
                label={tr('ws.customerRules.tags.manage.name')}
                required
                error={draftTried && nameMissing ? tr('op.errors.NAME_LENGTH') : undefined}
              >
                <input
                  style={inputStyle}
                  value={draft.name}
                  maxLength={40}
                  disabled={draftBusy}
                  placeholder={tr('ws.customerRules.tags.manage.namePlaceholder')}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                  data-testid="tag-name"
                />
              </Field>
              <label
                style={{
                  display: 'inline-flex',
                  gap: 'var(--tp-sp-2)',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.same}
                  disabled={draftBusy}
                  onChange={(e) => setDraft({ ...draft, same: e.target.checked })}
                />
                <span>{tr('ws.customerRules.tags.manage.sameBoth')}</span>
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: draft.same ? '1fr' : 'repeat(auto-fit, minmax(12rem, 1fr))',
                  gap: 'var(--tp-sp-3)',
                }}
              >
                <Field
                  label={
                    draft.same
                      ? tr('ws.customerRules.tags.manage.everything')
                      : tr('ws.customerRules.tags.manage.cafe')
                  }
                  hint={tr('ws.customerRules.tags.manage.percentHint')}
                  error={
                    draftTried && cafeBp === 'invalid'
                      ? tr('ws.customerRules.tags.manage.invalidPercent')
                      : undefined
                  }
                >
                  <input
                    style={inputStyle}
                    inputMode="decimal"
                    dir="ltr"
                    value={draft.cafe}
                    disabled={draftBusy}
                    placeholder="15"
                    onChange={(e) => setDraft({ ...draft, cafe: e.target.value })}
                    data-testid="tag-cafe"
                  />
                </Field>
                {!draft.same && (
                  <Field
                    label={tr('ws.customerRules.tags.manage.court')}
                    error={
                      draftTried && courtBp === 'invalid'
                        ? tr('ws.customerRules.tags.manage.invalidPercent')
                        : undefined
                    }
                  >
                    <input
                      style={inputStyle}
                      inputMode="decimal"
                      dir="ltr"
                      value={draft.court}
                      disabled={draftBusy}
                      placeholder="15"
                      onChange={(e) => setDraft({ ...draft, court: e.target.value })}
                      data-testid="tag-court"
                    />
                  </Field>
                )}
              </div>
              <ErrorText error={draftError} />
              <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
                <Button
                  disabled={draftBusy}
                  onClick={() => {
                    setDraft(null);
                    setDraftTried(false);
                    setDraftError(null);
                  }}
                >
                  {tr('ws.customerRules.tags.manage.cancel')}
                </Button>
                <Button
                  kind="primary"
                  busy={draftBusy}
                  disabled={!reachable}
                  disabledReason={offline}
                  onClick={() => void saveDraft()}
                  data-testid="tag-form-save"
                >
                  {draft.id
                    ? tr('ws.customerRules.tags.manage.update')
                    : tr('ws.customerRules.tags.manage.create')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                icon="plus"
                disabled={anyBusy}
                onClick={() => setDraft(blankDraft())}
                data-testid="tag-new"
              >
                {tr('ws.customerRules.tags.manage.newTag')}
              </Button>
            </div>
          ))}
      </div>

      {deleting && (
        <ConfirmDialog
          open
          kind="danger"
          title={tr('ws.customerRules.tags.manage.deleteTitle', { name: isolate(deleting.name) })}
          body={
            <>
              <p>
                {tr('ws.customerRules.tags.manage.deleteBody', {
                  members: countPhrase('ws.customerRules.tags.members', deleting.members, locale),
                })}
              </p>
              <ErrorText error={deleteError} />
            </>
          }
          confirmLabel={tr('ws.customerRules.tags.manage.deleteConfirm')}
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}
