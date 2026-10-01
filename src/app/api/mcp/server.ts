import type { CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { checkDocuments } from "@/assessment/checks";
import { documentsOnFile } from "@/assessment/documents";
import { draftAssessorNotes, draftCustomerRequest, HOW_IT_IS_SENT } from "@/assessment/drafts";
import { handOver } from "@/assessment/handover";
import {
  BASIS,
  CALL_BASIS,
  INDICATIVE,
  indicativeServiceability,
} from "@/assessment/serviceability";
import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { currentStage } from "@/domain/application";
import { STAGES } from "@/domain/stages";
import { visitsTo } from "@/domain/visits";
import { applyIntake, capturedOf, changesTheFigures } from "@/intake/apply";
import type { IntakeFields, IntakeKey } from "@/intake/fields";
import { INTAKE_FILE, INTAKE_KEYS } from "@/intake/fields";
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

const NAMES = ["applicant_1_name", "applicant_2_name"] as const satisfies readonly IntakeKey[];
const FIGURE_INPUTS = [
  "applicant_1_income",
  "applicant_2_income",
  "purchase_price",
  "deposit",
  "declared_debts",
] as const satisfies readonly IntakeKey[];
const FIGURES = [...NAMES, ...FIGURE_INPUTS];
const CHECKED = [
  ...NAMES,
  "applicant_1_income",
  "applicant_2_income",
  "deposit",
  "declared_debts",
] as const;

const fromCall = z
  .array(z.enum(INTAKE_KEYS))
  .optional()
  .describe(
    "The intake answers this reply used that came from the latest call. Everything else is the demo script's.",
  );

interface OnFile {
  readonly application: Application;
  /** The keys among `keys` that came from the latest call. */
  readonly used: (keys: readonly IntakeKey[]) => IntakeKey[];
  /** Whether the call's incomes, debts, price or deposit differ from the script's. */
  readonly figuresChanged: boolean;
}

/** The call's answers apply only to the file the app's call writes to. */
function onCall(file: Application, fields: IntakeFields): OnFile {
  const answers = file.reference === INTAKE_FILE ? fields : {};
  return {
    application: applyIntake(file, answers),
    used: (keys) => capturedOf(answers, keys),
    figuresChanged: changesTheFigures(file, answers),
  };
}

/** Adds `fromCall` last, and only when an answer came from the call. */
const marked = (output: object, used: readonly IntakeKey[]) =>
  used.length > 0 ? { ...output, fromCall: used } : output;

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

/**
 * A fresh server over a fixed set of files. Each call reads the latest call's answers, and
 * nothing a tool does changes the files or the answers.
 */
export function buildServer(
  files: readonly Application[],
  answers: () => Promise<IntakeFields>,
): McpServer {
  const server = new McpServer(
    { name: "demo-homeloan-assessment-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  const withFile =
    <A extends { readonly applicationId: string }>(
      use: (file: OnFile, args: A) => CallToolResult,
    ) =>
    async (args: A): Promise<CallToolResult> => {
      const file = files.find(({ id }) => id === args.applicationId);
      return file ? use(onCall(file, await answers()), args) : refuse(NOT_FOUND);
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
            fromCall,
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    async () => {
      const fields = await answers();
      return answer({
        applications: files
          .filter((file) => currentStage(file) === "credit-assessment")
          .map((file) => {
            const { application, used } = onCall(file, fields);
            return marked(
              {
                applicationId: application.id,
                reference: application.reference,
                applicants: viewFor("credit-assessment", application).identity.map(
                  ({ firstName, lastName }) => `${firstName} ${lastName}`,
                ),
                visit: visitsTo(application, "credit-assessment"),
                itemsToCheck: toCheckAtStage2(application).length,
              },
              used(NAMES),
            );
          }),
      });
    },
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
        fromCall,
      }),
      annotations: READ_ONLY,
    },
    withFile(({ application, used }) => {
      const stage = currentStage(application);
      const output = {
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
      };
      return answer(marked(output, used(INTAKE_KEYS)));
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
        fromCall,
      }),
      annotations: READ_ONLY,
    },
    withFile(({ application, used }) => answer(marked(checkDocuments(application), used(CHECKED)))),
  );

  server.registerTool(
    "indicative_serviceability",
    {
      title: "Indicative serviceability",
      description: `Indicative borrowing figures for the file, worked out from the call's answers, with the demo script's values for anything the call didn't capture. ${FIGURES_AS_RETURNED} Records nothing.`,
      inputSchema: onFile,
      outputSchema: z.object({
        label: z.literal(INDICATIVE),
        basis: z.enum([BASIS, CALL_BASIS]),
        amountNeeded: z.number(),
        beforeAfterpay: z.number().nullable(),
        withAfterpay: z.number().nullable(),
        fallsShort: z.boolean(),
        summary: z.string(),
        fromCall,
      }),
      annotations: READ_ONLY,
    },
    withFile(({ application, used, figuresChanged }) =>
      answer(marked(indicativeServiceability(application, { figuresChanged }), used(FIGURES))),
    ),
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
        fromCall,
      }),
      annotations: READ_ONLY,
    },
    withFile(({ application, used }) =>
      answer(marked(draftAssessorNotes(application), used(FIGURES))),
    ),
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
        fromCall,
      }),
      annotations: READ_ONLY,
    },
    withFile(({ application, used }) => {
      const request = draftCustomerRequest(application);
      return request.ok
        ? answer(marked(request.draft, used(["applicant_1_name"])))
        : refuse(request.message);
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
      description: `Gets the file ready to hand over from Credit Assessment to Credit Decision. It doesn't move the file: Priya Raman hands it over in the app, and she decides. This demo server keeps no records: the reply is the handover record, and nothing is written anywhere else. Without confirm it returns what it will record. ${CONFIRM_FIRST} It records no decision.`,
      inputSchema: handoverInput,
      outputSchema: z.object({
        applicationId: z.string(),
        reference: z.string(),
        status: z.enum(["needs-confirmation", "ready-to-hand-over"]),
        findings: z.array(z.string()),
        stage: stageId,
        message: z.string(),
        fromCall,
      }),
      annotations: { idempotentHint: true },
    },
    withFile(({ application, used }, { confirm }: z.output<typeof handoverInput>) => {
      const handover = handOver(application, { confirm: confirm === true });
      if (!handover.ok) {
        return refuse(handover.message);
      }
      const output = {
        applicationId: application.id,
        reference: application.reference,
        status: handover.status,
        findings: handover.findings,
        stage: currentStage(application),
        message: handover.message,
      };
      return answer(marked(output, used(FIGURES)));
    }),
  );

  return server;
}

/**
 * The endpoint over `files`: every request needs the token, then one stateless MCP exchange.
 * With no `answers`, every file keeps the script's values.
 */
export function mcpEndpoint(
  files: readonly Application[],
  answers: () => Promise<IntakeFields> = () => Promise.resolve({}),
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(() => buildServer(files, answers), { responseMode: "json" });
  return async (request) => tokenRefusal(request) ?? (await handler.fetch(request));
}
