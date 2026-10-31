/**
 * Couriers offered in the "add shipment" dialog, with an optional tracking-link template
 * (`{awb}` is replaced by the URL-encoded AWB). The templates are conveniences: the admin can
 * always paste the exact tracking link instead, and an unknown courier simply has none.
 * Pure module (no server-only) so the dialog can use it too.
 */
export interface CourierPreset {
  name: string;
  trackingTemplate: string | null;
}

export const COURIER_PRESETS: readonly CourierPreset[] = [
  { name: "Delhivery", trackingTemplate: "https://www.delhivery.com/track-v2/package/{awb}" },
  { name: "Blue Dart", trackingTemplate: "https://www.bluedart.com/tracking?trackfor=0&trackno={awb}" },
  { name: "DTDC", trackingTemplate: "https://www.dtdc.in/tracking/shipment-tracking.asp?awbno={awb}" },
  { name: "Ecom Express", trackingTemplate: "https://ecomexpress.in/tracking/?awb_field={awb}" },
  { name: "Xpressbees", trackingTemplate: "https://www.xpressbees.com/shipment/tracking?awbNo={awb}" },
  { name: "Shiprocket", trackingTemplate: "https://shiprocket.co/tracking/{awb}" },
  { name: "India Post", trackingTemplate: null },
];

/** Tracking link for a courier + AWB from the preset templates, or null if there is no template. */
export function trackingUrlFor(courier: string, awb: string | null | undefined): string | null {
  const trimmed = awb?.trim();
  if (!trimmed) return null;
  const preset = COURIER_PRESETS.find((c) => c.name.toLowerCase() === courier.trim().toLowerCase());
  return preset?.trackingTemplate
    ? preset.trackingTemplate.replace("{awb}", encodeURIComponent(trimmed))
    : null;
}
