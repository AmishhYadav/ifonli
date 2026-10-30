import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Radix portals (dialogs, menus, selects) render into the admin root so they inherit its base
 * styles (border colour, cursor, font) instead of the storefront's. Client-only; null falls back to body.
 */
export function adminPortalContainer(): HTMLElement | null {
  return typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>("[data-admin]");
}
