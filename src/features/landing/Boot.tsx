/**
 * Runs while the HTML is parsed, before first paint and long before hydration:
 *  - Switches the scroll-choreography layout on (`data-motion`), unless the visitor prefers reduced motion. The
 *    sticky tracks have their final height from the first frame, so a slow phone does not see the page grow (or
 *    the scroll position shift) when the JavaScript finally arrives. No JavaScript, or reduced motion, keeps the
 *    plain stack of chapters.
 *  - Notes the first scroll gesture (`data-gesture`), so LandingMotion does not throw a visitor who has already
 *    started scrolling back to the top.
 * It must be the last child of #landing.
 */
const BOOT_SCRIPT = `(function(){var r=document.getElementById("landing");if(!r)return;if(!matchMedia("(prefers-reduced-motion: reduce)").matches)r.dataset.motion="on";var g=function(){r.dataset.gesture="1"};["wheel","touchstart","keydown","pointerdown"].forEach(function(n){addEventListener(n,g,{passive:true,once:true})})})()`;

export function LandingBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />;
}
