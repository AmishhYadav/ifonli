"use client";

import { History, RotateCcw, Rocket, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  previewPolicyAction,
  publishPolicyAction,
  restorePolicyVersionAction,
  savePolicyDraftAction,
} from "@/app/admin/(app)/policies/actions";
import { MarkdownEditor } from "@/components/admin/content/MarkdownEditor";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  Input,
} from "@/components/admin/ui";

export interface PolicyVersionView {
  version: number;
  title: string;
  bodyMd: string;
  effectiveDate: string | null;
  publishedByName: string | null;
  isLive: boolean;
}

export function PolicyEditor({
  slug,
  published,
  liveVersion,
  draft,
  problemCount,
  history,
  today,
  canEdit,
  canPublish,
}: {
  slug: string;
  published: boolean;
  liveVersion: number | null;
  draft: { title: string; bodyMd: string; version: number; saved: boolean };
  /** Token problems in the saved draft (publishing is blocked while any remain). */
  problemCount: number;
  history: PolicyVersionView[];
  /** Today's date in IST, `YYYY-MM-DD`. */
  today: string;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(draft.title);
  const [body, setBody] = React.useState(draft.bodyMd);
  const [effectiveDate, setEffectiveDate] = React.useState(today);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const [restoring, setRestoring] = React.useState<PolicyVersionView | null>(null);

  const dirty = title !== draft.title || body !== draft.bodyMd;
  const unchangedFromLive = published && !dirty && !draft.saved;
  const blockedReason = dirty
    ? "Save your changes before publishing."
    : unchangedFromLive
      ? "There are no changes to publish. Edit the text and save a draft first."
      : problemCount > 0
        ? `${problemCount} settings ${problemCount === 1 ? "token is" : "tokens are"} unresolved or still placeholders.`
        : !body.trim()
          ? "The policy text is empty."
          : null;

  function save() {
    setErrors({});
    start(async () => {
      const res = await savePolicyDraftAction(slug, { title, bodyMd: body });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(`Draft of version ${res.data.version} saved`);
      router.refresh();
    });
  }

  async function publish() {
    const res = await publishPolicyAction(slug, { effectiveDate });
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`Version ${res.data.version} published`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {published
              ? `Draft of version ${draft.version}`
              : `Version ${draft.version} (not published)`}
            {dirty ? (
              <Badge tone="warning">Unsaved changes</Badge>
            ) : draft.saved ? (
              <Badge tone="info">Draft saved</Badge>
            ) : null}
            {published && liveVersion !== null ? (
              <Badge tone="success">Version {liveVersion} is live</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {published
              ? "Editing here does not change the live page until the owner publishes this draft."
              : "This policy is not live yet. Visitors see a short “being finalised” notice."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Title" htmlFor="policy-title" required error={errors.title}>
            <Input
              id="policy-title"
              value={title}
              maxLength={150}
              disabled={!canEdit}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <MarkdownEditor
            id="policy-body"
            label="Policy text (Markdown)"
            value={body}
            onChange={setBody}
            preview={previewPolicyAction}
            disabled={!canEdit}
            error={errors.bodyMd}
          />
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} loading={pending} disabled={!dirty}>
                <Save aria-hidden /> Save draft
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTitle(draft.title);
                    setBody(draft.bodyMd);
                  }}
                >
                  Discard changes
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="publish-panel">
        <CardHeader>
          <CardTitle>Publish</CardTitle>
          <CardDescription>
            Publishing makes this text live straight away as version {draft.version}. Only the owner
            can publish, and only when every settings token has a real value.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {canPublish ? (
            <>
              <Field
                label="Effective date"
                htmlFor="policy-effective"
                hint="The date this version takes effect, shown on the page. Today or earlier."
                className="max-w-xs"
              >
                <Input
                  id="policy-effective"
                  type="date"
                  value={effectiveDate}
                  max={today}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
              {blockedReason ? (
                <p className="text-[13px] text-admin-ink-muted" data-testid="publish-blocked">
                  {blockedReason}
                </p>
              ) : null}
              <div>
                <Button
                  onClick={() => setConfirmPublish(true)}
                  disabled={blockedReason !== null || !effectiveDate || effectiveDate > today}
                >
                  <Rocket aria-hidden /> Publish version {draft.version}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-admin-ink-muted">
              Only the owner can publish. Save the draft and ask the owner to review and publish it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden /> Version history
          </CardTitle>
          <CardDescription>Every published version, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="rounded-md border border-dashed border-admin-border-strong p-3 text-[13px] text-admin-ink-muted">
              Nothing has been published yet.
            </p>
          ) : (
            <ul
              className="divide-y divide-admin-border rounded-lg border border-admin-border"
              data-testid="policy-history"
            >
              {history.map((v) => (
                <li key={v.version} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Version {v.version}</span>
                    {v.isLive ? <Badge tone="success">Live</Badge> : null}
                    <span className="text-xs text-admin-ink-muted">
                      {v.effectiveDate ? `Effective ${v.effectiveDate}` : "No effective date"}
                      {v.publishedByName ? ` · published by ${v.publishedByName}` : ""}
                    </span>
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setRestoring(v)}
                      >
                        <RotateCcw aria-hidden /> Restore as draft
                      </Button>
                    ) : null}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[13px] text-admin-primary">
                      View text
                    </summary>
                    <p className="mt-2 text-sm font-medium">{v.title}</p>
                    <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-admin-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">
                      {v.bodyMd}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Publish version ${draft.version}?`}
        description={`The new text goes live immediately with the effective date ${effectiveDate}. The previous version stays in the history.`}
        confirmLabel="Publish"
        onConfirm={publish}
      />
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={`Restore version ${restoring?.version ?? ""} as the draft?`}
        description="The current draft is replaced with that version's text. The live page does not change until you publish."
        confirmLabel="Restore"
        onConfirm={async () => {
          if (!restoring) return;
          const res = await restorePolicyVersionAction(slug, restoring.version);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success(`Version ${restoring.version} restored as a draft`);
          router.refresh();
        }}
      />
    </div>
  );
}
