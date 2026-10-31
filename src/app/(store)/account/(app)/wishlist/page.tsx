import { redirect } from "next/navigation";

/** The wishlist page is the same for guests and members (it syncs when signed in), so it has one home. */
export default function AccountWishlistPage() {
  redirect("/wishlist");
}
