/**
 * Place an order (0251): the floor, the menu, and the one write. The phone
 * calls no till RPC (__tests__/noStationRpc.test.ts): place_floor_order opens
 * the tab or adds to it and sends the order to the kitchen on the server.
 */
import { staffRpc } from '../api';
import { readFloor, readMenu, type Floor, type MenuCategory, type SendArgs } from './logic';

export async function fetchFloor(venueId: string): Promise<Floor> {
  return readFloor(await staffRpc<unknown>('floor_tables', { p_venue_id: venueId }));
}

export async function fetchFloorMenu(venueId: string): Promise<MenuCategory[]> {
  return readMenu(await staffRpc<unknown>('floor_menu', { p_venue_id: venueId }));
}

export interface PlacedOrder {
  tab_id: string;
  opened: boolean;
  order_id: string | null;
  ticket_id: string | null;
  duplicate?: boolean;
}

export function placeFloorOrder(args: SendArgs, key: string): Promise<PlacedOrder> {
  return staffRpc<PlacedOrder>('place_floor_order', { ...args, p_idempotency_key: key });
}
