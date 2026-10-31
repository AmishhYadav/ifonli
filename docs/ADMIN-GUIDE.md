# Admin guide

For the shop owner, admins and the person who packs parcels. Every section starts from a job you want to do ("I want to...") and lists the clicks. The admin is at `/admin`. It is never themed (no vibes), works on a laptop first, and is usable on a phone for the fulfilment jobs (orders, packing slips, support).

Screens are named as they appear in the left menu. Where a screen shows a button, the button's label is in **bold**.

## 1. Before anything else

### 1.1 Roles: who can do what

| Role | For | Can | Cannot |
|---|---|---|---|
| **Owner** | The business owner | Everything, including Settings, Users and publishing policies | n/a |
| **Admin** | Trusted staff | Everything except Settings, Users and publishing policies | Change settings, add staff, publish a policy |
| **Fulfilment** | Whoever packs and ships | Orders (view, pack, ship, add tracking), packing slips, support cases | Products, prices, coupons, settings, reports |

The left menu only shows what your role may open. A page you may not open shows a "You don't have access" page; the server also refuses the action, so a hand-typed link does not help.

### 1.2 Signing in and two-factor codes

1. Go to `/admin` and sign in with your email and password.
2. First time only: the shop asks you to **Set up two-factor sign-in**. Confirm your password, scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password...). If you cannot scan, open **Can't scan?** and type the key into the app. Enter the 6-digit code and press **Verify and turn on**.
3. Save the **backup codes** it shows (each works once). Print them or put them in a password manager. They are the only way in if you lose your phone.
4. Next time: email + password, then the 6-digit code from the app.

Codes change every 30 seconds and each one works once. If a code is refused, wait for the next one.

Lost phone and no backup code: the owner asks whoever runs the server to reset your two-factor (`pnpm admin:create --email you@example.com --reset-2fa`); you enrol again at next sign-in.

### 1.3 Everything you change is recorded

Every save, publish, refund and stock change is written to the **Audit log** (who, what, when, before and after). You cannot edit or delete it. If something looks wrong, the audit log tells you who changed it.

## 2. Dashboard

Open **Dashboard**. It answers "what needs me today?".

- **Orders today / Revenue today / last 7 days**: paid online orders plus cash-on-delivery orders placed, not counting cancelled or refunded ones and not counting no-charge replacement orders. Days are India time (IST).
- **Awaiting fulfilment**: orders still to pack plus packed ones not yet shipped. Click it for the filtered order list.
- **Low / out of stock**: variants at or below the low-stock level / at zero. Click for the filtered inventory.
- **Open support cases**: cases that are open or in progress. Click to go to the cases tab.
- **Recent orders** and **Payment anomalies** (paid at the bank but no order, or an order paid but not confirmed). An anomaly needs a look the same day: open the order and check its timeline; if you are unsure, ask the person who runs the server (see RUNBOOK).

## 3. Products

### 3.1 Add a product

1. **Products > New product**.
2. **Details** tab: name (the web address, `/products/<slug>`, is filled in for you and checked live for clashes), description (Markdown: `**bold**`, lists, links), status (**Draft** is invisible to shoppers, **Active** is live), product type, and **Sold as a DIY kit** for fixed kits.
3. **Vibes** tab: tick every vibe the product belongs to. A product can sit in several. The **Featured rank** decides how early it appears on that vibe's pages and the home page (lower number = earlier).
4. **Options & variants** tab: add options (Colour, Size...) and values, then fill one row per variant: **SKU**, **Price**, **MRP**, weight, opening stock. The price shoppers see includes GST. Price cannot be above MRP; "x% off" is only shown when price is below MRP.
5. **Images & cutouts** tab: upload photos in the order you want them shown. **Alt text is required**: describe what is in the picture (colour, shape). Add a **cutout** (a PNG/WebP with a transparent background) so the product can appear in the animated hero; a cutout without transparency is rejected.
6. **Legal** tab: country of origin, net quantity, dimensions, manufacturer/packer/importer name and address, HSN code and GST rate. These are shown on the product page and used on invoices, so fill them in.
7. **SEO** tab: title and description for search engines, with a live preview.
8. **Create product**. The page confirms "Product created". A **Draft** stays hidden until you set Status to Active and save.

### 3.2 Edit, duplicate, archive

- Change anything and press **Save**. Prices and MRP changes apply to new carts at once; orders already placed keep the price they were placed at.
- Menu **More actions > Duplicate** makes a draft copy (useful for colour families).
- **Archive** hides the product everywhere but keeps its orders. **Restore** brings it back as a draft.
- A variant that has ever been ordered cannot be deleted; **Deactivate variant** hides it instead.

### 3.3 Replace the placeholder products

