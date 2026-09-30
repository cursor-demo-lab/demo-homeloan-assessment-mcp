import type { VersionNegotiationMode } from "@modelcontextprotocol/client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkDocuments } from "@/assessment/checks";
import { RECOMMENDATION_PREFIX } from "@/assessment/credit-assessment-bot";
import { documentsOnFile } from "@/assessment/documents";
import { draftAssessorNotes, draftCustomerRequest } from "@/assessment/drafts";
import { answered, assessed, landed, reassessed } from "@/assessment/journey.fixture";
import { indicativeServiceability } from "@/assessment/serviceability";
import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { DAN, MIA } from "@/domain/fixtures/mia-and-dan";
import { formatAud } from "@/domain/money";
import { DEMO_ONLY_TOKEN } from "./auth";
import { DELETE, GET, POST } from "./route";
import { mcpEndpoint } from "./server";

const ENDPOINT = "http://localhost/api/mcp";
const ID = landed.id;
const MIA_AND_DAN = { applicationId: ID };
const CONFIRM = { ...MIA_AND_DAN, confirm: true };
const NOTHING = {};
const TOOLS = [
  "list_applications",
  "get_application",
  "check_documents",
  "indicative_serviceability",
  "draft_assessor_notes",
  "draft_customer_request",
  "hand_over_to_assessor",
];

type Output = Record<string, unknown>;
type Endpoint = (request: Request) => Promise<Response>;

const clients: Client[] = [];

async function connect({
  headers = { Authorization: `Bearer ${DEMO_ONLY_TOKEN}` },
  mode = "legacy",
  endpoint = POST,
}: {
  headers?: Record<string, string>;
  mode?: VersionNegotiationMode;
  endpoint?: Endpoint;
} = {}): Promise<Client> {
  const client = new Client(
    { name: "route-test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      requestInit: { headers },
      fetch: (input, init) => endpoint(new Request(input, init)),
    }),
  );
  return client;
}

const onFile = (file: Application) => connect({ endpoint: mcpEndpoint([file]) });

async function answer(client: Client, name: string, args: Output = MIA_AND_DAN) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false);
  expect(result.content).toStrictEqual([
    { type: "text", text: JSON.stringify(result.structuredContent) },
  ]);
  return result.structuredContent as Output;
}

async function refusal(client: Client, name: string, args: Output = MIA_AND_DAN) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toHaveLength(1);
  return result.content[0];
}

const said = (line: string) => ({ type: "text", text: line });

type Said = readonly [tool: string, text: string];

async function says(client: Client, name: string, args: Output): Promise<Said> {
  const { content } = await client.callTool({ name, arguments: args });
  return [name, JSON.stringify(content)];
}

const EVERY_CALL: readonly (readonly [string, Output])[] = [
  ...TOOLS.map((name) => [name, name === "list_applications" ? NOTHING : MIA_AND_DAN] as const),
  ["hand_over_to_assessor", CONFIRM],
];

/** Every tool on each file state of both visits, plus a confirmed handover at each. */
async function everyResultAtEachStep(): Promise<Said[]> {
  const steps = await Promise.all(
    [landed, assessed, answered, reassessed].map((file) => onFile(file)),
  );
  return Promise.all(
    steps.flatMap((client) => EVERY_CALL.map(([name, args]) => says(client, name, args))),
  );
}

const SCRIPT_AMOUNTS = Object.values(SCRIPT_FIGURES).map(({ amount }) => formatAud(amount));

/** Pasted into the Grok Bot as they are, so the server must send the same words. */
const BOT_RULES =
  'Rules for the assessment tools: You prepare; Priya Raman, the credit assessor, decides. Never say or imply that a loan is or will be approved. Quote figures only as a tool returns them, and put "Indicative, not lender policy" in the same reply as any figure. Keep that label exactly as the tools return it, word for word. Handing over always takes two messages from Priya. When she first asks you to hand a file over, call hand_over_to_assessor without confirm, show her what it will record, and ask her to confirm; do not set confirm yet, even though she asked. Set confirm to true only when her next message confirms. Call tools one after another, and call every tool her message needs before you reply. Keep replies short, because they are read on a big screen. All names, figures and documents are fictional.';

