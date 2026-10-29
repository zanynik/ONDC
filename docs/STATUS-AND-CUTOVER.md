# ZeroProfit status and cutover — 29 October 2026

## Deployed independent foundation

- Cloudflare Worker: `zeroprofit-preproduction`, account
  `2b1b021020ef414b0a5297a6652f7429`.
- Native Workers Assets serve the website's image, JavaScript and CSS.
- Supabase `zeroprofit`: `ynmevkntztzfutjnbfnf`, Mumbai (`ap-south-1`).
- Postgres migration: `20261029145157_zeroprofit_foundation.sql`.
- Auth account UI and text support requests are implemented. Production email
  delivery/redirect settings still require configuration and verification.
- Private storage bucket `support-attachments` is configured; upload UI is pending.
- Protocol persistence is provided by the authenticated `protocol-store` Edge
  Function. It uses fixed operations, never arbitrary SQL from callers.
- The earlier empty Cloudflare D1 database is unused by the hybrid deployment.
  It is retained; no resources or old data were deleted during the hosting change.

## Verification

- Local build, TypeScript and protocol/UI regression checks pass.
- Hosted gateway tests verified authentication, real Postgres connectivity,
  atomic callback+audit writes, retry deduplication, latest-order retrieval,
  nonce replay prevention and anonymous-data isolation.
- Rollback-only SQL tests verified two-customer isolation, ownership checks on
  support tickets, and denial of direct order/backend-RPC writes by customers.
- Security/performance advisors found informational notices only: service-only
  tables intentionally have no customer policies; new indexes may be unused.
- Preview pages and original PNG asset return 200. Browser inspection confirms
  the account page hydrates and renders the sign-in form.
- No live orders, actual payments or customer email deliveries were tested.

## Original application findings

The original v53 implementation is still preserved on ChatGPT Sites and GitHub's
`backup/sites-v53` branch. It is a Workbench integration with mock billing,
provider, PAID status and settlement data. Public search has zero finder fee,
while some Workbench fixtures use 3.0%; do not use these fixtures for real orders.
The public support page is phone/WhatsApp information, not an operational support
team or SLA system. Reconciliation callbacks/logs are not a payout engine.

Original callback handlers did not verify signatures and acknowledged before
asynchronous writes completed. The independent Worker adds signature validation
against pinned registry public keys, body/context validation and durable writes
before ACK. Its changed latency needs ONDC Workbench validation before cutover.

Observability submission is still best effort. A durable retry queue, complete
coverage of outbound test routes and automatic registry-key refresh are pending.

## Before changing the live domains

1. Finish the Supabase Auth redirect/SMTP configuration. Preview and final
   `/account` URLs must be explicitly allowed. Verify confirmation and sign-in.
2. Restore original ONDC keys and tokens into Cloudflare. The Sites API masks
   secret values; it cannot transfer or recover the private keys. Keep the
   registered subscriber ID and `https://ondc.zeroprofit.food/buyer` URL intact.
3. Populate `ONDC_TRUSTED_SIGNING_KEYS` from verified ONDC pre-production
   registry records. Do not trust keys or key URLs supplied in callbacks.
4. Coordinate a pre-production test address/registry entry before temporarily
   unlocking outbound test actions. Currently `ONDC_DEPLOYMENT_MODE=staging`
   blocks all outbound search/Workbench actions. Do not point their callbacks
   at the original service while testing the new one.
5. Validate full Workbench flows, callback signatures and persistence latency,
   observability acceptance and failure/retry behaviour.
6. Export/preserve existing Sites D1 protocol logs. Supabase starts fresh;
   no historical test transactions or nonces were imported. Avoid switching
   during an active transaction, and retain the original service for rollback.
7. Inventory all DNS records at the existing provider, including mail and ONDC
   verification. The domain is absent from the connected Cloudflare account.
   Workers Custom Domains require an active zone in that account. Moving DNS
   needs the full inventory before changing nameservers, or choose a frontend
   host supporting externally managed DNS. No DNS records were changed here.
8. Verify final hostname TLS, unchanged callback paths and redirects, then rerun
   supervised tests. The Worker contains the apex→www redirect once the apex
   actually routes to it; the current GoDaddy page is still separate.

Rollback: restore previous DNS records and verify the old Sites publication.
Retain both original Sites data and the new Supabase data until rollback expiry.

## Before customers can shop

Complete ONDC reverification after the v53 order-ID fix, the live grievance and
payout walkthroughs, observability acceptance and production registry setup.
Implement actual catalog/cart/checkout, validated payment webhooks, refunds,
reconciliation and operational support. Enforce monetary and order-state
invariants in those future workflows. The existing schema does not implement a
financial ledger. Run a supervised pilot with every amount reconciled end to end.

Customer support tickets currently save in Supabase and appear in the customer's
account; there is no email notification or operator dashboard yet. Use Supabase
Studio as the restricted operator view during development. Do not promise an
operational support SLA on the basis of a successful ticket insertion alone.
