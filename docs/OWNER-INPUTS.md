# Owner inputs

Everything below is supplied by the owner (or their advisers). Until an item is supplied, the build uses a marked placeholder and the production launch gate stays closed. Source: plan sections 14 and 17 ([PLAN.md](./PLAN.md)).

## Needed by Phase 2 (design approval and staging)

- [ ] Logo files
- [ ] Brand colours and fonts, or approval of the proposals in plan section 8.2
- [ ] Hand-icon direction
- [ ] Legal entity name and registered address
- [ ] Support email, phone, support hours and response time
- [ ] Grievance officer: name, designation, email, phone
- [ ] Policy drafts (shipping, cancellation, returns and refunds, privacy, terms, grievance), or approval of templates for legal review
- [ ] Razorpay KYC documents (PAN, bank account, business proof)

## Needed by Phase 3 (catalogue)

- [ ] Real product list: names, SKUs, prices, MRP, stock, vibes, types, variants, descriptions
- [ ] Net quantity, country of origin, manufacturer/packer/importer per product
- [ ] HSN codes and GST rates per product (from the owner's CA)
- [ ] Definition of "Hippers"
- [ ] Product photography (consistent ratio) and transparent cutouts (same angle and lighting, at least 1200 px). Needed across Phases 3-7

## Needed by Phase 4 (cart, checkout, payments)

- [ ] Shipping fee and free-shipping threshold
- [ ] Serviceable regions (all India, allowlist or denylist)
- [ ] COD on or off; COD fee; COD maximum order value; excluded pincodes
- [ ] Stock reservation time (minutes)
- [ ] Coupon list
- [ ] Confirm auto-capture is ON in the Razorpay dashboard
- [ ] Prepaid or COD tax rule for shipping and COD fee (CA to confirm)
- [ ] GSTIN, if registered (decides "Tax invoice" or "Bill of supply")

## Needed by Phase 5 (orders, notifications, accounts)

- [ ] Cancellation window (which fulfilment statuses allow customer cancel)
- [ ] Return and damage policy; damaged-claim window; refund timelines
- [ ] Notification events and channels per event; admin alert emails
- [ ] WhatsApp provider (optional)

## Needed by Phase 8 (launch)

- [ ] Domain and DNS access
- [ ] Final legal review of all policies
- [ ] GA4 yes or no (and measurement ID)
- [ ] Performance budgets agreed (plan section 13)
- [ ] Launch date
- [ ] Sign-off

## Business-rule settings (plan section 14)

Each setting has a placeholder and a launch gate. The owner supplies the real values by the phase shown.

- [ ] Store and legal details: legal_name, brand_name, registered_address, state, gstin (optional), support contact, grievance officer, default manufacturer, default country of origin (Phase 2)
- [ ] Pricing and tax: default_gst_rate_bp, shipping_tax_rule (Phase 4)
- [ ] Shipping: serviceability_mode, flat_fee, free_threshold, zone_overrides, processing_days, delivery_estimates_by_zone, delay_message (Phase 4)
- [ ] COD: cod_enabled, cod_fee, cod_max_order_value, cod_excluded_pincodes (Phase 4)
- [ ] Inventory: reservation_ttl_minutes, default_low_stock_threshold, max_qty_per_line (Phase 4)
- [ ] Cancellation and returns: cancellable_statuses, return_policy_type, returns_window_days, damaged_claim_window_hours (Phase 5)
- [ ] Vibes: vibe_cycle, default_vibe, hero_enabled, custom_cursor_enabled (Phase 2)
- [ ] Notifications: channels per event, admin_alert_emails (Phase 5)
- [ ] Analytics: ga4_measurement_id, consent_required, event_retention_months (Phase 6)

## Reference data follow-ups (found during Phase 0 data prep)

- [ ] Pincode directory is the data.gov.in May-2019 snapshot (+40 newer pincodes). Download a fresh official extract (needs a data.gov.in login) and re-run `pnpm db:import-reference` before launch if coverage of post-2019 pincodes matters. (Phase 8)
- [ ] GST state code for the merged UT "Dadra and Nagar Haveli and Daman and Diu" is set to `26`; the GST portal still lists 25 and 26 separately. Confirm with CA before invoices go live. (Phase 5)
- [ ] Delivery zones in `data/reference/zones.json` are a placeholder grouping; confirm per courier/actual delivery times. (Phase 4)
- [ ] Display fonts are proposals (Fredoka, Archivo, Kalam, Grenze Gotisch, Shrikhand; body Figtree, all SIL OFL). Replace with brand typography if IfOnli has its own. (Phase 2)
