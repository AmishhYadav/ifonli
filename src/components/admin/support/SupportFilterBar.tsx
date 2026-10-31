"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button, Input, Select } from "@/components/admin/ui";

import { DEFAULT_STATUS, supportHref, type FilterValues } from "./filters";

const ANY = "any";

export function SupportFilterBar({
  tab,
  values,
  statusOptions,
  typeOptions,
  staff,
  meId,
}: {
  tab: "inbox" | "cases";
  values: FilterValues;
  statusOptions: { value: string; label: string }[];
  /** Cases only. */
  typeOptions?: { value: string; label: string }[];
  staff: { id: string; name: string }[];
  meId: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(values);
  const key = JSON.stringify(values);
  const [syncedKey, setSyncedKey] = React.useState(key);
  if (key !== syncedKey) {
    setSyncedKey(key);
    setDraft(values);
  }

  function apply(next: FilterValues) {
    setDraft(next);
    router.push(supportHref(tab, next));
  }
  const set = (patch: Partial<FilterValues>) => apply({ ...draft, ...patch });
  const dirty =
    values.status !== DEFAULT_STATUS ||
    values.type !== "" ||
    values.assigned !== "" ||
    values.q !== "";

  // The accessible name must contain the visible text (WCAG 2.5.3): "Status: Needs attention".
  const named = (field: string, value: string, options: { value: string; label: string }[]) =>
    `${field}: ${options.find((o) => o.value === value)?.label ?? ""}`;
  const typeChoices = typeOptions ? [{ value: ANY, label: "Any type" }, ...typeOptions] : [];

  const assignedOptions = [
    { value: ANY, label: "Anyone" },
    { value: "me", label: "Assigned to me" },
    { value: "unassigned", label: "Unassigned" },
    ...staff.filter((s) => s.id !== meId).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(draft);
      }}
      role="search"
      aria-label={tab === "inbox" ? "Filter messages" : "Filter cases"}
    >
      <div className="relative w-full max-w-xs min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-admin-ink-faint"
          aria-hidden
        />
        <Input
          type="search"
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          placeholder={tab === "inbox" ? "Name, e-mail or order" : "Name, e-mail, order or case"}
          aria-label={tab === "inbox" ? "Search messages" : "Search cases"}
          className="pl-8"
        />
      </div>
      <Select
        aria-label={named("Status", draft.status || DEFAULT_STATUS, statusOptions)}
        value={draft.status || DEFAULT_STATUS}
        onValueChange={(v) => set({ status: v })}
        className="h-9 w-44"
        options={statusOptions}
      />
      {typeOptions ? (
        <Select
          aria-label={named("Type", draft.type || ANY, typeChoices)}
          value={draft.type || ANY}
          onValueChange={(v) => set({ type: v === ANY ? "" : v })}
          className="h-9 w-40"
          options={typeChoices}
        />
      ) : null}
      <Select
        aria-label={named("Assigned to", draft.assigned || ANY, assignedOptions)}
        value={draft.assigned || ANY}
        onValueChange={(v) => set({ assigned: v === ANY ? "" : v })}
        className="h-9 w-44"
        options={assignedOptions}
      />
      <Button type="submit" variant="outline">
        Search
      </Button>
      {dirty ? (
        <Button
          variant="ghost"
          onClick={() => apply({ status: DEFAULT_STATUS, type: "", assigned: "", q: "" })}
        >
          <X aria-hidden /> Clear
        </Button>
      ) : null}
    </form>
  );
}
