import { AuthArt } from "@/components/admin/shell/AuthArt";
import { BrandMark } from "@/components/admin/shell/BrandMark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-admin-auth className="relative min-h-dvh overflow-hidden">
      <AuthArt />
      <main className="relative z-[1] flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <div className="admin-rise-in mb-8">
          <BrandMark size="hero" stacked />
        </div>
        <div className="admin-rise-in w-full max-w-sm" style={{ animationDelay: "120ms" }}>
          {children}
        </div>
        <p className="admin-rise-in mt-6 text-xs text-admin-ink-muted" style={{ animationDelay: "240ms" }}>
          Authorised staff only. Activity is logged.
        </p>
      </main>
    </div>
  );
}
