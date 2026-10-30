"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Save, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { toast } from "sonner";

import {
  createProductAction,
  duplicateProductAction,
  setProductStatusAction,
  updateProductAction,
} from "@/app/admin/(app)/products/actions";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Form,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@/components/admin/ui";
import {
  formToInput,
  productFormSchema,
  type ProductFormValues,
} from "@/server/services/admin/product-schema";
import type { ProductFormOptions } from "@/server/services/admin/products";

import { DetailsTab } from "./DetailsTab";
import { ImagesTab, type ImageView } from "./ImagesTab";
import { LegalTab } from "./LegalTab";
import { SeoTab } from "./SeoTab";
import { VariantsTab } from "./VariantsTab";
import { VibesTab } from "./VibesTab";

const TABS = [
  {
    id: "details",
    label: "Details",
    fields: ["name", "slug", "descriptionMd", "typeId", "status", "isKit"],
  },
  { id: "vibes", label: "Vibes", fields: ["vibes"] },
  { id: "variants", label: "Options & variants", fields: ["options", "variants"] },
  { id: "images", label: "Images & cutouts", fields: [] },
  { id: "seo", label: "SEO", fields: ["seoTitle", "seoDesc"] },
  {
    id: "legal",
    label: "Legal & tax",
    fields: [
      "hsnCode",
      "gstRatePercent",
      "countryOfOrigin",
      "netQuantity",
      "dimensions",
      "manufacturerName",
      "manufacturerAddress",
    ],
  },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_TONE = { active: "success", draft: "neutral", archived: "warning" } as const;

function tabOf(field: string): TabId | null {
  return TABS.find((t) => (t.fields as readonly string[]).includes(field))?.id ?? null;
}

export function ProductForm({
  options,
  defaultValues,
  productId,
  images,
  siteHost,
  permissions,
  meta,
}: {
  options: ProductFormOptions;
  defaultValues: ProductFormValues;
  productId: string | null;
  images: ImageView[];
  siteHost: string;
  permissions: { create: boolean; update: boolean; archive: boolean };
  meta?: { status: "draft" | "active" | "archived"; name: string };
}) {
  const router = useRouter();
  const isNew = productId === null;
  const storageKey = `admin-product-tab:${productId ?? "new"}`;
  const [tab, setTab] = React.useState<TabId>("details");
  const [saving, startSaving] = React.useTransition();
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  // Restore the tab after the form remounts (every save refreshes the page). Read after mount, in a
  // microtask, so server and first client render agree.
  React.useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = sessionStorage.getItem(storageKey) as TabId | null;
        if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
      } catch {
        /* storage unavailable: start on Details */
      }
    });
  }, [storageKey]);
  function changeTab(next: string) {
    setTab(next as TabId);
    try {
      sessionStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  }

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
    mode: "onTouched",
  });
  const { handleSubmit, formState, setError, reset } = form;
  const { isDirty, errors } = formState;

  // Next keeps a navigated-away page mounted (hidden) to preserve its state. A "new product" form
  // must not come back pre-filled with a product that was already created, so reset it when hidden.
  React.useEffect(() => {
    if (!isNew) return;
    return () => reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  React.useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const errorTabs = new Set<TabId>();
  for (const key of Object.keys(errors)) {
    const t = tabOf(key);
    if (t) errorTabs.add(t);
  }

  function onInvalid(fieldErrors: FieldErrors<ProductFormValues>) {
    const firstTab = Object.keys(fieldErrors).map(tabOf).find(Boolean);
    if (firstTab) changeTab(firstTab);
    toast.error("Some fields need attention");
  }

  function onValid(values: ProductFormValues) {
    startSaving(async () => {
      const input = formToInput(values);
      const res = isNew
        ? await createProductAction(input)
        : await updateProductAction(productId, input);
      if (!res.ok) {
        for (const [path, message] of Object.entries(res.fieldErrors ?? {})) {
          setError(path as never, { type: "server", message });
        }
        const firstTab = Object.keys(res.fieldErrors ?? {})
          .map((p) => tabOf(p.split(".")[0]!))
          .find(Boolean);
        if (firstTab) changeTab(firstTab);
        toast.error(res.error);
        return;
      }
      toast.success(isNew ? "Product created" : "Product saved");
      if (isNew) {
        router.replace(`/admin/products/${res.data.id}`);
      } else {
        // The page re-renders with fresh server data (new ids) and remounts this form.
        router.refresh();
      }
    });
  }

  async function duplicate() {
    if (!productId) return;
    const res = await duplicateProductAction(productId);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Duplicated as a draft");
    router.push(`/admin/products/${res.data.id}`);
  }

  async function setStatus(status: "archived" | "draft") {
    if (!productId) return;
    const res = await setProductStatusAction(productId, status);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(status === "archived" ? "Product archived" : "Product restored as a draft");
    router.refresh();
  }

  const status = meta?.status;
  const watchedName = useWatch({ control: form.control, name: "name" });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
        <PageHeader
          back={{ href: "/admin/products", label: "Products" }}
          title={isNew ? "New product" : meta?.name || watchedName || "Product"}
          badges={
            status ? (
              <Badge tone={STATUS_TONE[status]} className="capitalize">
                {status}
              </Badge>
            ) : undefined
          }
          actions={
            <>
              {isDirty && !isNew ? (
                <Button variant="ghost" onClick={() => reset(defaultValues)} disabled={saving}>
                  <Undo2 aria-hidden /> Discard
                </Button>
              ) : null}
              {!isNew ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions">
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {permissions.create ? (
                      <DropdownMenuItem onSelect={duplicate}>
                        <Copy aria-hidden /> Duplicate as draft
                      </DropdownMenuItem>
                    ) : null}
                    {permissions.archive && status !== "archived" ? (
                      <DropdownMenuItem destructive onSelect={() => setConfirmArchive(true)}>
                        <Archive aria-hidden /> Archive
                      </DropdownMenuItem>
                    ) : null}
                    {permissions.update && status === "archived" ? (
                      <DropdownMenuItem onSelect={() => void setStatus("draft")}>
                        <ArchiveRestore aria-hidden /> Restore as draft
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Button
                type="submit"
                loading={saving}
                disabled={!permissions.update && !permissions.create}
              >
                {saving ? null : <Save aria-hidden />}
                {isNew ? "Create product" : "Save changes"}
              </Button>
            </>
          }
        />

        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList aria-label="Product sections">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
                {errorTabs.has(t.id) ? (
                  <span
                    className="size-1.5 rounded-full bg-admin-danger"
                    role="img"
                    aria-label="has errors"
                  />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* forceMount keeps every tab's inputs registered so hidden tabs still submit and validate. */}
          <TabsContent value="details" forceMount className={cn(tab !== "details" && "hidden")}>
            <DetailsTab options={options} productId={productId ?? undefined} isNew={isNew} />
          </TabsContent>
          <TabsContent value="vibes" forceMount className={cn(tab !== "vibes" && "hidden")}>
            <VibesTab options={options} />
          </TabsContent>
          <TabsContent value="variants" forceMount className={cn(tab !== "variants" && "hidden")}>
            <VariantsTab />
          </TabsContent>
          <TabsContent value="images" forceMount className={cn(tab !== "images" && "hidden")}>
            <ImagesTab productId={productId} initialImages={images} canEdit={permissions.update} />
          </TabsContent>
          <TabsContent value="seo" forceMount className={cn(tab !== "seo" && "hidden")}>
            <SeoTab siteHost={siteHost} />
          </TabsContent>
          <TabsContent value="legal" forceMount className={cn(tab !== "legal" && "hidden")}>
            <LegalTab />
          </TabsContent>
        </Tabs>
      </form>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this product?"
        description="It is removed from the storefront (pages, search, sitemap). Orders keep their snapshot. You can restore it later."
        confirmLabel="Archive"
        destructive
        onConfirm={() => setStatus("archived")}
      />
    </Form>
  );
}
