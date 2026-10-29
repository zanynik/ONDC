# ZeroProfit — foundation website and ONDC integration

Independent **Cloudflare Workers + Supabase** application, currently restricted
to pre-production. Live customer ordering and payments are not open.

- Preview: https://zeroprofit-preproduction.zanynik.workers.dev
- Account: https://zeroprofit-preproduction.zanynik.workers.dev/account
- Supabase project: `zeroprofit` (`ynmevkntztzfutjnbfnf`), Mumbai, separate from SlowClaw.
- Repository: https://github.com/zanynik/ONDC
- Exact original ChatGPT Sites v53 source: branch `backup/sites-v53`, recovered
  from Sites commit `4460743eb78282341d8e88f907438ee4aaa67065`.

## What is implemented

- Foundation website, disclosures, terms and support information.
- Account UI: email/password sign-in/sign-up, own-order history and support tickets.
- Supabase Postgres foundation for profiles, orders/events, payments, refunds,
  settlements and support, with ownership-based row-level security.
- A private `support-attachments` storage bucket and owner-folder access policies.
  The current support form is text-only; attachment upload UI is not implemented.
- Private ONDC callbacks/logs/nonces, connected through an authenticated Edge
  Function. Callback+audit writes are atomic and duplicate receipts are ignored.
- Cloudflare callback signature verification using explicitly trusted public keys,
  bounded request bodies and timing-safe admin-token checks.
- Separate Cloudflare staging configuration; outbound ONDC actions are disabled.
- Source CI and a manual independent deployment workflow.

These database tables are foundations, **not working payment/refund/settlement
integrations**. Workbench payload builders still contain test-only sample
providers, billing details, mock PAID claims and finder-fee fixtures.

## Current hosting

| Address | Status |
| --- | --- |
| `www.zeroprofit.food` | Existing ChatGPT Site; no DNS cutover yet |
| `ondc.zeroprofit.food/buyer` | Existing Sites pre-production backend |
| `zeroprofit.food` | Separate GoDaddy page; apex redirect still pending |
| `zeroprofit-preproduction.zanynik.workers.dev` | Independent Cloudflare preview using Supabase |

## Run and test

Use Node.js 24:

```sh
npm ci
npx wrangler types --config wrangler.jsonc
npx tsc --noEmit
ZEROPROFIT_HOSTING=cloudflare npm test
npx wrangler deploy --dry-run --config dist/server/wrangler.json
```

Tests cover rendering, protocol signatures and tampering, persistence failures,
receipt retries, correct Buyer Delivery order IDs, the Supabase storage adapter,
and the private gateway. Mock tests are not ONDC certification. Hosted verification
also exercised real Postgres writes, readback, replay protection and anonymous
access; rollback-only SQL verified customer isolation and backend privileges.

The default build retains the original Sites configuration. Setting
`ZEROPROFIT_HOSTING=cloudflare` selects `wrangler.jsonc`. The Vite plugin emits
`dist/server/wrangler.json`; use that file for native Wrangler deployment.
Legacy `db/index.ts` and D1 migrations are retained only for Sites compatibility.
The independent Worker selects Supabase and does not bind D1.

## Deploy

The GitHub `Deploy independent pre-production` workflow is manually triggered.
Configure `CLOUDFLARE_API_TOKEN` in GitHub's `preproduction` environment to use it.
It builds/tests and deploys the Worker and native static assets. No domain changes
are included. The scoped token needs Workers deployment access for the configured
account; this workflow does not manage Supabase schema or secrets.

For Supabase, version-controlled migrations are in `supabase/migrations/` and
the `protocol-store` Edge Function is in `supabase/functions/protocol-store/`.
Use an authenticated Supabase CLI session to deploy subsequent changes, verifying
remote migration history before applying them. Generated DB types live in
`db/supabase.types.ts`.

Connector-based initial deployment uses `scripts/prepare-native-assets.mjs` and
`scripts/upload-native-assets.py`: only short-lived upload-session tokens pass
through hidden stdin. Ordinary Wrangler deployment handles assets automatically.
No generated bundles or credentials should be committed.

## Secrets and access

- `SUPABASE_URL` and the frontend publishable key are public identifiers.
- `ZP_PROTOCOL_STORE_TOKEN` is a server-only Cloudflare secret. The database
  retains only its SHA-256 hash in `private.backend_credentials`.
- The `protocol-store` Edge Function performs its own token authentication.
  Supabase's JWT gateway check is disabled for this machine-to-machine endpoint;
  a publishable key alone cannot authorize it.
- The function obtains a backend key from Supabase's runtime environment. It
  supports new `SUPABASE_SECRET_KEYS` and a legacy compatibility fallback.
  No Supabase service key is exposed to the Worker or browser.
- Service-only RPCs and protocol tables are inaccessible to customers.
  Customer RLS cannot create/alter paid orders, payment records or settlements.
- Anonymous API access does not expose customer or protocol records.
- `GET /buyer/storage-health` requires the backend-token header and verifies
  Cloudflare → Edge Function → Postgres connectivity without returning records.
- Keep ONDC keys, API tokens, `.env*` and `.dev.vars*` out of Git. Do not rotate
  registered ONDC keys merely to facilitate migration.

## Remaining setup

1. Configure Supabase Auth Site URL and allowed redirect URLs for the preview
   and final `/account` page; configure production SMTP before public sign-ups.
   No signup email was sent or email-delivery flow verified during this work.
2. Restore the original ONDC signing/encryption keys, unique key ID, N.O. token
   and Workbench/admin tokens into Cloudflare secrets/settings.
3. Configure trusted callback signing public keys from verified registry records.
   Automatic registry refresh and an observability retry queue remain unfinished.
4. Complete signed Workbench reverification and live grievance/payout validation.
5. Export/preserve existing Sites logs and arrange the external DNS/hosting
   cutover. No old test data or nonces were imported automatically.
6. Build and verify real catalog/cart/checkout, payments, refunds, settlement and
   operations support before accepting real orders.

See [the cutover runbook](docs/STATUS-AND-CUTOVER.md).
