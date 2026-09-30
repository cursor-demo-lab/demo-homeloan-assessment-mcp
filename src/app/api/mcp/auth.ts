import { createHash, timingSafeEqual } from "node:crypto";

/**
 * DEMO ONLY. This repository is public, so this token keeps out casual callers and nothing
 * more: it guards fictional data. Set DEMO_MCP_TOKEN to use a different one.
 */
export const DEMO_ONLY_TOKEN = "2381f05ddc3a010030d70c6b310510cab10ba23953da044b9ee39758b203ea82";

const sha256 = (text: string) => createHash("sha256").update(text).digest();

function expectedToken(): string {
  const override = process.env["DEMO_MCP_TOKEN"];
  return override === undefined || override === "" ? DEMO_ONLY_TOKEN : override;
}

/** Every request needs the token, `initialize` and `tools/list` included. */
export function tokenRefusal(request: Request): Response | undefined {
  const given = /^Bearer\s+(.+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1];
  // Hashing both sides first keeps the compare constant-time for any token length.
  if (given !== undefined && timingSafeEqual(sha256(given), sha256(expectedToken()))) {
    return undefined;
  }
  // xAI reports a 401 as "Authentication failed" only when this header is present. It names no
  // OAuth resource metadata, so clients don't go looking for a sign-in flow.
  return Response.json(
    { error: "Unauthorized." },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}
