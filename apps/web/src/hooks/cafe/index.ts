/** Cafe guest-app hooks (web-slice §2). Pure reducers live beside them in *.ts. */
export { useSupabase } from './useSupabase';
export { useOnline } from './useOnline';
export { useTableSession, forgetTableBoot } from './useTableSession';
export type { TableSession, TableSessionState, UseTableSession } from './useTableSession';
export { useMenu } from './useMenu';
export type { UseMenu } from './useMenu';
export { useBasket } from './useBasket';
export type { UseBasket, BasketToast } from './useBasket';
export { useSessionChannel } from './useSessionChannel';
export type {
  SessionChannelHandlers,
  OrderStatusPayload,
  WaiterCallStatusPayload,
} from './useSessionChannel';
export { useOrders } from './useOrders';
export type { UseOrders } from './useOrders';
export {
  ordersPartition,
  orderStepIndex,
  orderTotal,
  isLiveStatus,
  ORDER_STEPS,
  SERVED_GRACE_MS,
} from './orders';
export type { GuestOrder, GuestOrderItem, GuestOrderStatus } from './orders';
export { useWaiterCall, DEFAULT_COOLDOWN_SECONDS } from './useWaiterCall';
export type { UseWaiterCall, WaiterReason, RaiseResult } from './useWaiterCall';
export { waiterPhase, formatCooldown, isCallOpen, cooldownStorageKey, cooldownLeftMs } from './waiter';
export type { WaiterCall, WaiterCallStatus, WaiterPhase } from './waiter';
export { useVenueMode } from './useVenueMode';
export { useScrollSpy } from './useScrollSpy';
export { scrollSpyPick } from './scrollSpy';
export type { SectionOffset } from './scrollSpy';
export { useSheetDrag } from './useSheetDrag';
export type { UseSheetDrag, SheetDragOptions } from './useSheetDrag';
export { useItemDwell } from './useItemDwell';
