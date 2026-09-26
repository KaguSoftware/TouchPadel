/**
 * protocol-action, the pure half (build-contracts-2026-09-23 §2.20): request
 * parsing, the menu photo path, and the two flows written against injected
 * ports, so the DB vitest suite runs them without Deno, storage or a model
 * (tests/protocol-action.test.ts). index.ts wires the ports to Supabase.
 *
 *   launch (owner session)  for `now`, copy the chosen staff-media photo to
 *                           menu-media/items/<menu_item_id>/<run_id>.<ext>
 *                           (a retry overwrites the same object; a launch
 *                           that went through already shows it, so a retry
 *                           copies nothing), then send the launch step with
 *                           the caller's JWT and the record {when, photo_path,
 *                           menu_photo_path}; a refused step takes its copy
 *                           back out of the public bucket. For `date`, send
 *                           it without copying.
 *   tick (service role)     the due scheduled launches (copy, then
 *                           app.release_launch_scheduled; a launch that
 *                           reverts, is skipped or fails takes its copy back
 *                           out), then the photo purge of runs stopped or
 *                           withdrawn 90 days ago.
 *
 * Errors keep the SQL contract: a refused RPC passes through mapPgError as
 * {error: '<CODE>', message, hint} with its status, and a malformed body is
 * {error: 'BAD_REQUEST'} (the phone reads it as errors.validation).
 */
import { mapPgError, type PgError } from '../_shared/http.ts';

/** A staff-media path (0159, the ten folders of staff_media_incidents). */
export const STAFF_MEDIA_PATH_RE =
  /^[0-9a-f-]{36}\/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests|incidents)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PhotoExt = 'jpg' | 'png' | 'webp';

export interface LaunchRequest {
  action: 'launch';
  run_step_id: string;
  when: 'now' | 'date';
  at: string | null;
  photo_path: string;
  idempotency_key: string | null;
}
export interface TickRequest {
  action: 'tick';
}
export type ProtocolActionRequest = LaunchRequest | TickRequest;

export type Parsed = { ok: true; value: ProtocolActionRequest } | { ok: false; message: string };

/** The body, checked for shape only: the launch check in SQL is the authority on the record. */
export function parseRequest(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  if (b.action === 'tick') return { ok: true, value: { action: 'tick' } };
  if (b.action !== 'launch') return { ok: false, message: "action must be 'launch' or 'tick'" };
  if (typeof b.run_step_id !== 'string' || !UUID_RE.test(b.run_step_id)) return { ok: false, message: 'run_step_id must be a uuid' };
  if (b.when !== 'now' && b.when !== 'date') return { ok: false, message: "when must be 'now' or 'date'" };
  if (typeof b.photo_path !== 'string' || !STAFF_MEDIA_PATH_RE.test(b.photo_path)) {
    return { ok: false, message: 'photo_path must be a staff-media photo path' };
  }
  const at = b.at === undefined || b.at === null ? null : b.at;
  if (at !== null && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) return { ok: false, message: 'at must be a timestamp' };
  if (b.when === 'date' && at === null) return { ok: false, message: 'a launch on a date needs at' };
  const key = b.idempotency_key === undefined || b.idempotency_key === null ? null : b.idempotency_key;
  if (key !== null && (typeof key !== 'string' || key.length === 0 || key.length > 200)) {
    return { ok: false, message: 'idempotency_key must be a short string' };
  }
  return {
    ok: true,
    value: {
      action: 'launch',
      run_step_id: b.run_step_id.toLowerCase(),
      when: b.when,
      at: b.when === 'date' ? (at as string) : null,
      photo_path: b.photo_path,
      idempotency_key: key as string | null,
    },
  };
}

export function extOf(path: string): PhotoExt | null {
  const m = /\.(jpg|png|webp)$/.exec(path);
  return m ? (m[1] as PhotoExt) : null;
}

