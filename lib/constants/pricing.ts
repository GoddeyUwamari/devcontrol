/**
 * SINGLE SOURCE OF TRUTH for the Starter plan's monthly list price.
 *
 * Every page that names the Starter price reads it from here, so the public
 * pricing page, the in-app upgrade page and any marketing copy can never
 * disagree. Before this constant existed, /pricing said $49 and the startups
 * FAQ said $79.
 *
 * PENDING FOUNDER DECISION: $49 is the value the pricing pages already showed.
 * It must match the Stripe price (STRIPE_PRICE_STARTER_MONTHLY). Change it only
 * here.
 */
export const STARTER_MONTHLY_PRICE_USD = 49

/** "$49/month": for running copy. */
export const STARTER_MONTHLY_PRICE_LABEL = `$${STARTER_MONTHLY_PRICE_USD}/month`
