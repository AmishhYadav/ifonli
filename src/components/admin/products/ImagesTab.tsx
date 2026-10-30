"use client";

import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { toast } from "sonner";

import {
  deleteImageAction,
  prepareImageUploadAction,
  registerImageAction,
  reorderImagesAction,
  updateImageAltAction,
} from "@/app/admin/(app)/products/actions";
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
  EmptyState,
  Field,
  Input,
} from "@/components/admin/ui";

export interface ImageView {
  id: string;
  kind: "photo" | "cutout";
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
  isPlaceholder: boolean;
  url: string | null;
}

type Kind = ImageView["kind"];

const COPY: Record<Kind, { title: string; description: string; accept: string; add: string }> = {
  photo: {
    title: "Photos",
    description:
      "Product photography shown on the product page and cards. JPEG, PNG, WebP or AVIF. The first one is the main image.",
    accept: "image/jpeg,image/png,image/webp,image/avif",
    add: "Add photo",
  },
  cutout: {
    title: "Cutouts",
    description:
      "Transparent PNG or WebP of the product, used for the hero tiles and vibe stages. Needs an alpha channel; 1200 px or more, roughly square.",
    accept: "image/png,image/webp",
    add: "Add cutout",
  },
};

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  return file.type.split("/")[1] ?? "";
}

function UploadDialog({
  productId,
  kind,
  open,
  onOpenChange,
  onAdded,
}: {
  productId: string;
  kind: Kind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (image: ImageView) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [alt, setAlt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // The dialog is portalled but still a React child of the product form: without this its submit
    // event would bubble up and save the whole product.
    e.stopPropagation();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareImageUploadAction({
        productId,
        kind,
        extension: extensionOf(file),
      });
      if (!prepared.ok) throw new Error(prepared.error);
      const put = await fetch(prepared.data.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const done = await registerImageAction({
        productId,
        kind,
        dbPath: prepared.data.dbPath,
        alt,
      });
      if (!done.ok) throw new Error(done.error);
      for (const w of done.data.warnings) toast.warning(w, { duration: 8000 });
      toast.success(`${kind === "photo" ? "Photo" : "Cutout"} added`);
      onAdded({ ...done.data.image, url: done.data.url });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{COPY[kind].add}</DialogTitle>
            <DialogDescription>{COPY[kind].description}</DialogDescription>
          </DialogHeader>
          <Field label="Image file" htmlFor="img-file" required>
            <input
              id="img-file"
              type="file"
              accept={COPY[kind].accept}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-admin-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-admin-border"
            />
          </Field>
          <Field
            label="Alt text"
            htmlFor="img-alt"
            required
            hint="Describe what is in the picture for screen readers and search."
            error={error ?? undefined}
          >
            <Input
              id="img-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={300}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!file || !alt.trim()}>
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImageCard({
  image,
  index,
  count,
  onMove,
  onDelete,
  onAltSaved,
  canEdit,
}: {
  image: ImageView;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAltSaved: (alt: string) => void;
  canEdit: boolean;
}) {
  const [alt, setAlt] = React.useState(image.alt);
  const [saving, setSaving] = React.useState(false);

  async function saveAlt() {
    const next = alt.trim();
    if (next === image.alt) return;
    if (!next) {
      setAlt(image.alt);
      toast.error("Alt text is required");
      return;
    }
    setSaving(true);
    const res = await updateImageAltAction(image.id, next);
    setSaving(false);
    if (res.ok) onAltSaved(next);
    else {
      toast.error(res.error);
      setAlt(image.alt);
    }
  }

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-admin-border bg-admin-surface">
      <div className="relative aspect-square bg-admin-surface-2 [background-image:repeating-conic-gradient(var(--admin-border)_0_25%,transparent_0_50%)] [background-size:16px_16px]">
        {image.url ? (
          <Image
            src={image.url}
            alt={image.alt}
            fill
            sizes="200px"
            className="object-contain p-1"
            unoptimized
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-admin-ink-faint">
            No preview
          </span>
        )}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {index === 0 ? <Badge tone="primary">Main</Badge> : null}
          {image.isPlaceholder ? <Badge tone="warning">Placeholder</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="relative">
          <Input
            aria-label="Alt text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={saveAlt}
            disabled={!canEdit}
            className="h-8 text-xs"
          />
          {saving ? (
            <Loader2
              className="absolute top-2 right-2 size-4 animate-spin text-admin-ink-faint"
              aria-hidden
            />
          ) : null}
        </div>
        {image.width && image.height ? (
          <p className="tabular text-[11px] text-admin-ink-muted">
            {image.width}×{image.height}px
          </p>
        ) : null}
        {canEdit ? (
          <div className="mt-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Move earlier"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Move later"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="danger-outline"
              size="icon-sm"
              className="ml-auto"
              aria-label="Delete image"
              onClick={onDelete}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Section({
  kind,
  productId,
  images,
  setImages,
  canEdit,
}: {
  kind: Kind;
  productId: string;
  images: ImageView[];
  setImages: React.Dispatch<React.SetStateAction<ImageView[]>>;
  canEdit: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ImageView | null>(null);
  const mine = images.filter((i) => i.kind === kind);

  async function move(index: number, dir: -1 | 1) {
    const next = [...mine];
    const target = index + dir;
    if (!next[index] || !next[target]) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    const before = images;
    setImages((all) => [...all.filter((i) => i.kind !== kind), ...next]);
    const res = await reorderImagesAction(
      productId,
      kind,
      next.map((i) => i.id),
    );
    if (!res.ok) {
      setImages(before);
      toast.error(res.error);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{COPY[kind].title}</CardTitle>
          <CardDescription>{COPY[kind].description}</CardDescription>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setUploading(true)}>
            <ImagePlus aria-hidden /> {COPY[kind].add}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {mine.length === 0 ? (
          <EmptyState
            title={`No ${COPY[kind].title.toLowerCase()} yet`}
            description="Products without images show a blank tile on the storefront."
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {mine.map((image, i) => (
              <ImageCard
                key={image.id}
                image={image}
                index={i}
                count={mine.length}
                canEdit={canEdit}
                onMove={(dir) => move(i, dir)}
                onDelete={() => setDeleting(image)}
                onAltSaved={(alt) =>
                  setImages((all) => all.map((x) => (x.id === image.id ? { ...x, alt } : x)))
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
      <UploadDialog
        key={uploading ? "open" : "closed"}
        productId={productId}
        kind={kind}
        open={uploading}
        onOpenChange={setUploading}
        onAdded={(img) => setImages((all) => [...all, img])}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this image?"
        description="It disappears from the storefront immediately. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteImageAction(deleting.id);
          if (!res.ok) {
            toast.error(res.error);
            throw new Error(res.error);
          }
          setImages((all) => all.filter((x) => x.id !== deleting.id));
          toast.success("Image deleted");
        }}
      />
    </Card>
  );
}

export function ImagesTab({
  productId,
  initialImages,
  canEdit,
}: {
  productId: string | null;
  initialImages: ImageView[];
  canEdit: boolean;
}) {
  const [images, setImages] = React.useState(initialImages);
  if (!productId) {
    return (
      <EmptyState
        title="Save the product first"
        description="Images attach to a saved product. Create it as a draft, then come back to add photos and cutouts."
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Section
        kind="photo"
        productId={productId}
        images={images}
        setImages={setImages}
        canEdit={canEdit}
      />
      <Section
        kind="cutout"
        productId={productId}
        images={images}
        setImages={setImages}
        canEdit={canEdit}
      />
    </div>
  );
}
