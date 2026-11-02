# ONDC key replacement and hosting cutover — 2 November 2026

## Verified replacement keys

The owner stored both replacement private keys directly as Cloudflare secrets.
The assistant did not retrieve their values. A protected Worker diagnostic
derived the public keys inside the runtime and returned only these public values:

- UKID: `a760e7ab-df2e-47eb-8287-dce8deb0ea3e`.
- Signing public key: `dZPaApbjiE+kxp0II2J4WWtlAlLo8tt0vqdDcu6c9XU=`.
- X25519 encryption public key:
  `MCowBQYDK2VuAyEAgIvbE5hRFJSPJznx3hMGYpn5YPSUWhpcSSbLzOtk7FA=`.

A signed v2.0 lookup returned HTTP 200, one matching SUBSCRIBED record, exactly
these public keys, the registered URL `https://ondc.zeroprofit.food/buyer`,
valid from 2026-11-02T19:35:00.387Z until 2027-11-02T19:35:00.387Z.
All earlier UKIDs in older checklists are superseded.

The direct Worker-to-registry request fails with a transport TypeError before
an upstream HTTP status. An operator-only prepared-request path signs the fixed
preprod read-only lookup inside the Worker; the verification client sends it
to ONDC. That path succeeded without exporting private keys. Do not claim
automatic registry refresh or direct Worker registry connectivity is working.

## Trusted preprod callback senders

Authenticated registry lookups verified SUBSCRIBED RET10 records and validity:
- Workbench `workbench.ondc.tech|c11d8b66-a8fb-4962-b1d8-66a66a67079d|ed25519`,
  public key `POT0oYdwKKGx1ZWTeSKfBHtoXeyQar4dO8w3wuFrXJU=`,
  validity 2026-07-21 through 2036-07-21, BAP/BPP records.
- Gateway `preprod.gateway.ondc.org|0739b57d-1dea-419f-ab8e-f5b0f878ca5c|ed25519`,
  public key `wpENEvRm4NvQtdf7FNTtGZtcZJfPxpsJEOjuabCXXgw=`,
  validity 2026-07-02 through 2031-05-30, BG record.

These two exact key IDs are pinned in configuration. Unknown senders remain
rejected; production and other seller keys require their own verified lookup.
Refresh the pins if the registry rotates them. No callback verification was
disabled to achieve the migration.

## Independent hosting

The ONDC hostname now has an enabled Cloudflare Worker Custom Domain:
- Domain ID `1f69e53d9c61c35033f9b400ca9ac0eacfbd06c3`.
- Certificate ID `a0ec26a2-8108-4946-84ab-cad824437a10`.
- Service `zeroprofit-preproduction`; custom-domain environment name
  `production` is Cloudflare's deployment label, not ONDC production approval.
- Worker deployment `405ea578a8b649279f62c64441693f93`.
- Application mode `preproduction`, required callback signatures, Supabase store,
  `production_ready:false`.
- Hosted protected diagnostic confirmed real Supabase connectivity.
- Live hostname health now reports the independent deployment fields. Initial
  cached requests still reached the old Site before DNS propagation completed.
- Public www and apex already use the same independent Worker.

A real active Workbench cancellation scenario now completed select/init/confirm/
cancel and all four callbacks with ACKs. Strict signature verification remained
required and all eight HTTP-200 audit records were persisted in Supabase. The
fixture BPP ID was corrected from `sample-bpp-id` to `workbench.ondc.tech` so the
callback signer matches the exact registry-pinned identity.

ACK completion is not full compliance acceptance. The generated report includes
307 failures across the initial failed Buyer Delivery attempt and corrected
cancellation flow; cancellation-only sections contain five failures, with item
metadata and a mock settlement field needing attention. See the current
[production checklist](ONDC-PRODUCTION-NEXT-STEPS.md) for the precise breakdown.

## Remaining work

- Complete the active Workbench end-to-end acceptance run and callback persistence
  verification for the real Workbench signer.
- Transfer/configure the network-observability token and verify submissions.
- Complete Supabase hosted Auth redirect/SMTP configuration and real email tests.
- Obtain a complete export of historical Sites protocol data. Keep the old Site
  and D1 database for history/rollback; bounded row responses truncate payloads
  and are not a usable full export.
- ONDC production agreement/walkthrough/build approval and actual customer
  shopping/payment/refund/settlement implementation remain separate gates.

The new admin and runner secrets are held in Cloudflare; never put their values
or private key downloads in source control or operational logs.
