import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button, EmptyState } from "@/components/admin/ui";

export const metadata: Metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={<Lock />}
      title="You do not have access to this page"
      description="Your role does not include this module. Ask the owner if you need it."
      action={
        <Button asChild variant="outline">
          <Link href="/admin">Back to start</Link>
        </Button>
      }
    />
  );
}
