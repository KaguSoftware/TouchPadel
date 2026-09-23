/** Pieces the staff list and the account panel share. */
import type { StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { ErrorText, Field, Select } from '../../../components/ui';
import { MessagePresenter } from '../../../components/kit';
import { roleChoices, staffRefusal } from './staffModel';

/** A refusal in this screen's own words when it has them; the shared mapping otherwise. */
export function StaffErrorText({ error }: { error: unknown }) {
  const { tr } = useLocale();
  if (!error) return null;
  const refusal = staffRefusal(error);
  if (refusal) return <MessagePresenter tone="refused" message={tr(`ws.owner.staff.refusals.${refusal}`)} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />;
  return <ErrorText error={error} />;
}

/**
 * The role picker with what the chosen role can open, said beneath it.
 * `current` is the role the account holds now: when it is retired (prep,
 * 0155) the picker still names it, greyed out, and the hint beneath says to
 * move the person on. A new account has no current role, so it never sees
 * prep at all.
 *
 * `flush` drops the field's own bottom margin for the account panel, whose
 * Section already spaces it; the add dialog keeps the normal gap, or its
 * one-sentence hint sits against the Password label below it.
 */
export function RoleField({
  value,
  current,
  onChange,
  disabled,
  flush,
}: {
  value: StaffRole;
  current?: StaffRole;
  onChange: (role: StaffRole) => void;
  disabled?: boolean;
  flush?: boolean;
}) {
  const { tr } = useLocale();
  const options = roleChoices(current ?? value).map((c) => ({ value: c.role, label: tr(`op.roles.${c.role}`), disabled: c.retired }));
  return (
    <Field label={tr('op.staff.role')} hint={tr(`ws.owner.staff.roleAccess.${value}`)} style={flush ? { marginBlockEnd: 0 } : undefined}>
      <Select<StaffRole> value={value} disabled={disabled} onChange={onChange} options={options} />
    </Field>
  );
}

