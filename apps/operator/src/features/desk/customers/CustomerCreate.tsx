/**
 * 06.10 CustomerCreateScreen — creates a real guest account at the desk
 * through the staff-gated `desk-customer-create` edge function (build plan
 * §0: the guest can later claim it). Duplicate phone / email and an invalid
 * phone come back as codes and land on the field. States: ready · busy · error.
 *
 * `?attach=match&match=<id>` (open matches operator.md §5.3): the desk was
 * adding a player to an open match and the player had no record yet, so the
 * new customer goes straight back to `/desk/matches/$id?customer=<new id>`,
 * where Add player opens with them picked. `?attach=lesson&lesson=<id>`
 * (coaching operator.md §5.3.2) does the same for a lesson's Add student,
 * back to `/desk/lessons/$id?customer=<new id>`. Otherwise to the new record.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { callEdge, EdgeError, type EdgeFunctionName } from '../../../lib/edge';
import { useToast } from '../../../components/toast';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { MessagePresenter, PageHeader, Panel } from '../../../components/kit';

type Lang = 'en' | 'ar';
type FieldError = 'DUPLICATE_PHONE' | 'DUPLICATE_EMAIL' | 'INVALID_PHONE';
const FIELD_ERRORS: readonly FieldError[] = ['DUPLICATE_PHONE', 'DUPLICATE_EMAIL', 'INVALID_PHONE'];

interface CreateBody {
  fullName: string;
  phone: string;
  email?: string;
  preferredLang: Lang;
}

/** The function name is not in lib/edge's union yet (shell-owned) — proposed for promotion. */
const DESK_CUSTOMER_CREATE = 'desk-customer-create' as EdgeFunctionName;

/**
 * The function answers `{ error: 'DUPLICATE_PHONE' | 'DUPLICATE_EMAIL' |
 * 'INVALID_PHONE', message }` with 409 / 400, and lib/edge.ts keeps that code
 * as EdgeError.code: those three land on their field, anything else is said
 * under the form.
 */
export function fieldErrorOf(e: unknown): FieldError | null {
  if (!(e instanceof EdgeError)) return null;
  return (FIELD_ERRORS as readonly string[]).includes(e.code) ? (e.code as FieldError) : null;
}

export function CustomerCreateScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  // Validated at the route (customerCreateRoute): `match` is set only with
  // attach=match, `lesson` only with attach=lesson.
  const search = useSearch({ strict: false }) as { attach?: 'match' | 'lesson' | 'tournament'; match?: string; lesson?: string; tournament?: string };
  const forMatch = search.attach === 'match' && search.match ? search.match : null;
  const forLesson = search.attach === 'lesson' && search.lesson ? search.lesson : null;
  const forTournament = search.attach === 'tournament' && search.tournament ? search.tournament : null;
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<Lang>(locale);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [touched, setTouched] = useState(false);

  const nameMissing = fullName.trim().length === 0;
  const phoneMissing = phone.trim().length === 0;
  const canSubmit = !busy && !nameMissing && !phoneMissing;

  async function submit() {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const body: CreateBody = { fullName: fullName.trim(), phone: phone.trim(), preferredLang: lang, ...(email.trim() ? { email: email.trim() } : {}) };
      const res = await callEdge<CreateBody, { id: string }>(DESK_CUSTOMER_CREATE, body, { ttlMs: 0 });
      toast.ok(tr('ws.courtDesk.createCustomer.created'));
      // The Customers list is kept in memory; the new record belongs in it now.
      void queryClient.invalidateQueries({ queryKey: ['customerDirectory'] });
      if (forMatch) void navigate({ to: '/desk/matches/$id', params: { id: forMatch }, search: { customer: res.id } as never });
      else if (forLesson) void navigate({ to: '/desk/lessons/$id', params: { id: forLesson }, search: { customer: res.id } as never });
      else if (forTournament) void navigate({ to: '/desk/tournaments/$id', params: { id: forTournament }, search: { customer: res.id } as never });
      else void navigate({ to: '/desk/customers/$id', params: { id: res.id } });
    } catch (e) {
      const fe = fieldErrorOf(e);
      if (fe) setFieldError(fe);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
     * The page takes the full width of the desk shell. Capped at the form
     * measure it was one narrow column against two thirds of empty station
     * monitor; the four fields pair up in a 2-up grid driven by the PANEL
     * instead, so a wide window reads as two short rows and a narrow one still
     * stacks them.
     */
    <div>
      <PageHeader title={tr('ws.courtDesk.createCustomer.title')} subtitle={tr('ws.courtDesk.createCustomer.lead')} />
      {forMatch && <MessagePresenter tone="info" icon="userPlus" message={tr('ws.matches.customers.creatingForMatch')} style={{ marginBlockEnd: '0.75rem' }} />}
      {forLesson && <MessagePresenter tone="info" icon="userPlus" message={tr('ws.coaching.create.creatingForLesson')} style={{ marginBlockEnd: '0.75rem' }} />}
      <Panel bodyClassName="tp-cq">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* Row gap is 0: every Field already carries its own block-end margin. */}
          <div className="tp-grid" data-cols="2" style={{ gap: '0 var(--tp-sp-4)' }}>
            <Field label={tr('ws.courtDesk.createCustomer.name')} required error={touched && nameMissing ? tr('ws.courtDesk.createCustomer.errors.nameRequired') : undefined}>
              <input style={inputStyle} value={fullName} disabled={busy} autoFocus maxLength={200} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field
              label={tr('ws.courtDesk.createCustomer.phone')}
              required
              hint={tr('ws.courtDesk.createCustomer.phoneHint')}
              error={
                fieldError === 'DUPLICATE_PHONE' || fieldError === 'INVALID_PHONE'
                  ? tr(`ws.courtDesk.createCustomer.errors.${fieldError}`)
                  : touched && phoneMissing
                    ? tr('ws.courtDesk.createCustomer.errors.phoneRequired')
                    : undefined
              }
            >
              <input
                style={inputStyle}
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                disabled={busy}
                maxLength={30}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (fieldError === 'DUPLICATE_PHONE' || fieldError === 'INVALID_PHONE') setFieldError(null);
                }}
              />
            </Field>
            <Field label={tr('ws.courtDesk.createCustomer.email')} error={fieldError === 'DUPLICATE_EMAIL' ? tr('ws.courtDesk.createCustomer.errors.DUPLICATE_EMAIL') : undefined}>
              <input
                style={inputStyle}
                dir="ltr"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                disabled={busy}
                maxLength={200}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldError === 'DUPLICATE_EMAIL') setFieldError(null);
                }}
              />
            </Field>
            <Field label={tr('ws.courtDesk.createCustomer.language')}>
              <Select<Lang>
                value={lang}
                disabled={busy}
                onChange={setLang}
                options={[
                  { value: 'en', label: tr('ws.courtDesk.customers.lang.en') },
                  { value: 'ar', label: tr('ws.courtDesk.customers.lang.ar') },
                ]}
              />
            </Field>
          </div>
          <ErrorText error={error} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button kind="ghost" onClick={() => void navigate({ to: '/desk/customers' })}>
              {tr('ws.courtDesk.createCustomer.cancel')}
            </Button>
            <Button type="submit" kind="primary" icon="userPlus" busy={busy} disabled={busy}>
              {tr('ws.courtDesk.createCustomer.submit')}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
