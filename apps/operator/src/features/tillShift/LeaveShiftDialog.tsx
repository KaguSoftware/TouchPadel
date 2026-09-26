/**
 * The leaving guard (wave5-addendum §5.1, §6.2): Sign out while one's own shift
 * is open here asks first. Ending the shift is the way the contract draws it
 * (blind count, own PIN, result, Sign out), so it is the primary action; signing
 * out anyway is allowed, and says what it leaves behind: the shift stays open
 * on this till until a manager closes it.
 */
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';

export function LeaveShiftDialog({ onCancel, onSignOut, onEndShift }: { onCancel: () => void; onSignOut: () => void; onEndShift: () => void }) {
  const { tr } = useLocale();
  return (
    <Modal
      title={tr('ws.tillShift.leave.title')}
      size="sm"
      onClose={onCancel}
      footer={(close) => (
        <>
          <Button onClick={close}>{tr('common.cancel')}</Button>
          <Button onClick={onSignOut} data-testid="leave.signOutAnyway">
            {tr('ws.tillShift.leave.signOut')}
          </Button>
          <Button kind="primary" icon="lock" autoFocus onClick={onEndShift}>
            {tr('ws.tillShift.leave.end')}
          </Button>
        </>
      )}
    >
      <p style={{ lineHeight: 1.5 }}>{tr('ws.tillShift.leave.body')}</p>
    </Modal>
  );
}
