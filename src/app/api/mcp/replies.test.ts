import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answered, assessed, landed, reassessed } from "@/assessment/journey.fixture";
import type { Application } from "@/domain/application";
import { SCRIPTED_ANSWERS } from "@/intake/answers.fixture";
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

async function replay(
  endpoint: (request: Request) => Promise<Response>,
  state: string,
  shown: (reply: Reply) => Reply = (reply) => reply,
) {
  const client = new Client({ name: "replies-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      fetch: (input, init) => endpoint(new Request(input, init)),
    }),
  );
  const replies = await Promise.all(
    GOLDEN.filter((entry) => entry.state === state).map(async ({ tool, args }) =>
      JSON.stringify(shown((await client.callTool({ name: tool, arguments: args })) as Reply)),
    ),
  );
  await client.close();
  return replies;
}

interface Reply {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly structuredContent?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unmarked(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => unmarked(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "fromCall")
      .map(([key, inner]) => [key, unmarked(inner)]),
  );
}

/** The reply as it would be without the call's `fromCall` marks, in both of its forms. */
function withoutFromCall(reply: Reply): Reply {
  if (reply.structuredContent === undefined) {
    return reply;
  }
  return {
    ...reply,
    content: reply.content.map((item) =>
      item.text === undefined
        ? item
        : { ...item, text: JSON.stringify(unmarked(JSON.parse(item.text))) },
    ),
    structuredContent: unmarked(reply.structuredContent),
  };
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

const scripted = () =>
  latestAnswers(
    storeHolding({ capturedAt: "2026-10-12T19:47:00+11:00", fields: SCRIPTED_ANSWERS }),
  );

describe("after a call that follows the script", () => {
  it("gives 4611c29's replies for every state, apart from saying which answers came from the call", async () => {
    vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
    const replies = await Promise.all(
      Object.entries(STATES).map(async ([state, file]) => [
        state,
        await replay(mcpEndpoint([file], scripted), state, withoutFromCall),
      ]),
    );
    expect(Object.fromEntries(replies)).toStrictEqual(
      Object.fromEntries(Object.keys(STATES).map((state) => [state, expected(state)])),
    );
  });

  it("does say which answers came from the call", async () => {
    vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
    const replies = await replay(mcpEndpoint([landed], scripted), "landed");
    expect(replies.filter((reply) => reply.includes('"fromCall"'))).toHaveLength(
      expected("landed").filter((reply) => !reply.includes('"isError"')).length,
    );
  });
});
