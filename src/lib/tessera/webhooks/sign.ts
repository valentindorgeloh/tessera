/**
 * HMAC-SHA256 signature for outbound webhook bodies.
 * `X-Tessera-Signature: sha256=<hex of HMAC("<timestamp>.<body>")>`.
 */
import { createHmac } from "node:crypto";

/** Returns `sha256=<hex>` for the signed `"<timestamp>.<body>"` string. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}
