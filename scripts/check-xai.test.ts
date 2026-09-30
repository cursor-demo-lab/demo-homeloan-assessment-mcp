import { describe, expect, it } from "vitest";
import { connectionOf } from "./check-xai";

const ENDPOINT = "https://demo-homeloan-assessment-mcp.vercel.app/api/mcp";
const AUTH_REQUIRED =
  "Send message error Transport [rmcp::transport::worker::WorkerTransport<rmcp::transport::streamable_http_client::StreamableHttpClientWorker<reqwest::async_impl::client::Client>>] error: Auth required, when send initialize request";

describe("connectionOf, on the errors xAI really returns", () => {
  it("reads a 401 with WWW-Authenticate as an authentication failure", () => {
    expect(
      connectionOf(400, `Authentication failed for ${ENDPOINT}: ${AUTH_REQUIRED}`, ENDPOINT),
    ).toBe("auth-failed");
  });

  it("reads every other failure as no connection", () => {
    expect(connectionOf(400, `Failed to connect to MCP server ${ENDPOINT}`, ENDPOINT)).toBe(
      "no-connection",
    );
  });

  it("doesn't credit another server's authentication failure to this one", () => {
    const other = "https://elsewhere.example/api/mcp";
    expect(
      connectionOf(400, `Authentication failed for ${other}: ${AUTH_REQUIRED}`, ENDPOINT),
    ).toBe("failed");
  });

  it.each([
    [401, `Authentication failed for ${ENDPOINT}`],
    [500, ""],
    [0, ""],
  ])("reads status %s from xAI itself as a failed request", (status, error) => {
    expect(connectionOf(status, error, ENDPOINT)).toBe("failed");
  });

  it("reads a 200 as connected", () => {
    expect(connectionOf(200, "", ENDPOINT)).toBe("connected");
  });
});
