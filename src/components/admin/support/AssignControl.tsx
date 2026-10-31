"use client";

import { UserRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { assignCaseAction, assignMessageAction } from "@/app/admin/(app)/support/actions";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Select,
} from "@/components/admin/ui";

import { useAct } from "./use-act";

const NOBODY = "__nobody";

/** Assign a message or case to a team member (or back to nobody). Needs `support:respond`. */
export function AssignControl({
  kind,
  id,
  assignedTo,
  staff,
  meId,
  disabled,
}: {
  kind: "message" | "case";
  id: string;
  assignedTo: string | null;
  staff: { id: string; name: string; role: string }[];
  meId: string;
  disabled?: boolean;
}) {
  const act = useAct();
  const [value, setValue] = React.useState(assignedTo ?? NOBODY);
  const [syncedFor, setSyncedFor] = React.useState(assignedTo);
  if (assignedTo !== syncedFor) {
    setSyncedFor(assignedTo);
    setValue(assignedTo ?? NOBODY);
  }

  function assign(next: string) {
    const input = { assignedTo: next === NOBODY ? null : next };
    act.run(
      () => (kind === "case" ? assignCaseAction(id, input) : assignMessageAction(id, input)),
      () => toast.success(next === NOBODY ? "Unassigned" : "Assigned"),
    );
  }

  const options = [
    { value: NOBODY, label: "Nobody" },
    ...staff.map((s) => ({ value: s.id, label: `${s.name}${s.id === meId ? " (you)" : ""}` })),
  ];
  const changed = value !== (assignedTo ?? NOBODY);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned to</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Team member" htmlFor={`assign-${kind}`}>
          <Select
            id={`assign-${kind}`}
            value={value}
            onValueChange={setValue}
            options={options}
            disabled={disabled || act.pending}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={act.pending}
            disabled={disabled || !changed}
            onClick={() => assign(value)}
          >
            Save
          </Button>
          {assignedTo !== meId ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || act.pending}
              onClick={() => assign(meId)}
            >
              <UserRound aria-hidden /> Assign to me
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
