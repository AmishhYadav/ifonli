# Storefront copy checklist

A reviewer checklist for **all** IfOnli storefront copy: vibe dictionaries (`src/features/vibe/copy/*.ts`), banners, toasts, emails, empty states, product text and policy pages. It is applied in review before any copy ships (plan section 3 and section 8.5).

This is a working checklist for a reviewer, not legal advice. Anything that touches a legal claim should also go to the owner's lawyer.

## 0. Where the rules come from

The Central Consumer Protection Authority (CCPA) issued the **Guidelines for Prevention and Regulation of Dark Patterns, 2023** on 30 November 2023, under Section 18 of the Consumer Protection Act, 2019. They apply to platforms, advertisers and sellers that offer goods or services in India, and they are in force from the date of notification. Annexure 1 lists the "specified dark patterns". The CCPA can add more over time.

Annexure 1 lists thirteen: false urgency, basket sneaking, confirm shaming, forced action, subscription trap, interface interference, bait and switch, drip pricing, disguised advertisement, nagging, trick question, SaaS billing and rogue malwares. The last two do not apply to a physical-goods store (see section 2).

How this list was checked:

- Secondary sources agree on the list and the dates: [SCC Online summary](https://www.scconline.com/blog/post/2023/12/04/ccpa-notifies-guidelines-for-prevention-and-regulation-of-dark-patterns-2023-legal-news/) (lists twelve; it leaves out SaaS billing), [Nasscom summary](https://community.nasscom.in/communities/public-policy/guidelines-prevention-and-regulation-dark-patterns-online-platforms) (lists thirteen), and [Vikaspedia](https://en.vikaspedia.in/viewcontent/social-welfare/social-awareness/consumer-education/the-guidelines-for-prevention-and-regulation-of-dark-patterns-2023).
- The official publisher is the Department of Consumer Affairs ([consumeraffairs.nic.in](https://consumeraffairs.nic.in)), which hosts the [draft guidelines](https://consumeraffairs.nic.in/sites/default/files/file-uploads/latestnews/Draft%20Guidelines%20for%20Prevention%20and%20Regulation%20of%20Dark%20Patterns%202023.pdf). **The final gazette text could not be opened when this checklist was written.** Before launch, someone should read Annexure 1 of the final notification and confirm the list and the wording below.
- The "don't / do instead" descriptions below are plain-language summaries written for IfOnli, not the official definitions.

## 1. How to use this checklist

1. Review every changed string against sections 2 to 6.
2. Copy on **checkout, payment, legal pages, critical errors and notifications is neutral and fixed**. It is never vibe-themed (plan section 8.5). Vibe voice is allowed only on expressive surfaces: hero, section titles, empty cart, no-results, 404/500, empty wishlist, add-to-cart toast and the "Wear this vibe" button.
3. Check each vibe's version of a string, not only the default. A string can be fine in Cute and a problem in Overthinking.
4. If a string needs a number (stock, discount, deadline), it must be computed from real data. If you cannot point to the data, remove the number.
5. Record the sign-off: reviewer, date, and which section 7 boxes were ticked.

## 2. Dark-pattern categories

| # | Category | Relevant to IfOnli? |
|---|---|---|
| 1 | False urgency | Yes |
| 2 | Basket sneaking | Yes |
| 3 | Confirm shaming | Yes, especially in themed copy |
| 4 | Forced action | Yes |
| 5 | Subscription trap | Not today. Applies if memberships or subscriptions are ever added |
| 6 | Interface interference | Yes |
| 7 | Bait and switch | Yes |
| 8 | Drip pricing | Yes |
| 9 | Disguised advertisement | Yes |
| 10 | Nagging | Yes |
| 11 | Trick question | Yes |
| 12 | SaaS billing | No (software services only) |
| 13 | Rogue malwares | No (applies to software that deceives users into installing it) |

### 2.1 False urgency

Creating a false sense of urgency or scarcity to push a purchase.

- **Don't:** countdown timers that reset on reload. "Only 2 left!" when there are 40. "12 people are looking at this right now" with made-up numbers. Gothic: "The void claims this charm at midnight." Bold: "LAST CHANCE. GONE FOREVER."
- **Do instead:** show a low-stock badge only from real stock (see section 3). Show an offer end time only when the banner or coupon has a real `ends_at`. The stock-hold timer at checkout is allowed because it is real: say what it is ("We are holding your items for {{minutes}} minutes while you pay"). Calm alternatives: "A few left" (true), "Back in stock" (true).

### 2.2 Basket sneaking

Adding items, services or charges the customer did not choose.

- **Don't:** pre-added extras (gift wrap, insurance, "protect your charms"), a donation, a bonus item, a pre-ticked "add a sticker pack for ₹X". A COD fee that appears only after the "Place order" click.
- **Do instead:** the cart holds only what the customer added. Extras are opt-in and unticked. Fees such as shipping and COD are visible lines before payment, each with a label.

### 2.3 Confirm shaming

Using guilt or ridicule to steer a choice. This applies to **vibe copy**, which is why it is here first.

- **Don't:**
  - Overthinking, on leaving the cart: "Leaving already? I guess you don't love yourself."
  - Cute, on a decline button: "No thanks, I don't like being cute."
  - Bold: "No, I hate saving money."
  - Gothic: "Walk away, mortal. Your shelf will stay empty."
  - Funky: "I'm boring and I like it."
- **Do instead:** decline options are plain and neutral in every vibe: "No thanks", "Not now", "Close". Do not show an exit-intent pop-up at all on cart or checkout. Playful voice can describe the **product or the mood**, never the **customer's decision**. Overthinking may joke about overthinking in general ("Take your time. Your cart will keep."), but not about the person leaving.

### 2.4 Forced action

Making a customer do something unrelated to get what they want.

- **Don't:** require an account to check out (guest checkout is on by decision D-04). Require a newsletter opt-in to see a price, apply a coupon or finish an order. Require a phone number "for offers".
- **Do instead:** an account is optional. "Create account" after an order is a quiet option. A marketing opt-in is a separate, unticked box. If a field is required for delivery, say why ("Phone, so the courier can reach you").

### 2.5 Subscription trap

Making it easy to join but hard to cancel, or hiding renewal terms.

- **Don't (if ever added):** a "Club" or box that renews by default; a free trial that turns paid without a clear reminder; cancellation that needs an email or call when sign-up took one click.
- **Do instead:** no subscriptions exist at launch. If one is added, show price, renewal date and how to cancel before sign-up, and make cancellation as easy as sign-up. Deleting an account and unsubscribing from emails must stay one-step.

### 2.6 Interface interference

Design that hides or distorts choices.

- **Don't:**
  - A bright "Accept all" cookie button next to a faint grey "Reject".
  - Return and shipping information in tiny, low-contrast text in the Gothic theme.
  - Overthinking's crossed-out text (`<s>`) used for decoration so that it looks like a price or an option has been removed.
  - A cart or checkout control that disappears in some themes.
  - Pre-ticked consent boxes.
- **Do instead:** "Accept analytics" and "No thanks" have equal size, weight and contrast. Buy pages use palette colours only, with base shape and type (plan section 8.1). Key information, policy links and every button must pass the contrast check in all five themes. Strike-through is reserved for the MRP (see section 4). Consent boxes start unticked.

### 2.7 Bait and switch

Advertising one thing and delivering another.

- **Don't:** a hero tile or banner showing a product or price that the link does not lead to. "Flat 20% off" when the coupon only works on some products. A photo of the red variant on a listing where only blue is in stock. Replacing an advertised item with a different one without asking.
- **Do instead:** every banner and tile links to the exact product or collection shown. Offer copy states its conditions ("20% off charms, minimum order ₹X" with values from the coupon record). Variant images match the variant. If the advertised item is unavailable, say so plainly.

### 2.8 Drip pricing

Revealing extra charges late.

- **Don't:** show a product price and add shipping, COD fee or "handling" on the last step. Add "+ GST" at checkout.
- **Do instead:** show a shipping estimate or "Free shipping above ₹X" in the cart. Prices include all taxes, with "Includes ₹X GST" displayed. At checkout, list items, discount, shipping, COD fee and total, and make the final button say the true total ("Pay ₹1,299 securely").

### 2.9 Disguised advertisement

Presenting advertising as something else.

- **Don't:** paid influencer posts, brand collaborations or sponsored picks styled as editorial or as "customer favourites". Staff-written text presented as customer reviews or testimonials.
- **Do instead:** label paid or sponsored content clearly ("Ad", "Sponsored", "Paid partnership") in every theme. Featuring your own products is normal merchandising and does not need a label, but "Bestseller" and "Customer favourite" must be true (section 3). Only genuine customer feedback may be shown as customer feedback.

### 2.10 Nagging

Repeated interruptions to push an action the customer did not ask for.

- **Don't:** pop-ups on first load, a notification-permission prompt on landing, a "Create account" pop-up on every visit, repeated WhatsApp or email opt-in prompts, "You left something behind!" modals.
- **Do instead:** ask once, in context, after the customer has had a chance to browse. Remember "No thanks" and do not ask again for a long time. Never block the page with a pop-up. One cookie banner, shown once until the choice is changed.

### 2.11 Trick question

Confusing wording that leads to the wrong choice.

- **Don't:** "Untick if you prefer not to miss out on not receiving offers." Mixing two consents in one box. A policy acknowledgement that hides what you agree to.
- **Do instead:** one idea per box, written positively and in plain words. Marketing: "Send me offers by email" (unticked). Policy acknowledgement (when returns are off): "I understand this order cannot be returned for change of mind. If an item is damaged, wrong or missing, I can report it within {{hours}} hours." The Yes/No buttons use the same words as the question.

### 2.12 SaaS billing and rogue malwares

Not applicable to IfOnli. Re-check the list if the CCPA adds new specified patterns.

## 3. Truthful stock and popularity badges

| Badge | Allowed when | Never |
|---|---|---|
| Sold out | Available stock is 0 (on hand minus active reservations) | Showing "sold out" to push a different product |
| Low stock / "Only N left" | Available stock is at or below the low-stock threshold (setting, or the variant override), using the real number | Fixed numbers, random numbers, or counts that ignore reservations |
| Back in stock | A real restock happened and the item is available | Re-using the badge to create buzz |
| New | Within a stated number of days of the real publish date | Leaving it on for months |
| Bestseller / Popular | A defined, documented rule is met (for example top sellers in the last N days), recalculated from real orders | A hand-set label with no data |
| "N people viewing / bought" | Only if computed from real, recent data and explained | Invented or inflated counts |
| Sale / % off | Selling price is below MRP, and the % is computed from those two numbers | A % off a price that was never charged |
| Offer ends | The banner or coupon has a real `ends_at` | Evergreen "ends tonight" |

Stock status is re-checked on the server at add-to-cart and checkout. Copy must not promise availability the server will not honour. If the cart changes (for example quantity reduced), say what changed and why.

## 4. Price display rules

- Show **MRP incl. of all taxes** and the selling price in rupees with Indian grouping (`₹1,299`).
- Show a struck-through price **only when selling price < MRP**, and the struck-through value is **always the MRP**. No other "was" price.
- Never write "+ taxes", "+ GST" or "excl. GST". Use "Incl. of all taxes" on product pages and "Includes ₹X GST" in the cart and at checkout.
- A coupon shows as a discount line. Do not re-draw it as a fake strike-through on the item.
- Shipping: show the fee, or "Free" only when it is actually zero. Show the COD fee as its own line when COD is chosen.
- The total next to the button equals the total charged. Avoid "from ₹X" unless a variant really starts at ₹X.
- Net quantity, country of origin and manufacturer, packer or importer details are shown on the product page, not only in the footer.
- Do not use vibe styling to hide price details (for example, low-contrast MRP).

## 5. Accessibility copy rules

- **Button and link labels say what they do.** "Add Mini Star Charm to cart", not "Click here" or "Yes". The same action has the same label in every vibe on buy pages.
- **Errors say what is wrong and how to fix it, in plain words, near the field.** "Enter a 10-digit mobile number" instead of "Invalid input". "That pincode has 6 digits. Please check it." Do not blame the person ("You entered...").
- **Summarise errors** at the top of the form for screen readers, and move focus to the first error.
- **Status messages** (added to cart, vibe changed, coupon applied or rejected) use a live region and stay visible long enough to read. Do not rely on colour or an icon alone.
- **Alt text** describes the product (colour, shape, what it is). Do not fill it with keywords or leave it as a file name. Decorative images get empty alt text.
- **Plain language.** Avoid jargon: say "tracking number", not "AWB". Short sentences. Indian English spelling ("cancelled", "colour"). Avoid long text in capitals.
- **Do not put key information in images.** Prices, policies and instructions are real text.
- **Theme voice never changes meaning.** If a vibe's wording is playful, it must still say the same fact as the neutral wording, and the neutral meaning is available to screen readers where the playful version could confuse.
- **Hand button:** its accessible name states the current vibe and the next one. The announcement after switching says what changed.
- **Motion:** copy must not rely on animation to be understood.

## 6. Tone guardrails per vibe

Vibe voice applies to expressive surfaces only. Checkout, payment, legal pages, critical errors and notifications use neutral copy.

| Vibe | Voice | Fine | Never |
|---|---|---|---|
| Cute | Soft, friendly, a little sparkly | "Found something sweet?" / "Saved to your wishlist" | Guilt about leaving ("Aww, they'll miss you"), baby talk that talks down to adults, sad-face pressure on decline buttons |
| Bold | Direct, confident, punchy | "Pick your statement." / "Loud and proud." | Insults or dares ("Don't be boring"), pressure ("Buy now or lose out"), all-caps for entire paragraphs |
| Overthinking | Wry, self-aware, gently funny | "Take your time. Your cart will keep." / "Still deciding? Totally fair." | Mocking the shopper's choice or leaving ("I guess you don't love yourself"), diagnosing anxiety or making mental-health claims, crossing out real information |
| Gothic | Dark, poetic, theatrical | "Something strange awaits." / "Add to your collection" | Words that treat death, self-harm or violence casually ("to die for", "kill it"), pressure framed as doom ("claimed at midnight"), tiny low-contrast text |
| Funky | Playful, retro, upbeat | "Groovy pick!" / "Shake it up." | Slang that excludes or confuses, copy that depends on a warped or hard-to-read headline to make sense |

General rules for all vibes:

- Jokes are about the product or mood, not about the customer.
- No fear of missing out, shame, guilt or flattery used to push a sale.
- A themed string must have the same facts as the neutral string (price, stock, deadline). Do not add new claims in themed text.
- Check every themed string for the dark-pattern list in section 2 in all five voices.
- Do not use third-party brand names, characters or lyrics in copy unless the owner confirms the rights.

## 7. Reviewer checklist (tick before shipping)

**Urgency and scarcity**
- [ ] No timers, counts or "last chance" wording unless backed by real data
- [ ] Low-stock and popularity badges follow section 3
- [ ] Offer end dates match real `ends_at` values

**Cart, price and checkout**
- [ ] Nothing is pre-added or pre-ticked
- [ ] MRP is shown incl. of all taxes; strike-through only when price < MRP
- [ ] Shipping estimate is visible in the cart; every charge is itemised before payment
- [ ] The button shows the true total
- [ ] Checkout, payment, legal, error and notification copy is neutral

**Choices and consent**
- [ ] Decline options are neutral and equal in prominence to accept options
- [ ] No confirm-shaming in any of the five vibes
- [ ] Each consent box has one purpose, is written positively, and starts unticked
- [ ] Guest checkout works; account creation is optional
- [ ] No repeated pop-ups or prompts

**Honesty**
- [ ] Banners and tiles lead to what they show, with conditions stated
- [ ] Sponsored or paid content is labelled
- [ ] Customer feedback shown is genuine
- [ ] Policy summaries match the live policy pages and settings (returns type, windows, fees)
- [ ] No legal claims beyond what the lawyer has approved

**Accessibility and plain language**
- [ ] Button and link labels describe the action
- [ ] Error messages say how to fix the problem
- [ ] Status messages are announced and stay visible long enough
- [ ] Alt text is useful; key info is not in images
- [ ] Indian English spelling; no unexplained jargon
- [ ] Themed strings are checked in all five vibes and for contrast

**Sign-off**

Reviewer: ____________  Date: ____________  Release / PR: ____________

## 8. Starter list of phrases to flag automatically

A lint or review search can flag these for human review (not for automatic rejection):

`hurry`, `last chance`, `only .* left`, `selling fast`, `ends tonight`, `don't miss`, `before it's gone`, `people are viewing`, `you'll regret`, `don't you want`, `I guess you`, `no, I`, `I hate`, `I don't want`, `are you sure you want to leave`, `exclusive` (when not true), `limited time` (without a real end date).
