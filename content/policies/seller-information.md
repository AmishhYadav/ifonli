---
title: "Legal and Seller Information"
slug: seller-information
version: 0.1-draft
status: "DRAFT — requires legal review before publishing"
lastReviewed: null
---

> **Draft notice:** This page is a draft and is waiting for legal review. It is not legal advice. Details may change before it is published.

# Legal and Seller Information

This page lists who we are and the details that Indian e-commerce and packaged-commodity rules ask us to display.

## Seller details

| | |
|---|---|
| Legal name | {{settings.legal_name}} |
| Trading as | {{settings.brand_name}} |
| Registered address | {{settings.registered_address}} |
| State | {{settings.state}} |
{{#if settings.gstin}}
| GSTIN | {{settings.gstin}} |
{{/if}}

## Customer care

| | |
|---|---|
| Email | {{settings.support_email}} |
| Phone | {{settings.support_phone}} |
| Hours | {{settings.support_hours}} |
| Usual response time | {{settings.response_time}} |

Contact form: [Help page](/help).

## Grievance Officer

| | |
|---|---|
| Name | {{settings.grievance_officer.name}} |
| Designation | {{settings.grievance_officer.designation}} |
| Email | {{settings.grievance_officer.email}} |
| Phone | {{settings.grievance_officer.phone}} |

We acknowledge complaints within 48 hours and resolve them within one month. See [Grievance Redressal](/policies/grievance).

## Product information

Each product page shows the details required for packaged goods:

- Maximum retail price (MRP), **inclusive of all taxes**
- Net quantity
- Name and address of the manufacturer, packer or importer
- Country of origin
- Customer care details

If a product page does not give its own details, these store defaults apply:

| | |
|---|---|
| Manufacturer / packer / importer | {{settings.default_manufacturer.name}} |
| Address | {{settings.default_manufacturer.address}} |
| Country of origin | {{settings.default_country_of_origin}} |

When a product page shows different details, the product page is correct for that product.

## Prices and payment

- All prices are in Indian rupees (INR) and include all taxes.
- We accept UPI, cards, net banking and wallets through Razorpay.
{{#if settings.cod_enabled}}
- Cash on Delivery is available for eligible orders. See [Shipping Policy](/policies/shipping).
{{/if}}
- We do not store your card details.

## Policies

- [Shipping Policy](/policies/shipping)
- [Cancellation Policy](/policies/cancellation)
- [Returns and Refunds Policy](/policies/returns-refunds)
- [Privacy Notice](/policies/privacy)
- [Terms of Use and Sale](/policies/terms)
- [Grievance Redressal](/policies/grievance)