The shop ships with products whose SKUs start with `PH-` and placeholder pictures. The launch checklist (section 14) blocks launch until none are left active. Edit each one, or archive it and create the real one.

## 4. Inventory

**Inventory** shows, per variant: **On hand**, **Reserved** (held for shoppers who are paying right now) and **Available** (on hand minus reserved: what can be sold).

- **Receive stock / correct a count**: press the adjust button on a row, enter a **change** (positive adds, negative removes), pick a **Reason** (**Restock** new stock arrived, **Return restock**, **Adjustment** count changed, **Correction** data fix) and add a note (required for Adjustment and Correction). Each adjustment is written to a stock ledger; nothing is overwritten.
- Filters: **Low** and **Out of stock**. The low-stock level is a setting (section 12); a variant can override it.
- **Export CSV** downloads the table for your records.

Stock is reduced when an order is confirmed (online: payment received; COD: placed), returned when an order is cancelled before dispatch (you choose "put the items back in stock" when you cancel as an admin), and held for 15 minutes (a setting) while a shopper pays.

## 5. Collections (vibe and type pages)

**Collections** edits the text on each vibe page and product type page: **Name**, **Description**, **Definition** ("what is this vibe?"), **Hero copy**, **SEO title / description** and **Visible on the storefront**. A hidden vibe disappears from menus and links but its products stay in the shop. **Featured order** reorders the products that lead each vibe: use the arrows next to each product.

## 6. Orders: the lifecycle

An order has three independent states. They are shown as coloured badges everywhere.

| Axis | Values |
|---|---|
| **Order** | Pending payment, Confirmed, Processing, Completed, Cancelled, Expired |
| **Payment** | Unpaid, Paid, Failed, COD pending, COD collected, Partially refunded, Refunded |
| **Fulfilment** | Unfulfilled, Packed, Shipped, Out for delivery, Delivered, RTO (return to origin), Returned |

You cannot jump to an impossible state: the buttons on an order only offer the next legal steps.

### 6.1 Find an order

**Orders**: search by order reference (`IFO-2611-7K3Q`), email or phone; filter by order, payment or fulfilment status and by payment method. Press an order to open it.

### 6.2 Pack and ship (the daily routine)

1. **Orders**, filter **Fulfilment = Unfulfilled**. Open an order.
2. Open **Documents > Packing slip (no prices)** and print it. It has the address and items but no prices (safe to put in the parcel).
3. Pick and pack. Press **Mark packed**. The customer's tracking page now says "Packed".
4. Hand the parcel to the courier, then press **Add shipment**: choose the **Courier** (or **Other** and type it), enter the **AWB / tracking number** and, if the courier has a tracking page for this parcel, paste the **Tracking link** (for the common couriers it is built from the AWB). Press **Mark shipped**.
5. The customer gets the "your order has shipped" email with the courier and tracking number, and their tracking page shows **Shipped**.
6. When the courier reports it: **Out for delivery**, **Mark delivered**. If the parcel comes back: **Mark RTO**, then when it is physically back **Mark returned** and choose whether to put the units back in stock.
7. A packed order can be un-packed with **Undo packed** (mis-click before dispatch).

You can **Add another shipment** if an order goes in two parcels.

### 6.3 Cash on delivery (COD)

- COD orders are confirmed when placed. Payment shows **COD pending**.
- When the courier remits the cash (or you collect it), open the order and press **Mark COD collected**. Payment becomes **COD collected**.
- If the customer refuses the parcel: **Mark RTO**, and the payment becomes Failed (never collected).
- COD has a fee, a maximum order value and an excluded-pincodes list; all are in Settings (section 12).

### 6.4 Cancel an order

Customers can cancel from their order page while the order is in a status the owner allows (setting "Cancellable statuses", by default before it is packed). You can cancel from the admin at any time before delivery:

1. Open the order and press **Cancel order...**.
2. Enter a **Reason** (internal; never shown to the customer) and choose **Put the items back in stock**.
3. Press the red **Cancel order** button.

A paid online order is refunded in full automatically (see 6.5). A COD order that was never paid has nothing to refund.

### 6.5 Refunds

Open the order and press **Refund...**.

- **Online (Razorpay) orders**: enter the **Amount** (the **Full amount** button fills the remaining refundable amount) and a **Reason**. The refund goes to the customer's original payment method. The page shows "Refund of Rs X started"; banks take a few working days. Partial refunds are fine; the order shows **Partially refunded** until the full amount has gone back.
- **COD orders**: there is no card to refund. Pay the customer yourself by UPI or bank transfer, then record it here: enter the amount, a reason and the **UPI / bank reference** (required). This keeps the books honest.
- Refunding units that come back: tick the option to restock them.

Refund timings the customer is told live in the Cancellation and Returns policies (section 11); keep them true.

### 6.6 Invoices

