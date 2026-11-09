import type { Metadata } from "next";

import { MyProfile } from "@/features/account/MyProfile";

/** Private to the visitor and never indexed (robots.txt also disallows /account). */
export const metadata: Metadata = {
  title: "My Profile",
  robots: { index: false, follow: false, nocache: true },
};

/** My Profile: a name and a way to reach them, then their orders, tracking and the Return Ritual. */
export default function AccountPage() {
  return <MyProfile />;
}
