"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as React from "react";

import type { ActionResult } from "@/app/admin/_lib/action";
import { Select, Textarea, cn } from "@/components/admin/ui";
import { SETTINGS, SETTING_KEYS } from "@/server/services/settings-registry";

export interface MarkdownProblem {
  kind: string;
  token: string;
  message: string;
}
export interface MarkdownPreviewResult {
  html: string;
  problems: MarkdownProblem[];
}

const TOKEN_OPTIONS = SETTING_KEYS.map((key) => ({
  value: key,
  label: `${SETTINGS[key].label}  ·  settings.${key}`,
}));

const PROSE =
  "text-sm leading-relaxed text-admin-ink [&_a]:text-admin-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-admin-border-strong [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-admin-surface-2 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:my-4 [&_li]:mb-1 [&_mark]:rounded [&_mark]:bg-admin-warning-soft [&_mark]:px-0.5 [&_mark]:outline [&_mark]:outline-1 [&_mark]:outline-dashed [&_mark]:outline-admin-warning [&_mark[data-marker=unresolved]]:bg-admin-danger-soft [&_mark[data-marker=unresolved]]:outline-admin-danger [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_table]:mb-3 [&_table]:w-full [&_td]:border [&_td]:border-admin-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-admin-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5";

/**
 * Markdown textarea with a live preview through the same safe renderer the storefront uses. Settings tokens
 * (`{{settings.key}}`) are filled from the current settings; placeholder values are highlighted in amber and
 * missing ones in red, and every problem is listed below so nothing slips through to publishing.
 */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  preview,
  rows = 14,
  disabled,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  preview: (markdown: string) => Promise<ActionResult<MarkdownPreviewResult>>;
  rows?: number;
  disabled?: boolean;
  error?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [result, setResult] = React.useState<MarkdownPreviewResult | null>(null);
  const [failed, setFailed] = React.useState(false);
  const request = React.useRef(0);
  // Remounts the token picker after each pick so the same setting can be inserted again.
  const [pickerKey, setPickerKey] = React.useState(0);

  React.useEffect(() => {
    const mine = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const res = await preview(value);
        if (mine !== request.current) return; // a newer keystroke superseded this one
        if (res.ok) {
          setResult(res.data);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (mine === request.current) setFailed(true);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [value, preview]);

  function insertToken(key: string) {
    const token = `{{settings.${key}}}`;
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const problems = result?.problems ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-admin-ink">
            {label}
          </label>
          {disabled ? null : (
            <Select
              key={pickerKey}
              aria-label="Insert a setting token"
              className="h-8 w-64 max-w-full text-[13px]"
              value=""
              placeholder="Insert a setting…"
              options={TOKEN_OPTIONS}
              onValueChange={(key) => {
                insertToken(key);
                setPickerKey((n) => n + 1);
              }}
            />
          )}
        </div>
        <Textarea
          id={id}
          ref={ref}
          value={value}
          rows={rows}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : `${id}-problems`}
          className="min-h-72 font-mono text-[13px] leading-6"
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs text-admin-danger">
            {error}
          </p>
        ) : null}
        <div id={`${id}-problems`} aria-live="polite" data-testid="token-status">
          {result === null ? (
            <p className="text-xs text-admin-ink-muted">Checking settings tokens…</p>
          ) : problems.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-admin-success">
              <CheckCircle2 className="size-3.5" aria-hidden /> All settings tokens are filled in.
            </p>
          ) : (
            <div className="rounded-md border border-admin-warning/40 bg-admin-warning-soft p-2.5 text-xs text-admin-ink">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-admin-warning">
                <AlertTriangle className="size-3.5" aria-hidden />
                {problems.length} {problems.length === 1 ? "problem blocks" : "problems block"}{" "}
                publishing
              </p>
              <ul className="grid gap-0.5">
                {problems.map((p) => (
                  <li key={`${p.kind}:${p.token}`}>
                    <code className="rounded bg-admin-surface px-1">{`{{${p.token}}}`}</code>{" "}
                    {p.kind === "placeholder"
                      ? "is still a placeholder: set it in Settings."
                      : p.kind === "unresolved"
                        ? "has no value."
                        : p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium text-admin-ink" id={`${id}-preview-label`}>
          Preview
        </p>
        <div
          role="region"
          aria-labelledby={`${id}-preview-label`}
          className={cn(
            "min-h-72 overflow-auto rounded-md border border-admin-border bg-admin-surface p-4",
            failed && "opacity-60",
          )}
        >
          {result === null ? (
            <p className="text-[13px] text-admin-ink-faint">Rendering…</p>
          ) : result.html.trim() ? (
            <div
              className={PROSE}
              data-testid="markdown-preview"
              dangerouslySetInnerHTML={{ __html: result.html }}
            />
          ) : (
            <p className="text-[13px] text-admin-ink-faint">Nothing to preview yet.</p>
          )}
        </div>
        {failed ? (
          <p className="text-xs text-admin-danger">The preview could not be refreshed.</p>
        ) : null}
      </div>
    </div>
  );
}
