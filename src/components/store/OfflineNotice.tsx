"use client";

import { useSyncExternalStore } from "react";

import { Icon } from "@/components/ui";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getOnline = () => navigator.onLine;
// The server cannot know; "online" renders nothing, so there is no hydration mismatch and no flash.
const getServerOnline = () => true;

/**
 * "You're offline" notice (plan section 10, global states). The status region is always in the page so
 * screen readers announce the change politely; the pill is fixed, so showing or hiding it never moves
 * anything (no layout shift), and it ignores pointer events so it never blocks a tap.
 */
export function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, getOnline, getServerOnline);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4">
      {online ? null : (
        <p
          data-testid="offline-notice"
          className="inline-flex max-w-full items-center gap-2 rounded-button border-token bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-card"
        >
          <Icon name="alert-circle" className="size-4 flex-none" />
          You&apos;re offline. Some things won&apos;t work until you&apos;re back online.
        </p>
      )}
    </div>
  );
}
