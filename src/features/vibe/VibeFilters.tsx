/**
 * Hidden SVG filter defs, rendered ONCE by the root layout (art: public/vibe/filters.svg source).
 *  - #grain:  fine noise for overlay elements
 * Filters are static, so they are safe under prefers-reduced-motion.
 */
export function VibeFilters() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="3"
            seed="2"
            stitchTiles="stitch"
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.05"
            result="a"
          />
          <feComponentTransfer in="a" result="b">
            <feFuncA type="linear" slope="0.09" />
          </feComponentTransfer>
          <feComposite in="b" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}
