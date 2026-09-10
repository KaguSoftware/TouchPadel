/**
 * 06.10 CustomerCreateScreen — creates a real guest account at the desk
 * through the staff-gated `desk-customer-create` edge function (build plan
 * §0: the guest can later claim it). Duplicate phone / email and an invalid
 * phone come back as codes and land on the field. States: ready · busy · error.
 */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { callEdge, EdgeError, type EdgeFunctionName } from '../../../lib/edge';
import { useToast } from '../../../components/toast';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { PageHeader, Panel } from '../../../components/kit';

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
 * The function answers `{ error: 'DUPLICATE_PHONE', message }` with 409 / 400.
 * lib/edge.ts lifts only a `code` field into EdgeError.detail, so the exact
 * code is not available here yet (proposed: read `error` too). Until then:
 * the code when present, else the HTTP status plus the message's subject.
 */
export function fieldErrorOf(e: unknown): FieldError | null {
  if (!(e instanceof EdgeError)) return null;
  for (const candidate of [e.detail, e.message]) {
    if (candidate && (FIELD_ERRORS as readonly string[]).includes(candidate)) return candidate as FieldError;
  }
  const msg = e.message.toLowerCase();
  if (e.status === 409) return msg.includes('email') && !msg.includes('phone') ? 'DUPLICATE_EMAIL' : 'DUPLICATE_PHONE';
  if (e.status === 400 && msg.includes('phone')) return 'INVALID_PHONE';
  return null;
}

export function CustomerCreateScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<Lang>(locale);
  const [busy, setBusy] = useState(false);
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
      void navigate({ to: '/desk/customers/$id', params: { id: res.id } });
    } catch (e) {
      const fe = fieldErrorOf(e);
      if (fe) setFieldError(fe);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)' }}>
      <PageHeader title={tr('ws.courtDesk.createCustomer.title')} subtitle={tr('ws.courtDesk.createCustomer.lead')} />
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
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
          <ErrorText error={error} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Link to="/desk/customers" className="tp-btn" data-kind="ghost" data-size="md">
              {tr('ws.courtDesk.createCustomer.cancel')}
            </Link>
            <Button type="submit" kind="primary" icon="userPlus" busy={busy} disabled={busy}>
              {tr('ws.courtDesk.createCustomer.submit')}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
