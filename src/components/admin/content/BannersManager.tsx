"use client";

import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  createBannerAction,
  deleteBannerAction,
  moveBannerAction,
  prepareBannerImageAction,
  setBannerActiveAction,
  updateBannerAction,
  verifyBannerImageAction,
} from "@/app/admin/(app)/content/actions";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/admin/ui";
import type { BannerPlacement, BannerState } from "@/server/services/admin/banners";

import { formatIst, isoToIstLocal, istLocalToIso } from "./ist";

export interface BannerView {
  id: string;
  placement: BannerPlacement;
  vibeId: string | null;
  vibeName: string | null;
  title: string;
  body: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  link: string | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  state: BannerState;
  /** The announcement bar shows exactly this one right now. */
  showingNow: boolean;
}

export interface VibeOption {
  id: string;
  name: string;
}

const STATE_BADGE: Record<
  BannerState,
  { label: string; tone: "success" | "info" | "neutral" | "warning" }
> = {
  live: { label: "Live", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Ended", tone: "neutral" },
  inactive: { label: "Hidden", tone: "warning" },
};

interface FormState {
  title: string;
  body: string;
  link: string;
  vibeId: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  imagePath: string | null;
  imageUrl: string | null;
}

const ALL_VIBES = "all";

function toForm(b: BannerView | null): FormState {
  return {
    title: b?.title ?? "",
    body: b?.body ?? "",
    link: b?.link ?? "",
    vibeId: b?.vibeId ?? ALL_VIBES,
    startsAt: isoToIstLocal(b?.startsAt),
    endsAt: isoToIstLocal(b?.endsAt),
    active: b?.active ?? true,
    imagePath: b?.imagePath ?? null,
    imageUrl: b?.imageUrl ?? null,
  };
}

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  return file.type.split("/")[1] ?? "";
}

