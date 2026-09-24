import {
  BALL_FILL_BLUR,
  BALL_FILL_SLOPE,
  BALL_MASK_BRIGHT,
  BALL_MASK_GREEN_OVER_BLUE,
  BALL_MASK_NOT_BLUE,
  BALL_MASK_NOT_WARM,
  LUMA_MATRIX,
  PHOTO_GRADE_ID,
  PHOTO_GRADE_RAMP,
  rampTables,
  type PhotoGrade,
} from '@/lib/site/photoGrade';

const GRADES: readonly PhotoGrade[] = ['print', 'night'];

/**
 * The photo grade's two SVG filters (lib/site/photoGrade.ts), drawn once on a page that
 * shows photos; every `.tp-photo` points at one of them from CSS. Luma → a ramp of Touch
 * Blue shades, then the source pixels laid back over it wherever the two ball masks
 * agree, so a padel ball keeps its green, plus the white of its lit side (bright, not
 * blue, and within `BALL_FILL_BLUR` px of the green), so the ball stays a whole sphere.
 *
 * The SVG is zero-sized and out of the flow (`.tp-photo-grade`), never `display: none`,
 * which would stop some engines resolving the filters.
 */
export function PhotoGrade() {
  return (
    <svg className="tp-photo-grade" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {GRADES.map((grade) => {
          const { r, g, b } = rampTables(PHOTO_GRADE_RAMP[grade]);
          return (
            <filter
              key={grade}
              id={PHOTO_GRADE_ID[grade]}
              colorInterpolationFilters="sRGB"
              x="0"
              y="0"
              width="1"
              height="1"
            >
              <feColorMatrix in="SourceGraphic" type="matrix" values={LUMA_MATRIX} result="luma" />
              <feComponentTransfer in="luma" result="duotone">
                <feFuncR type="table" tableValues={r} />
                <feFuncG type="table" tableValues={g} />
                <feFuncB type="table" tableValues={b} />
              </feComponentTransfer>
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={BALL_MASK_GREEN_OVER_BLUE}
                result="greenOverBlue"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={BALL_MASK_NOT_WARM}
                result="notWarm"
              />
              <feComposite in="greenOverBlue" in2="notWarm" operator="in" result="core" />
              {/* The lit side: the core's reach, then only what is bright and not blue. */}
              <feGaussianBlur in="core" stdDeviation={BALL_FILL_BLUR} result="reachSoft" />
              <feComponentTransfer in="reachSoft" result="reach">
                <feFuncA type="linear" slope={BALL_FILL_SLOPE} intercept="0" />
              </feComponentTransfer>
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={BALL_MASK_BRIGHT}
                result="bright"
              />
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values={BALL_MASK_NOT_BLUE}
                result="notBlue"
              />
              <feComposite in="reach" in2="bright" operator="in" result="litA" />
              <feComposite in="litA" in2="notBlue" operator="in" result="litB" />
              <feComposite in="litB" in2="notWarm" operator="in" result="lit" />
              <feComposite in="core" in2="lit" operator="over" result="ballMask" />
              <feComposite in="SourceGraphic" in2="ballMask" operator="in" result="ball" />
              <feMerge>
                <feMergeNode in="duotone" />
                <feMergeNode in="ball" />
              </feMerge>
            </filter>
          );
        })}
      </defs>
    </svg>
  );
}
