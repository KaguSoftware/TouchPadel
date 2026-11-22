/**
 * The line under a typed name and phone on every desk screen that takes a
 * customer (0448): what happens to this guest. With a number that can be one,
 * they are saved as a customer under it; with a name alone they are saved as
 * an incomplete customer, and the note says a number completes the account.
 * Offline nothing is saved as a customer, and the note says so.
 */
import { isolate } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { useStationReach } from '../../../lib/stationReach';
import { WizardNote } from '../../../components/StepWizard';
import { isDeskPhone } from './deskAccount';

/**
 * Shown on the Who step after a press found the typed number on an account
 * under ANOTHER name (`found.check`): nothing was written, and this says why
 * the screen came back and what the two ways on are.
 */
export function DeskAccountCheckNote({ name }: { name: string }) {
  const { tr } = useLocale();
  return (
    <WizardNote tone="refused" testId="desk-account-check">
      {tr('ws.courtDesk.deskAccount.checkNote', { name: isolate(name) })}
    </WizardNote>
  );
}

export function DeskAccountNote({ phone }: { name?: string; phone: string }) {
  const { tr } = useLocale();
  const { reachable } = useStationReach();
  const key = !reachable ? 'offline' : isDeskPhone(phone) ? 'ready' : 'nameOnly';
  return <WizardNote testId="desk-account-note">{tr(`ws.courtDesk.deskAccount.note.${key}`)}</WizardNote>;
}