function BannerForm({
  placement,
  banner,
  vibes,
  onOpenChange,
  onSaved,
}: {
  placement: BannerPlacement;
  banner: BannerView | null;
  vibes: VibeOption[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isBar = placement === "announcement";
  const [form, setForm] = React.useState<FormState>(() => toForm(banner));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function upload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const prepared = await prepareBannerImageAction(extensionOf(file));
      if (!prepared.ok) throw new Error(prepared.error);
      const put = await fetch(prepared.data.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const verified = await verifyBannerImageAction(prepared.data.dbPath);
      if (!verified.ok) throw new Error(verified.error);
      for (const w of verified.data.warnings) toast.warning(w, { duration: 8000 });
      setForm((f) => ({
        ...f,
        imagePath: verified.data.dbPath,
        imageUrl: verified.data.previewUrl,
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const input = {
      placement,
      vibeId: isBar || form.vibeId === ALL_VIBES ? null : form.vibeId,
      title: form.title,
      body: form.body,
      imagePath: isBar ? null : form.imagePath,
      link: form.link,
      startsAt: istLocalToIso(form.startsAt),
      endsAt: istLocalToIso(form.endsAt),
      active: form.active,
    };
    const res = banner
      ? await updateBannerAction(banner.id, input)
      : await createBannerAction(input);
    setBusy(false);
    if (!res.ok) {
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) setErrors(res.fieldErrors);
      setFormError(res.error);
      return;
    }
    toast.success(banner ? "Banner saved" : "Banner added");
    onOpenChange(false);
    onSaved();
  }

  const noun = isBar ? "announcement" : "banner";
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{banner ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
        <DialogDescription>
          {isBar
            ? "A slim line above the header on every page. Only the first live announcement is shown."
            : "A card in the offers row on the home page."}
        </DialogDescription>
      </DialogHeader>

      <Field label="Title" htmlFor="b-title" required error={errors.title}>
        <Input
          id="b-title"
          value={form.title}
          maxLength={120}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={Boolean(errors.title)}
        />
      </Field>
      <Field
        label={isBar ? "Extra text" : "Text"}
        htmlFor="b-body"
        error={errors.body}
        hint={
          isBar
            ? "Shown after the title on wider screens."
            : "One or two short lines under the title."
        }
      >
        <Textarea
          id="b-body"
          rows={2}
          maxLength={300}
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
        />
      </Field>
      <Field
        label="Link"
        htmlFor="b-link"
        error={errors.link}
        hint="A page on this site such as /shop or /vibes/gothic, or a full https:// address. Leave empty for no link."
      >
        <Input
          id="b-link"
          value={form.link}
          onChange={(e) => set("link", e.target.value)}
          placeholder="/shop"
          autoComplete="off"
          aria-invalid={Boolean(errors.link)}
        />
      </Field>

      {isBar ? null : (
        <>
          <Field
            label="Show in"
            htmlFor="b-vibe"
            error={errors.vibeId}
            hint="Everyone sees banners for all vibes; a vibe banner only appears while that vibe is active."
          >
            <Select
              id="b-vibe"
              value={form.vibeId}
              onValueChange={(v) => set("vibeId", v)}
              options={[
                { value: ALL_VIBES, label: "Every vibe" },
                ...vibes.map((v) => ({ value: v.id, label: v.name })),
              ]}
            />
          </Field>
          <Field
            label="Image"
            htmlFor="b-image"
            error={errors.imagePath}
            hint="Optional. JPEG, PNG, WebP or AVIF, shown beside the text."
          >
            <div className="flex items-center gap-3">
              <span className="relative flex size-16 flex-none items-center justify-center overflow-hidden rounded-md border border-admin-border bg-admin-surface-2">
                {form.imageUrl ? (
                  <Image
                    src={form.imageUrl}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-contain p-1"
                    unoptimized
                  />
                ) : (
                  <ImagePlus className="size-5 text-admin-ink-faint" aria-hidden />
                )}
              </span>
              <input
                id="b-image"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
                className="block min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-admin-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-admin-border"
              />
              {form.imagePath ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove image"
                  onClick={() => setForm((f) => ({ ...f, imagePath: null, imageUrl: null }))}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
            {uploading ? <p className="text-xs text-admin-ink-muted">Uploading…</p> : null}
          </Field>
        </>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium text-admin-ink">Schedule (India time)</legend>
        <Field
          label="Starts"
          htmlFor="b-start"
          error={errors.startsAt}
          hint="Empty = as soon as it is active."
        >
          <Input
            id="b-start"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </Field>
        <Field label="Ends" htmlFor="b-end" error={errors.endsAt} hint="Empty = until you hide it.">
          <Input
            id="b-end"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
            aria-invalid={Boolean(errors.endsAt)}
          />
        </Field>
      </fieldset>

      <Field label="Active" htmlFor="b-active" inline hint={undefined}>
        <Switch id="b-active" checked={form.active} onCheckedChange={(v) => set("active", v)} />
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
        <Button type="submit" loading={busy} disabled={uploading}>
          {banner ? "Save" : `Add ${noun}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The form is mounted only while the dialog is open, so it starts from fresh values each time. */
function BannerDialog({
  open,
  onOpenChange,
  ...rest
}: {
  placement: BannerPlacement;
  banner: BannerView | null;
  vibes: VibeOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <BannerForm onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

function scheduleText(b: BannerView): string {
  if (b.startsAt && b.endsAt) return `${formatIst(b.startsAt)} to ${formatIst(b.endsAt)}`;
  if (b.startsAt) return `From ${formatIst(b.startsAt)}`;
  if (b.endsAt) return `Until ${formatIst(b.endsAt)}`;
  return "Always on";
}

export function BannersManager({
  placement,
  banners,
  vibes,
  canEdit,
}: {
  placement: BannerPlacement;
  banners: BannerView[];
  vibes: VibeOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<BannerView | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<BannerView | null>(null);
  const [pending, start] = React.useTransition();
  const isBar = placement === "announcement";
  const noun = isBar ? "announcement" : "banner";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Could not save");
      if (success) toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-admin-ink-muted">
          {isBar
            ? "The slim notice above the header. The first live announcement is shown; use the arrows to choose which."
            : "Offer cards on the home page, in this order. A banner with a schedule appears and disappears by itself."}
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New {noun}
          </Button>
        ) : null}
      </div>

      {banners.length === 0 ? (
        <EmptyState
          title={isBar ? "No announcement" : "No banners yet"}
          description={
            isBar ? "Nothing is shown above the header." : "The home page shows no offers row."
          }
        />
      ) : (
        <ol className="divide-y divide-admin-border rounded-lg border border-admin-border bg-admin-surface">
          {banners.map((b, i) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
              data-testid="banner-row"
            >
              {!isBar ? (
                <span className="relative flex size-12 flex-none items-center justify-center overflow-hidden rounded-md border border-admin-border bg-admin-surface-2">
                  {b.imageUrl ? (
                    <Image
                      src={b.imageUrl}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-contain p-0.5"
                      unoptimized
                    />
                  ) : (
                    <ImagePlus className="size-4 text-admin-ink-faint" aria-hidden />
                  )}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{b.title}</span>
                  <Badge tone={STATE_BADGE[b.state].tone}>{STATE_BADGE[b.state].label}</Badge>
                  {b.showingNow ? <Badge tone="primary">Showing now</Badge> : null}
                  {!isBar ? <Badge tone="neutral">{b.vibeName ?? "Every vibe"}</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-admin-ink-muted">
                  {scheduleText(b)}
                  {b.link ? ` · ${b.link}` : ""}
                </p>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <Switch
                    aria-label={`${b.title}: active`}
                    checked={b.active}
                    disabled={pending}
                    onCheckedChange={(active) => run(() => setBannerActiveAction(b.id, active))}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${b.title} up`}
                    disabled={i === 0 || pending}
                    onClick={() => run(() => moveBannerAction(b.id, "up"))}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${b.title} down`}
                    disabled={i === banners.length - 1 || pending}
                    onClick={() => run(() => moveBannerAction(b.id, "down"))}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${b.title}`}
                    onClick={() => setEditing(b)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${b.title}`}
                    onClick={() => setDeleting(b)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <BannerDialog
        placement={placement}
        banner={null}
        vibes={vibes}
        open={creating}
        onOpenChange={setCreating}
        onSaved={() => router.refresh()}
      />
      <BannerDialog
        placement={placement}
        banner={editing}
        vibes={vibes}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => router.refresh()}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description="It disappears from the storefront straight away. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteBannerAction(deleting.id);
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
