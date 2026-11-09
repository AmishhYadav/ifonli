"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { prepareSupportPhotosAction, reportProblemAction } from "@/features/orders/actions";
import {
  SUPPORT_DESCRIPTION_MAX,
  SUPPORT_DESCRIPTION_MIN,
  SUPPORT_PHOTO_MAX,
  SUPPORT_PHOTO_MAX_BYTES,
  SUPPORT_PHOTO_TYPES,
  SUPPORT_TYPE_LABELS,
  validatePhotoFiles,
  type SupportField,
  type SupportType,
} from "@/features/orders/support-schema";

export interface ReportProblemDialogProps {
  orderRef: string;
  token?: string;
  /** Types this order can take right now (empty hides the button). */
  types: readonly SupportType[];
  claimWindowHours: number;
  windowEnded: boolean;
  /** False when photo storage is not configured: the picker is replaced by a short note. */
  photosAvailable: boolean;
  /** Where the acknowledgement e-mail goes. */
  email: string;
}

const ACCEPT = Object.keys(SUPPORT_PHOTO_TYPES).join(",");

/** The same order as the "Report a problem" steps in the Returns and Refunds Policy. */
const STEPS = [
  { title: "What went wrong?" },
  { title: "Describe it" },
  { title: "Add photos" },
  { title: "Review and send" },
] as const;
const LAST_STEP = STEPS.length;

/**
 * "Report a problem" (plan 7.8, C-17). Plain, kind wording: nothing here argues with the customer. The
 * claim window never blocks a report; past it we say so gently and still take it.
 */
