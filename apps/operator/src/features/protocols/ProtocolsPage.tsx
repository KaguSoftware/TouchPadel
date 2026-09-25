/**
 * Protocols (/protocols) — manager and owner (ROUTE_ROLES).
 *
 * A placeholder (build-contracts-2026-09-23 §5.1, lane D1). The route and its
 * search params land first so the menu editor, the pricing screens and the
 * stock screens can link here with a typed `?start=` or `?run=` before the
 * page itself exists; D2 replaces this file with the cards, the lists and the
 * run and step sheets. Until then a followed link lands on this empty state
 * and nothing is read or written.
 */
import { useLocale } from '../../lib/i18n';
import { EmptyState, PageHeader } from '../../components/kit';

export function ProtocolsPageScreen() {
  const { tr } = useLocale();
  return (
    <>
      <PageHeader title={tr('ws.protocols.title')} />
      <EmptyState icon="split" title={tr('ws.protocols.placeholder.title')} body={tr('ws.protocols.placeholder.body')} />
    </>
  );
}
