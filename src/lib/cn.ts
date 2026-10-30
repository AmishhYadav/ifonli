import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class-name helper: conditional classes via clsx, conflicting Tailwind utilities resolved by tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
