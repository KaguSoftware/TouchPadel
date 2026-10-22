/**
 * The new-booking dialog's gender line (0353): one quiet line when the chosen
 * court and time are kept for women or men, and, with a customer picked, what
 * that means for them. A customer with no gender on their record gets "Set
 * gender" right here (GenderDialog, app.staff_set_customer_gender), so the
 * desk never has to leave the booking to fix what the server would refuse
 * (GENDER_REQUIRED). A booking under a typed name only is not judged by the
 * server, so it gets the plain line and nothing more.
 */
import { useMemo, useState } from 'react';
import { genderVerdict, keptFor, slotGenderRules, type Gender } from '@touch/core';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { WizardNote } from '../../components/StepWizard';
import { GenderDialog } from './customers/GenderDialog';
import { useGenderRules } from './GenderBands';
import type { PickedCustomer } from './customers/CustomerPicker';

/** The genders the period on the court is kept for ([] when open), from the branch's rules. */
export function useSlotKept(courtId: string, startAt: Date, endAt: Date, tz: string): Gender[] {
  const rules = useGenderRules();
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  return useMemo(
    () => (courtId ? slotGenderRules(rules, courtId, new Date(startMs), new Date(endMs), tz) : []),
    [rules, courtId, startMs, endMs, tz],
  );
}

/**
 * Whether the server would refuse this booking for its customer: a customer
 * whose gender is known (null = none on the record) on a kept slot that is
 * not theirs. Unknown (a read that did not carry it) never blocks.
 */
export function genderBlocksBooking(kept: readonly Gender[], customer: PickedCustomer | null): boolean {
  if (!customer || customer.gender === undefined) return false;
  const v = genderVerdict(kept, customer.gender);
  return v === 'gender_required' || v === 'restricted';
}

export function GenderSlotNote({
  kept,
  customer,
  disabled,
  onCustomerGender,
}: {
  kept: readonly Gender[];
  customer: PickedCustomer | null;
  disabled?: boolean;
  onCustomerGender: (gender: Gender) => void;
}) {
  const { tr } = useLocale();
  const [asking, setAsking] = useState(false);
  const one = keptFor(kept);
  if (!one) return null;

  const plain = one === 'female' ? tr('ws.genderHours.booking.womenOnly') : one === 'male' ? tr('ws.genderHours.booking.menOnly') : tr('ws.genderHours.booking.both');
  const known = customer && customer.gender !== undefined;
  const verdict = known ? genderVerdict(kept, customer.gender) : 'open';

  let body;
  if (verdict === 'gender_required' && customer) {
    body = (
      <div data-testid="gender-slot-note" style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 18rem' }}>
          <WizardNote tone="refused">{`${plain} ${tr('ws.genderHours.booking.needsGender')}`}</WizardNote>
        </div>
        <Button size="sm" icon="user" disabled={disabled} onClick={() => setAsking(true)}>
          {tr('ws.genderHours.booking.setGender')}
        </Button>
      </div>
    );
  } else if (verdict === 'restricted' && one !== 'both') {
    body = (
      <WizardNote tone="refused">{tr(one === 'female' ? 'ws.genderHours.booking.notWomen' : 'ws.genderHours.booking.notMen')}</WizardNote>
    );
  } else {
    // Quiet: the kept time is information until it decides something.
    body = (
      <WizardNote tone={one === 'both' ? 'refused' : 'info'} testId="gender-slot-note">
        {plain}
      </WizardNote>
    );
  }

  return (
    <>
      {body}
      {asking && customer && (
        <GenderDialog
          customerId={customer.id}
          current={customer.gender ?? null}
          onClose={() => setAsking(false)}
          onSaved={(g) => {
            setAsking(false);
            onCustomerGender(g);
          }}
        />
      )}
    </>
  );
}
