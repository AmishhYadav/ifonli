import { Icon } from "@/components/ui/Icon";
import type { CartNotice } from "@/features/cart/types";

/**
 * Server notices ("Only 2 left - we updated your quantity") and the last failed-mutation message.
 * Rendered inside a polite live region that is always in the DOM, so additions are announced.
 */
export function CartNotices({ notices, error }: { notices: readonly CartNotice[]; error: string | null }) {
  return (
    <div role="status" aria-live="polite" data-testid="cart-notices" className="flex flex-col gap-2 empty:hidden">
      {error ? (
        <p className="flex items-start gap-2 rounded-input border-token border-danger bg-surface p-3 text-sm font-semibold text-danger">
          <Icon name="alert-circle" className="mt-0.5 size-4 flex-none" />
          {error}
        </p>
      ) : null}
      {notices.map((notice) => (
        <p
          key={notice.message}
          data-testid="cart-notice"
          className="flex items-start gap-2 rounded-input border-token bg-surface-2 p-3 text-sm text-ink"
        >
          <Icon name="info" className="mt-0.5 size-4 flex-none" />
          {notice.message}
        </p>
      ))}
    </div>
  );
}
