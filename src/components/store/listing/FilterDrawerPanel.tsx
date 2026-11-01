"use client";

import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/Drawer";

import { ListingFilters } from "./ListingFilters";

export type FilterProps = React.ComponentProps<typeof ListingFilters>;
export type FilterDrawerProps = FilterProps & { activeCount: number; total: number; defaultOpen?: boolean };

/** Mobile filters: the same form as the desktop sidebar, inside a left drawer. Changes apply live. */
export function FilterDrawerPanel({ activeCount, total, defaultOpen, ...filters }: FilterDrawerProps) {
  return (
    <Drawer defaultOpen={defaultOpen}>
      <DrawerTrigger asChild>
        <Button variant="secondary" size="sm" iconStart="filter" className="lg:hidden">
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Filters"
        side="left"
        footer={
          <DrawerClose asChild>
            <Button fullWidth>Show {total} products</Button>
          </DrawerClose>
        }
      >
        <ListingFilters {...filters} alwaysShowSubmit={false} />
      </DrawerContent>
    </Drawer>
  );
}
