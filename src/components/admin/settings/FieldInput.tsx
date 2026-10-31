"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import * as React from "react";

import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  cn,
} from "@/components/admin/ui";

import type { Draft, Node, Option } from "./field-model";

type Rec = { [key: string]: Draft | undefined };
const isRec = (d: Draft | undefined): d is Rec =>
  typeof d === "object" && d !== null && !Array.isArray(d);

export interface FieldInputProps {
  node: Node;
  draft: Draft | undefined;
  onChange: (next: Draft) => void;
  /** Stable DOM id base (unique per setting + path). */
  id: string;
  label: string;
  /** Dotted path of this field inside the setting's value ("" for the root). */
  path: string;
  errors: Record<string, string>;
  disabled?: boolean;
  hint?: React.ReactNode;
  /** Render the label visually hidden (the card title already says it). */
  hideLabel?: boolean;
}

const sub = (path: string, key: string) => (path ? `${path}.${key}` : key);

function ChoiceList({
  id,
  label,
  options,
  value,
  ordered,
  onChange,
  disabled,
  error,
  hint,
}: {
  id: string;
  label: string;
  options: Option[];
  value: string[];
  ordered: boolean;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
  hint?: React.ReactNode;
}) {
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const unselected = options.filter((o) => !value.includes(o.value));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...value];
    const j = i + dir;
    if (!next[i] || !next[j]) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <fieldset
      className="grid gap-1.5"
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-admin-ink">{label}</legend>
      {ordered ? (
        <>
          <ol className="divide-y divide-admin-border rounded-lg border border-admin-border">
            {value.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-admin-ink-muted">Nothing selected.</li>
            ) : null}
            {value.map((v, i) => (
              <li key={v} className="flex items-center gap-2 px-3 py-1.5">
                <span className="tabular w-5 text-xs text-admin-ink-faint">{i + 1}</span>
                <span className="flex-1 text-[13px]">{labelOf(v)}</span>
                {disabled ? null : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${labelOf(v)} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${labelOf(v)} down`}
                      disabled={i === value.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${labelOf(v)}`}
                      onClick={() => onChange(value.filter((x) => x !== v))}
                    >
                      <X aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {disabled || unselected.length === 0 ? null : (
            <Select
              aria-label={`Add to ${label}`}
              className="w-56"
              value=""
              placeholder="Add…"
              options={unselected}
              onValueChange={(v) => onChange([...value, v])}
              key={value.join(",")}
            />
          )}
        </>
      ) : (
        <div className="grid gap-1 rounded-md border border-admin-border p-2 sm:grid-cols-2">
          {options.map((o) => {
            const checkId = `${id}-${o.value}`;
            return (
              <label
                key={o.value}
                htmlFor={checkId}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-admin-surface-2"
              >
                <Checkbox
                  id={checkId}
                  checked={value.includes(o.value)}
                  disabled={disabled}
                  onCheckedChange={(c) =>
                    onChange(
                      c === true
                        ? options
                            .filter((x) => value.includes(x.value) || x.value === o.value)
                            .map((x) => x.value)
                        : value.filter((x) => x !== o.value),
                    )
                  }
                />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-admin-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-admin-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Recursive control for one node of a setting's form tree (see `field-model.ts`). */
export function FieldInput({
  node,
  draft,
  onChange,
  id,
  label,
  path,
  errors,
  disabled,
  hint,
  hideLabel,
}: FieldInputProps) {
  const error = errors[path];
  const labelNode = hideLabel ? <span className="sr-only">{label}</span> : label;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  switch (node.kind) {
    case "nullable":
      return (
        <FieldInput
          node={node.inner}
          draft={draft}
          onChange={onChange}
          id={id}
          label={label}
          path={path}
          errors={errors}
          disabled={disabled}
          hideLabel={hideLabel}
          hint={hint ?? "Leave empty if it does not apply."}
        />
      );

    case "text": {
      const value = typeof draft === "string" ? draft : "";
      return (
        <Field label={labelNode} htmlFor={id} hint={hint} error={error}>
          {node.multiline ? (
            <Textarea
              id={id}
              rows={5}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
            />
          ) : (
            <Input
              id={id}
              type={node.email ? "email" : "text"}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      );
    }

    case "number": {
      const value = typeof draft === "string" ? draft : "";
      return (
        <Field
          label={labelNode}
          htmlFor={id}
          hint={hint ?? (node.money ? "Amount in rupees." : undefined)}
          error={error}
          className="max-w-xs"
        >
          <div className="relative">
            {node.money ? (
              <span
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-admin-ink-muted"
                aria-hidden
              >
                ₹
              </span>
            ) : null}
            <Input
              id={id}
              inputMode={node.integer && !node.money ? "numeric" : "decimal"}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="off"
              className={cn("tabular", node.money && "pl-7")}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
            />
          </div>
        </Field>
      );
    }

    case "boolean":
      return (
        <Field label={labelNode} htmlFor={id} hint={hint} error={error} inline>
          <Switch id={id} checked={draft === true} disabled={disabled} onCheckedChange={onChange} />
        </Field>
      );

    case "enum":
      return (
        <Field label={labelNode} htmlFor={id} hint={hint} error={error} className="max-w-xs">
          <Select
            id={id}
            value={typeof draft === "string" ? draft : ""}
            onValueChange={onChange}
            options={node.options}
            disabled={disabled}
            aria-invalid={Boolean(error)}
          />
        </Field>
      );

    case "choices":
      return (
        <ChoiceList
          id={id}
          label={label}
          options={node.options}
          value={Array.isArray(draft) ? draft : []}
          ordered={node.ordered}
          onChange={onChange}
          disabled={disabled}
          error={error}
          hint={
            hint ?? (node.ordered ? "In the order the hand button cycles through them." : undefined)
          }
        />
      );

    case "lines":
      return (
        <Field label={labelNode} htmlFor={id} hint={hint ?? "One per line."} error={error}>
          <Textarea
            id={id}
            rows={4}
            value={typeof draft === "string" ? draft : ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
          />
        </Field>
      );

    case "object": {
      const value = isRec(draft) ? draft : {};
      const leafOnly = node.fields.every(
        (f) => f.node.kind !== "object" && f.node.kind !== "record",
      );
      return (
        <fieldset className="grid gap-3 rounded-md border border-admin-border p-3">
          <legend className={cn("px-1 text-sm font-medium text-admin-ink", hideLabel && "sr-only")}>
            {label}
          </legend>
          <div className={cn("grid gap-3", leafOnly && node.fields.length > 1 && "sm:grid-cols-2")}>
            {node.fields.map((f) => (
              <FieldInput
                key={f.key}
                node={f.node}
                draft={value[f.key]}
                onChange={(next) => onChange({ ...value, [f.key]: next })}
                id={`${id}-${f.key}`}
                label={f.label}
                path={sub(path, f.key)}
                errors={errors}
                disabled={disabled}
              />
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-xs text-admin-danger">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }

    case "record": {
      const value = isRec(draft) ? draft : {};
      return (
        <fieldset className="grid gap-3 rounded-md border border-admin-border p-3">
          <legend className={cn("px-1 text-sm font-medium text-admin-ink", hideLabel && "sr-only")}>
            {label}
          </legend>
          {node.keys.map((k) => (
            <FieldInput
              key={k.value}
              node={node.value}
              draft={value[k.value]}
              onChange={(next) => onChange({ ...value, [k.value]: next })}
              id={`${id}-${k.value}`}
              label={k.label}
              path={sub(path, k.value)}
              errors={errors}
              disabled={disabled}
              hint={node.value.kind === "number" ? "Leave empty to use the default." : undefined}
            />
          ))}
          {error ? (
            <p role="alert" className="text-xs text-admin-danger">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }
  }
}
