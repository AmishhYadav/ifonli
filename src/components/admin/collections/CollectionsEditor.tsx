"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  setFeaturedOrderAction,
  updateTypeAction,
  updateVibeAction,
} from "@/app/admin/(app)/collections/actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/admin/ui";
import type {
  FeaturedProduct,
  TypeAdminRow,
  VibeAdminRow,
} from "@/server/services/admin/collections";

function useSave(refresh = true) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Could not save");
      toast.success(success);
      if (refresh) router.refresh();
    });
  return { pending, run };
}

function FeaturedOrder({ vibe, canEdit }: { vibe: VibeAdminRow; canEdit: boolean }) {
  const [list, setList] = React.useState<FeaturedProduct[]>(vibe.featured);
  const [adding, setAdding] = React.useState("");
  const { pending, run } = useSave();
  const dirty =
    JSON.stringify(list.map((p) => p.productId)) !==
    JSON.stringify(vibe.featured.map((p) => p.productId));
  const available = vibe.candidates
    .concat(vibe.featured)
    .filter((p) => !list.some((l) => l.productId === p.productId));

  function move(i: number, dir: -1 | 1) {
    const next = [...list];
    const j = i + dir;
    if (!next[i] || !next[j]) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-[13px] font-semibold">Featured order</h4>
        <p className="text-xs text-admin-ink-muted">
          Products here lead the vibe&apos;s featured sets, top first. Others follow by newest.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-admin-border-strong p-3 text-[13px] text-admin-ink-muted">
          Nothing featured: the newest products of this vibe are used.
        </p>
      ) : (
        <ol className="divide-y divide-admin-border rounded-lg border border-admin-border">
          {list.map((p, i) => (
            <li key={p.productId} className="flex items-center gap-2 px-3 py-1.5">
              <span className="tabular w-5 text-xs text-admin-ink-faint">{i + 1}</span>
              <span className="flex-1 truncate text-[13px]">{p.name}</span>
              {p.status !== "active" ? <Badge tone="warning">{p.status}</Badge> : null}
              {canEdit ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${p.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${p.name} down`}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setList(list.filter((x) => x.productId !== p.productId))}
                  >
                    <X aria-hidden />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={`Add product to ${vibe.name}`}
            className="w-64"
            value={adding}
            onValueChange={(id) => {
              const p = available.find((x) => x.productId === id);
              if (p) setList([...list, p]);
              setAdding("");
            }}
            options={available.map((p) => ({ value: p.productId, label: p.name }))}
            placeholder={available.length ? "Add a product…" : "All products added"}
            disabled={available.length === 0}
          />
          <Button
            size="sm"
            disabled={!dirty}
            loading={pending}
            onClick={() =>
              run(
                () =>
                  setFeaturedOrderAction(
                    vibe.id,
                    list.map((p) => p.productId),
                  ),
                "Featured order saved",
              )
            }
          >
            Save order
          </Button>
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => setList(vibe.featured)}>
              Reset
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VibeCard({ vibe, canEdit }: { vibe: VibeAdminRow; canEdit: boolean }) {
  const [v, setV] = React.useState({
    name: vibe.name,
    description: vibe.description ?? "",
    heroCopy: vibe.heroCopy ?? "",
    seoTitle: vibe.seoTitle ?? "",
    seoDesc: vibe.seoDesc ?? "",
  });
  const { pending, run } = useSave();
  const set =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value });
  const id = `vibe-${vibe.slug}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {vibe.name} <span className="font-normal text-admin-ink-muted">/vibes/{vibe.slug}</span>
        </CardTitle>
        <CardDescription>Copy for the vibe page and the products in it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateVibeAction(vibe.id, v), `${vibe.name} saved`);
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`} required>
            <Input id={`${id}-name`} value={v.name} onChange={set("name")} disabled={!canEdit} />
          </Field>
          <Field label="Description" htmlFor={`${id}-desc`}>
            <Textarea
              id={`${id}-desc`}
              rows={3}
              value={v.description}
              onChange={set("description")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Hero copy" htmlFor={`${id}-hero`}>
            <Input
              id={`${id}-hero`}
              value={v.heroCopy}
              onChange={set("heroCopy")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="SEO title" htmlFor={`${id}-st`}>
            <Input
              id={`${id}-st`}
              value={v.seoTitle}
              onChange={set("seoTitle")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="SEO description" htmlFor={`${id}-sd`}>
            <Textarea
              id={`${id}-sd`}
              rows={2}
              value={v.seoDesc}
              onChange={set("seoDesc")}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <Button type="submit" loading={pending} className="self-start">
              Save {vibe.name}
            </Button>
          ) : null}
        </form>
        <FeaturedOrder vibe={vibe} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

function TypeCard({ type, canEdit }: { type: TypeAdminRow; canEdit: boolean }) {
  const [t, setT] = React.useState({
    name: type.name,
    definition: type.definition ?? "",
    seoTitle: type.seoTitle ?? "",
    seoDesc: type.seoDesc ?? "",
    active: type.active,
  });
  const { pending, run } = useSave();
  const id = `type-${type.slug}`;
  const set =
    (k: "name" | "definition" | "seoTitle" | "seoDesc") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setT({ ...t, [k]: e.target.value });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {type.name} <span className="font-normal text-admin-ink-muted">/types/{type.slug}</span>
        </CardTitle>
        <CardDescription>{type.productCount} products</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-2xl gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateTypeAction(type.id, t), `${type.name} saved`);
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`} required>
            <Input id={`${id}-name`} value={t.name} onChange={set("name")} disabled={!canEdit} />
          </Field>
          <Field
            label="Definition"
            htmlFor={`${id}-def`}
            hint="What this type is, in the owner's words (shown on the type page)."
          >
            <Textarea
              id={`${id}-def`}
              rows={3}
              value={t.definition}
              onChange={set("definition")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="SEO title" htmlFor={`${id}-st`}>
            <Input
              id={`${id}-st`}
              value={t.seoTitle}
              onChange={set("seoTitle")}
              disabled={!canEdit}
            />
          </Field>
          <Field label="SEO description" htmlFor={`${id}-sd`}>
            <Textarea
              id={`${id}-sd`}
              rows={2}
              value={t.seoDesc}
              onChange={set("seoDesc")}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Visible on the storefront"
            htmlFor={`${id}-active`}
            hint="Turning this off hides every product of this type."
            inline
          >
            <Switch
              id={`${id}-active`}
              checked={t.active}
              onCheckedChange={(active) => setT({ ...t, active })}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <Button type="submit" loading={pending} className="self-start">
              Save {type.name}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function CollectionsEditor({
  vibes,
  types,
  canEdit,
}: {
  vibes: VibeAdminRow[];
  types: TypeAdminRow[];
  canEdit: boolean;
}) {
  return (
    <Tabs defaultValue="vibes">
      <TabsList>
        <TabsTrigger value="vibes">Vibes</TabsTrigger>
        <TabsTrigger value="types">Product types</TabsTrigger>
      </TabsList>
      <TabsContent value="vibes" className="flex flex-col gap-5">
        {vibes.map((v) => (
          <VibeCard key={v.id} vibe={v} canEdit={canEdit} />
        ))}
      </TabsContent>
      <TabsContent value="types" className="flex flex-col gap-5">
        {types.map((t) => (
          <TypeCard key={t.id} type={t} canEdit={canEdit} />
        ))}
      </TabsContent>
    </Tabs>
  );
}
