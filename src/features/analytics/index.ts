/**
 * First-party analytics (plan 12, FR-18). Client-safe public surface for other features:
 *
 *   import { track } from "@/features/analytics";
 *
 *   // Animated hero (phase 7); every field is optional and defaults sensibly:
 *   track("hero_tile_click", { productId, meta: { tile: "3", scene: "5" } });
 *   track("hero_play");
 *   track("hero_pause", { meta: { by: "user" } });
 *
 * `track()` batches, never throws and does nothing on the server. Server components import
 * `AnalyticsMount` / `AnalyticsFooterLink` from "./AnalyticsMount" directly (they read cached settings).
 * See docs/ANALYTICS.md.
 */
export { track, flush } from "@/lib/analytics/client";
export type { ClientEvent, TrackProps } from "@/lib/analytics/events";
export { trackPaymentInfo, trackShippingInfo } from "./checkout-events";
export { PdpTracker } from "./PdpTracker";
export { SearchTracker } from "./SearchTracker";
