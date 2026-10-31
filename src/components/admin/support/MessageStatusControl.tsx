"use client";

import { CircleCheck, RotateCcw, Inbox } from "lucide-react";
import { toast } from "sonner";

import { setMessageStatusAction } from "@/app/admin/(app)/support/actions";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/admin/ui";
import type { ContactStatus } from "@/server/domain/support-state";

import { ContactStatusBadge } from "./status";
import { useAct } from "./use-act";

const BUTTON: Record<ContactStatus, { label: string; icon: React.ReactNode } | null> = {
  new: null,
  open: { label: "Mark open", icon: <Inbox aria-hidden /> },
  closed: { label: "Close message", icon: <CircleCheck aria-hidden /> },
};

/** Moves a message along new → open → closed (and back to open). The server enforces the table. */
export function MessageStatusControl({
  id,
  status,
  allowed,
  disabled,
}: {
  id: string;
  status: ContactStatus;
  allowed: ContactStatus[];
  disabled?: boolean;
}) {
  const act = useAct();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="flex items-center gap-2 text-[13px]">
          <ContactStatusBadge status={status} />
          <span className="text-admin-ink-muted">Replying marks a new message as open.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {allowed.map((to) => {
            const b = BUTTON[to];
            if (!b) return null;
            const reopen = status === "closed" && to === "open";
            return (
              <Button
                key={to}
                variant={to === "closed" ? "outline" : "ghost"}
                size="sm"
                disabled={disabled || act.pending}
                onClick={() =>
                  act.run(
                    () => setMessageStatusAction(id, { status: to }),
                    () =>
                      toast.success(
                        reopen
                          ? "Message re-opened"
                          : `Message ${to === "closed" ? "closed" : "marked open"}`,
                      ),
                  )
                }
              >
                {reopen ? <RotateCcw aria-hidden /> : b.icon} {reopen ? "Re-open" : b.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
