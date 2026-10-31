import { Badge } from "@/components/admin/ui";
import type { CustomerKind } from "@/server/services/admin/customers";

/** "Account" (signed up, has a login) or "Guest" (ordered without an account). */
export function CustomerKindBadge({ kind }: { kind: CustomerKind }) {
  return kind === "account" ? (
    <Badge tone="primary">Account</Badge>
  ) : (
    <Badge tone="neutral">Guest</Badge>
  );
}