export function contentTypeOf(ext: PhotoExt): string {
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

/**
 * The only menu path a launch writes: `items/<menu_item_id>/<run_id>.<ext>`,
 * app.release_menu_photo_path's twin, derived from the run so a retry
 * overwrites the same object.
 */
export function menuPhotoPath(menuItemId: string, runId: string, photoPath: string): string | null {
  const ext = extOf(photoPath);
  return ext ? `items/${menuItemId}/${runId}.${ext}` : null;
}

/** The launch step's record, as app.protocol_check_product_release_launch reads it. */
export function launchRecord(req: LaunchRequest, menuPath: string | null): Record<string, unknown> {
  return req.when === 'now'
    ? { when: 'now', photo_path: req.photo_path, menu_photo_path: menuPath }
    : { when: 'date', at: req.at, photo_path: req.photo_path };
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/** A refused RPC as the function answers it: mapPgError's code and status, with the hint. */
export function refusal(err: PgError & { hint?: string | null }): HttpResult {
  const m = mapPgError(err);
  return { status: m.status, body: { error: m.code, message: m.message, hint: err.hint ?? null } };
}

export interface LaunchStep {
  run_id: string;
  menu_item_id: string | null;
  step_key: string | null;
  kind: string;
  /** The run's photos a launch may choose (app.release_run_photos). */
  photos: string[];
}

export interface RpcAnswer {
  data: unknown;
  error: (PgError & { hint?: string | null }) | null;
}

/** The public menu bucket, as the launch and the tick touch it. */
export interface MenuPhotoPorts {
  /** Whether the menu item's photo is this menu-media path already (its launch went through). */
  menuPhotoInUse(menuItemId: string, path: string): Promise<boolean>;
  /** Removes one menu-media object. Throws on failure. */
  removeMenuPhoto(path: string): Promise<void>;
  log(message: string): void;
}

export interface LaunchPorts extends MenuPhotoPorts {
  /** The step, its run, and the run's choosable photos; null when there is no such step. */
  step(runStepId: string): Promise<LaunchStep | null>;
  /** staff-media → menu-media, overwriting. Throws on failure. */
  copyPhoto(from: string, to: string, contentType: string): Promise<void>;
  /** app.submit_step with the CALLER's JWT, so the engine sees the owner. */
  submit(runStepId: string, record: Record<string, unknown>, idempotencyKey: string | null): Promise<RpcAnswer>;
}

/**
 * A copy that no launch took is taken back out of the public bucket, so an
 * unreleased item's test photo is never served. The item's own photo (a
 * launch that went through meanwhile) is kept. A failed removal is logged,
 * never thrown: the answer the caller gets is the launch's.
 */
async function discardMenuPhoto(ports: MenuPhotoPorts, menuItemId: string, path: string): Promise<void> {
  try {
    if (!(await ports.menuPhotoInUse(menuItemId, path))) await ports.removeMenuPhoto(path);
  } catch (e) {
    ports.log(`remove ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The owner's launch. The photo is checked against the run before anything is
 * copied, so nothing but one of this run's own test or marketing photos ever
 * lands in the public menu bucket; the SQL check runs again on the submit.
 */
export async function launch(req: LaunchRequest, ports: LaunchPorts): Promise<HttpResult> {
  const step = await ports.step(req.run_step_id);
  if (!step || step.kind !== 'product_release' || step.step_key !== 'launch') {
    return { status: 404, body: { error: 'PROTOCOL_NOT_FOUND', message: 'PROTOCOL_NOT_FOUND', hint: null } };
  }
  if (!step.photos.includes(req.photo_path)) {
    return { status: 400, body: { error: 'RECORD_INVALID', message: 'RECORD_INVALID', hint: 'photo_path' } };
  }

  let menuPath: string | null = null;
  let copied = false;
  if (req.when === 'now') {
    if (!step.menu_item_id) {
      return { status: 400, body: { error: 'RELEASE_NOT_READY', message: 'RELEASE_NOT_READY', hint: 'names' } };
    }
    menuPath = menuPhotoPath(step.menu_item_id, step.run_id, req.photo_path);
    if (!menuPath) return { status: 400, body: { error: 'RECORD_INVALID', message: 'RECORD_INVALID', hint: 'photo_path' } };
    // A launch that went through shows this path already: a retry sends the
    // step again (its key replays the answer) and never copies over the live
    // menu photo.
    if (!(await ports.menuPhotoInUse(step.menu_item_id, menuPath))) {
      try {
        await ports.copyPhoto(req.photo_path, menuPath, contentTypeOf(extOf(req.photo_path)!));
      } catch (e) {
        return { status: 502, body: { error: 'UPSTREAM', message: `photo copy failed: ${e instanceof Error ? e.message : String(e)}`, hint: null } };
      }
      copied = true;
    }
  }

  const res = await ports.submit(req.run_step_id, launchRecord(req, menuPath), req.idempotency_key);
  if (res.error) {
    if (copied && menuPath) await discardMenuPhoto(ports, step.menu_item_id!, menuPath);
    return refusal(res.error);
  }
  return { status: 200, body: (res.data ?? {}) as Record<string, unknown> };
}

export interface DueLaunch {
  run_id: string;
  venue_id: string;
  menu_item_id: string | null;
  photo_path: string | null;
}

export interface PurgeDue {
  run_id: string;
  paths: string[];
}

export interface TickPorts extends MenuPhotoPorts {
  dueLaunches(): Promise<DueLaunch[]>;
  copyPhoto(from: string, to: string, contentType: string): Promise<void>;
  /** app.release_launch_scheduled: 'launched' | 'reverted' | 'skipped'. Throws on a refusal. */
  launchScheduled(runId: string, menuPath: string): Promise<string>;
  purgeDue(): Promise<PurgeDue[]>;
  /** Removes staff-media objects. Throws on failure. */
  removePhotos(paths: string[]): Promise<void>;
  markPurged(runId: string): Promise<void>;
}

export interface TickResult {
  launched: number;
  reverted: number;
  skipped: number;
  failed: number;
  purged: number;
}

/** One pass of the 5-minute tick. One bad run never stops the others. */
export async function tick(ports: TickPorts): Promise<TickResult> {
  const out: TickResult = { launched: 0, reverted: 0, skipped: 0, failed: 0, purged: 0 };

  for (const due of await ports.dueLaunches()) {
    const menuPath = due.menu_item_id && due.photo_path ? menuPhotoPath(due.menu_item_id, due.run_id, due.photo_path) : null;
    if (!menuPath || !due.photo_path) {
      out.failed += 1;
      ports.log(`launch ${due.run_id}: no draft or no chosen photo`);
      continue;
    }
    let copied = false;
    try {
      await ports.copyPhoto(due.photo_path, menuPath, contentTypeOf(extOf(due.photo_path)!));
      copied = true;
      const status = await ports.launchScheduled(due.run_id, menuPath);
      if (status === 'launched') {
        out.launched += 1;
        continue;
      }
      if (status === 'reverted') out.reverted += 1;
      else out.skipped += 1;
    } catch (e) {
      out.failed += 1;
      ports.log(`launch ${due.run_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Not launched: the copy goes back out of the public bucket.
    if (copied) await discardMenuPhoto(ports, due.menu_item_id!, menuPath);
  }

  for (const run of await ports.purgeDue()) {
    try {
      const paths = run.paths.filter((p) => STAFF_MEDIA_PATH_RE.test(p));
      if (paths.length > 0) await ports.removePhotos(paths);
      await ports.markPurged(run.run_id);
      out.purged += 1;
    } catch (e) {
      out.failed += 1;
      ports.log(`purge ${run.run_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
