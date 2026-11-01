import { PlaceholderValue } from "@/components/store/footer/PlaceholderValue";
import { Icon } from "@/components/ui/Icon";
import type { StoreValue } from "@/server/cache/settings";

/** Shown instead of a policy body that is not publishable yet (production). */
export function FinalisingNotice({ supportEmail }: { supportEmail: StoreValue }) {
  return (
    <section
      aria-label="Policy status"
      data-testid="policy-finalising"
      className="flex max-w-prose flex-col gap-3 rounded-card border-token bg-surface p-5 text-ink shadow-card sm:p-6"
    >
      <p className="flex items-start gap-2 font-display text-xl leading-tight">
        <Icon name="info" className="mt-1 size-5 flex-none" />
        This policy is being finalised.
      </p>
      <p className="text-base text-ink-muted">
        Until it is published, please write to{" "}
        <PlaceholderValue value={supportEmail}>
          <a href={`mailto:${supportEmail.value}`} className="font-semibold text-link underline underline-offset-4">
            {supportEmail.value}
          </a>
        </PlaceholderValue>{" "}
        and we will answer your question directly.
      </p>
    </section>
  );
}
