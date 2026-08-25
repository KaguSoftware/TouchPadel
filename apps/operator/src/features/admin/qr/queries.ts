import type { QueryKey } from '@tanstack/react-query';

/** `app.table_qr_tokens()` — active tables + signed tokens (audited per call). */
export const TABLE_QR_QUERY_KEY: QueryKey = ['tableQrTokens'];
/** Raw `cafe_tables` rows (incl. inactive) for the table editor. */
export const TABLES_QUERY_KEY: QueryKey = ['cafeTables'];

export interface TableTokenRow {
  table_id: string;
  table_number: string;
  zone: string | null;
  capacity: number | null;
  is_active: boolean;
  bell_enabled: boolean;
  token_version: number;
  token: string;
}
