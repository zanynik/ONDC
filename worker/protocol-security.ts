import { Buffer } from "node:buffer";
import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { blake2b } from "blakejs";

export function secretMatches(supplied: string | null, expected?: string): boolean {
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Pin exact subscriber|key-id|ed25519 entries from a trusted registry lookup.
// Never fetch a public key from a URL supplied by an incoming request.
export function callbackSignatureStatus(
  authorization: string | null,
  body: string,
  trustedKeysJson?: string,
  now = Math.floor(Date.now() / 1000),
): string {
  try {
    if (!authorization) return "missing_authorization";
    if (!authorization.startsWith("Signature ")) return "unsupported_authorization";
    if (!trustedKeysJson) return "missing_trusted_keys";
    const fields: Record<string, string> = {};
    const parts = authorization.slice(10).split(/,\s*/);
    for (const part of parts) {
      const match = /^(\w+)="([^"\r\n]+)"$/.exec(part);
      if (!match || Object.hasOwn(fields, match[1])) return "malformed_authorization";
      fields[match[1]] = match[2];
    }
    if (fields.algorithm !== "ed25519" || fields.headers !== "(created) (expires) digest") return "unsupported_signature_parameters";
    if (!/^\d+$/.test(fields.created ?? "") || !/^\d+$/.test(fields.expires ?? "")) return "invalid_signature_timestamps";
    const created = Number(fields.created), expires = Number(fields.expires);
    if (created > now + 30) return "signature_created_in_future";
    if (expires <= now || expires <= created) return "signature_expired";
    if (expires - created > 600) return "signature_lifetime_exceeds_limit";
    const keys = JSON.parse(trustedKeysJson) as Record<string, string>;
    if (!Object.hasOwn(keys, fields.keyId) || typeof keys[fields.keyId] !== "string") return "untrusted_signer";
    const publicKey = Buffer.from(keys[fields.keyId], "base64");
    const signature = Buffer.from(fields.signature ?? "", "base64");
    if (publicKey.length !== 32 || signature.length !== 64) return "invalid_key_or_signature_encoding";
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der", type: "spki",
    });
    const digest = Buffer.from(blake2b(Buffer.from(body), undefined, 64)).toString("base64");
    return verify(null, Buffer.from(`(created): ${fields.created}\n(expires): ${fields.expires}\ndigest: BLAKE-512=${digest}`), key, signature) ? "valid" : "signature_mismatch";
  } catch {
    return "invalid_signature_configuration";
  }
}

export function verifyCallbackSignature(
  authorization: string | null,
  body: string,
  trustedKeysJson?: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return callbackSignatureStatus(authorization, body, trustedKeysJson, now) === "valid";
}

export async function boundedText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new RangeError("payload_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError("payload_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