An invoice number is issued when the order is confirmed (sequential per financial year, e.g. `IFO/26-27/000123`). On the order, **Documents** links the PDF (**Tax invoice** or **Bill of supply** depending on the GST status in Settings). The customer can download theirs from the order page. Re-sending the confirmation email includes it: **Resend e-mail...** and choose the template.

### 6.7 Notes and the timeline

The order's **Timeline** lists every step with who did it. Add an internal **note** (the customer never sees it). Notes that are customer-visible steps (confirmed, shipped, delivered) appear on the customer's page.

## 7. Discounts (coupon codes)

**Discounts > New coupon**.

- **Code**: letters, numbers, `-` and `_`. Shown in capitals; shoppers can type it in any case. A code that has been used cannot be renamed.
- **Type**: **Percentage off** (up to 100, two decimals) or **Amount off** (rupees).
- **Minimum cart value** (before the discount; blank = none) and **Maximum discount** (caps a percentage; blank = none).
- **Starts** / **Ends** (blank = already started / never ends). An offer's "ends" text anywhere on the site comes from this real date; there are no fake countdowns.
- **Total uses** and **Uses per customer** (counted by email).
- **Active** switch. One coupon per order; codes cannot be combined.

Usage and revenue per code is under **Reports > Coupon performance**. Do not write "20% off" in a banner unless a coupon with exactly those conditions exists: banners must lead to what they show.

## 8. Support: the inbox and cases

**Support** has two tabs. The default view shows what still needs the team.

### 8.1 Inbox (messages from the Help page)

Open a message. Read it, write your answer in **Reply to the customer by e-mail** and press **Send reply**. The email goes to the address they gave; the message becomes **Open** and the thread records the reply. When it is done press **Close message** (you can **Re-open** it later, for example if the customer writes again). Use **Close** without replying only for spam or duplicates.

### 8.2 Cases (problems reported on orders)

Customers report a problem from their order page (damaged, defective, wrong item, missing item, other), with photos. Open the case:

1. **Start working on it** (status becomes in progress) and, if you like, **Assign** it to a team member.
2. Talk to the customer with **Message to the customer** (emailed) or leave an **Internal note** (never sent).
3. Decide. Press **Resolve** and pick the **Outcome**:
   - **Refund**: enter the amount (partial is fine) and, for COD orders, the UPI/bank reference. The refund is created for you.
   - **Replacement**: creates a new no-charge order for the same items that you pack and ship like any order. It is linked to the case and the original order.
4. Or **Reject**: you must write a message for the customer explaining why; they receive it by email.

A resolved or rejected case is closed for good. If the customer has a new problem, it is a new case.

## 9. Customers and privacy requests (DPDP)

**Customers** lists everyone who has an account or has placed a real order as a guest (badge **Account** or **Guest**), with search (name, email, phone), a type filter, sort (last order, total spent, joined) and paging. Order counts and lifetime value use the same sales rule as the dashboard (refunded, cancelled and no-charge replacement orders are left out). A person's page shows their profile, addresses, wishlist count, orders, support cases and messages. Staff accounts never appear here.

Under India's DPDP Act a person can ask for a copy of their data or for it to be erased. Both are done on their page, in the privacy panel:

- **Export**: downloads a JSON file with everything held about them (profile, addresses, orders, cases, messages). Send it by email to the address on the account, after you have checked the request really came from them (reply from the same address, or ask for the order reference).
- **Delete** (accounts only): type the customer's email to confirm. The account, saved addresses, wishlist and sign-ins are removed; orders and invoices are kept without the link to the account, because tax law requires you to keep them. The policy page says the same. A guest has no account to delete, so guests only get **Export**: their order records are kept for the same reason.

Customers can also do both themselves from **Account > Profile**. Log what you did in the support inbox so there is a record of the date you responded.

## 10. Site content

**Content** has four tabs: **Home banners**, **Announcement bar**, **Featured sets** and **Hero tiles**.

### 10.1 Home banners

**New banner**: **Title**, **Image**, **Link** (an internal page like `/vibes/gothic` or `/products/heart-charm`), **Show in** (all vibes or one), **Starts** and **Ends** (blank = always), **Active**. The list shows which banners are **Showing now**. Reorder with the arrows; delete with the bin. The link must lead to exactly what the banner shows.

### 10.2 Announcement bar

The slim bar at the top of every page. Same fields, one line of text. Only the first active one shows. Keep it factual ("Free shipping above Rs 500" only if that is the real rule).

### 10.3 Featured sets

For each vibe, pick the products on the home page's "featured" shelf and their order (up to eight per vibe). Anything not picked falls back to the vibe's products by featured rank.

### 10.4 Hero tiles

For each vibe, the products whose cutout pictures fly across the animated hero. The panel warns when a vibe has too few cutouts or a product has no real (transparent) cutout. Shoppers who prefer reduced motion see these tiles as a still poster.

