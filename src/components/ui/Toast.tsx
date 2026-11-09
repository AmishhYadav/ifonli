"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { findScope, type ScopeAttrs } from "./scope";

export type ToastTone = "neutral" | "success" | "danger" | "info";

export interface ToastAction {
  label: string;
  /** Navigate (renders a link) ... */
  href?: string;
  /** ... or run code. The toast closes afterwards. */
  onClick?: () => void;
}

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  action?: ToastAction;
  /** Milliseconds before auto-dismiss (default 5000, 8000 with an action). `0` keeps it until dismissed. */
  duration?: number;
}

interface ToastItemData extends ToastOptions {
  id: number;
  scope: ScopeAttrs;
  open: boolean;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const EXIT_MS = 300;

/** `const { toast } = useToast()`. Must be used under `ToastProvider`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const toneIcon: Record<ToastTone, IconName> = {
  neutral: "bag",
  success: "check",
  danger: "alert-circle",
  info: "info",
};

const toneColor: Record<ToastTone, string> = {
  neutral: "text-ink",
  success: "text-success",
  danger: "text-danger",
  info: "text-link",
};

/**
 * Toasts for transient confirmations ("Added to bag"). One polite live region (always in the DOM, so
 * additions are announced); each toast pauses its timer while hovered or focused and offers a close button
 * (and Escape while focused inside it). The toast wears the vibe / Buy scope of the element that fired it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItemData[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)));
      window.setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const region = useRef<HTMLElement>(null);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    // Desktop toasts sit just under the sticky header, in the corner where the bag is, clear of the page
    // content. The header's height differs per layout (store vs. buy), so measure it when a toast opens.
    const header = document.querySelector("header");
    const headerBottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
    region.current?.style.setProperty("--toast-top", `${headerBottom + 12}px`);
    const origin = document.activeElement;
    const scope =
      origin && origin !== document.body
        ? findScope(origin)
        : findScope(document.querySelector("[data-vibe-scope]"));
    setItems((prev) => [...prev, { ...options, id, scope, open: true }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const dismissAll = useCallback(() => {
    setItems((prev) => prev.map((t) => ({ ...t, open: false })));
    window.setTimeout(() => setItems([]), EXIT_MS);
  }, []);

  const api = useMemo(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  return (
    <ToastContext value={api}>
      {children}
      {/* Mobile: along the bottom, above the fixed PDP add bar when it is showing (`--toast-bottom`, set by the
          PDP). From md up: top right under the header, so it never covers the product or its buy controls. */}
      <section
        ref={region}
        aria-label="Notifications"
        className={
          "pointer-events-none fixed inset-x-0 bottom-[var(--toast-bottom,0px)] z-80 flex justify-center px-4 " +
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-auto md:top-[var(--toast-top,5rem)] md:justify-end md:pb-0"
        }
      >
        <div
          role="status"
          aria-live="polite"
          aria-atomic="false"
          className="flex w-full max-w-sm flex-col gap-3"
        >
          {items.map((item) => (
            <ToastItem key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
      </section>
    </ToastContext>
  );
}

function ToastItem({ item, onDismiss }: { item: ToastItemData; onDismiss: (id: number) => void }) {
  const { id, tone = "neutral", title, description, action, open, scope } = item;
  const duration = item.duration ?? (action ? 8000 : 5000);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!open || paused || duration === 0) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [open, paused, duration, id, onDismiss]);

  const actionClasses =
    "inline-flex min-h-11 items-center rounded-button px-3 text-sm font-bold text-link underline underline-offset-4 hover:no-underline";

  return (
    <div
      {...scope}
      data-state={open ? "open" : "closed"}
      data-tone={tone}
      className="ui-toast pointer-events-auto flex items-start gap-3 rounded-card bg-surface p-3 pl-4 text-ink shadow-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDismiss(id);
      }}
    >
      <Icon name={toneIcon[tone]} className={cn("mt-2.5 size-5", toneColor[tone])} />
      <div className="flex min-w-0 flex-1 flex-col py-2">
        <p className="text-base leading-snug font-semibold">{title}</p>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        {action ? (
          action.href ? (
            <Link
              href={action.href}
              className={cn(actionClasses, "self-start")}
              onClick={() => onDismiss(id)}
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              className={cn(actionClasses, "self-start")}
              onClick={() => {
                action.onClick?.();
                onDismiss(id);
              }}
            >
              {action.label}
            </button>
          )
        ) : null}
      </div>
      <IconButton
        icon="close"
        label="Dismiss notification"
        size="sm"
        onClick={() => onDismiss(id)}
      />
    </div>
  );
}
