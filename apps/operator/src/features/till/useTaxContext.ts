/**
 * The tax context `computeTabTotals` needs: every category's tax group, off
 * the SAME ['menu'] cache the grid already holds, plus the venue's
 * tax_inclusive flag. The till's detail panel, its open-tabs board and the
 * tills observation screen each built this themselves; one copy now.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { QK } from '../../lib/queryKeys';
import { TILL_MENU_QUERY } from './tillData';
import { taxContextFrom, type TaxContext } from './tabTotals';

export function useTaxContext(): TaxContext | null {
  const menuQ = useQuery({ ...TILL_MENU_QUERY });
  const taxInclusiveQ = useQuery({
    queryKey: QK.taxInclusive,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('venue_settings').select('tax_inclusive').single();
      if (error) throw error;
      return Boolean((data as { tax_inclusive: boolean }).tax_inclusive);
    },
  });
  return useMemo(
    () => (menuQ.data && taxInclusiveQ.data !== undefined ? taxContextFrom(menuQ.data.categories, taxInclusiveQ.data) : null),
    [menuQ.data, taxInclusiveQ.data],
  );
}