const RPC = {
  initialize: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "route-test", version: "1.0.0" },
    },
  },
  "tools/list": { jsonrpc: "2.0", id: 1, method: "tools/list" },
  "tools/call": {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_applications", arguments: {} },
  },
} as const;

type Method = keyof typeof RPC;

function rpc(method: Method, authorization?: string) {
  return POST(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
        ...(authorization === undefined ? {} : { Authorization: authorization }),
      },
      body: JSON.stringify(RPC[method]),
    }),
  );
}

const REFUSED = {
  status: 401,
  challenge: "Bearer",
  body: JSON.stringify({ error: "Unauthorized." }),
};

async function refusalOf(response: Response) {
  return {
    status: response.status,
    challenge: response.headers.get("WWW-Authenticate"),
    body: await response.text(),
  };
}

const toolsIn = (body: string) => TOOLS.filter((tool) => body.includes(tool));

const METHODS: readonly Method[] = ["initialize", "tools/list", "tools/call"];
const flipLast = (token: string) => `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
const MISSING: readonly (readonly [string, string | undefined])[] = [
  ["no Authorization header", undefined],
  ["an empty bearer token", "Bearer "],
  ["the token under another scheme", `Basic ${DEMO_ONLY_TOKEN}`],
];
const WRONG: readonly (readonly [string, string])[] = [
  ["a wrong token of the same length", `Bearer ${flipLast(DEMO_ONLY_TOKEN)}`],
  ["the token with more on the end", `Bearer ${DEMO_ONLY_TOKEN}0`],
  ["a short wrong token", "Bearer 0"],
];
const cases = (list: readonly (readonly [string, string | undefined])[]) =>
  METHODS.flatMap((method) =>
    list.map(([label, authorization]) => [method, label, authorization] as const),
  );

beforeEach(() => {
  vi.stubEnv("DEMO_MCP_TOKEN", "");
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllEnvs();
});

describe("the token check", () => {
  it("hardcodes a demo token of 32 random bytes in hex", () => {
    expect(DEMO_ONLY_TOKEN).toMatch(/^[\da-f]{64}$/u);
  });

  it.each(cases(MISSING))(
    "refuses %s with a missing token (%s): 401, a Bearer challenge, and no tool list",
    async (method, _label, authorization) => {
      const refused = await refusalOf(await rpc(method, authorization));
      expect(refused).toStrictEqual(REFUSED);
      expect(toolsIn(refused.body)).toStrictEqual([]);
    },
  );

  it.each(cases(WRONG))(
    "refuses %s with a wrong token (%s): 401, a Bearer challenge, and no tool list",
    async (method, _label, authorization) => {
      const refused = await refusalOf(await rpc(method, authorization));
      expect(refused).toStrictEqual(REFUSED);
      expect(toolsIn(refused.body)).toStrictEqual([]);
    },
  );

  it.each([
    ["no token", {}],
    ["a wrong token", { Authorization: `Bearer ${flipLast(DEMO_ONLY_TOKEN)}` }],
  ])("stops an MCP client connecting with %s", async (_label, headers) => {
    await expect(connect({ headers })).rejects.toThrow(/401|unauthori[sz]ed/iu);
  });

  it("serves the demo token, with Bearer in any case", async () => {
    const client = await connect({ headers: { Authorization: `bEARER ${DEMO_ONLY_TOKEN}` } });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length);
  });

  it("uses DEMO_MCP_TOKEN instead of the demo token when it's set", async () => {
    const override = "a-different-token-for-this-deployment";
    vi.stubEnv("DEMO_MCP_TOKEN", override);
    const client = await connect({ headers: { Authorization: `Bearer ${override}` } });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toStrictEqual(TOOLS);
    const refusals = await Promise.all(
      METHODS.map(async (method) => refusalOf(await rpc(method, `Bearer ${DEMO_ONLY_TOKEN}`))),
    );
    expect(refusals).toStrictEqual(METHODS.map(() => REFUSED));
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("keeps the demo token when DEMO_MCP_TOKEN is %s", async (_label, value) => {
    vi.stubEnv("DEMO_MCP_TOKEN", value);
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toStrictEqual(TOOLS);
    await expect(refusalOf(await rpc("tools/list", "Bearer "))).resolves.toStrictEqual(REFUSED);
  });

  it.each([
    ["GET", GET],
    ["DELETE", DELETE],
  ])("answers %s with 405 given the token, and 401 without it", async (method, route) => {
    const request = (headers: Record<string, string>) =>
      route(
        new Request(ENDPOINT, { method, headers: { Accept: "text/event-stream", ...headers } }),
      );
    const served = await request({ Authorization: `Bearer ${DEMO_ONLY_TOKEN}` });
    expect(served.status).toBe(405);
    await expect(refusalOf(await request({}))).resolves.toStrictEqual(REFUSED);
  });
});

describe("tools/list", () => {
  it.each<VersionNegotiationMode>(["legacy", "auto"])(
    "lists the seven tools, each with an input and output schema (%s negotiation)",
    async (mode) => {
      const client = await connect({ mode });
      expect(client.getProtocolEra()).toBe(mode === "auto" ? "modern" : "legacy");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toStrictEqual(TOOLS);
      for (const tool of tools) {
        expect(tool.inputSchema, tool.name).toMatchObject({ type: "object" });
        expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
        expect(tool.annotations, tool.name).toStrictEqual(
          tool.name === "hand_over_to_assessor" ? { idempotentHint: true } : { readOnlyHint: true },
        );
      }
    },
  );

  it("names itself and states the rules", async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({
      name: "demo-homeloan-assessment-mcp",
      version: "0.1.0",
    });
    expect(client.getInstructions()).toBe(BOT_RULES);
  });

  it("puts the two-message handover on the handover tool too, for clients that drop the instructions", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const handover = tools.find((tool) => tool.name === "hand_over_to_assessor");
    expect(handover?.description).toContain("Handing over always takes two messages from Priya.");
    expect(handover?.inputSchema).toMatchObject({
      properties: {
        confirm: { description: "true only when Priya confirms, in her message after the preview" },
      },
    });
  });
});

describe("every tool on Mia and Dan's file", () => {
  it("lists the file at Credit Assessment on its first visit", async () => {
    const client = await connect();
    await expect(answer(client, "list_applications", NOTHING)).resolves.toStrictEqual({
      applications: [
        {
          applicationId: ID,
          reference: landed.reference,
          applicants: ["Mia Castellano", "Dan Harlow"],
          visit: 1,
          itemsToCheck: 7,
        },
      ],
    });
  });

  it("reads only stage 2's view", async () => {
    const client = await connect();
    const output = await answer(client, "get_application");
    expect(output).toMatchObject({
      applicationId: ID,
      reference: landed.reference,
      stage: "credit-assessment",
      visit: 1,
      canWrite: true,
    });
    expect(output["view"]).toStrictEqual(viewFor("credit-assessment", landed));
    expect(output["documents"]).toStrictEqual(documentsOnFile(landed));
    expect(output["toCheck"]).toHaveLength(7);
  });

  it("returns the helpers' checks, figures and drafts unchanged", async () => {
    const client = await connect();
    const request = draftCustomerRequest(landed);
    await expect(answer(client, "check_documents")).resolves.toStrictEqual(checkDocuments(landed));
    await expect(answer(client, "indicative_serviceability")).resolves.toStrictEqual(
      indicativeServiceability(landed),
    );
    await expect(answer(client, "draft_assessor_notes")).resolves.toStrictEqual(
      draftAssessorNotes(landed),
    );
    await expect(answer(client, "draft_customer_request")).resolves.toStrictEqual(
      request.ok ? request.draft : request,
    );
  });

  it("previews the handover, returns the record on confirm, and writes nothing", async () => {
    const client = await connect();
    const preview = await answer(client, "hand_over_to_assessor");
    expect(preview).toMatchObject({ status: "needs-confirmation", stage: "credit-assessment" });

    const handedOver = await answer(client, "hand_over_to_assessor", CONFIRM);
    expect(handedOver).toMatchObject({ status: "handed-over", stage: "credit-decision" });
    const findings = handedOver["findings"] as readonly string[];
    const notes = draftAssessorNotes(landed);
    expect(findings[0]).toMatch(/^On Priya Raman's instruction, /u);
    expect(findings.slice(1)).toStrictEqual([...notes.findings, notes.recommendation]);
    expect(preview["findings"]).toStrictEqual(findings);

    await expect(answer(client, "get_application")).resolves.toMatchObject({
      stage: "credit-assessment",
      visit: 1,
    });
    await expect(answer(client, "list_applications", NOTHING)).resolves.toMatchObject({
      applications: [{ applicationId: ID, visit: 1 }],
    });
  });
});

describe("refusals", () => {
  it.each(TOOLS.filter((name) => name !== "list_applications"))(
    "%s refuses an unknown id",
    async (name) => {
      const client = await connect();
      await expect(refusal(client, name, { applicationId: "app-nobody" })).resolves.toStrictEqual(
        said("There's no application with that id."),
      );
    },
  );

  it("won't draft a customer request on visit 2, when nothing is missing", async () => {
    const client = await onFile(answered);
    await expect(refusal(client, "draft_customer_request")).resolves.toStrictEqual(
      said("Nothing is missing on this visit, so there's no request to draft."),
    );
  });

  it.each([false, true])("won't hand over a file at stage 3 (confirm %s)", async (confirm) => {
    const client = await onFile(assessed);
    await expect(
      refusal(client, "hand_over_to_assessor", { ...MIA_AND_DAN, confirm }),
    ).resolves.toStrictEqual(
      said("The file is at Credit decision now, so I can read it but can't change it."),
    );
    await expect(answer(client, "get_application")).resolves.toMatchObject({
      stage: "credit-decision",
      canWrite: false,
    });
  });
});

describe("both visits", () => {
  it("finds the Afterpay gap on visit 1, and recommends approval on visit 2 once it's closed", async () => {
    const visit1 = await onFile(landed);
    await expect(answer(visit1, "check_documents")).resolves.toMatchObject({
      visit: 1,
      gaps: [
        "The bank statements and credit report show an Afterpay account that wasn't mentioned on the call.",
      ],
    });
    await expect(answer(visit1, "indicative_serviceability")).resolves.toMatchObject({
      fallsShort: true,
    });

    const visit2 = await onFile(answered);
    await expect(answer(visit2, "list_applications", NOTHING)).resolves.toMatchObject({
      applications: [{ applicationId: ID, visit: 2 }],
    });
    await expect(answer(visit2, "check_documents")).resolves.toMatchObject({ visit: 2, gaps: [] });
    await expect(answer(visit2, "indicative_serviceability")).resolves.toMatchObject({
      beforeAfterpay: null,
      withAfterpay: null,
      fallsShort: false,
    });
    const handedOver = await answer(visit2, "hand_over_to_assessor", CONFIRM);
    const findings = handedOver["findings"] as readonly string[];
    expect(findings.at(-1)).toMatch(new RegExp(`^${RECOMMENDATION_PREFIX}approve\\.`, "u"));

    const decided = await onFile(reassessed);
    await expect(answer(decided, "list_applications", NOTHING)).resolves.toStrictEqual({
      applications: [],
    });
  });
});

describe("every result, at each step of both visits", () => {
  it("says 'not lender policy' wherever it quotes one of the script's figures", async () => {
    const results = await everyResultAtEachStep();
    const quoting = results.filter(([, text]) =>
      SCRIPT_AMOUNTS.some((amount) => text.includes(amount)),
    );
    expect(new Set(quoting.map(([tool]) => tool))).toStrictEqual(
      new Set(["indicative_serviceability", "draft_assessor_notes", "hand_over_to_assessor"]),
    );
    for (const [tool, text] of quoting) {
      expect(text, tool).toContain("not lender policy");
    }
  });

  it("never shows contact details or the appointment", async () => {
    const hidden = [
      "mobile",
      "email",
      "appointment",
      landed.appointment.startsAt,
      MIA.mobile,
      MIA.email,
      DAN.mobile,
      DAN.email,
    ];
    for (const [tool, text] of await everyResultAtEachStep()) {
      for (const detail of hidden) {
        expect(text, tool).not.toContain(detail);
      }
    }
  });
});
