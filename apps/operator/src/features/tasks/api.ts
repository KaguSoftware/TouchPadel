/**
 * My tasks' shared read, apart from the page so the kitchen board's My tasks
 * count can make it without loading the page (build-contracts-2026-09-23 §5.1).
 */
import { appRpc } from '../../lib/appRpc';

/** TK.work: app.my_protocol_work as returned. */
export function fetchMyWork(): Promise<unknown> {
  return appRpc<unknown>('my_protocol_work', {});
}
