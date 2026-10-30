import type { ReactNode } from "react";

import type { StoreValue } from "@/server/cache/settings";

/**
 * A store setting in the footer. While the owner has not replaced the registry placeholder it renders as an
 * obvious dashed, tinted chip (never silently as if it were real data); launch is blocked elsewhere until
 * the setting is filled in.
 */
export function PlaceholderValue({ value, children }: { value: StoreValue; children?: ReactNode }) {
  if (!value.isPlaceholder) return <>{children ?? value.value}</>;
  return (
    <mark
      data-placeholder=""
      title="Placeholder value: set it in Admin > Settings before launch"
      className="rounded-input bg-warning/25 px-1 text-ink outline-2 outline-dashed outline-warning"
    >
      {value.value}
    </mark>
  );
}
