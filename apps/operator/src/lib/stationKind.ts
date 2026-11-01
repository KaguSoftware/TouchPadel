/**
 * Which screens a station's kind may open (F-29).
 *
 * A station is set up as one kind (station.json `mode`, the same kind
 * app.register_station files it as): the café till, the court desk, a kitchen
 * screen or the shop station. Until 2026-11-01 neither /shop nor /kds asked,
 * so a manager could ring up shop sales on the café till and the cash landed
 * in the café till's open shift. The money screens of the shop (its till and
 * its drawer) now open on the shop station only, and the kitchen board on a
 * kitchen screen or the café till (which it is paired with).
 *
 * Browser mode (vite dev, Playwright, a manager's browser tab) is not a
 * station: there is no drawer and no till shift on this machine, so nothing
 * it sells can land in another till's shift — the server files a sale by the
 * x-station-id header, and a browser sends the dev id, not a registered
 * till's. It keeps today's behaviour. An Electron machine always has a kind
 * (an unconfigured one shows the setup screen first), so the owner's office
 * PC is held to its own kind too: it is exactly the cross-till case.
 */
import type { StationMode } from '../ipc/bridge';

export type StationScreen = 'shopTill' | 'kds';

const ALLOWED: Record<StationScreen, readonly StationMode[]> = {
  shopTill: ['shop'],
  kds: ['kds', 'till'],
};

/** Null when this station may open the screen; else its own kind, for the refusal. */
export function stationKindRefusal(screen: StationScreen, station: { electron: boolean; mode: StationMode }): StationMode | null {
  if (!station.electron) return null;
  return ALLOWED[screen].includes(station.mode) ? null : station.mode;
}

/** The shop's paths that take money: its till (the index) and its drawer. */
export function shopPathTakesMoney(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p === '/shop' || p === '/shop/drawer' || p.startsWith('/shop/drawer/');
}
