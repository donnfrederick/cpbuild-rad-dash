/**
 * Best-effort client IP from reverse-proxy headers (Railway, Vercel, etc.).
 * Never trust for authentication — only for coarse rate limiting / logging.
 */
const MAX_IP_LEN = 128;

export function getClientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first.length > 0) return first.slice(0, MAX_IP_LEN);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length > 0) return realIp.slice(0, MAX_IP_LEN);
  return "unknown";
}
