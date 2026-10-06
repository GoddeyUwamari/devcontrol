import { notFound } from 'next/navigation';

// Retired from the product surface: the API-keys and outbound-webhooks
// features this page exposed have no backing production schema
// (api_keys/webhook_endpoints tables were never created by any migration)
// and no functioning consumer (no API-key auth middleware, no webhook
// delivery mechanism) -- see the investigation this removal is based on.
// The underlying routes/service/migrations are deliberately left in place
// for a later, separate decision to rebuild or formally retire them.
export default function DevelopersPage() {
  notFound();
}
