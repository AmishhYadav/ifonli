import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

import { RETURNS_POLICY_PATH } from "./policy-path";

/** Return-policy summary with the link to the full policy. Server- and client-safe (no hooks). */
export function ReturnNote({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-ink-muted", className)}>
      <Icon name="info" className="mt-0.5 size-4 flex-none" />
      <span>
        {text}{" "}
        <Link href={RETURNS_POLICY_PATH} className="font-semibold text-link underline underline-offset-4 hover:no-underline">
          Returns and refunds policy
        </Link>
      </span>
    </p>
  );
}
