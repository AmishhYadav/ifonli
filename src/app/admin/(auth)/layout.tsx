import { ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-admin-ink">
        <span className="flex size-8 items-center justify-center rounded-lg bg-admin-primary text-admin-on-primary">
          <ShieldCheck className="size-4.5" aria-hidden />
        </span>
        <span className="text-base font-semibold tracking-tight">IfOnli Admin</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 text-xs text-admin-ink-faint">
        Authorised staff only. Activity is logged.
      </p>
    </main>
  );
}
