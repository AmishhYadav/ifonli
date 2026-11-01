"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { updateSettingAction } from "@/app/admin/(app)/settings/actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui";

import { FieldInput } from "./FieldInput";
import { fromDraft, sameDraft, toDraft, type Draft, type Node } from "./field-model";

export interface SettingCardData {
  key: string;
  label: string;
  description: string;
  value: unknown;
  isPlaceholder: boolean;
  blocksLaunch: boolean;
  requiredForLaunch: boolean;
  locked: boolean;
  /** Nothing reads this setting in this version: shown as such, never as a "Locked" decision. */
  unused: boolean;
  /** Preformatted "Last changed by X on Y" or null. */
  updated: string | null;
  node: Node;
}

/** Server paths of array elements (`admin_alert_emails.1`) become a message on the list itself. */
function normaliseIssues(issues: { path: string; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const segments = issue.path.split(".").filter(Boolean);
    const numeric = segments.findIndex((s) => /^\d+$/.test(s));
    const path = (numeric === -1 ? segments : segments.slice(0, numeric)).join(".");
    const message =
      numeric === -1 ? issue.message : `Item ${Number(segments[numeric]) + 1}: ${issue.message}`;
    out[path] = out[path] ? `${out[path]}. ${message}` : message;
  }
  return out;
}

export function SettingCard({ setting, canEdit }: { setting: SettingCardData; canEdit: boolean }) {
  const router = useRouter();
  const initial = React.useMemo(
    () => toDraft(setting.node, setting.value),
    [setting.node, setting.value],
  );
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const dirty = !sameDraft(draft, initial);
  const editable = canEdit && !setting.locked;
  const id = `setting-${setting.key}`;

  function save() {
    const local = fromDraft(setting.node, draft);
    if (Object.keys(local.errors).length > 0) return void setErrors(local.errors);
    setErrors({});
    start(async () => {
      const res = await updateSettingAction(setting.key, local.value);
      if (!res.ok) return void toast.error(res.error);
      if (!res.data.saved) {
        setErrors(normaliseIssues(res.data.issues));
        return void toast.error(`${setting.label}: please fix the highlighted fields`);
      }
      toast.success(`${setting.label} saved`);
      router.refresh();
    });
  }

  return (
    <Card id={id} className="scroll-mt-20" data-testid={id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {setting.label}
          {setting.unused ? (
            <Badge tone="neutral">Not used in this version</Badge>
          ) : setting.locked ? (
            <Badge tone="neutral">
              <Lock aria-hidden /> Locked
            </Badge>
          ) : setting.isPlaceholder ? (
            <Badge tone={setting.blocksLaunch ? "danger" : "warning"}>Placeholder</Badge>
          ) : (
            <Badge tone="success">Set</Badge>
          )}
          {setting.blocksLaunch ? <Badge tone="danger">Blocks launch</Badge> : null}
        </CardTitle>
        <CardDescription>{setting.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FieldInput
          node={setting.node}
          draft={draft}
          onChange={setDraft}
          id={`${id}-field`}
          label={setting.label}
          path=""
          errors={errors}
          disabled={!editable}
          hideLabel
        />
        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} loading={pending} disabled={!dirty && !setting.isPlaceholder}>
              {!dirty && setting.isPlaceholder ? "Confirm this value" : "Save"}
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(initial);
                  setErrors({});
                }}
              >
                Reset
              </Button>
            ) : null}
            {setting.updated ? (
              <span className="text-xs text-admin-ink-muted">{setting.updated}</span>
            ) : null}
          </div>
        ) : setting.updated ? (
          <p className="text-xs text-admin-ink-muted">{setting.updated}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
