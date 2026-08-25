/**
 * app.* RPC names introduced by the cafe-rebuild migrations (db-slice.md
 * 0027–0034). The generated Database types do not carry them yet, so callers
 * use `appRpcUntyped(RPC.X, args)` — switch to typed `appRpc` after
 * `pnpm db:types`. One map so a server-side rename is a single edit.
 */
export const RPC = {
  SET_CAFE_SETTING: 'set_cafe_setting',
  SET_ITEM_PHOTO: 'set_item_photo',
  SET_CATEGORY_PHOTO: 'set_category_photo',
  SET_ITEM_SOLD_OUT: 'set_item_sold_out',
  SET_ITEM_COST: 'set_item_cost',
  SET_MODIFIER_REVEALS: 'set_modifier_reveals',
  SET_TABLE_BELL: 'set_table_bell',
  UPSERT_CAFE_TABLE: 'upsert_cafe_table',
  TABLE_QR_TOKENS: 'table_qr_tokens',
  SET_WAITER_CALL_COOLDOWN: 'set_waiter_call_cooldown',
  TELEGRAM_SEND_TEST: 'telegram_send_test',
  RETRY_TELEGRAM_OUTBOX: 'retry_telegram_outbox',
  SAVE_ANALYTICS_INSIGHTS: 'save_analytics_insights',
  SAVE_ANALYTICS_PATTERNS: 'save_analytics_patterns',
  REJECT_INSIGHT: 'reject_insight',
  UNREJECT_INSIGHT: 'unreject_insight',
} as const;

export type RpcName = (typeof RPC)[keyof typeof RPC];
