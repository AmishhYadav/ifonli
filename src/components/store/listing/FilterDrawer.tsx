"use client";

import { Button, Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui";

import { ListingFilters } from "./ListingFilters";

type FilterProps = React.ComponentProps<typeof ListingFilters>;

/** Mobile filters: the same form as the desktop sidebar, inside a left drawer. Changes apply live. */
export function FilterDrawer({
  activeCount,
  total,
  ...filters
}: FilterProps & { activeCount: number; total: number }) {
  return (
    <Drawer>
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
