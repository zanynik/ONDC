# DNS migration — 2 November 2026

Cloudflare account: `2b1b021020ef414b0a5297a6652f7429`.
Cloudflare zone: `a27eaad9460c4df5f52fddfd1c32894e` (`zeroprofit.food`, Free Website plan).
Assigned nameservers: `iris.ns.cloudflare.com`, `johnny.ns.cloudflare.com`.
Previous registrar nameservers: `ns23.domaincontrol.com`, `ns24.domaincontrol.com`.

The owner exported the GoDaddy zone and changed the registrar nameservers.
Cloudflare's zone API now reports **active**. Public DNS returns the assigned
Cloudflare nameservers.

## Public website cutover complete

The following enabled Worker Custom Domains now route to
`zeroprofit-preproduction` (environment `production`):
- `www.zeroprofit.food`: domain ID `1ddd684a645a6500de6bf95a58fbec36e428c998`,
  certificate ID `cea08fcd-3787-4a86-b521-698311456198`.
- `zeroprofit.food`: domain ID `1837fa8d827d3a4e1619c44ab5467452807c48a6`,
  certificate ID `b7397b1c-62d7-46cf-b05f-941fbd142085`.

The former www CNAME and two apex GoDaddy A records were replaced by Worker
Custom Domain records. The ONDC CNAME, all TXT records and DomainConnect CNAME
were retained. Cloudflare manages the public-hostname certificates.

Verified live over HTTPS: all six website pages return 200; the apex responds
308 to www with path/query preserved. The www health endpoint identifies the
independent staging backend with Supabase persistence. Browser verified the
account page and its create-account form interaction. Email confirmation and
full sign-in remain unverified until hosted Auth settings are configured.

The overall migration is **partial**: `ondc.zeroprofit.food` still uses ChatGPT
Sites because the independent service lacks the original private keys/tokens.
Do not advertise the whole application as independent yet. ONDC production
approval is a separate project gate.

## Preserved inventory

Ten original records were created in Cloudflare and read back with no missing records before cutover. The original inventory for rollback is:

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

## Remaining actions

1. Configure Supabase hosted Auth redirects for the live account URL and verified
   SMTP. The current Supabase plugin does not expose these settings.
2. Recover original ONDC private keys/tokens or coordinate a replacement key
   pair with the registered subscription; configure trusted callback signing
   keys and test before moving the ONDC hostname.
3. Obtain a complete supported export of old Sites protocol data. Bounded plugin
   row responses truncate some payloads and are not a complete export.
4. After verified ONDC cutover and the chosen rollback period, retire the old
   Sites hosting. Do not delete it while it is serving the subscribed endpoint.

The independent deployment is `4909754ec22f4809b7831fb1df60f297`.
The source build and 22 tests passed before deployment. Custom Domains are now
tracked in wrangler.jsonc for future deployments.

## Rollback

Detach the two Worker Custom Domains, then recreate the original www CNAME and
apex A records above with DNS-only routing and TTL 3600. Retain original Sites
hosting and verification TXT records. Moving the registrar nameservers back to
GoDaddy is not required for this hosting rollback.
