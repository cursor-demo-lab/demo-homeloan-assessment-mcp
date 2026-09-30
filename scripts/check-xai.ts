import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const DEPLOYMENT_URL = "https://demo-homeloan-assessment-mcp.vercel.app/api/mcp";
const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const MODEL = "grok-4.20-0309-non-reasoning";
const SERVER_LABEL = "assessment";
const TIMEOUT_MS = 60_000;
const LABEL = "Indicative, not lender policy";
const LIST_PROMPT =
  "List the exact name of every tool available to you, one per line, and nothing else.";

const TOOLS = [
  "list_applications",
  "get_application",
  "check_documents",
  "indicative_serviceability",
  "draft_assessor_notes",
  "draft_customer_request",
  "hand_over_to_assessor",
] as const;

type Tool = (typeof TOOLS)[number];

interface McpServer {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * How xAI's MCP client fared. It never passes the server's status through: a 401 that
 * carries `WWW-Authenticate` comes back as "Authentication failed for <url>", and every
 * other failure as "Failed to connect to MCP server <url>".
 */
export type Connection = "connected" | "auth-failed" | "no-connection" | "failed";

type CallResult =
  | { readonly status: "unreachable"; readonly connection: Exclude<Connection, "connected"> }
  | { readonly status: "not-called" }
  | { readonly status: "refused"; readonly text: string }
  | { readonly status: "answered"; readonly content: unknown };

interface Check {
  readonly mark: "PASS" | "FAIL" | "SKIP";
  readonly name: string;
  readonly detail?: string;
}

const xaiError = z.object({ error: z.string() });
const xaiOutput = z.object({ output: z.array(z.unknown()) });
const textParts = z.array(z.object({ text: z.string().optional() }));
const message = z.object({ type: z.literal("message"), content: textParts });
const mcpCall = z.object({
  type: z.literal("mcp_call"),
  name: z.string(),
  error: z.string().nullish(),
  output: z.string().nullish(),
});
const toolResult = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown(),
  content: textParts.optional(),
});
const applicationList = z.object({
  applications: z.array(z.object({ applicationId: z.string() })),
});
const labelled = z.object({ label: z.literal(LABEL) });
const preview = z.object({ status: z.literal("needs-confirmation") });
const isLabelled = (content: unknown) => labelled.safeParse(content).success;

const CONNECTION_DETAIL: Record<Connection, string> = {
  connected: "xAI connected",
  "auth-failed": 'xAI reported "Authentication failed"',
  "no-connection": 'xAI reported "Failed to connect"',
  failed: "the xAI request failed",
};

