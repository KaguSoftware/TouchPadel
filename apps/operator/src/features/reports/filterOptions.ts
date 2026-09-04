/**
 * Option lists for ReportFilterBar. Courts come from the shared QK.courts
 * fetcher; categories and staff have report-private keys (different shapes
 * from the menu editor's and the staff admin's — one key, one shape).
 */
import type { QueryKey } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import type { StaffRole } from '../../lib/auth';

export const REPORT_CATEGORIES_KEY: QueryKey = ['reports', 'categories'];
export const REPORT_STAFF_KEY: QueryKey = ['reports', 'staff'];

export interface CategoryOption {
  id: string;
  name_en: string;
  name_ar: string;
}

export interface StaffOption {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
}

export async function fetchReportCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabase.from('menu_categories').select('id, name_en, name_ar').order('sort_order');
  if (error) throw error;
  return (data ?? []) as CategoryOption[];
}

/** `app.list_staff` (manager + owner). Removed people stay listed: their past work is still reportable. */
export async function fetchReportStaff(): Promise<StaffOption[]> {
  const rows = await appRpc<StaffOption[]>('list_staff');
  return [...rows].sort((a, b) => a.display_name.localeCompare(b.display_name));
}
