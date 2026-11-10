import type { MetadataRoute } from "next";

import { DEFAULT_VIBE } from "@/features/vibe/config";
import { resolveTokens } from "@/features/vibe/tokens";

/** Web app manifest: "Add to Home Screen" opens the store home in its own window, in the default mood's colours. */
export default function manifest(): MetadataRoute.Manifest {
  const { bg } = resolveTokens(DEFAULT_VIBE).palette;
  return {
    name: "IfOnli",
    short_name: "IfOnli",
    description: "Charms, 3D stickers and DIY kits in four moods. Made in India.",
    id: "/",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    lang: "en-IN",
    background_color: bg,
    theme_color: bg,
    categories: ["shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
