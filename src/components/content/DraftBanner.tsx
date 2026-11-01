import { Icon } from "@/components/ui/Icon";

/**
 * Review-mode banner (development and dev-pages builds): the owner can read the page but must not
 * mistake it for the published policy. Lists what still blocks publishing.
 */
export function DraftBanner({
  unpublished,
  problems,
  what = "page",
}: {
  unpublished: boolean;
  problems: readonly { kind: string; token: string; message: string }[];
  what?: string;
}) {
  return (
    <section
      role="note"
      aria-label="Draft status"
      data-testid="draft-banner"
      className="flex flex-col gap-3 rounded-card border-token border-warning bg-surface p-4 text-ink sm:p-5"
    >
      <p className="flex items-start gap-2 text-lg font-bold">
        <Icon name="alert-circle" className="mt-1 size-5 flex-none text-warning" />
        <span>DRAFT — requires legal review</span>
      </p>
      <p className="text-base">
        Visible to you because this is a development build. In production this {what} stays hidden
        {unpublished ? " until it is published" : ""}
        {problems.length > 0 ? " and every highlighted value is filled in under Admin > Settings" : ""}.
      </p>
      {problems.length > 0 ? (
        <details className="text-base">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold md:min-h-9">
            {problems.length} {problems.length === 1 ? "value needs" : "values need"} attention
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-6">
            {problems.map((p) => (
              <li key={`${p.kind}:${p.token}`}>
                <code className="rounded-input bg-surface-2 px-1">{p.token}</code>{" "}
                <span className="text-ink-muted">
                  {p.kind === "placeholder" ? "placeholder" : p.kind === "unresolved" ? "no value" : p.message}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
