import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/Accordion";
import type { HelpFaqGroup } from "@/server/content/policies";

import { PolicyProse } from "./PolicyProse";

const CATEGORY_TITLES: Record<HelpFaqGroup["category"], string> = {
  delivery: "Delivery",
  payment: "Payment",
  product: "Products",
  orders: "Orders",
};

/** FAQ accordion grouped by category. Answers are pre-rendered HTML (`loadHelpFaqs`). */
export function FaqList({ groups }: { groups: readonly HelpFaqGroup[] }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const headingId = `faq-${group.category}`;
        return (
          <section key={group.category} aria-labelledby={headingId} data-testid={`faq-${group.category}`}>
            <h3 id={headingId} className="mb-3 font-display text-2xl leading-tight">
              {CATEGORY_TITLES[group.category]}
            </h3>
            <Accordion type="single" collapsible>
              {group.items.map((item) => (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger>{item.question}</AccordionTrigger>
                  <AccordionContent>
                    <PolicyProse html={item.html} compact />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        );
      })}
    </div>
  );
}
