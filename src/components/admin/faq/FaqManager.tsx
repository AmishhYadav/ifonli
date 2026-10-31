"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  createFaqAction,
  deleteFaqAction,
  moveFaqAction,
  previewFaqAction,
  setFaqPublishedAction,
  updateFaqAction,
} from "@/app/admin/(app)/faq/actions";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Switch,
} from "@/components/admin/ui";
import type { FaqCategory } from "@/server/services/content";

export interface FaqView {
  id: string;
  category: FaqCategory;
  question: string;
  answerMd: string;
  published: boolean;
  problems: { kind: string; token: string; message: string }[];
}

const CATEGORY_OPTIONS: { value: FaqCategory; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "payment", label: "Payment" },
  { value: "product", label: "Product" },
  { value: "orders", label: "Orders" },
];

function FaqForm({
  faq,
  defaultCategory,
  onOpenChange,
  onSaved,
}: {
  faq: FaqView | null;
  defaultCategory: FaqCategory;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = React.useState<FaqCategory>(faq?.category ?? defaultCategory);
  const [question, setQuestion] = React.useState(faq?.question ?? "");
  const [answer, setAnswer] = React.useState(faq?.answerMd ?? "");
  const [published, setPublished] = React.useState(faq?.published ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const input = { category, question, answerMd: answer, published };
    const res = faq ? await updateFaqAction(faq.id, input) : await createFaqAction(input);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error);
      return;
    }
    toast.success(faq ? "Question saved" : "Question added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{faq ? "Edit question" : "New question"}</DialogTitle>
        <DialogDescription>
          Answers are Markdown. Use setting tokens such as{" "}
          <code>{"{{settings.support_email}}"}</code> for values that can change.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <Field label="Category" htmlFor="faq-category" required error={errors.category}>
          <Select
            id="faq-category"
            value={category}
            onValueChange={(v) => setCategory(v as FaqCategory)}
            options={CATEGORY_OPTIONS}
          />
        </Field>
        <Field label="Question" htmlFor="faq-question" required error={errors.question}>
          <Input
            id="faq-question"
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            aria-invalid={Boolean(errors.question)}
          />
        </Field>
      </div>
      <MarkdownEditor
        id="faq-answer"
        label="Answer"
        value={answer}
        onChange={setAnswer}
        preview={previewFaqAction}
        rows={10}
        error={errors.answerMd}
      />
      <Field label="Published" htmlFor="faq-published" inline>
        <Switch id="faq-published" checked={published} onCheckedChange={setPublished} />
      </Field>
      {formError ? (
        <p role="alert" className="text-sm text-admin-danger">
          {formError}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {faq ? "Save" : "Add question"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The form is mounted only while the dialog is open, so it starts from fresh values each time. */
function FaqDialog({
  open,
  onOpenChange,
  ...rest
}: {
  faq: FaqView | null;
  defaultCategory: FaqCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <FaqForm onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

export function FaqManager({ faqs, canEdit }: { faqs: FaqView[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<FaqView | null>(null);
  const [creatingIn, setCreatingIn] = React.useState<FaqCategory | null>(null);
  const [deleting, setDeleting] = React.useState<FaqView | null>(null);
  const [pending, start] = React.useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Could not save");
      if (success) toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {CATEGORY_OPTIONS.map(({ value: category, label }) => {
        const list = faqs.filter((f) => f.category === category);
        return (
          <Card key={category} data-testid={`faq-category-${category}`}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>{label}</CardTitle>
                <CardDescription>
                  {list.length} {list.length === 1 ? "question" : "questions"} · shown in this order
                  on the Help page
                </CardDescription>
              </div>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setCreatingIn(category)}>
                  <Plus aria-hidden /> Add question
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {list.length === 0 ? (
                <p className="rounded-md border border-dashed border-admin-border-strong p-3 text-[13px] text-admin-ink-muted">
                  No questions in this category.
                </p>
              ) : (
                <ol className="divide-y divide-admin-border rounded-lg border border-admin-border">
                  {list.map((f, i) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                      data-testid="faq-row"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{f.question}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={f.published ? "success" : "warning"}>
                            {f.published ? "Published" : "Hidden"}
                          </Badge>
                          {f.problems.length > 0 ? (
                            <Badge tone="warning" title={f.problems.map((p) => p.token).join(", ")}>
                              <AlertTriangle aria-hidden /> {f.problems.length} setting{" "}
                              {f.problems.length === 1 ? "token needs" : "tokens need"} attention
                              (hidden on /help)
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <Switch
                            aria-label={`${f.question}: published`}
                            checked={f.published}
                            disabled={pending}
                            onCheckedChange={(v) => run(() => setFaqPublishedAction(f.id, v))}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move "${f.question}" up`}
                            disabled={i === 0 || pending}
                            onClick={() => run(() => moveFaqAction(f.id, "up"))}
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move "${f.question}" down`}
                            disabled={i === list.length - 1 || pending}
                            onClick={() => run(() => moveFaqAction(f.id, "down"))}
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit "${f.question}"`}
                            onClick={() => setEditing(f)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete "${f.question}"`}
                            onClick={() => setDeleting(f)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        );
      })}

      <FaqDialog
        faq={null}
        defaultCategory={creatingIn ?? "delivery"}
        open={creatingIn !== null}
        onOpenChange={(o) => !o && setCreatingIn(null)}
        onSaved={() => router.refresh()}
      />
      <FaqDialog
        faq={editing}
        defaultCategory="delivery"
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => router.refresh()}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this question?"
        description={
          deleting
            ? `"${deleting.question}" is removed from the Help page. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteFaqAction(deleting.id);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          toast.success("Deleted");
          router.refresh();
        }}
      />
    </div>
  );
}
