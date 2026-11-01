/**
 * "Follow every step" on the operator (F-61; 0363 protocol watch): the owner's
 * switch for a notification on every protocol status change, until now only on
 * the phone's Work alerts page. The same RPCs, so the two always agree:
 * app.my_push_prefs reads it (no row = on), app.set_my_push_prefs writes it.
 * Owner only, as the server; nothing is shown to anyone else.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Switch } from '../../components/Switch';
import { readFollowEveryStep } from './protocolLogic';

const PREFS_KEY = ['protocols', 'pushPrefs'] as const;

export function FollowEveryStep() {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PREFS_KEY, queryFn: async () => readFollowEveryStep(await appRpc('my_push_prefs', {})), retry: false });
  if (!q.isSuccess) return null;
  return (
    <div data-testid="protocols.follow" style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
      <Switch
        checked={q.data}
        label={tr('ws.protocols.run.followTitle')}
        onChange={async (next) => {
          await appRpc('set_my_push_prefs', { p_protocol_updates: next });
          qc.setQueryData(PREFS_KEY, next);
        }}
      />
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '22rem', textAlign: 'end' }}>{tr('ws.protocols.run.followHint')}</span>
    </div>
  );
}
