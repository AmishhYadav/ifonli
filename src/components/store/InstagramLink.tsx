import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export const INSTAGRAM_URL = "https://www.instagram.com/ifonli_studio/";

/** "Follow @ifonli_studio" with the animated Instagram badge (styles in ui.css). Opens in a new tab. */
export function InstagramLink({ className }: { className?: string }) {
  return (
    <a
      href={INSTAGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("insta-link", className)}
      aria-label="Follow IfOnli on Instagram (opens in a new tab)"
    >
      <span className="insta-link__badge" aria-hidden="true">
        <Icon name="instagram" className="insta-link__icon" />
      </span>
      <span>
        Follow <strong>@ifonli_studio</strong>
      </span>
    </a>
  );
}
