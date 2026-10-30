"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "@/components/ui";
import { cn } from "@/lib/cn";

interface NavMenuProps {
  label: string;
  /** Links (anchors) of the panel. Rendered by the server, so the panel is plain markup. */
  children: ReactNode;
  panelClassName?: string;
}

/**
 * Disclosure menu for the desktop nav: a button toggles a panel of links.
 * Keyboard: Enter/Space/ArrowDown opens, Arrow keys move between links, Home/End jump, Escape closes and
 * returns focus to the button, Tab out of the menu closes it. Pointer: click toggles, hover opens (mouse only).
 */
export function NavMenu({ label, children, panelClassName }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>(0);
  /** Opened by mouse hover: the click that follows should keep it open, not toggle it shut. */
  const openedByHover = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) openedByHover.current = false;
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const links = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);

  const focusLink = (index: number) => {
    const all = links();
    if (all.length === 0) return;
    all[(index + all.length) % all.length]?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => focusLink(0));
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = links();
    const index = all.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusLink(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusLink(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusLink(0);
        break;
      case "End":
        event.preventDefault();
        focusLink(-1);
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(hoverTimer.current);
        if (!open) openedByHover.current = true;
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          openedByHover.current = false;
          setOpen(false);
        }, 160);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (openedByHover.current) {
            openedByHover.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        className="inline-flex min-h-11 items-center gap-1 rounded-button px-3 text-base font-semibold text-ink hover:bg-surface-2"
      >
        {label}
        <Icon
          name="chevron-down"
          className={cn("size-4 transition-transform ease-vibe", open && "rotate-180")}
        />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        onKeyDown={onPanelKeyDown}
        className={cn(
          "absolute top-full left-0 z-50 mt-1 min-w-64 rounded-card border-token bg-surface p-3 text-ink shadow-card",
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
