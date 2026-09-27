import type { CardState } from '../../cards/CardShell';
import type { Formatters } from '../../format';
import type { DerivedCourts, RawCourts } from '../derive';

/** What every section receives: the parsed data, the derivation, the card state and the formatters. */
export interface SectionProps {
  raw: RawCourts | null;
  derived: DerivedCourts | null;
  state: CardState;
  refreshing: boolean;
  f: Formatters;
  rangeLabel: string;
}