export function ReportProblemDialog({
  orderRef,
  token,
  types,
  claimWindowHours,
  windowEnded,
  photosAvailable,
  email,
}: ReportProblemDialogProps) {
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [type, setType] = useState<SupportType | "">("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SupportField, string>>>({});

  if (types.length === 0) return null;

  function reset() {
    setStep(1);
    setType("");
    setDescription("");
    setFiles([]);
    setError(null);
    setFieldErrors({});
    setDone(false);
  }

  function pickFiles(list: FileList | null) {
    const picked = [...(list ?? [])];
    const next = [...files, ...picked].slice(0, SUPPORT_PHOTO_MAX + 1);
    const problem = validatePhotoFiles(next);
    setFieldErrors((prev) => ({ ...prev, photoPaths: problem ?? undefined }));
    setFiles(problem ? files : next);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Checks one step's fields; returns true when the customer can move on. */
  function validateStep(which: number): boolean {
    const errors: Partial<Record<SupportField, string>> = {};
    if (which === 1 && !type) errors.type = "Choose what went wrong";
    if (which === 2) {
      const len = description.trim().length;
      if (len < SUPPORT_DESCRIPTION_MIN) {
        errors.description = `Write at least ${SUPPORT_DESCRIPTION_MIN} characters so we can help`;
      } else if (len > SUPPORT_DESCRIPTION_MAX) {
        errors.description = `Keep it under ${SUPPORT_DESCRIPTION_MAX} characters`;
      }
    }
    setFieldErrors((prev) => ({ ...prev, type: undefined, description: undefined, ...errors }));
    return Object.keys(errors).length === 0;
  }

  function next() {
    setError(null);
    if (validateStep(step)) setStep(step + 1);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (step < LAST_STEP) {
      next();
      return;
    }
    if (!validateStep(1)) return setStep(1);
    if (!validateStep(2)) return setStep(2);
    const text = description.trim();

    setBusy(true);
    try {
      let photoPaths: string[] = [];
      if (files.length > 0) {
        const prepared = await prepareSupportPhotosAction({
          ref: orderRef,
          token,
          files: files.map((f) => ({ type: f.type, size: f.size })),
        });
        if (!prepared.ok) {
          setError(prepared.message);
          return;
        }
        const puts = await Promise.all(
          prepared.uploads.map((upload, i) =>
            fetch(upload.url, {
              method: "PUT",
              body: files[i],
              headers: { "Content-Type": files[i]!.type, "x-upsert": "false" },
            }),
          ),
        );
        if (puts.some((res) => !res.ok)) {
          setError(
            "A photo didn't upload. Check your connection and try again, or send your report without it.",
          );
          return;
        }
        photoPaths = prepared.uploads.map((u) => u.path);
      }
      const result = await reportProblemAction({
        ref: orderRef,
        token,
        type: type as SupportType,
        description: text,
        photoPaths,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.message);
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const maxMb = Math.round(SUPPORT_PHOTO_MAX_BYTES / (1024 * 1024));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next && done) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" iconStart="alert-circle" data-testid="report-problem">
          Report a problem
        </Button>
      </DialogTrigger>
      <DialogContent
        title={done ? "We've got your report" : "Report a problem"}
        description={
          done
            ? undefined
            : "Tell us what's wrong and we'll make it right. A real person reads every report."
        }
        footer={
          done ? (
            <DialogClose asChild>
              <Button data-testid="report-close">Close</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  Not now
                </Button>
              </DialogClose>
              {step > 1 ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStep(step - 1)}
                  data-testid="report-back"
                >
                  Back
                </Button>
              ) : null}
              {step < LAST_STEP ? (
                <Button onClick={next} data-testid="report-next">
                  Next
                </Button>
              ) : (
                <Button
                  type="submit"
                  form="report-problem-form"
                  loading={busy}
                  data-testid="report-submit"
                >
                  Send report
                </Button>
              )}
            </>
          )
        }
      >
        {done ? (
          <div className="flex flex-col gap-3" role="status" data-testid="report-done">
            <p className="flex items-start gap-2 text-base">
              <Icon name="check" className="mt-0.5 size-5 flex-none" />
              Thank you for telling us. We&apos;ve emailed a confirmation to {email} and will reply
              there after we&apos;ve looked at your report.
            </p>
          </div>
        ) : (
          <form
            id="report-problem-form"
            onSubmit={(e) => void submit(e)}
            noValidate
            className="flex flex-col gap-5"
          >
            {windowEnded && claimWindowHours > 0 ? (
              <p
                className="flex items-start gap-2 rounded-card bg-surface-2 p-3 text-sm"
                data-testid="report-late-note"
              >
                <Icon name="info" className="mt-0.5 size-4 flex-none" />
                It&apos;s been more than our usual {claimWindowHours} hours since delivery. Please
                tell us anyway: we&apos;ll look at every report.
              </p>
            ) : claimWindowHours > 0 ? (
              <p className="text-sm text-ink-muted">
                Reports about damage are easiest to sort out within {claimWindowHours} hours of
                delivery.
              </p>
            ) : null}

            <p
              className="text-sm font-semibold text-ink"
              aria-live="polite"
              data-testid="report-step"
            >
              Step {step} of {LAST_STEP}: {STEPS[step - 1]!.title}
            </p>

            {step === 1 ? (
              <div>
                <RadioGroup
                  legend="What went wrong?"
                  value={type}
                  onValueChange={(v) => setType(v as SupportType)}
                  disabled={busy}
                >
                  {types.map((t) => (
                    <Radio key={t} value={t} label={SUPPORT_TYPE_LABELS[t]} />
                  ))}
                </RadioGroup>
                <div aria-live="polite">
                  {fieldErrors.type ? (
                    <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-danger">
                      <Icon name="alert-circle" className="mt-0.5 size-4" />
                      {fieldErrors.type}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <>
                <p className="text-sm text-ink-muted">
                  Order reference:{" "}
                  <span className="font-semibold text-ink" data-testid="report-order-ref">
                    {orderRef}
                  </span>
                </p>
                <Field
                  label="What happened?"
                  required
                  hint={`${description.trim().length}/${SUPPORT_DESCRIPTION_MAX}. Which item, and what's wrong with it?`}
                  error={fieldErrors.description}
                >
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={SUPPORT_DESCRIPTION_MAX + 200}
                    disabled={busy}
                    data-testid="report-description"
                  />
                </Field>
              </>
            ) : null}

            {step === 3 ? (
              photosAvailable ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor={fileId} className="text-sm font-semibold text-ink">
                    Photos (optional)
                  </label>
                  <p id={`${fileId}-hint`} className="text-sm text-ink-muted">
                    Up to {SUPPORT_PHOTO_MAX} photos, JPEG, PNG or WebP, {maxMb} MB each. A clear
                    photo helps us fix it faster.
                  </p>
                  <ul className="list-disc pl-5 text-sm text-ink-muted">
                    <li>The outside of the parcel and its shipping label</li>
                    <li>The item</li>
                    <li>The damage, or the wrong item</li>
                  </ul>
                  <p className="text-sm text-ink-muted">
                    An unboxing video also helps if you have one. Email it to us after you send this
                    report.
                  </p>
                  <input
                    ref={fileRef}
                    id={fileId}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    disabled={busy || files.length >= SUPPORT_PHOTO_MAX}
                    aria-describedby={`${fileId}-hint`}
                    onChange={(e) => pickFiles(e.target.files)}
                    className="ui-control min-h-11 w-full rounded-input border-0 bg-field px-3 py-2 text-base text-ink file:mr-3 file:min-h-9 file:rounded-button file:border-0 file:bg-surface-2 file:px-3 file:font-semibold file:text-ink"
                  />
                  {files.length > 0 ? (
                    <ul className="flex flex-col gap-1" data-testid="report-files">
                      {files.map((file, i) => (
                        <li
                          key={`${file.name}-${i}`}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 truncate">{file.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div aria-live="polite">
                    {fieldErrors.photoPaths ? (
                      <p className="flex items-start gap-1.5 text-sm font-semibold text-danger">
                        <Icon name="alert-circle" className="mt-0.5 size-4" />
                        {fieldErrors.photoPaths}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-muted" data-testid="report-no-photos">
                  Photo upload isn&apos;t available right now. Send your report as it is and, if we
                  need photos, we&apos;ll ask for them by email.
                </p>
              )
            ) : null}

            {step === LAST_STEP ? (
              <div className="flex flex-col gap-3" data-testid="report-review">
                <dl className="flex flex-col gap-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="font-semibold">Order</dt>
                    <dd>{orderRef}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-semibold">Problem</dt>
                    <dd>{type ? SUPPORT_TYPE_LABELS[type] : ""}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-semibold">Photos</dt>
                    <dd>{files.length}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">What happened</dt>
                    <dd className="whitespace-pre-wrap text-ink-muted">{description.trim()}</dd>
                  </div>
                </dl>
                <p className="flex items-start gap-2 rounded-card bg-surface-2 p-3 text-sm">
                  <Icon name="info" className="mt-0.5 size-4 flex-none" />
                  Please keep the item and the packaging until we have resolved your report.
                </p>
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 text-base font-semibold text-danger"
                data-testid="report-error"
              >
                <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
                {error}
              </p>
            ) : null}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
