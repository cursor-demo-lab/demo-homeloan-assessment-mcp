import type { CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { checkDocuments } from "@/assessment/checks";
import { documentsOnFile } from "@/assessment/documents";
import { draftAssessorNotes, draftCustomerRequest, HOW_IT_IS_SENT } from "@/assessment/drafts";
import { handOver } from "@/assessment/handover";
import { BASIS, INDICATIVE, indicativeServiceability } from "@/assessment/serviceability";
import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { currentStage } from "@/domain/application";
import { STAGES } from "@/domain/stages";
import { visitsTo } from "@/domain/visits";
import { tokenRefusal } from "./auth";

const NO_APPROVAL = "Never say or imply that a loan is or will be approved.";
const FIGURES_AS_RETURNED = `Quote figures only as a tool returns them, and put "${INDICATIVE}" in the same reply as any figure. Keep that label exactly as the tools return it, word for word.`;
const CONFIRM_FIRST =
  "Handing over always takes two messages from Priya. When she first asks you to hand a file over, call hand_over_to_assessor without confirm, show her what it will record, and ask her to confirm; do not set confirm yet, even though she asked. Set confirm to true only when her next message confirms.";

export const INSTRUCTIONS = [
  "Rules for the assessment tools: You prepare; Priya Raman, the credit assessor, decides.",
  NO_APPROVAL,
  FIGURES_AS_RETURNED,
  CONFIRM_FIRST,
  "Call tools one after another, and call every tool her message needs before you reply. Keep replies short, because they are read on a big screen. All names, figures and documents are fictional.",
].join(" ");

const applicationId = z.string().min(1).describe('The file id, for example "app-mia-dan"');
const onFile = z.object({ applicationId });
const stageId = z.enum(STAGES.map((stage) => stage.id));
const captured = <T extends z.ZodType>(value: T) =>
  z.object({
    status: z.enum(["stated", "verified"]),
    value,
    source: z.enum(["voice-call", "document-upload", "bot-check"]),
    verifiedAt: z.string().optional(),
  });
const document = z.object({
  id: z.string(),
  title: z.string(),
  shows: z.string(),
  verifies: z.array(z.string()),
});

const stage2View = z.object({
  id: z.string(),
  identity: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["primary", "co-applicant"]),
      firstName: z.string(),
      lastName: z.string(),
      identity: z.object({
        status: z.enum(["pending", "verified"]),
        method: z.string().optional(),
        at: z.string().optional(),
      }),
    }),
  ),
  household: z.object({ relationship: z.literal("partners"), dependants: z.number().int() }),
  income: z.array(
    z.object({
      id: z.string(),
      employment: captured(
        z.object({
          basis: z.string(),
          occupation: z.string(),
          employer: z.string(),
          yearsInRole: z.number(),
        }),
      ),
      annualIncome: captured(z.number()),
    }),
  ),
  commitments: captured(
    z.array(
      z.object({
        kind: z.string(),
        description: z.string(),
        limitOrBalance: z.number(),
        monthlyRepayment: z.number(),
      }),
    ),
  ),
  "property-goal": z.object({
    purpose: z.literal("owner-occupier"),
    firstHomeBuyers: z.boolean(),
    targetArea: z.string(),
    purchasePrice: captured(z.number()),
    deposit: captured(z.number()),
    loanAmountSought: z.number(),
  }),
  consent: z.array(
    z.object({
      id: z.string(),
      consent: z.object({
        status: z.enum(["pending", "given"]),
        scope: z.string().optional(),
        channel: z.string().optional(),
        at: z.string().optional(),
      }),
    }),
  ),
});

const READ_ONLY = { readOnlyHint: true } as const;
const NOT_FOUND = "There's no application with that id.";

function answer(output: object): CallToolResult {
  return {
    structuredContent: { ...output },
    content: [{ type: "text", text: JSON.stringify(output) }],
  };
}

