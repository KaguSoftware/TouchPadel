'use client';

import { use, useEffect, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

// Cafe table-bound ordering entry point (Touch Cafe identity: blue + brown #603813).
// Real flow (design-arch.md §4 + §6.2, W2): middleware verifies the printed JWS token
// (ES256, { tid, ver, iat }) → supabase.auth.signInAnonymously() → open_table_session RPC
// stamps { table_id, table_session_exp } into app_metadata via the table-token edge
// function → RLS authorises reads/writes for that table only. Guest order status arrives
// on broadcast topic `session:{id}` (plan override #4). While venue is degraded, guest
// writes raise 'venue_degraded' → "please see a member of staff" (design-arch.md §3.4).
export default function TableSessionPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = use(params);
  const ar = locale === 'ar';
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');

  useEffect(() => {
    const supabase = createBrowserSupabase();
    // TODO(W2): STUB — open_table_session does not exist yet (RPC lands with the
    // table-token migration; see design-data.md). Replace with the real bind + error
    // mapping (invalid token / stale ver / degraded venue).
    void supabase.rpc('open_table_session', { p_token: token }).then(({ error }) => {
      setStatus(error ? 'error' : 'ready');
    });
  }, [token]);

  return (
    // data-theme override: cafe subtree uses the Touch Cafe palette (HANDOFF brands).
    <main data-theme="cafe" style={{ padding: '2rem', maxInlineSize: '32rem', marginInline: 'auto' }}>
      <h1>{ar ? 'تاتش كافيه' : 'Touch Cafe'}</h1>
      {status === 'connecting' && <p>{ar ? 'جارٍ ربط الطاولة…' : 'Linking your table…'}</p>}
      {status === 'ready' && <p>{ar ? 'الطاولة مرتبطة — القائمة قريباً.' : 'Table linked — menu coming soon.'}</p>}
      {status === 'error' && (
        <p>{ar ? 'يرجى مراجعة أحد الموظفين.' : 'Please see a member of staff.'}</p>
      )}
    </main>
  );
}
