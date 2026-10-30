---
title: "Shipping Policy"
slug: shipping
version: 0.1-draft
status: "DRAFT — requires legal review before publishing"
lastReviewed: null
---

> **Draft notice:** This page is a draft and is waiting for legal review. It is not legal advice. Details may change before it is published.

# Shipping Policy

This page explains where we deliver, how long it takes, what it costs and what happens if something goes wrong. {{settings.legal_name}} (trading as {{settings.brand_name}}) ships orders within India only.

## Where we deliver

{{#if settings.serviceability_mode == "all_india"}}
We deliver across India, wherever our courier partners can reach. Some remote pincodes may not be covered.
{{else}}
We deliver to selected areas of India. Not every pincode is covered.
{{/if}}

- Enter your pincode on the product page or at checkout to see whether we can deliver to you.
- The pincode check runs before you pay. If we cannot deliver to your pincode, you will be told at that point, and you will not be charged.
- We deliver in India only. All prices and payments are in Indian rupees (INR).

## Processing time

Processing means checking, packing and handing your order to the courier.

- Orders are usually processed within {{settings.processing_days}} working days after the order is confirmed.
- Working days are: {{settings.policy.working_days}}. Public holidays are not counted.
- For prepaid orders, the clock starts when your payment is confirmed. For Cash on Delivery orders, it starts when the order is placed.

## Delivery time

Delivery time depends on where you live. These are estimates, counted from dispatch, not guarantees.

| Zone | Estimated delivery |
|---|---|
| Metro region | {{settings.delivery_estimates_by_zone.metro_region}} |
| Rest of India | {{settings.delivery_estimates_by_zone.rest_of_india}} |
| North East | {{settings.delivery_estimates_by_zone.north_east}} |
| Jammu & Kashmir and Ladakh | {{settings.delivery_estimates_by_zone.jk_ladakh}} |
| Islands | {{settings.delivery_estimates_by_zone.islands}} |

- Your exact estimate appears when you enter your pincode.
- Your order is delivered by our courier partner(s): {{settings.policy.courier_partners}}.
- Sundays and public holidays are usually not delivery days.

{{#if settings.delay_message}}
**Current delivery notice:** {{settings.delay_message}}
{{/if}}

## Shipping fees

- Standard shipping fee: {{settings.flat_fee}} per order.
- Free shipping on orders of {{settings.free_threshold}} or more, calculated after any discount is applied.
{{#if settings.zone_overrides}}
- The fee may be different for some delivery zones. Checkout always shows the exact fee for your address before you pay.
{{/if}}

Your cart shows the shipping fee (or that shipping is free) before checkout. At checkout you see every charge listed separately: items, discount, shipping, any Cash on Delivery fee, and the total you pay. Prices already include GST. We do not add any other charge after you place your order.

## Cash on Delivery (COD)

{{#if settings.cod_enabled}}
COD is available for eligible orders.

- It is available only for some pincodes. Checkout tells you whether COD is available for yours.
- COD is available for orders up to {{settings.cod_max_order_value}}.
- COD fee: {{settings.cod_fee}}. If a fee applies, it is shown as a separate line before you place the order.
- Please keep the exact amount ready. You pay the courier when the order arrives.
{{else}}
Cash on Delivery is not available right now. You can pay online by UPI, card, net banking or wallet.
{{/if}}

## Tracking your order

- When your order is handed to the courier, we email you the courier name, the tracking number (AWB) and a tracking link.
- You can also track any order at any time on our [Track order](/track) page. Use your order reference and the email address or phone number you gave at checkout. You do not need an account.
- If you have an account, your order status is on your order page.
- Tracking updates come from the courier and can take some time to appear after dispatch.

## Delays

Sometimes a parcel is late because of weather, strikes, festivals, courier problems or other things outside our control.

- If your order is later than the estimate, check the tracking link first.
- If there is still no movement, write to us at {{settings.support_email}} with your order reference. We usually reply within {{settings.response_time}}.
- If we cancel an order because we cannot deliver it, you get a full refund. See our [Cancellation Policy](/policies/cancellation).

## Failed delivery and returns to us (RTO)

- The courier will try to deliver {{settings.policy.delivery_attempts}} time(s). Please keep your phone reachable on the delivery day.
- If delivery fails or the parcel is refused, it may be sent back to us ("return to origin" or RTO).
- What happens next: {{settings.policy.rto_handling}}
- If your parcel is on its way back to us for a reason you think is wrong, contact us and we will help.

## Changing your delivery address

- Check your address carefully at checkout. A wrong or incomplete address is the most common reason for failed deliveries.
- If you need to change the address, write to {{settings.support_email}} or use the [Help page](/help) as soon as possible, with your order reference.
- We can change the address only if the order has not yet been handed to the courier. After that, we cannot promise a change, but we will try to ask the courier.

## Damaged or missing items on arrival

If your parcel arrives damaged, or an item is wrong or missing, use **Report a problem** on your order page within {{settings.damaged_claim_window_hours}} hours of delivery. See our [Returns and Refunds Policy](/policies/returns-refunds).

## Contact us

{{settings.legal_name}}, {{settings.registered_address}}
Email: {{settings.support_email}} | Phone: {{settings.support_phone}}
Support hours: {{settings.support_hours}}