function refuse(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const toCheckAtStage2 = (application: Application) =>
  application.toCheck.filter((item) => item.checkedAt === "credit-assessment");

/** A fresh server over a fixed set of files. Nothing a tool does changes them. */
export function buildServer(files: readonly Application[]): McpServer {
  const server = new McpServer(
    { name: "demo-homeloan-assessment-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  const withFile =
    <A extends { readonly applicationId: string }>(
      use: (application: Application, args: A) => CallToolResult,
    ) =>
    (args: A): CallToolResult => {
      const application = files.find((file) => file.id === args.applicationId);
      return application ? use(application, args) : refuse(NOT_FOUND);
    };

  server.registerTool(
    "list_applications",
    {
      title: "Files at Credit Assessment",
      description:
        "Lists the files now at Credit Assessment, with the visit and how many items each has to check. Records nothing.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        applications: z.array(
          z.object({
            applicationId: z.string(),
            reference: z.string(),
            applicants: z.array(z.string()),
            visit: z.number().int().min(1),
            itemsToCheck: z.number().int(),
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    () =>
      answer({
        applications: files
          .filter((application) => currentStage(application) === "credit-assessment")
          .map((application) => ({
            applicationId: application.id,
            reference: application.reference,
            applicants: viewFor("credit-assessment", application).identity.map(
              ({ firstName, lastName }) => `${firstName} ${lastName}`,
            ),
            visit: visitsTo(application, "credit-assessment"),
            itemsToCheck: toCheckAtStage2(application).length,
          })),
      }),
  );

  server.registerTool(
    "get_application",
    {
      title: "Read a file",
      description:
        "Reads one file as Credit Assessment sees it: the applicants, income, commitments, property goal and consent, what's to check, and the documents on file. It works at any stage, so it also says where a file has gone. It never shows contact details or the appointment. Records nothing.",
      inputSchema: onFile,
      outputSchema: z.object({
        applicationId: z.string(),
        reference: z.string(),
        stage: stageId,
        visit: z.number().int(),
        canWrite: z.boolean(),
        view: stage2View,
        toCheck: z.array(z.object({ id: z.string(), label: z.string(), reason: z.string() })),
        documents: z.array(document),
      }),
      annotations: READ_ONLY,
    },
    withFile((application) => {
      const stage = currentStage(application);
      return answer({
        applicationId: application.id,
        reference: application.reference,
        stage,
        visit: visitsTo(application, "credit-assessment"),
        canWrite: stage === "credit-assessment",
        view: viewFor("credit-assessment", application),
        toCheck: toCheckAtStage2(application).map(({ id, label, reason }) => ({
          id,
          label,
          reason,
        })),
        documents: documentsOnFile(application),
      });
    }),
  );

  server.registerTool(
    "check_documents",
    {
      title: "Check the documents",
      description:
        "Cross-checks what the call stated against the documents on file, item by item, and lists the open gaps. Records nothing.",
      inputSchema: onFile,
      outputSchema: z.object({
        visit: z.number().int(),
        checks: z.array(
          z.object({
            checkId: z.string(),
            label: z.string(),
            stated: z.string().nullable(),
            onDocuments: z.string(),
            evidence: z.array(z.string()),
            result: z.enum(["matches", "shown-on-documents", "not-on-call", "closed"]),
          }),
        ),
        gaps: z.array(z.string()),
      }),
      annotations: READ_ONLY,
    },
    withFile((application) => answer(checkDocuments(application))),
  );

  server.registerTool(
    "indicative_serviceability",
    {
      title: "Indicative serviceability",
      description: `The demo script's borrowing figures for the file. Nothing is calculated. ${FIGURES_AS_RETURNED} Records nothing.`,
      inputSchema: onFile,
      outputSchema: z.object({
        label: z.literal(INDICATIVE),
        basis: z.literal(BASIS),
        amountNeeded: z.number(),
        beforeAfterpay: z.number().nullable(),
        withAfterpay: z.number().nullable(),
        fallsShort: z.boolean(),
        summary: z.string(),
      }),
      annotations: READ_ONLY,
    },
    withFile((application) => answer(indicativeServiceability(application))),
  );

  server.registerTool(
    "draft_assessor_notes",
    {
      title: "Draft the assessor's notes",
      description: `Drafts Priya's notes: the findings hand_over_to_assessor will record, word for word, and the bot's recommendation. Priya decides. ${NO_APPROVAL} ${FIGURES_AS_RETURNED} Records nothing.`,
      inputSchema: onFile,
      outputSchema: z.object({
        label: z.literal(INDICATIVE),
        findings: z.array(z.string()),
        recommendation: z.string(),
        recorded: z.literal(false),
      }),
      annotations: READ_ONLY,
    },
    withFile((application) => answer(draftAssessorNotes(application))),
  );

  server.registerTool(
    "draft_customer_request",
    {
      title: "Draft a text to the customer",
      description:
        "Drafts a text to the customer asking about the gap the documents show. It is never sent from here. It refuses when nothing is missing. Records nothing.",
      inputSchema: onFile,
      outputSchema: z.object({
        to: z.string(),
        text: z.string(),
        sent: z.literal(false),
        howItIsSent: z.literal(HOW_IT_IS_SENT),
      }),
      annotations: READ_ONLY,
    },
    withFile((application) => {
      const request = draftCustomerRequest(application);
      return request.ok ? answer(request.draft) : refuse(request.message);
    }),
  );

  const handoverInput = z.object({
    applicationId,
    confirm: z
      .boolean()
      .optional()
      .describe("true only when Priya confirms, in her message after the preview"),
  });
  server.registerTool(
    "hand_over_to_assessor",
    {
      title: "Hand over to Credit Decision",
      description: `Hands the file from Credit Assessment to Credit Decision, where Priya Raman decides. This demo server keeps no records: the reply is the handover record, and nothing is written anywhere else. Without confirm it returns what it will record. ${CONFIRM_FIRST} It records no decision.`,
      inputSchema: handoverInput,
      outputSchema: z.object({
        status: z.enum(["needs-confirmation", "handed-over"]),
        findings: z.array(z.string()),
        stage: stageId,
        message: z.string(),
      }),
      annotations: { idempotentHint: true },
    },
    withFile((application, { confirm }: z.output<typeof handoverInput>) => {
      const handover = handOver(application, { confirm: confirm === true });
      if (!handover.ok) {
        return refuse(handover.message);
      }
      return answer({
        status: handover.status,
        findings: handover.findings,
        stage:
          handover.status === "handed-over"
            ? currentStage({ audit: [...application.audit, ...handover.events] })
            : currentStage(application),
        message: handover.message,
      });
    }),
  );

  return server;
}

/** The endpoint over `files`: every request needs the token, then one stateless MCP exchange. */
export function mcpEndpoint(
  files: readonly Application[],
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(() => buildServer(files), { responseMode: "json" });
  return async (request) => tokenRefusal(request) ?? (await handler.fetch(request));
}
