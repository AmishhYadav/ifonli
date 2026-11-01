"use client";

import { useState, type ComponentType } from "react";

import { Button } from "@/components/ui/Button";

import type { FilterDrawerProps } from "./FilterDrawerPanel";

let loading: Promise<ComponentType<FilterDrawerProps>> | null = null;

/** Download the filter drawer (Radix dialog and the filter form). Cached after the first call. */
function loadPanel(): Promise<ComponentType<FilterDrawerProps>> {
  loading ??= import("./FilterDrawerPanel").then((m) => m.FilterDrawerPanel);
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/**
 * Mobile filters button. Until the first tap it is just the button: the drawer (and the dialog code behind it)
 * downloads on hover, focus or touch and mounts already open on tap.
 */
export function FilterDrawer(props: Omit<FilterDrawerProps, "defaultOpen">) {
  const [panel, setPanel] = useState<{ Panel: ComponentType<FilterDrawerProps> } | null>(null);
  if (panel) return <panel.Panel {...props} defaultOpen />;

  const warm = () => void loadPanel().catch(() => {});
  return (
    <Button
      variant="secondary"
      size="sm"
      iconStart="filter"
      className="lg:hidden"
      aria-haspopup="dialog"
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={() => {
        loadPanel().then((Panel) => setPanel({ Panel }), () => {});
      }}
    >
      Filters{props.activeCount > 0 ? ` (${props.activeCount})` : ""}
    </Button>
  );
}
