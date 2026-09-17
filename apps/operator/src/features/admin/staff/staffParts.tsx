/** Pieces the staff list and the account panel share. */
import type { StaffRole } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { ErrorText, Field, Select } from '../../../components/ui';
import { MessagePresenter } from '../../../components/kit';
import { ROLES, staffRefusal } from './staffModel';

/** A refusal in this screen's own words when it has them; the shared mapping otherwise. */
export function StaffErrorText({ error }: { error: unknown }) {
  const { tr } = useLocale();
  if (!error) return null;
  const refusal = staffRefusal(error);
  if (refusal) return <MessagePresenter tone="refused" message={tr(`ws.owner.staff.refusals.${refusal}`)} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />;
  return <ErrorText error={error} />;
}

/** The role picker with what the chosen role can open, said beneath it. */
export function RoleField({
  value,
  onChange,
  disabled,
}: {
  value: StaffRole;
  onChange: (role: StaffRole) => void;
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <Field label={tr('op.staff.role')} hint={tr(`ws.owner.staff.roleAccess.${value}`)} style={{ marginBlockEnd: 0 }}>
      <Select<StaffRole> value={value} disabled={disabled} onChange={onChange} options={ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))} />
    </Field>
  );
}

