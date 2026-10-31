/** Tabs of Admin > Content (the active one lives in `?tab=`). Kept out of the client component so server code can import it. */
export const CONTENT_TABS = ["offers", "announcement", "featured", "hero"] as const;
export type ContentTab = (typeof CONTENT_TABS)[number];
