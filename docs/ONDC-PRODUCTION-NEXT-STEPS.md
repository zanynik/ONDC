# ONDC production next steps — checked 2 November 2026

## Current state

All three live hostnames (`www.zeroprofit.food`, `zeroprofit.food`, and
`ondc.zeroprofit.food`) route to the independent Cloudflare Worker. Protocol
storage uses the separate ZeroProfit Supabase project `ynmevkntztzfutjnbfnf`.
The old ChatGPT Site and D1 data remain for history and rollback; historical
payloads have not been fully exported or imported.

The application is in **preproduction**, requires signed callbacks, and reports
`production_ready:false`. Cloudflare's custom-domain environment label
`production` does not mean ONDC production approval.

- Organisation: 16047; Retail B2C buyer profile: 16047–10732.
- Subscriber ID: `ondc.zeroprofit.food`.
- Subscriber URL: `https://ondc.zeroprofit.food/buyer`.
- Current UKID: `a760e7ab-df2e-47eb-8287-dce8deb0ea3e`.
- Authenticated registry lookup verified SUBSCRIBED and matching public keys,
  valid 2 November 2026 through 2 November 2027. Older key IDs and dates are
  superseded. See [ONDC-KEY-ROTATION.md](ONDC-KEY-ROTATION.md).
- The owner entered replacement private keys directly into Cloudflare secrets.
  Do not put keys, operator tokens or signed request headers in this repository.

## Portal approval gates

Last signed-in portal inspection on 2 November 2026 showed:

| Task | Status |
| --- | --- |
| Integration | In Progress; profile re-enabled |
| Preprod subscription | Subscribed |
| NP Agreement | Pending; existing documents attached; reconcile with support |
| Contacts/public website and static disclosures | Completed |
| Build-components declaration | Completed declaration; not implementation proof |
| Workbench build verification | Pending |
| Live grievance/payout walkthrough | Pending; readiness checkbox unchecked |
| Observability token/preprod logs | Previously marked Completed; token absent from the new Worker, so revalidation required |
| Production subscription/start transacting | Pending |

Do not sign the agreement again or mark the walkthrough ready automatically.
The portal session subsequently expired. After the owner's explicit approval,
two support emails were sent on 2 November 2026: agreement reconciliation to
portal-support@ondc.org and the go-live/report checklist to team@ondc.org.
Gmail confirmed SENT for both. Await ONDC responses and actual ticket references;
sending an email does not establish that a portal ticket has been opened.

## Technical validation

A real Workbench RET10 / 1.2.5 / GROCERY preprod session was started. Initial
fixture calls used `sample-bpp-id`; Workbench copied that into its callback
signer ID, which correctly failed the exact trusted-key check. Fixtures now use
`workbench.ondc.tech`, matching the authenticated registry record. Do not add a
sample signer alias or disable signature checks to mask this error.

The corrected cancellation scenario completed all eight request/callback steps
with ACKs: select, init, confirm and cancel. Supabase contains one HTTP-200 audit
record for each direction/action. Transaction:
`60ec287d-5ef0-49cf-af0c-89581590416f`.

Workbench report `PW_jGgobcSvNeggmUoB4yc7ObnR-0LFi7wn`, generated at
2026-11-02T20:48:24.791Z, includes both the initial failed Buyer Delivery attempt
and the corrected cancellation exchange: 3,292 checks, 2,985 passed, 307 failed.
These totals must not be described as cancellation-only counts. Within the
cancellation sections there are five failures out of 1,769 checks: four buyer
payload checks (init parent_item_id twice, init tags, confirm location_id) and
one Workbench mock on_init settlement upi_address check. The item helper now
preserves parent_item_id/tags/location_id and carries the fixture location L1
into confirm; this subsequent metadata change has local coverage but has not
been rerun through a fresh full Workbench report. Do not invent catalog parent
relationships merely to satisfy a validator; confirm the conditional rules and
mock response with ONDC. The report labels its environment staging despite the
session UI being PRE-PRODUCTION; ask ONDC how to interpret that label.

