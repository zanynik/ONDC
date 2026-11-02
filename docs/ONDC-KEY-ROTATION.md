# ONDC key replacement checkpoint

The owner generated replacement keys through the ONDC portal. A fresh signed-in
subscription View panel shows the existing PreProd subscription still Subscribed
at subscriber ID `ondc.zeroprofit.food`, URL `https://ondc.zeroprofit.food/buyer`.
The new public identifiers are:

- Unique key ID: `bec6f9f9-9e08-4845-acba-3c85f85907e4`.
- Ed25519 signing public key: `+s8rQaTZ70ej+a7aK6Hf2ftNtxQNHparvODtC/I6fWM=`.
- X25519 encryption public key (SPKI DER, Base64):
  `MCowBQYDK2VuAyEAoWgjqpfFFFz5W1S5JJdm+x5i8j6n/I6Fc8MKbhPUYXc=`.
- The portal displays updated 03 Nov 2026 and expiry 03 Nov 2027. These are the
  portal's displayed dates; the session client date is 2 November 2026.

The old unique key ID in earlier checklists is superseded. No private keys are
included here or in source control. The owner reports that the private-key file
was downloaded in the cloud browser. It has not appeared in the shared scratch
folder. Agent access to chrome://downloads is blocked by browser policy; do not
use alternate browser surfaces or low-level commands to work around that block.
The owner must retrieve the file through the supported user download interface
and provide it for secure import, or enter the private keys directly into the
Cloudflare Worker's secret settings.

## Next steps

1. Obtain the replacement private-key package through an authorized supported
   file flow. Never print key values or commit the package.
2. Derive public keys locally and compare against both public values above.
3. Install signing/encryption keys in `zeroprofit-preproduction` secrets and
   update its unique key ID. Preserve the protocol-store token and static assets.
4. Configure remaining runner/admin/observability tokens and trusted preprod
   callback sender public keys. Test signing and registry lookup; do not loosen
   callback verification or unlock fixtures simply to obtain a green health page.
5. Validate the independent handler, then migrate the ONDC custom domain with
   rollback records retained. Confirm callbacks and persistence end to end.

The public www website and apex redirect already use Cloudflare. The ONDC
hostname still routes to ChatGPT Sites. Its original private keys may no longer
match the registry after this owner-performed replacement, so pause preprod
transaction tests until the new private keys have been installed and verified.
Full ONDC hosting independence is not complete yet.
