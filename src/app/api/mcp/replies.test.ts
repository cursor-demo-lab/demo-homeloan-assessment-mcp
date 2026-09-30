import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answered, assessed, landed, reassessed } from "@/assessment/journey.fixture";
import type { Application } from "@/domain/application";
import { fakeStore } from "@/intake/fake-upstash.fixture";
import type { IntakeFields } from "@/intake/fields";
import type { IntakeStore } from "@/intake/store";
import { latestAnswers } from "@/intake/store";
import GOLDEN from "./replies-4611c29.json";
import { POST } from "./route";
import { mcpEndpoint } from "./server";

/** Every tool on each file state of both visits, as 4611c29 answered, before the intake. */
const STATES: Record<string, Application> = { landed, assessed, answered, reassessed };
const TOKEN = "replies-test-token";

async function replay(endpoint: (request: Request) => Promise<Response>, state: string) {
  const client = new Client({ name: "replies-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      fetch: (input, init) => endpoint(new Request(input, init)),
    }),
  );
  const replies = await Promise.all(
    GOLDEN.filter((entry) => entry.state === state).map(async ({ tool, args }) =>
      JSON.stringify(await client.callTool({ name: tool, arguments: args })),
    ),
  );
  await client.close();
  return replies;
}

const expected = (state: string) =>
  GOLDEN.filter((entry) => entry.state === state).map(({ reply }) => reply);

function storeHolding(value: unknown): IntakeStore {
  const { store, upstash } = fakeStore();
  upstash.values.set("intake:HL-26-104471", { value: JSON.stringify(value), expiresAt: Infinity });
  return store;
}

function downStore(): IntakeStore {
  const { store, upstash } = fakeStore();
  upstash.failing = true;
  return store;
}

const EMPTY: readonly (readonly [string, () => Promise<IntakeFields>])[] = [
  ["no store", () => latestAnswers()],
  ["a store that's down", () => latestAnswers(downStore())],
  ["an empty store", () => latestAnswers(fakeStore().store)],
  [
    "an intake with no fields",
    () => latestAnswers(storeHolding({ capturedAt: "2026-10-12T19:47:00+11:00", fields: {} })),
  ],
  [
    "a stored intake that no longer passes the checks",
    () =>
      latestAnswers(
        storeHolding({ capturedAt: "2026-10-12T19:47:00+11:00", fields: { deposit: "lots" } }),
      ),
  ],
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with no answers from the call", () => {
  it("has 4611c29's replies for every state", () => {
    expect(new Set(GOLDEN.map(({ state }) => state))).toStrictEqual(new Set(Object.keys(STATES)));
    expect(GOLDEN).toHaveLength(56);
  });

  it.each(EMPTY)("gives 4611c29's replies byte for byte with %s", async (_label, answers) => {
    vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
    const replies = await Promise.all(
      Object.entries(STATES).map(async ([state, file]) => [
        state,
        await replay(mcpEndpoint([file], answers), state),
      ]),
    );
    expect(Object.fromEntries(replies)).toStrictEqual(
      Object.fromEntries(Object.keys(STATES).map((state) => [state, expected(state)])),
    );
  });

  it("gives 4611c29's replies through the deployed route when no store is configured", async () => {
    vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    await expect(replay(POST, "landed")).resolves.toStrictEqual(expected("landed"));
  });
});
