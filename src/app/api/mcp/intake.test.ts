import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intakeEndpoint } from "@/app/api/intake/endpoint";
import { answered, landed } from "@/assessment/journey.fixture";
import type { Application } from "@/domain/application";
import { intakeOf, SCRIPTED_ANSWERS, VARIED_ANSWERS } from "@/intake/answers.fixture";
import { fakeStore } from "@/intake/fake-upstash.fixture";
import type { IntakeInput } from "@/intake/fields";
import { INTAKE_KEYS } from "@/intake/fields";
import { latestAnswers } from "@/intake/store";
import GOLDEN from "./replies-4611c29.json";
import { mcpEndpoint } from "./server";

const TOKEN = "intake-test-token";
const APPLICATION = { applicationId: "app-mia-dan" };
const NAMES = ["applicant_1_name", "applicant_2_name"];
const FIGURES = [
  "applicant_1_name",
  "applicant_1_income",
  "applicant_2_name",
  "applicant_2_income",
  "purchase_price",
  "deposit",
  "declared_debts",
];

let fake: ReturnType<typeof fakeStore>;

async function post(fields: IntakeInput) {
  const response = await intakeEndpoint(() => fake.store).POST(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(intakeOf(fields)),
    }),
  );
  expect(response.status).toBe(200);
}

async function reset() {
  const response = await intakeEndpoint(() => fake.store).DELETE(
    new Request("http://localhost/api/intake", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ applicationId: "HL-26-104471" }),
    }),
  );
  expect(response.status).toBe(200);
}

