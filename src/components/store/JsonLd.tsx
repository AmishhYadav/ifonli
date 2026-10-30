import { jsonLdString } from "@/lib/seo";

/** `<script type="application/ld+json">`. Server component; `data` must be plain JSON. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
