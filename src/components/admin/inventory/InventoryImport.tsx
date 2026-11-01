"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  applyInventoryImportAction,
  previewInventoryImportAction,
} from "@/app/admin/(app)/inventory/actions";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import { inputClasses } from "@/components/admin/ui/input";
import type { InventoryImportPreview } from "@/server/services/admin/inventory-import";

const MAX_CHARS = 600_000;
const fmt = (n: number) => n.toLocaleString("en-IN");

const REASONS = [
  { value: "adjust", label: "Stock count (the file has the counted numbers)" },
  { value: "correction", label: "Correction (data fix)" },
  { value: "restock", label: "Restock (new stock arrived, can only add)" },
];

/**
 * Stock CSV import. Step 1 reads the file in the browser and asks the server for a preview (old to
 * new for every SKU, problems per line); step 2 applies exactly that file, and the server refuses it
 * if any stock moved in between. A file with any problem line cannot be applied.
 */
export function InventoryImport() {
  const router = useRouter();
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [reason, setReason] = React.useState("adjust");
  const [note, setNote] = React.useState("");
  const [preview, setPreview] = React.useState<InventoryImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "apply" | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    setNote("");
    if (input.current) input.current.value = "";
  }

  async function runPreview(text: string, nextReason: string) {
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const res = await previewInventoryImportAction({ text, reason: nextReason, note });
      if (!res.ok) setError(res.error);
      else setPreview(res.data);
    } finally {
      setBusy(null);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    setPreview(null);
    setError(null);
    setFile(null);
    if (!picked) return;
    const text = await picked.text();
    if (text.length > MAX_CHARS) {
      setError("That file is too large (about 600 KB at most). Split it into smaller files.");
      return;
    }
    setFile({ name: picked.name, text });
    await runPreview(text, reason);
  }

  async function onReason(next: string) {
    setReason(next);
    if (file) await runPreview(file.text, next);
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await applyInventoryImportAction({
        text: file.text,
        fileName: file.name,
        reason,
        note,
        baseline: preview.baseline,
      });
      if (!res.ok) {
        setError(res.error);
        return void toast.error(res.error);
      }
      toast.success(`Stock updated for ${fmt(res.data.changed)} ${res.data.changed === 1 ? "variant" : "variants"}`);
      reset();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const c = preview?.counts;
  return (
    <Card id="import">
      <CardHeader>
        <CardTitle>Import stock from a CSV</CardTitle>
        <CardDescription>
          Needs two columns: <span className="font-mono">SKU</span> and <span className="font-mono">On hand</span>{" "}
          (the new count, not a change). The export above has exactly these, so download it, edit the{" "}
          <em>On hand</em> column in a spreadsheet and upload it again; other columns are ignored. Every change
          goes to the stock ledger with the reason you pick, and you see old and new numbers before anything is
          saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason for these changes" htmlFor="import-reason">
            <Select id="import-reason" value={reason} onValueChange={onReason} options={REASONS} />
          </Field>
          <Field label="Note (optional)" htmlFor="import-note" hint="Added to every ledger row, after the file name.">
            <Input id="import-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Field label="CSV file" htmlFor="inventory-csv" error={error ?? undefined}>
          <input
            ref={input}
            id="inventory-csv"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={onPick}
            disabled={busy !== null}
            className={`${inputClasses} h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-admin-surface-2 file:px-2.5 file:py-1 file:text-[13px] file:font-medium file:text-admin-ink`}
          />
        </Field>

        {busy === "preview" ? (
          <p className="text-[13px] text-admin-ink-muted" role="status">
            Checking {file?.name}…
          </p>
        ) : null}

        {preview && c ? (
          <div className="grid gap-4" data-testid="inventory-import-preview">
            <p className="text-sm" role="status">
              <strong>{file?.name}</strong>: {fmt(c.lines)} {c.lines === 1 ? "line" : "lines"}.{" "}
              <strong>{fmt(c.changed)}</strong> would change
              {c.changed > 0 ? (
                <>
                  {" "}
                  ({fmt(c.unitsAdded)} units added, {fmt(c.unitsRemoved)} removed)
                </>
              ) : null}
              , {fmt(c.unchanged)} already match
              {preview.issues.total > 0 ? (
                <>
                  , and{" "}
                  <strong className="text-admin-danger">
                    {fmt(preview.issues.total)} {preview.issues.total === 1 ? "line has a problem" : "lines have problems"}
                  </strong>
                </>
              ) : null}
              .
            </p>

            {preview.issues.total > 0 ? (
              <div className="grid gap-2">
                <h4 className="text-[13px] font-semibold">
                  Problems
                  {preview.issues.total > preview.issues.items.length ? ` (first ${preview.issues.items.length})` : ""}
                </h4>
                <div className="max-h-64 overflow-auto rounded-md border border-admin-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-20">Line</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.issues.items.map((i, n) => (
                        <TableRow key={`${i.line}:${n}`} data-testid="inventory-import-issue">
                          <TableCell className="tabular">{i.line || "File"}</TableCell>
                          <TableCell>{i.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[13px] text-admin-ink-muted">
                  Fix these lines and upload the file again. A file with problems is not applied at all.
                </p>
              </div>
            ) : null}

            {preview.changes.length > 0 ? (
              <div className="grid gap-2">
                <h4 className="text-[13px] font-semibold">
                  What will change
                  {c.changed > preview.changes.length ? ` (first ${preview.changes.length} of ${fmt(c.changed)})` : ""}
                </h4>
                <div className="max-h-72 overflow-auto rounded-md border border-admin-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Now</TableHead>
                        <TableHead className="text-right">New</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.changes.map((ch) => (
                        <TableRow key={ch.variantId}>
                          <TableCell>
                            <span className="block font-medium">{ch.productName}</span>
                            <span className="block text-xs text-admin-ink-muted">
                              {ch.variantTitle !== "Default" ? `${ch.variantTitle} · ` : ""}
                              <span className="font-mono">{ch.sku}</span>
                            </span>
                            {ch.warning ? (
                              <Badge tone="warning" className="mt-1 whitespace-normal">
                                {ch.warning}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="tabular text-right">{fmt(ch.from)}</TableCell>
                          <TableCell className="tabular text-right">{fmt(ch.to)}</TableCell>
                          <TableCell className="tabular text-right">
                            <Badge tone={ch.delta > 0 ? "success" : "danger"}>
                              {ch.delta > 0 ? "+" : "−"}
                              {fmt(Math.abs(ch.delta))}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={apply} loading={busy === "apply"} disabled={!preview.canApply || busy !== null}>
                <Upload aria-hidden /> Apply {fmt(c.changed)} {c.changed === 1 ? "change" : "changes"}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
