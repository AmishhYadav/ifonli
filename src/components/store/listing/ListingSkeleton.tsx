import { Skeleton } from "@/components/ui/Skeleton";

import { ProductGridSkeleton } from "../ProductGrid";

/** Fallback while the listing reads `searchParams`: same boxes as the real thing, so nothing jumps. */
export function ListingSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-4 sm:px-6" aria-busy="true">
      <div className="flex items-center justify-between gap-3 border-b border-hairline py-4">
        <Skeleton shape="text" className="h-6 w-28" />
        <Skeleton shape="block" className="h-11 w-52" />
      </div>
      <div className="grid gap-8 pt-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 max-lg:hidden">
          <Skeleton shape="text" className="h-6 w-24" />
          <Skeleton shape="block" className="h-40 w-full" />
          <Skeleton shape="block" className="h-24 w-full" />
        </div>
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
