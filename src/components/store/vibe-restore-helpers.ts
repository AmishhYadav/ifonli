import { VIBE_COOKIE, VIBE_URL_PARAM, isVibe, type Vibe } from "@/features/vibe/config";

/** `?vibe=` first, then the `ifonli_vibe` cookie; null when neither names a known vibe. */
export function getVibeFromStorageOrUrl(): Vibe | null {
  const fromUrl = new URLSearchParams(window.location.search).get(VIBE_URL_PARAM);
  if (isVibe(fromUrl)) return fromUrl;
  const match = document.cookie.match(new RegExp(`(?:^|; )${VIBE_COOKIE}=(\\w+)`));
  const fromCookie = match?.[1];
  return isVibe(fromCookie) ? fromCookie : null;
}