The full mandatory scenario set still needs acceptance.
Preprod signature failures now return a fixed diagnostic reason and a bounded
public signer identifier; production responses retain the generic error. No
private key, signature or unverified callback body is echoed or persisted.

Direct Worker-to-registry transport still fails before an HTTP response. The
operator-only prepared lookup can be sent by an authenticated verification
client without exporting the private key. A later sample-ID lookup returned 401;
that is not evidence for trusting that identity.

## Configuration still needed

### Supabase Auth

The connected plugin does not expose hosted Auth settings. The owner signed in
with ChatGPT and the ZeroProfit dashboard was verified on 2 November 2026.
Never send a management token through chat.

Saved and verified:
- Site URL: `https://www.zeroprofit.food`.
- Exact allowed redirects: `https://www.zeroprofit.food/account` and
  `https://zeroprofit-preproduction.zanynik.workers.dev/account`.
- Email provider and email confirmation are enabled.
- Minimum password length is now 10. A live API test with a nine-character
  synthetic password was rejected with HTTP 422 / weak_password and the
  expected ten-character minimum. No test signup succeeded and no email was sent.

Custom SMTP remains disabled. The owner selected Resend's Free plan on
2 November 2026. Account signup/login is the next blocker; no Resend domain,
API key or SMTP configuration has been created yet.

Planned integration (not yet applied):
- Verify a dedicated sending subdomain, preferably `auth.zeroprofit.food`, after
  checking for existing DNS use. Use Resend's exact generated DNS records.
- Sender: `ZeroProfit Food <noreply@auth.zeroprofit.food>` once verified.
- SMTP host `smtp.resend.com`, port `465`, username `resend`.
- The SMTP password is a Resend API key; store it only in Supabase's secure
  settings, never in this repository or chat. Prefer sending-only permission
  restricted to the verified sending domain.
- Keep open/click tracking off for authentication messages.
- Stay on Free, without paid upgrades or pay-as-you-go. The published allowance
  checked on 2 November is 3,000 emails/month and 100/day.
- Test real signup, confirmation, login and logout only after delivery is ready.

Configure a verified sender before public signup. Supabase's
  default email service is restricted to team addresses and is not production
  mail delivery. Use the provider's exact DNS records, preserving existing SPF.
- Verify signup, confirmation, login and logout with an owner test account.

### ONDC network observability

Obtain the current preprod N.O. token from the signed-in portal and store it
as the Cloudflare Worker secret `N_O_Token`. It is currently absent. Verify
accepted submissions at the preprod analytics endpoint after saving it. Current
submission is best effort; there is no durable retry queue. A completed old
portal checkbox does not prove the migrated Worker sends logs.

## Next sequence

1. Resolve the remaining Workbench report failures, rerun with the metadata fix,
   and run the mandatory scenarios/versions confirmed by ONDC.
2. Follow up on the two sent support emails; reconcile the agreement and get
   the remaining acceptance and walkthrough checklist in writing. Record actual
   ticket references when ONDC supplies them.
3. Complete SMTP/email delivery and network-observability configuration and verify both.
4. Implement real catalog/search, cart, checkout, payments, cancellations,
   refunds, grievance operations and settlement/reconciliation. The current
   repository contains account/support and protocol foundations plus synthetic
   test fixtures, not a complete customer shopping/payment service.
5. Complete ONDC build, observability and grievance/payout acceptance. Arrange
   the walkthrough when the real workflows and evidence are ready.
6. Request production approval/subscription through the portal. Publish exactly
   the DNS verification record and signed request ID supplied for that request;
   do not invent them or reuse the UKID as a request ID.
7. Verify production registry keys, callback signatures, production endpoint
   configuration and a supervised end-to-end pilot before opening ordering.

Production membership and customer shopping readiness are separate gates.

Sources:
- Signed-in ONDC portal inspection, 2 November 2026.
- Authenticated preprod registry lookup and live Workbench results.
- https://github.com/ONDC-Official/developer-docs
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/auth-smtp
