import type { QueryKey } from '@tanstack/react-query';
import { QK } from '../../../lib/queries';

/** `app.table_qr_tokens()` — active tables + signed tokens (audited per call). */
export const TABLE_QR_QUERY_KEY: QueryKey = ['tableQrTokens'];
/**
 * Raw `cafe_tables` rows INCLUDING inactive ones, for the table editor.
 * Distinct from the till’s active-only list: they shared a bare
 * [‘cafeTables’] key and served each other’s rows for up to the 10 s staleTime.
 */
export const TABLES_QUERY_KEY: QueryKey = QK.allCafeTables;

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
