/**
 * protocol-action (build-contracts-2026-09-23 §2.20; plan §5.1 "Launch").
 *
 *   POST {action:'launch', run_step_id, when:'now'|'date', at?, photo_path, idempotency_key}
 *     owner session (requireStaffRole ['owner']). For `now` the chosen photo
 *     is copied from staff-media to menu-media/items/<menu_item_id>/<run_id>.<ext>
 *     first (storage.copy with destinationBucket; download and upload over it
 *     when that is refused, a retry's existing object included), then the
 *     launch step is sent through app.submit_step WITH THE CALLER'S JWT, so
 *     the engine sees the owner and the launch check accepts exactly that
 *     path, copied. A refused step has its copy removed again. Returns the
 *     submit_step result.
 *   POST {action:'tick'}
 *     service role (cron tp_protocol_tick through app.protocol_tick_nudge):
 *     the due scheduled launches, then the photo purge, then the photos of
 *     incident reports past their purge date, then the incidents and campaigns
 *     photos nobody claimed within a day. Returns
 *     {launched, reverted, skipped, failed, purged, incidents_purged, orphans_purged}.
 *
 * verify_jwt = true (config.toml). The flows are in logic.ts, pure.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireStaffRole } from '../_shared/auth.ts';
import { json } from '../_shared/http.ts';
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import {
  launch,
  parseRequest,
  tick,
  type DueLaunch,
  type IncidentPurgeDue,
  type LaunchPorts,
  type LaunchStep,
  type PurgeDue,
  type TickPorts,
} from './logic.ts';

const STAFF_BUCKET = 'staff-media';
const MENU_BUCKET = 'menu-media';

function callerClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
}

/** staff-media → menu-media. A copy onto an existing object is refused, so the fallback overwrites. */
async function copyPhoto(service: SupabaseClient, from: string, to: string, contentType: string): Promise<void> {
  const copied = await service.storage.from(STAFF_BUCKET).copy(from, to, { destinationBucket: MENU_BUCKET });
  if (!copied.error) return;
  const file = await service.storage.from(STAFF_BUCKET).download(from);
  if (file.error || !file.data) throw new Error(`download ${from}: ${file.error?.message ?? 'no data'}`);
  const up = await service.storage.from(MENU_BUCKET).upload(to, file.data, { upsert: true, contentType });
  if (up.error) throw new Error(`upload ${to}: ${up.error.message}`);
}

/** The menu item's photo is this path: its launch went through. */
async function menuPhotoInUse(service: SupabaseClient, menuItemId: string, path: string): Promise<boolean> {
  const { data, error } = await service.from('menu_items').select('photo_path').eq('id', menuItemId).maybeSingle();
  if (error) throw new Error(`menu item ${menuItemId}: ${error.message}`);
  return (data as { photo_path: string | null } | null)?.photo_path === path;
}

async function removeMenuPhoto(service: SupabaseClient, path: string): Promise<void> {
  const { error } = await service.storage.from(MENU_BUCKET).remove([path]);
  if (error) throw new Error(`remove ${path}: ${error.message}`);
}

const log = (message: string) => console.error('[protocol-action]', message);

function launchPorts(service: SupabaseClient, req: Request): LaunchPorts {
  const caller = callerClient(req);
  return {
    menuPhotoInUse: (menuItemId, path) => menuPhotoInUse(service, menuItemId, path),
    removeMenuPhoto: (path) => removeMenuPhoto(service, path),
    log,
    async step(runStepId): Promise<LaunchStep | null> {
      const { data: step, error } = await service
        .from('protocol_run_steps')
        .select('id, run_id, step_key, protocol_runs!inner(id, kind, menu_item_id)')
        .eq('id', runStepId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!step) return null;
      const run = (step as unknown as { protocol_runs: { id: string; kind: string; menu_item_id: string | null } }).protocol_runs;
      const photos = await service.schema('app').rpc('release_run_photos', { p_run_id: run.id });
      if (photos.error) throw new Error(photos.error.message);
      return {
        run_id: run.id,
        kind: run.kind,
        menu_item_id: run.menu_item_id,
        step_key: (step as { step_key: string | null }).step_key,
        photos: (photos.data as string[] | null) ?? [],
      };
    },
    copyPhoto: (from, to, contentType) => copyPhoto(service, from, to, contentType),
    async submit(runStepId, record, idempotencyKey) {
      const { data, error } = await caller.schema('app').rpc('submit_step', {
        p_run_step_id: runStepId,
        p_record: record,
        p_photos: [],
        p_idempotency_key: idempotencyKey,
      });
      return { data, error };
    },
  };
}

function tickPorts(service: SupabaseClient): TickPorts {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await service.schema('app').rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    menuPhotoInUse: (menuItemId, path) => menuPhotoInUse(service, menuItemId, path),
    removeMenuPhoto: (path) => removeMenuPhoto(service, path),
    log,
    dueLaunches: async () => ((await rpc('release_due_launches', { p_limit: 10 })) as DueLaunch[] | null) ?? [],
    copyPhoto: (from, to, contentType) => copyPhoto(service, from, to, contentType),
    launchScheduled: async (runId, menuPath) =>
      String(await rpc('release_launch_scheduled', { p_run_id: runId, p_menu_photo_path: menuPath })),
    purgeDue: async () => ((await rpc('protocol_photo_purge_due', { p_limit: 20 })) as PurgeDue[] | null) ?? [],
    async removePhotos(paths) {
      const { error } = await service.storage.from(STAFF_BUCKET).remove(paths);
      if (error) throw new Error(`remove: ${error.message}`);
    },
    markPurged: async (runId) => {
      await rpc('protocol_photos_purged', { p_run_id: runId });
    },
    incidentPurgeDue: async () =>
      ((await rpc('incident_photo_purge_due', { p_limit: 20 })) as IncidentPurgeDue[] | null) ?? [],
    markIncidentPurged: async (incidentId) => {
      await rpc('incident_photos_purged', { p_id: incidentId });
    },
    orphanPurgeDue: async () => ((await rpc('staff_media_orphan_purge_due', { p_limit: 50 })) as string[] | null) ?? [],
    markOrphansPurged: async (paths) => {
      await rpc('staff_media_orphans_purged', { p_paths: paths });
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const parsed = parseRequest(body);
  if ('message' in parsed) return json({ error: 'BAD_REQUEST', message: parsed.message }, 400);

  const service = createServiceClient();
  try {
    if (parsed.value.action === 'tick') {
      if (!isServiceRoleRequest(req)) return json({ error: 'FORBIDDEN', message: 'service role only' }, 403);
      return json(await tick(tickPorts(service)));
    }

    const auth = await requireStaffRole(req, service, ['owner']);
    if (auth instanceof Response) return auth;
    const res = await launch(parsed.value, launchPorts(service, req));
    return json(res.body, res.status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[protocol-action] failed', parsed.value.action, message);
    return json({ error: 'INTERNAL', message }, 500);
  }
});
