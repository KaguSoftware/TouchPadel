/**
 * "Paid from: Safe | Bank transfer" (0344), Safe preselected by the caller.
 * Safe takes the money out of the main cash (القاصة); a bank transfer is
 * recorded beside it and moves nothing there. The hint under the control says
 * which, so the choice reads as a consequence and not a label.
 */
import { Field } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import type { PaidFrom } from './wagesLogic';

export function PaidFromField({ value, onChange, testId, disabled }: { value: PaidFrom; onChange: (v: PaidFrom) => void; testId: string; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.wages.paidFrom.label')} hint={tr(value === 'safe' ? 'ws.wages.paidFrom.safeHint' : 'ws.wages.paidFrom.bankHint')} group style={{ marginBlockEnd: 0 }}>
      <SegmentedControl<PaidFrom>
        value={value}
        onChange={onChange}
        options={[
          { value: 'safe', label: tr('ws.wages.paidFrom.safe'), testId: `${testId}.safe`, disabled },
          { value: 'bank', label: tr('ws.wages.paidFrom.bank'), testId: `${testId}.bank`, disabled },
        ]}
      />
    </Field>
  );
}
