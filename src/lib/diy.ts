/**
 * The DIY pack: one free chain plus 1 to 4 charms the shopper picks. Shared by the kit tray (client) and the cart
 * service (server), so it holds constants only.
 *
 * The chain is a real, free product (price 0, SKU below) in the hidden "DIY parts" type. A pack puts the chain in the
 * bag once, next to its charms, so the order carries a chain line that fulfilment can pack. Migration 0008 creates it.
 */

/** Product type of the charms a pack is made of. */
export const DIY_CHARM_TYPE_SLUG = "charms";
/** Charms per pack (the tray has one more box, for the chain). */
export const DIY_MAX_CHARMS = 4;
/** SKU of the free chain variant. */
export const DIY_CHAIN_SKU = "IFO-DIY-CHAIN";
/** Hidden product type that holds the chain: not listed anywhere, but its products can be bought into a pack. */
export const DIY_PARTS_TYPE_SLUG = "diy-parts";
/** Chain photo. Replace the file in public/diy/ to change it everywhere (tray and bag). */
export const DIY_CHAIN_IMAGE = "/diy/chain.png";
/** Product slug of the chain (created by migration 0008). */
export const DIY_CHAIN_PRODUCT_SLUG = "diy-chain";
