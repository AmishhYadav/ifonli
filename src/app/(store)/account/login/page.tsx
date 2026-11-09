import { redirect } from "next/navigation";

/** The email sign-in was replaced by the simple My Profile form; old links and redirects land there. */
export default function LoginPage(): never {
  redirect("/account");
}
