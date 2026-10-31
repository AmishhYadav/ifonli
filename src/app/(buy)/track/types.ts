/** Serialisable shapes for the track form (dates are ISO strings). */

export interface TrackedOrder {
  ref: string;
  statusLabel: string;
  paymentMethod: "razorpay" | "cod";
  fulfillmentStatus: string;
  placedAt: string;
  totalPaise: number;
  events: { type: string; note: string | null; createdAt: string }[];
  shipment: {
    courier: string;
    awb: string | null;
    trackingUrl: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
  } | null;
  expectedDelivery: { fromDate: string; toDate: string } | null;
}

export interface TrackFormState {
  status: "idle" | "invalid" | "not_found" | "rate_limited" | "error" | "found";
  /** What was submitted, so the inputs keep their text. */
  values: { ref: string; contact: string };
  fieldErrors?: { ref?: string; contact?: string };
  message?: string;
  order?: TrackedOrder;
}

export const INITIAL_TRACK_STATE: TrackFormState = {
  status: "idle",
  values: { ref: "", contact: "" },
};
