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
export function verifyCallbackSignature(
  authorization: string | null,
  body: string,
  trustedKeysJson?: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  try {
    if (!authorization?.startsWith("Signature ") || !trustedKeysJson) return false;
    const fields: Record<string, string> = {};
    const parts = authorization.slice(10).split(/,\s*/);
    for (const part of parts) {
      const match = /^(\w+)="([^"\r\n]+)"$/.exec(part);
      if (!match || Object.hasOwn(fields, match[1])) return false;
      fields[match[1]] = match[2];
    }
    if (fields.algorithm !== "ed25519" || fields.headers !== "(created) (expires) digest") return false;
    if (!/^\d+$/.test(fields.created ?? "") || !/^\d+$/.test(fields.expires ?? "")) return false;
    const created = Number(fields.created), expires = Number(fields.expires);
    if (created > now + 30 || expires <= now || expires <= created || expires - created > 600) return false;
    const keys = JSON.parse(trustedKeysJson) as Record<string, string>;
    if (!Object.hasOwn(keys, fields.keyId) || typeof keys[fields.keyId] !== "string") return false;
    const publicKey = Buffer.from(keys[fields.keyId], "base64");
    const signature = Buffer.from(fields.signature ?? "", "base64");
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der", type: "spki",
    });
    const digest = Buffer.from(blake2b(Buffer.from(body), undefined, 64)).toString("base64");
    return verify(null, Buffer.from(`(created): ${fields.created}\n(expires): ${fields.expires}\ndigest: BLAKE-512=${digest}`), key, signature);
  } catch {
    return false;
  }
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
