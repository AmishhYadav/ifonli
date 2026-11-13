"use client";

import { Check, ChevronDown } from "lucide-react";
import * as SelectPrimitive from "radix-ui/select";
import * as React from "react";

import { cn, adminPortalContainer } from "./cn";
import { inputClasses } from "./input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}

/** Single-select dropdown on Radix Select. Option values must be non-empty strings. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  id,
  name,
  disabled,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={onValueChange}
      name={name}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          inputClasses,
          "justify-between gap-2 data-[placeholder]:text-admin-ink-faint",
          className,
        )}
        {...aria}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-admin-ink-faint" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={adminPortalContainer()}>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="admin-select z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-admin-border bg-admin-surface text-sm text-admin-ink shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer items-center rounded-lg py-2 pr-8 pl-2.5 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-admin-primary-soft"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                  <Check className="size-4 text-admin-primary" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
