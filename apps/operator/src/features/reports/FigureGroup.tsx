import type { ReactNode } from 'react';
import { card } from '../../components/ui';

/**
 * A labelled group of figures (revenue's Earned / Money taken / Given away),
 * drawn as one bordered card with its figures inside it. The heading and hint
 * used to float over the figures with nothing around them, so on a wide screen
 * the four groups read as one run of tiles and it took reading the labels to
 * tell where "Earned" stopped and "Given away" started.
 *
 * The heading and hint sit on white above a rule; the rest of the card is
 * tinted in a brand colour, so the white figure tiles read as one set apart
 * from the label and each group is told apart before its title is read. The
 * colour follows the group's place in the band (blue, green, black, light
 * blue, then round again) and lives in GlobalStyles (.tp-figure-group),
 * because blue mode drops the tint: mixed into a blue panel the brand blue
 * vanished and the others went murky. The title stays --tp-fg because the
 * brand green is too pale to read as text on white.
 */
export function FigureGroup({
  title,
  hint,
  span,
  children,
}: {
  title: string;
  hint: string;
  /** Columns of the band this group spans (the management panel's Money taken takes two). */
  span?: number;
  children: ReactNode;
}) {
  return (
    <section
      className="tp-figure-group"
      style={{
        ...card,
        // The class paints the ground; the strip stays inline because card's
        // own inline border would otherwise win over it.
        background: undefined,
        borderBlockStart: '3px solid var(--tp-tone)',
        paddingBlock: 0,
        paddingInline: 0,
        overflow: 'hidden',
        display: 'grid',
        // Header and figures take the band's rows, so every group's rule sits
        // at the height of the tallest header in its row (a hint that wraps
        // to two lines no longer pushes one group's rule below the others').
        gridRow: 'span 2',
        gridColumn: span ? `span ${span}` : undefined,
        gridTemplateRows: 'subgrid',
        rowGap: 0,
      }}
    >
      <div
        style={{
          display: 'grid',
          alignContent: 'start',
          gap: 'var(--tp-sp-0)',
          paddingBlock: card.paddingBlock,
          paddingInline: card.paddingInline,
          borderBlockEnd: '1px solid var(--tp-border)',
          background: 'var(--tp-surface)',
        }}
      >
        <h2 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h2>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '60ch' }}>{hint}</p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
          // The row is as tall as the tallest group's; the tiles keep their
          // own height instead of stretching to fill it.
          alignContent: 'start',
          gap: 'var(--tp-sp-2)',
          paddingBlock: card.paddingBlock,
          paddingInline: card.paddingInline,
        }}
      >
        {children}
      </div>
    </section>
  );
}
