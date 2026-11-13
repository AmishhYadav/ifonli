"use client";

import * as TabsPrimitive from "radix-ui/tabs";
import * as React from "react";

import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

/**
 * Tab strip with one gradient underline that glides to the active trigger. The indicator is a
 * transform-only element sized from the active trigger (`data-state="active"`), re-measured when the
 * active tab or the strip's size changes.
 */
export function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!list || !indicator) return;

    const place = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) {
        indicator.removeAttribute("data-ready");
        return;
      }
      indicator.style.setProperty("--tab-x", `${active.offsetLeft}px`);
      indicator.style.setProperty("--tab-w", String(active.offsetWidth));
      if (!indicator.dataset.ready) {
        // Position first without a transition, then enable the glide for later changes.
        requestAnimationFrame(() => indicator.setAttribute("data-ready", "true"));
      }
    };

    place();
    const mutations = new MutationObserver(place);
    mutations.observe(list, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    const sizes = new ResizeObserver(place);
    sizes.observe(list);
    return () => {
      mutations.disconnect();
      sizes.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn("relative flex gap-1 overflow-x-auto border-b border-admin-border", className)}
      {...props}
    >
      {children}
      <span ref={indicatorRef} aria-hidden className="admin-tab-indicator" />
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-admin-ink-muted transition-colors hover:text-admin-ink data-[state=active]:text-admin-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "pt-5 outline-none data-[state=active]:animate-[admin-rise_360ms_var(--admin-ease)_backwards]",
        className,
      )}
      {...props}
    />
  );
}
