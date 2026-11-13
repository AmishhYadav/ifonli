import Image from "next/image";

import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/money";

/** What the thread would cost on its own; shown struck through. Display only: it is never charged. */
const THREAD_VALUE_PAISE = 1100;

/**
 * The charm thread that comes free with every order, shown as an extra line in the bag and at checkout:
 * the price struck through and "Free". Not a cart line, so it never changes the subtotal or total.
 * Photo: /diy/thread.png (public/diy/): replace the file to change the picture.
 */
export function FreeThreadLine({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3", className)} data-testid="free-thread">
      <span
        className={cn(
          "relative flex-none overflow-hidden rounded-input art-none",
          size === "sm" ? "size-16" : "size-20",
        )}
      >
        <Image src="/diy/thread.png" alt="" fill sizes="80px" className="object-cover" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base leading-snug font-semibold break-words">Charm thread</p>
        <p className="text-sm text-ink-muted">Free with every order</p>
        <p className="text-sm text-ink-muted">Qty 1</p>
      </div>
      <p className="flex flex-none flex-col items-end text-base tabular-nums">
        <s className="text-sm text-ink-muted" aria-label={`Was ${formatINR(THREAD_VALUE_PAISE)}`}>
          {formatINR(THREAD_VALUE_PAISE)}
        </s>
        <span className="font-semibold text-success">Free</span>
      </p>
    </div>
  );
}
