# DNS migration — 2 November 2026

Cloudflare account: `2b1b021020ef414b0a5297a6652f7429`.
Cloudflare zone: `a27eaad9460c4df5f52fddfd1c32894e` (`zeroprofit.food`, Free Website plan).
Assigned nameservers: `iris.ns.cloudflare.com`, `johnny.ns.cloudflare.com`.
Previous registrar nameservers: `ns23.domaincontrol.com`, `ns24.domaincontrol.com`.

The owner exported the GoDaddy zone and changed the registrar nameservers.
Cloudflare DNS-over-HTTPS now returns the assigned Cloudflare nameservers;
Google still returned cached GoDaddy nameservers during the same check.
The last Cloudflare zone API status remains `pending`; activation check was
requested successfully. Do not report active-zone or website cutover completion
until verified. No repeat registrar change is needed on the evidence available.

## Preserved inventory

Ten records were created in Cloudflare and read back with no missing records.
All A/CNAME records remain DNS-only (not proxied) for preservation:

- Apex A: `76.223.105.230` and `13.248.243.5`. GoDaddy's export contains the
  non-IP placeholder `WebsiteBuilder Site`; these actual IPs were resolved
  through public DNS before copying.
- `www` and `ondc`: CNAME `custom-domains.chatgpt.site`.
- `_domainconnect`: CNAME `_domainconnect.gd.domaincontrol.com`.
- Five TXT records copied exactly: `_cf-custom-hostname.ondc`,
  `_cf-custom-hostname.www`, `_dmarc`, `_openai-site-verification.ondc`,
  `_openai-site-verification.www`.
- GoDaddy apex NS and SOA records were not copied as user records; Cloudflare
  provides the authoritative SOA and NS records.
- No MX records exist in the supplied export. Do not invent mail routing.
- The owner's GoDaddy view offered Enable DNSSEC; a public DS lookup returned
  no DS record. No DNSSEC setting was modified. Enable signing after stable
  migration using the new provider's actual DS values and registrar flow.

## Next actions

1. Read zone status until active before attaching Worker Custom Domains.
2. Move `www.zeroprofit.food` to `zeroprofit-preproduction` using the Workers
   Domains API. An existing CNAME conflicts: capture its exact record, remove
   only that CNAME immediately before attaching, and restore it if attachment
   fails. Preserve the verification TXT records for rollback.
3. Attach the apex to the same Worker to activate its existing apex-to-www
   redirect. Verify certificates, redirect, all pages, images, JS/CSS and account.
4. Keep `ondc.zeroprofit.food` on its existing backend until private keys,
   tokens, trusted callback keys and callback parity are configured/tested.
   Do not strand the existing subscribed ONDC endpoint during public-page migration.
5. Finish Supabase hosted Auth redirect/SMTP settings (not exposed by the
   current plugin). Preserve original Sites data until a complete supported
   export and rollback-retention decision.

The deployed independent Worker is `4909754ec22f4809b7831fb1df60f297`, verified
on workers.dev. Source/build and 22 tests passed. Domain DNS management and
website hosting are separate steps; full independence is not yet complete.
