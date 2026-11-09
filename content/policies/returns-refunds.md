---
title: "Returns and Refunds Policy"
slug: returns-refunds
version: 1.0
status: "Published"
lastReviewed: "2026-11-10"
---

# Returns and Refunds Policy

This page explains what you can do if you are not happy with an order, and how refunds work. Your statutory consumer rights are always protected. Nothing on this page takes them away.

## Returns and exchanges

{{#if settings.return_policy_type == "no_returns"}}
**We do not accept returns or exchanges for change of mind.** This includes a different colour or size than you expected, or if you simply no longer want the item. Please read the product page carefully before you buy. This summary is shown on product pages, in your cart and at checkout, and you are asked to acknowledge it before you place an order.

**This does not affect your rights if something is wrong with your order.** If an item arrives damaged, is defective, is not what you ordered, or is missing from your parcel, you can report it within {{settings.damaged_claim_window_hours}} hours of delivery. We will then refund you or send a replacement. See "Report a problem" below.
{{else}}
You can ask to return an item within **{{settings.returns_window_days}} days** of delivery.

**Conditions for returns:**

{{settings.policy.return_conditions}}

**Items that cannot be returned:**

{{settings.policy.non_returnable_items}}

**How to return an item:**

1. Open your order page and choose **Return an item**, or write to {{settings.support_email}} with your order reference and the item you want to return.
2. We review your request and confirm the next steps by email.
3. Return shipping: {{settings.policy.return_shipping_rule}}
4. When we receive and check the item, we approve the refund. See "How refunds work" below.

**If something is wrong with your order**, you do not need to use the return process. Use **Report a problem** within {{settings.damaged_claim_window_hours}} hours of delivery. See below.
{{/if}}

## Report a problem

If your order arrives damaged or defective, is the wrong item, or has an item missing, tell us using **Report a problem**. This applies to every order, whatever our returns policy says.

**When:** within {{settings.damaged_claim_window_hours}} hours of delivery. This is how quickly we ask you to tell us so we can sort it out easily. It does not limit your rights under the law. If you notice a problem later, please still contact us.

**How:**

1. Open your order page and choose **Report a problem**. You can reach it from the link in your confirmation email, the [Track order](/track) page, or your account.
2. Choose what is wrong: damaged, defective, wrong item, missing item, or something else.
3. Add a short description and your order reference.
4. Add clear photos. Helpful photos show the outside of the parcel and its shipping label, the item, and the damage or the wrong item. An unboxing video also helps if you have one.
5. Please keep the item and the packaging until we have resolved your report.

If the page does not work for you, email {{settings.support_email}} with the same details and photos.

**What happens next:**

- We reply within {{settings.response_time}}.
- If your report is accepted, we offer either a **refund** or a **replacement**, depending on the item and stock.
- A replacement is dispatched within {{settings.policy.replacement_days}}. You are not charged for it.
- If we cannot accept your report, we tell you why. You can then contact us using the details on our [Seller information](/policies/seller-information) page.

## How refunds work

**Prepaid orders (UPI, card, net banking, wallet)**

- Refunds go to the **same payment method** you used. We cannot refund to a different account.
- We start the refund within {{settings.policy.refund_initiation_days}} working days after we approve it. Your bank or wallet may then take {{settings.policy.refund_bank_days}} to show it.
- We email you when the refund is started and when it is completed.

**Cash on Delivery orders**

- We cannot refund to a payment method we did not receive. We refund by UPI or bank transfer instead.
- We will ask for your UPI ID or bank account details by email. Please send them only from the email address you used for the order, and only to {{settings.support_email}}.
- We send the refund within {{settings.policy.cod_refund_days}} working days after we receive correct details.
- We will never ask for your card number, PIN, CVV or an OTP to give you a refund.

**Partial refunds**

- If only some items in an order are affected, we refund only those items.
- Shipping and Cash on Delivery fees: {{settings.policy.shipping_fee_refund_rule}}
- A full refund covers the price of the items only. The shipping charge you paid to us is not included, except in the cases described above.
- The total we refund will never be more than the amount you paid.

**Refund not received?**

Please wait for the timelines above, then check with your bank or wallet. If it still has not arrived, write to {{settings.support_email}} with your order reference. Your bank can give you a reference number (ARN) for the refund, which helps us trace it.

## Cancelling before dispatch

If you want to cancel an order that has not been shipped, see our [Cancellation Policy](/policies/cancellation).

## Need help?

Email {{settings.support_email}} or call {{settings.support_phone}} ({{settings.support_hours}}).

{{settings.legal_name}}, {{settings.registered_address}}