async function connect(file: Application) {
  const endpoint = mcpEndpoint([file], () => latestAnswers(fake.store));
  const client = new Client({ name: "intake-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      fetch: (input, init) => endpoint(new Request(input, init)),
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = APPLICATION) => {
    const result = await client.callTool({ name, arguments: args });
    return result.structuredContent as Record<string, unknown>;
  };
  return { client, call };
}

beforeEach(() => {
  vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
  fake = fakeStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("after a call with different answers", () => {
  it("every tool uses them, and says which came from the call", async () => {
    await post(VARIED_ANSWERS);
    const { client, call } = await connect(landed);

    await expect(call("list_applications", {})).resolves.toStrictEqual({
      applications: [
        {
          applicationId: "app-mia-dan",
          reference: "HL-26-104471",
          applicants: ["Sofia Reyes", "Tom Nguyen"],
          visit: 1,
          itemsToCheck: 7,
          fromCall: NAMES,
        },
      ],
    });

    const file = await call("get_application");
    expect(file).toMatchObject({
      fromCall: [...INTAKE_KEYS],
      view: {
        identity: [
          { firstName: "Sofia", lastName: "Reyes" },
          { firstName: "Tom", lastName: "Nguyen" },
        ],
        income: [
          {
            annualIncome: { value: 150_000 },
            employment: { value: { occupation: "Nurse", basis: "part-time" } },
          },
          { annualIncome: { value: 120_000 }, employment: { value: { basis: "self-employed" } } },
        ],
        "property-goal": {
          firstHomeBuyers: false,
          targetArea: "Brunswick, VIC",
          purchasePrice: { value: 1_100_000 },
          deposit: { value: 200_000 },
          loanAmountSought: 900_000,
        },
      },
    });

    const checks = await call("check_documents");
    expect(checks["fromCall"]).toStrictEqual([
      "applicant_1_name",
      "applicant_1_income",
      "applicant_2_name",
      "applicant_2_income",
      "deposit",
      "declared_debts",
    ]);
    expect(checks["checks"]).toContainEqual(
      expect.objectContaining({
        checkId: "debts-and-commitments",
        stated: "Credit card (A$10,000 limit), Car loan (A$30,000 balance)",
        result: "not-on-call",
      }),
    );

    await expect(call("indicative_serviceability")).resolves.toStrictEqual({
      label: "Indicative, not lender policy",
      basis:
        "Worked out from the call's answers, with the demo script's values for anything the call didn't capture.",
      amountNeeded: 900_000,
      beforeAfterpay: 970_000,
      withAfterpay: 920_000,
      fallsShort: false,
      summary:
        "Indicative borrowing is about A$970,000 before the Afterpay commitment and about A$920,000 with it, which covers what Sofia and Tom need (about A$900,000). Indicative, not lender policy.",
      fromCall: FIGURES,
    });

    await expect(call("draft_assessor_notes")).resolves.toMatchObject({
      findings: [
        "Checked Sofia and Tom's documents against what the call recorded. Found an Afterpay account that wasn't mentioned on the call.",
        "Indicative borrowing is about A$970,000 before the Afterpay commitment and about A$920,000 with it. Sofia and Tom need about A$900,000.",
      ],
      recommendation:
        "Recommendation: ask for more information. The Afterpay commitment wasn't disclosed on the call. Ask them to explain the account or close it.",
      fromCall: FIGURES,
    });

    const request = await call("draft_customer_request");
    expect(request).toMatchObject({ to: "Sofia", fromCall: ["applicant_1_name"] });
    expect(request["text"]).toMatch(/^Hi Sofia, /u);

    const handover = await call("hand_over_to_assessor", { ...APPLICATION, confirm: true });
    expect(handover).toMatchObject({ status: "ready-to-hand-over", fromCall: FIGURES });
    expect(handover["message"]).toMatch(/^Sofia and Tom's file is ready/u);

    const everything = JSON.stringify(
      await Promise.all(
        [
          "get_application",
          "check_documents",
          "indicative_serviceability",
          "draft_assessor_notes",
        ].map((tool) => call(tool)),
      ),
    );
    expect(everything).not.toMatch(/\b(?:Mia|Dan|Castellano|Okafor|Coburg|Physiotherap)/u);
    expect(everything).not.toMatch(/810,000|760,000|790,000|950,000|112,000|98,000/u);
    await client.close();
  });

  it("recommends a decline on the re-check when the borrowing still falls short", async () => {
    await post({ applicant_2_income: "A$60,000 a year" });
    const { client, call } = await connect(answered);
    await expect(call("draft_assessor_notes")).resolves.toStrictEqual({
      label: "Indicative, not lender policy",
      findings: [
        "Re-checked Mia and Dan's documents after the request for more information. The Afterpay account is closed, and nothing else has changed.",
        "Even without the Afterpay commitment, the indicative borrowing falls short of what Mia and Dan need (about A$790,000).",
      ],
      recommendation:
        "Recommendation: decline. The undisclosed account is closed, but the indicative borrowing still falls short of what Mia and Dan need.",
      recorded: false,
      fromCall: ["applicant_2_income"],
    });
    await client.close();
  });

  it("re-checks the call's answers after the reply, and says which came from the call", async () => {
    await post(VARIED_ANSWERS);
    const { client, call } = await connect(landed);
    const recheck = await call("recheck_after_reply", { ...APPLICATION, customerReplied: true });
    expect(recheck).toMatchObject({
      visit: 2,
      reply:
        "Sofia replied to the 'more information needed' text. She and Tom have closed the Afterpay account, and she sent the closure letter.",
      gaps: [],
      serviceability: {
        basis:
          "Worked out from the call's answers, with the demo script's values for anything the call didn't capture.",
        amountNeeded: 900_000,
        fallsShort: false,
      },
      findings: [
        "Re-checked Sofia and Tom's documents after the request for more information. The Afterpay account is closed, and nothing else has changed.",
        "Without the Afterpay commitment, the indicative borrowing no longer falls short of what Sofia and Tom need (about A$900,000).",
      ],
      recommendation:
        "Recommendation: approve. The re-check passes: the undisclosed account is closed, and the borrowing covers what Sofia and Tom need.",
      fromCall: FIGURES,
    });
    expect(recheck["message"]).toMatch(/^Sofia and Tom's file is re-checked\./u);
    expect(JSON.stringify(recheck)).not.toMatch(/\b(?:Mia|Dan|Castellano|Okafor)\b|790,000/u);
    await client.close();
  });

  it("recommends a decline on the re-check tool too when the borrowing still falls short", async () => {
    await post({ applicant_2_income: "A$60,000 a year" });
    const { client, call } = await connect(landed);
    await expect(
      call("recheck_after_reply", { ...APPLICATION, customerReplied: true }),
    ).resolves.toMatchObject({
      serviceability: { fallsShort: true },
      recommendation:
        "Recommendation: decline. The undisclosed account is closed, but the indicative borrowing still falls short of what Mia and Dan need.",
      fromCall: ["applicant_2_income"],
    });
    await client.close();
  });

  it("keeps the script's basis when only names came from the call", async () => {
    await post({ applicant_1_name: "Sofia Reyes" });
    const { client, call } = await connect(landed);
    const reply = await call("indicative_serviceability");
    expect(reply).toMatchObject({
      basis: "The demo script's figures. Nothing is calculated.",
      fromCall: ["applicant_1_name"],
    });
    expect(reply["summary"]).toContain("what Sofia and Dan need (about A$790,000)");
    await client.close();
  });

  it("uses the next call's answers without a restart, and the script's after a reset", async () => {
    const { client, call } = await connect(landed);
    const summary = async () => {
      const reply = await call("indicative_serviceability");
      return reply["summary"];
    };
    const scripted = GOLDEN.find(
      ({ state, tool }) => state === "landed" && tool === "indicative_serviceability",
    );

    await post(VARIED_ANSWERS);
    await expect(summary()).resolves.toMatch(/Sofia and Tom/u);
    await post({ applicant_1_name: "Ana Silva" });
    await expect(summary()).resolves.toMatch(/Ana and Dan need \(about A\$790,000\)/u);
    await reset();
    const result = await client.callTool({
      name: "indicative_serviceability",
      arguments: APPLICATION,
    });
    expect(JSON.stringify(result)).toBe(scripted?.reply);
    await client.close();
  });

  it("gives the script's figures and basis, marked as the call's, when the call follows the script", async () => {
    await post(SCRIPTED_ANSWERS);
    const { client, call } = await connect(landed);
    const scripted = GOLDEN.find(
      ({ state, tool }) => state === "landed" && tool === "indicative_serviceability",
    );
    const reply = scripted && (JSON.parse(scripted.reply) as { structuredContent: object });
    await expect(call("indicative_serviceability")).resolves.toStrictEqual({
      ...reply?.structuredContent,
      fromCall: FIGURES,
    });
    await client.close();
  });

  it("says the figures were worked out from the call once one of them differs from the script", async () => {
    await post({ ...SCRIPTED_ANSWERS, deposit: "A$170,000" });
    const { client, call } = await connect(landed);
    await expect(call("indicative_serviceability")).resolves.toMatchObject({
      basis:
        "Worked out from the call's answers, with the demo script's values for anything the call didn't capture.",
      fromCall: FIGURES,
    });
    await client.close();
  });
});
