"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { setPincodeFlagsAction } from "@/app/admin/(app)/pincodes/actions";
import {
  Badge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import type { PincodeRow } from "@/server/services/admin/pincodes";

type Flags = Pick<PincodeRow, "serviceable" | "codAllowed">;

/**
 * One page of pincodes with a switch per flag. A switch flips straight away (optimistic) and goes
 * back by itself if the save is refused, with the reason in a toast. Without edit rights the flags
 * are plain badges.
 */
export function PincodeTable({ rows, canEdit }: { rows: PincodeRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useOptimistic<
    Record<string, Partial<Flags>>,
    { pincode: string; patch: Partial<Flags> }
  >({}, (state, { pincode, patch }) => ({ ...state, [pincode]: { ...state[pincode], ...patch } }));

  function toggle(row: PincodeRow, patch: Partial<Flags>, label: string) {
    startTransition(async () => {
      setOptimistic({ pincode: row.pincode, patch });
      const res = await setPincodeFlagsAction({ pincode: row.pincode, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${row.pincode}: ${label}`);
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-admin-border bg-admin-surface shadow-xs">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Pincode</TableHead>
            <TableHead>District</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Zone</TableHead>
            <TableHead>Serviceable</TableHead>
            <TableHead>COD allowed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const flags: Flags = { ...row, ...optimistic[row.pincode] };
            return (
              <TableRow key={row.pincode} data-testid="pincode-row">
                <TableCell className="font-mono">{row.pincode}</TableCell>
                <TableCell>{row.district}</TableCell>
                <TableCell>{row.stateName}</TableCell>
                <TableCell className="text-[13px] text-admin-ink-muted">
                  {row.zone ? row.zone.replace(/_/g, " ") : "none"}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Switch
                      checked={flags.serviceable}
                      onCheckedChange={(v) =>
                        toggle(row, { serviceable: v }, v ? "now serviceable" : "no longer serviceable")
                      }
                      aria-label={`Serviceable: ${row.pincode}`}
                    />
                  ) : (
                    <Badge tone={flags.serviceable ? "success" : "danger"}>
                      {flags.serviceable ? "Yes" : "No"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Switch
                      checked={flags.codAllowed}
                      onCheckedChange={(v) =>
                        toggle(row, { codAllowed: v }, v ? "COD allowed" : "COD turned off")
                      }
                      aria-label={`COD allowed: ${row.pincode}`}
                    />
                  ) : (
                    <Badge tone={flags.codAllowed ? "success" : "neutral"}>
                      {flags.codAllowed ? "Yes" : "No"}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