const CALL_DETAIL: Record<Exclude<CallResult["status"], "unreachable">, string> = {
  "not-called": "xAI didn't call it",
  refused: "the tool returned an error",
  answered: "unexpected answer",
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function connectionOf(status: number, error: string, url: string): Connection {
  if (status >= 200 && status < 300) {
    return "connected";
  }
  if (status === 400 && error.startsWith(`Authentication failed for ${url}`)) {
    return "auth-failed";
  }
  if (status === 400 && error.startsWith(`Failed to connect to MCP server ${url}`)) {
    return "no-connection";
  }
  return "failed";
}

async function ask({
  xaiKey,
  server,
  input,
  mode,
}: {
  readonly xaiKey: string;
  readonly server: McpServer;
  readonly input: string;
  readonly mode:
    | { readonly tool_choice: "none" }
    | { readonly tool_choice: "required"; readonly allowed_tools: readonly [Tool] };
}): Promise<{ readonly connection: Connection; readonly output: readonly unknown[] }> {
  const { tool_choice, ...allowed } = mode;
  const mcp = {
    type: "mcp",
    server_url: server.url,
    server_label: SERVER_LABEL,
    headers: server.headers,
    ...allowed,
  };
  try {
    const response = await fetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        // xAI keeps responses by default, and a response echoes the MCP headers.
        store: false,
        input,
        tools: [mcp],
        tool_choice,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = parseJson(await response.text());
    const error = xaiError.safeParse(body).data?.error ?? "";
    return {
      connection: connectionOf(response.status, error, server.url),
      output: xaiOutput.safeParse(body).data?.output ?? [],
    };
  } catch {
    return { connection: "failed", output: [] };
  }
}

async function listTools(
  xaiKey: string,
  server: McpServer,
): Promise<{ readonly connection: Connection; readonly names: ReadonlySet<string> }> {
  const reply = await ask({ xaiKey, server, input: LIST_PROMPT, mode: { tool_choice: "none" } });
  const prefix = `${SERVER_LABEL}___`;
  const text = reply.output
    .flatMap((item) => message.safeParse(item).data?.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
  const names = text
    .split(/\W+/u)
    .filter((token) => token.startsWith(prefix))
    .map((token) => token.slice(prefix.length));
  return { connection: reply.connection, names: new Set(names) };
}

async function callTool(
  xaiKey: string,
  server: McpServer,
  tool: Tool,
  args: Readonly<Record<string, string>>,
): Promise<CallResult> {
  const input = `Call ${tool} once with the arguments ${JSON.stringify(args)}. Then reply "done".`;
  const reply = await ask({
    xaiKey,
    server,
    input,
    mode: { tool_choice: "required", allowed_tools: [tool] },
  });
  if (reply.connection !== "connected") {
    return { status: "unreachable", connection: reply.connection };
  }
  const call = reply.output
    .map((item) => mcpCall.safeParse(item).data)
    .find((item) => item?.name === tool);
  if (call === undefined) {
    return { status: "not-called" };
  }
  const result = toolResult.safeParse(parseJson(call.output ?? ""));
  if (call.error || !result.success || result.data.isError) {
    const said = result.data?.content?.map((part) => part.text ?? "") ?? [];
    return { status: "refused", text: [call.error ?? "", ...said].join("\n") };
  }
  return { status: "answered", content: result.data.structuredContent };
}

function check({
  name,
  ok,
  detail,
}: {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}): Check {
  return ok ? { mark: "PASS", name } : { mark: "FAIL", name, detail };
}

function answers(
  name: string,
  result: CallResult,
  accept: (content: unknown) => boolean = () => true,
): Check {
  return check({
    name,
    ok: result.status === "answered" && accept(result.content),
    detail:
      result.status === "unreachable"
        ? CONNECTION_DETAIL[result.connection]
        : CALL_DETAIL[result.status],
  });
}

function refusedAuth(name: string, connection: Connection): Check {
  return check({ name, ok: connection === "auth-failed", detail: CONNECTION_DETAIL[connection] });
}

async function checkFile(
  xaiKey: string,
  server: McpServer,
  applicationId: string,
): Promise<Check[]> {
  const call = (tool: Tool) => callTool(xaiKey, server, tool, { applicationId });
  const [application, documents, figures, notes, request, handover] = await Promise.all([
    call("get_application"),
    call("check_documents"),
    call("indicative_serviceability"),
    call("draft_assessor_notes"),
    call("draft_customer_request"),
    call("hand_over_to_assessor"),
  ]);
  return [
    answers("get_application answers", application),
    answers("check_documents answers", documents),
    answers(`indicative_serviceability answers, labelled "${LABEL}"`, figures, isLabelled),
    answers(`draft_assessor_notes answers, labelled "${LABEL}"`, notes, isLabelled),
    answers("draft_customer_request answers", request),
    answers(
      "hand_over_to_assessor without confirm asks for confirmation",
      handover,
      (content) => preview.safeParse(content).success,
    ),
  ];
}

function readUrl(): URL | undefined {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { url: { type: "string", default: DEPLOYMENT_URL } },
    });
    const url = URL.canParse(values.url) ? new URL(values.url) : undefined;
    return url?.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const url = readUrl();
  if (url === undefined) {
    console.error("Usage: pnpm assessment:check [--url https://<deployment>/api/mcp]");
    return 2;
  }
  const xaiKey = process.env["XAI_API_KEY"] ?? "";
  if (xaiKey === "") {
    console.error("Set XAI_API_KEY first.");
    return 2;
  }
  const token = process.env["DEMO_MCP_TOKEN"] ?? "";
  if (token === "") {
    console.error("Set DEMO_MCP_TOKEN to the deployment's token first.");
    return 2;
  }

  process.stdout.write(`Checking ${url.origin}${url.pathname} through xAI's MCP client\n`);
  const server: McpServer = { url: url.href, headers: { Authorization: `Bearer ${token}` } };
  const wrongToken = { Authorization: `Bearer ${randomBytes(32).toString("hex")}` };

  const [listing, applications, withoutToken, withWrongToken] = await Promise.all([
    listTools(xaiKey, server),
    callTool(xaiKey, server, "list_applications", {}),
    listTools(xaiKey, { url: url.href, headers: {} }),
    listTools(xaiKey, { url: url.href, headers: wrongToken }),
  ]);

  const unlisted = TOOLS.filter((tool) => !listing.names.has(tool));
  const files =
    applications.status === "answered"
      ? applicationList.safeParse(applications.content).data?.applications
      : undefined;
  const file = files?.[0];
  const fileChecks: readonly Check[] =
    file === undefined
      ? [
          {
            mark: "SKIP",
            name: "the tools that read one file",
            detail:
              files === undefined ? "no list to pick a file from" : "no file at Credit Assessment",
          },
        ]
      : await checkFile(xaiKey, server, file.applicationId);

  const checks: readonly Check[] = [
    check({
      name: `all ${TOOLS.length} tools listed`,
      ok: listing.connection === "connected" && unlisted.length === 0,
      detail:
        listing.connection === "connected"
          ? `missing ${unlisted.join(", ")}`
          : CONNECTION_DETAIL[listing.connection],
    }),
    answers(
      "list_applications answers",
      applications,
      (content) => applicationList.safeParse(content).success,
    ),
    ...fileChecks,
    refusedAuth('without a token, xAI reports "Authentication failed"', withoutToken.connection),
    refusedAuth(
      'with a wrong token, xAI reports "Authentication failed"',
      withWrongToken.connection,
    ),
  ];
  for (const { mark, name, detail } of checks) {
    process.stdout.write(`${mark}  ${name}${detail === undefined ? "" : `  (${detail})`}\n`);
  }
  const failed = checks.filter((c) => c.mark === "FAIL").length;
  process.stdout.write(failed > 0 ? `${failed} check(s) failed\n` : "all checks passed\n");
  return failed > 0 ? 1 : 0;
}

async function run(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
