"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { applyPincodeCsvAction, previewPincodeCsvAction } from "@/app/admin/(app)/pincodes/actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import { inputClasses } from "@/components/admin/ui/input";
import type { PincodeCsvPreview } from "@/server/services/admin/pincodes";

const MAX_CHARS = 900_000;
const fmt = (n: number) => n.toLocaleString("en-IN");
const yn = (v: boolean) => (v ? "yes" : "no");

/**
 * Upload step 1 reads the file in the browser and asks the server for a preview (problems per line
 * and what would change); step 2 applies exactly that file. A file with any problem line cannot be
 * applied, so the preview is always what gets saved.
 */
export function PincodeCsvImport() {
  const router = useRouter();
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = React.useState<PincodeCsvPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "apply" | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    setPreview(null);
    setError(null);
    setFile(null);
    if (!picked) return;
    const text = await picked.text();
    if (text.length > MAX_CHARS) {
      setError("That file is too large (about 1 MB at most). Split it into smaller files.");
      return;
    }
    setFile({ name: picked.name, text });
    setBusy("preview");
    try {
      const res = await previewPincodeCsvAction(text);
      if (!res.ok) setError(res.error);
      else setPreview(res.data);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy("apply");
    try {
      const res = await applyPincodeCsvAction({
        text: file.text,
        fileName: file.name,
        expectedChanges: preview.counts.changed,
      });
      if (!res.ok) {
        setError(res.error);
        return void toast.error(res.error);
      }
      toast.success(`${fmt(res.data.changed)} pincodes updated`);
      reset();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const c = preview?.counts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a CSV</CardTitle>
        <CardDescription>
          Columns <span className="font-mono">pincode,serviceable,cod_allowed</span> with yes or no (true
          and false work too); leave a cell empty to keep that flag as it is. Download the current list
          above, edit it and upload it again, or write your own. Only pincodes already in the directory
          can be changed. You see the result before anything is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="CSV file" htmlFor="pincode-csv" error={error ?? undefined}>
          <input
            ref={input}
            id="pincode-csv"
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
          <div className="grid gap-4" data-testid="pincode-csv-preview">
            <p className="text-sm" role="status">
              <strong>{file?.name}</strong>: {fmt(c.lines)} {c.lines === 1 ? "line" : "lines"}.{" "}
              <strong>{fmt(c.changed)}</strong> would change
              {c.changed > 0 ? (
                <>
                  {" "}
                  ({[
                    c.serviceableOff ? `${fmt(c.serviceableOff)} turned unserviceable` : null,
                    c.serviceableOn ? `${fmt(c.serviceableOn)} made serviceable` : null,
                    c.codOff ? `${fmt(c.codOff)} COD off` : null,
                    c.codOn ? `${fmt(c.codOn)} COD on` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")})
                </>
              ) : null}
              , {fmt(c.unchanged)} already match
              {preview.issueCount > 0 ? (
                <>
                  , and <strong className="text-admin-danger">{fmt(preview.issueCount)} {preview.issueCount === 1 ? "line has a problem" : "lines have problems"}</strong>
                </>
              ) : null}
              .
            </p>

            {preview.issueCount > 0 ? (
              <div className="grid gap-2">
                <h4 className="text-[13px] font-semibold">
                  Problems{preview.issueCount > preview.issues.length ? ` (first ${preview.issues.length})` : ""}
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
                      {preview.issues.map((i, n) => (
                        <TableRow key={`${i.line}:${n}`} data-testid="pincode-csv-issue">
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
                <div className="max-h-64 overflow-auto rounded-md border border-admin-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Pincode</TableHead>
                        <TableHead>District</TableHead>
                        <TableHead>Serviceable</TableHead>
                        <TableHead>COD allowed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.changes.map((ch) => (
                        <TableRow key={ch.pincode}>
                          <TableCell className="font-mono">{ch.pincode}</TableCell>
                          <TableCell>{ch.district}</TableCell>
                          <TableCell>
                            {ch.serviceable.from === ch.serviceable.to ? (
                              <span className="text-admin-ink-muted">{yn(ch.serviceable.to)}</span>
                            ) : (
                              <Badge tone={ch.serviceable.to ? "success" : "danger"}>
                                {yn(ch.serviceable.from)} to {yn(ch.serviceable.to)}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {ch.codAllowed.from === ch.codAllowed.to ? (
                              <span className="text-admin-ink-muted">{yn(ch.codAllowed.to)}</span>
                            ) : (
                              <Badge tone={ch.codAllowed.to ? "success" : "warning"}>
                                {yn(ch.codAllowed.from)} to {yn(ch.codAllowed.to)}
                              </Badge>
                            )}
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
