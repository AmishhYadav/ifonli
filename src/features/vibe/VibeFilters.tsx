/**
 * Hidden SVG filter defs, rendered ONCE by the root layout (art: public/vibe/filters.svg source).
 *  - #wobble: hand-drawn jitter, used through the --icon-filter token (Overthinking)
 *  - #warp:   wavy headline, used through --display-filter (Funky, large display text only)
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
        <filter
          id="wobble"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035 0.045"
            numOctaves="2"
            seed="4"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="2.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter
          id="warp"
          x="-8%"
          y="-30%"
          width="116%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.014 0.0015"
            numOctaves="1"
            seed="11"
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 .5  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"
            result="v"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="v"
            scale="44"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
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