## 11. FAQ and policies

### 11.1 FAQ

**FAQ**: **Add question** with **Question**, **Answer**, **Category** and **Published**. Reorder within a category with the arrows. Only published questions show on the Help page. An answer that mentions a setting you have not filled in yet is hidden until you do (the launch checklist lists these).

### 11.2 Policies: draft, version, publish

Policies are the pages linked from every footer: Shipping, Cancellation, Returns and refunds, Privacy, Terms, Grievance redressal, Seller information.

1. **Policies > open one**. Edit the **Title** and the **Policy text (Markdown)**. Values in double braces, like `{{settings.support_email}}`, are filled in from Settings automatically; if a value is still a placeholder the editor lists it and you cannot publish.
2. Press **Save draft**.
3. Set the **Effective date**.
4. The **owner** presses **Publish version N** (in the **Publish** card). This creates a new numbered version; the page shows "Version N" and its effective date. Older versions stay in **Every published version, newest first** and a **Live** badge marks the current one. Orders record which version the customer accepted.
5. Admins can edit drafts but only the owner can publish.

Have a lawyer read the first published version of every policy (see KNOWN-ISSUES). The draft text is a starting point, not legal advice.

## 12. Settings

Owner only. **Settings** holds the business rules, grouped: **Store** (legal name, address, GSTIN, support email/phone/hours, grievance officer), **Pricing** (default GST rate...), **Shipping** (flat fee, free-shipping threshold, zone overrides, serviceability, processing days, delivery estimates), **COD** (on/off, fee, maximum order value, excluded pincodes), **Inventory** (low-stock level, reservation time, maximum per line), **Returns** (change-of-mind returns on/off and window, damaged-claim window), **Accounts**, **Vibes** (default vibe and cycle order), **Notifications**, **Analytics**, and **Policies** (refund timings and other values the policies quote).

- Every setting shows its description. A value marked **PLACEHOLDER** is a made-up starting value; the shop will not take real orders until the required ones are replaced.
- Edit, **Save**. The change is live for new carts within a minute and is written to the audit log.
- Money is entered in rupees. Percentages as written on the field.

### Launch checklist

The panel at the top of **Settings** is the launch gate. It lists blockers (placeholder settings, placeholder products or images, policies not published or with unresolved values, production environment values such as live payment keys and email) and warnings (thin hero sets, optional services) with a link to fix each. "Ready" means no blockers. The environment items cannot be fixed in the admin: the person who deploys the site sets them in the hosting dashboard (see RUNBOOK).

## 13. Users, audit log

### 13.1 Add staff

**Users > Add staff member** (the dialog is titled "Add a staff member"): **Name**, **Email**, **Role**, **Temporary password**. Share the password through a safe channel (it is shown once; **Copied** confirms the copy button). The person signs in, changes nothing else, and is asked to set up two-factor at first sign-in. You cannot change your own role or deactivate yourself; deactivate someone who leaves with **Deactivate**. The list shows each person's role, two-factor status and last sign-in.

### 13.2 Audit log

**Audit log**: filter by person, area and date; open an entry's **diff** to see before and after values; **Export CSV** for an accountant.

## 14. Reports and insights

### 14.1 Reports

**Reports** (owner/admin): choose a date range. **Sales** by day, **Shopping funnel** (visits that reached each step: product page, add to cart, checkout, purchase), **Orders by status**, **Coupon performance**, **Top products**, **Top vibes** (a product in several vibes counts towards each, so vibes add up to more than total), **Top product types**. Each card has **Export CSV**. Figures use the same definition of "a sale" as the dashboard.

### 14.2 Insights

**Insights**: what visitors look at, from our own anonymous counts (no personal data; search terms that look like an email or phone number are never stored). **Worth a look** flags products much weaker than the shop overall once they have enough views. Also most viewed, most seen in listings, scroll depth on product pages, conversion by product, vibe performance (switches to each vibe), hero tile clicks, searches with no results (candidates for new products) and top searches. The product figures refresh hourly.

## 15. A day in the life

| When | Who | Do |
|---|---|---|
| Morning | Fulfilment | Dashboard: **Awaiting fulfilment**. Print packing slips, pack, **Mark packed**, hand to courier, **Add shipment** with the AWB. |
| Morning | Admin | **Support**: reply to messages, start new cases. |
| Afternoon | Admin | **Inventory**: receive stock. **Low** filter: order more. |
| When COD cash arrives | Admin | **Mark COD collected** on each order. |
| Weekly | Owner | **Reports** and **Insights**; refresh banners and the announcement; check the **Launch checklist** warnings. |
| When a policy changes | Owner | Edit draft, set date, **Publish**, tell customers if it affects open orders. |
