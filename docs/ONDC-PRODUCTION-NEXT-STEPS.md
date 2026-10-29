# ONDC production next steps — checked 29 October 2026

## Current portal evidence

ONDC's email of 20 October says business profile Buyer NP / Retail (B2C) v1.2
was disabled for inactivity. Re-enable it from the portal's Integrations menu;
ONDC says the journey resumes where it stopped. Organization: 16047;
integration profile: 16047–10732.

The 19 October pending-submissions email listed:
- Network Participant Agreement still pending.
- Live customer grievance and payout walkthrough pending.
- Build verification pending.
- Start-transacting details pending.

Agreement issue ONWGR-011708 was closed on 15 October without resolving the
pending status. Verify the current portal status before reopening a ticket.
Do not re-sign a legal agreement automatically or claim the pending work is done.

## Obtain the four configuration items

| Item | Where it comes from | Next action |
| --- | --- | --- |
| Own signing/encryption private keys | The original ONDC subscription key download or another securely retained original | Inspect the existing subscription's Download Keys action. The 1 October portal update announced an enhanced download. Do not regenerate or rotate merely to inspect it. Confirm whether existing private keys are downloadable; the email alone does not prove that. |
| Trusted callback signing public keys | Verified ONDC registry records for each sender and matching unique key ID | Use the current environment's signed v2.0 lookup. Match subscriber ID, unique key ID, algorithm, validity and subscription status before pinning a public key. These are public verification keys, not our private keys. |
| Email-login configuration | Supabase Authentication settings and a transactional email provider | Apply the URL configuration below, configure SMTP, verify its sending domain and test confirmation/sign-in. Keep email confirmation enabled. |
| DNS | GoDaddy DNS/registrar, with the existing records preserved | Inventory/export the complete zone before any nameserver change. Include mail, verification and ONDC TXT records. Attach and verify the independent host only after the inventory is complete. |

The recorded existing unique key ID is
`5f6cf834-19d6-42de-8c03-d13208a4b42d`. Compare it with the actual portal
subscription; it is not a replacement for inspecting the current record.
The Sites API masks private secret values. If the original private keys cannot
be recovered from a legitimate backup/download, coordinate a new key pair and
registry update through ONDC. A new public key cannot recover an old private key.
Enter private key material into secure settings, never a Git commit or chat.

## Supabase settings to apply (not yet applied)

Project: `zeroprofit` / `ynmevkntztzfutjnbfnf`.

- During preview, Site URL: `https://zeroprofit-preproduction.zanynik.workers.dev`.
- Allowed redirect URL: `https://zeroprofit-preproduction.zanynik.workers.dev/account`.
- Also allow the future final URL: `https://www.zeroprofit.food/account`.
- At domain cutover, Site URL becomes `https://www.zeroprofit.food`.
- Keep email confirmations enabled. The application requires 10 characters for
  new passwords; align the server password policy with that requirement.
- Use verified custom SMTP before public signups. Configure sender identity and
  the provider's exact SPF/DKIM records; do not guess values or replace an
  existing SPF record without merging its authorized senders.
- Verify registration, email confirmation, sign-in and sign-out with the owner
  before inviting other customers. No authentication email was sent here.

The connected Supabase tools do not expose Auth configuration updates. Use the
signed-in dashboard, or an authenticated Management API/CLI session. Do not send
a management access token through chat to work around a dashboard login.

## Registry endpoints implemented

The independent source now includes:
- `GET /ondc-site-verification.html`: signs the exact
  `ONDC_SUBSCRIPTION_REQUEST_ID` using `ONDC_SIGNING_PRIVATE_KEY`.
- `POST /buyer/on_subscribe`: X25519 shared-secret + AES-256-ECB challenge
  decryption, matching ONDC's reference utility.

Both fail closed if unconfigured. The challenge handler uses ONDC's published
registry encryption public key for `ONDC_REGISTRY_ENVIRONMENT`; default
`preproduction`, with `production` selected only for the corresponding approved
subscription. It validates the requested subscriber ID. Request IDs and unique
key IDs serve different purposes; do not substitute one for the other.

These endpoints do not enable outgoing production transactions. Outbound
Workbench fixtures remain locked in staging and contain mock payment data.

## Sequence to production

1. Re-enable the existing integration and inspect its subscription/key package.
2. Reconcile the NP Agreement status and outstanding ONDC verification tasks.
3. Configure/retest the independent service with the original pre-production
   keys, trusted senders, correct request ID and the approved callback address.
4. Finish email setup and DNS inventory, then migrate hosting without changing
   the registered subscriber ID or `/buyer` path. Preserve old Sites logs.
5. Complete ONDC's build, grievance/payout and observability acceptance steps.
6. Request the approved production environment/subscription in the portal and
   publish exactly the DNS verification record it supplies. Current ONDC guidance
   says production subscription uses portal-managed approval and DNS verification;
   do not blindly POST a legacy production /subscribe request.
7. Validate the production registry entry, signature verification and callbacks.
8. Replace all Workbench fixtures with real checkout/payment/refund/settlement
   workflows and supervise an end-to-end pilot before opening customer ordering.

Production registry membership and public shopping readiness are separate gates.
The repository currently has account/support and protocol foundations; it does
not yet implement a complete customer shopping/payment service.

Sources:
- ONDC email: Business Profile Disabled, 20 October 2026.
- ONDC email: Pending Submissions, 19 October 2026.
- ONDC email: Subscription Module update, 1 October 2026.
- https://github.com/ONDC-Official/developer-docs
- https://github.com/ONDC-Official/reference-implementations/tree/main/utilities/on_subscibe-service/node
