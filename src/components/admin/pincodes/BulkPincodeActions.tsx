"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  bulkUpdatePincodesAction,
  previewBulkPincodesAction,
} from "@/app/admin/(app)/pincodes/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  Select,
} from "@/components/admin/ui";
import type { PincodeFilters } from "@/server/services/admin/pincodes";

const ACTIONS = [
  { value: "serviceable_off", label: "Mark not serviceable", set: { serviceable: false } },
  { value: "serviceable_on", label: "Mark serviceable", set: { serviceable: true } },
  { value: "cod_off", label: "Turn COD off", set: { codAllowed: false } },
  { value: "cod_on", label: "Allow COD", set: { codAllowed: true } },
] as const;

const fmt = (n: number) => n.toLocaleString("en-IN");

/**
 * Applies one change to EVERY pincode matching the filter above (not only the page on screen). The
 * button first asks the server how many pincodes it would change, and the confirmation says that
 * number; the server refuses if the number moved in between.
 */
export function BulkPincodeActions({
  filter,
  filterLabel,
  matched,
}: {
  filter: PincodeFilters;
  /** Plain-language description of the filter, e.g. "in Kerala, zone north east". */
  filterLabel: string;
  matched: number;
}) {
  const router = useRouter();
  const [action, setAction] = React.useState<(typeof ACTIONS)[number]["value"]>("serviceable_off");
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState<{ willChange: number } | null>(null);
  const chosen = ACTIONS.find((a) => a.value === action)!;

  async function review() {
    setBusy(true);
    try {
      const res = await previewBulkPincodesAction({ filter, set: chosen.set });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.willChange === 0) {
        return void toast.info(`Nothing to change: all ${fmt(res.data.matched)} pincodes are already set that way.`);
      }
      setConfirm({ willChange: res.data.willChange });
    } finally {
      setBusy(false);
    }
  }

  const noun = (n: number) => `${fmt(n)} ${n === 1 ? "pincode" : "pincodes"}`;
  const effect =
    "serviceable" in chosen.set
      ? chosen.set.serviceable
        ? "Shoppers there will be able to check out."
        : "Shoppers there will be refused at checkout straight away."
      : chosen.set.codAllowed
        ? "Cash on delivery will be offered there (within the COD order limit)."
        : "Cash on delivery will stop being offered there straight away.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change every pincode in this filter</CardTitle>
        <CardDescription>
          Applies to all {fmt(matched)} matching {matched === 1 ? "pincode" : "pincodes"}
          {filterLabel ? ` (${filterLabel})` : " (no filter: the whole directory)"}, not only the page below.
          You see how many will change before anything is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Action" htmlFor="bulk-action" className="w-full sm:w-56">
          <Select
            id="bulk-action"
            value={action}
            onValueChange={(v) => setAction(v as typeof action)}
            options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))}
          />
        </Field>
        <Button variant="outline" onClick={review} loading={busy} disabled={matched === 0}>
          Review change…
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`${chosen.label} for ${noun(confirm?.willChange ?? 0)}?`}
        description={
          <>
            {noun(matched)} match{matched === 1 ? "es" : ""} the filter{filterLabel ? ` (${filterLabel})` : ""};{" "}
            {fmt(confirm?.willChange ?? 0)} will change, the rest already are set that way. {effect}
          </>
        }
        confirmLabel={`${chosen.label}: ${fmt(confirm?.willChange ?? 0)}`}
        destructive={action === "serviceable_off" || action === "cod_off"}
        onConfirm={async () => {
          const res = await bulkUpdatePincodesAction({
            filter,
            set: chosen.set,
            expectedChanges: confirm?.willChange,
          });
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success(`${noun(res.data.changed)} updated`);
          router.refresh();
        }}
      />
    </Card>
  );
}
