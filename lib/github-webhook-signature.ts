import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub `X-Hub-Signature-256` against the raw webhook body.
 */
export function verifyGitHubWebhookSignature256(
  rawBody: string,
  signature256Header: string | null,
  secret: string
): boolean {
  if (!signature256Header?.startsWith("sha256=")) {
    return false;
  }
  const providedHex = signature256Header.slice("sha256=".length);
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(providedHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
