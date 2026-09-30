import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/**
 * Every request needs the token in DEMO_MCP_TOKEN, `initialize` and `tools/list` included.
 * The repository is public, so there is no default: unset or empty, every request is refused.
 */
export function tokenRefusal(request: Request): Response | undefined {
  const expected = process.env["DEMO_MCP_TOKEN"] ?? "";
  const given = /^Bearer\s+(.+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1];
  // Hashing both sides first keeps the compare constant-time for any token length.
  if (expected !== "" && given !== undefined && timingSafeEqual(sha256(given), sha256(expected))) {
    return undefined;
  }
  // xAI reports a 401 as "Authentication failed" only when this header is present. It names no
  // OAuth resource metadata, so clients don't go looking for a sign-in flow.
  return Response.json(
    { error: "Unauthorized." },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}
