import { StoreChrome } from "@/components/store/StoreChrome";

/** Discovery pages: expressive, fully themed. Header (hand button), footer, skip link. */
export default function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <StoreChrome>{children}</StoreChrome>;
}
