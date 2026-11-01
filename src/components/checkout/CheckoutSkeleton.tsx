import { Skeleton } from "@/components/ui/Skeleton";

/** Layout-matching placeholder while the cart loads. */
export function CheckoutSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading checkout"
      role="status"
      className="flex flex-col gap-6"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  );
}
