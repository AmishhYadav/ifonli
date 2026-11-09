/**
 * Runs while the HTML is parsed, before first paint and long before hydration:
 *  - Switches the scroll-choreography layout on (`data-motion`), unless the visitor prefers reduced motion. The
 *    sticky tracks have their final height from the first frame, so a slow phone does not see the page grow (or
 *    the scroll position shift) when the JavaScript finally arrives. No JavaScript, or reduced motion, keeps the
 *    plain stack of chapters.
 *  - Flags a low-power device (`data-low-power` on <html>, same rule as power.ts): CSS drops the frosted pills and the
 *    background texture, and the motion code drops the parallax blobs. A phone cannot repaint those at 60fps.
 *  - Notes the first scroll gesture (`data-gesture`), so LandingMotion does not throw a visitor who has already
 *    started scrolling back to the top.
 * It must be the last child of #landing.
 */
export const BOOT_SCRIPT = `(function(){var r=document.getElementById("landing");if(!r)return;var n=navigator,c=n.connection||{};if((n.hardwareConcurrency||99)<=4||(n.deviceMemory||99)<=4||c.saveData===true||/2g/.test(c.effectiveType||""))document.documentElement.setAttribute("data-low-power","");if(!matchMedia("(prefers-reduced-motion: reduce)").matches)r.dataset.motion="on";var g=function(){r.dataset.gesture="1"};["wheel","touchstart","keydown","pointerdown"].forEach(function(n){addEventListener(n,g,{passive:true,once:true})})})()`;

export function LandingBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />;
}
