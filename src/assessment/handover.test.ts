import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/domain/application";
import { currentStage } from "@/domain/application";
import { creditAssessmentEvents } from "./credit-assessment-bot";
import type { Handover } from "./handover";
import { handOver } from "./handover";
import { answered, assessed, landed, withEvents } from "./journey.fixture";

function recordOf(handover: Handover): readonly AuditEvent[] {
  if (!handover.ok || handover.status !== "handed-over") {
    throw new Error(`Expected a handover, got ${JSON.stringify(handover)}`);
  }
  return handover.events;
}

const summaries = (events: readonly AuditEvent[]) =>
  events.flatMap((event) => (event.kind === "bot-output" ? [event.summary] : []));

const INSTRUCTION =
  "On Priya Raman's instruction, the Grok Bot recorded its checks and handed Mia and Dan's file to Credit Decision. Figures are indicative, not lender policy.";

describe("handOver", () => {
  it("asks first, and the preview carries no record", () => {
    const preview = handOver(landed, { confirm: false });
    expect(preview).toStrictEqual({
      ok: true,
      status: "needs-confirmation",
      findings: summaries(recordOf(handOver(landed, { confirm: true }))),
      message:
        "Nothing is handed over until Priya Raman confirms. Then I'll record these findings and hand Mia and Dan's file to Credit Decision.",
    });
  });

  it("records the instruction line first, then the bot's findings, then the move to Credit Decision", () => {
    const record = recordOf(handOver(landed, { confirm: true }));
    expect(record.map((event) => event.id)).toStrictEqual([
      "app-mia-dan-credit-assessment-visit-1-mcp-handover",
      "app-mia-dan-credit-assessment-visit-1-01",
      "app-mia-dan-credit-assessment-visit-1-02",
      "app-mia-dan-credit-assessment-visit-1-03",
      "app-mia-dan-credit-assessment-visit-1-04",
    ]);
    expect(summaries(record)).toStrictEqual([
      INSTRUCTION,
      ...summaries(creditAssessmentEvents(landed)),
    ]);
    expect(record.at(-1)).toMatchObject({ kind: "stage-entered", stage: "credit-decision" });
    expect(currentStage(withEvents(landed, record))).toBe("credit-decision");
  });

  it("stamps the record in order, on the story clock after the file's last event", () => {
    const times = [landed.audit, recordOf(handOver(landed, { confirm: true }))]
      .flat()
      .map((event) => Date.parse(event.at));
    expect(times.toSorted((a, b) => a - b)).toStrictEqual(times);
  });

  it("changes nothing on the file it was given", () => {
    const before = structuredClone(landed);
    handOver(landed, { confirm: true });
    expect(landed).toStrictEqual(before);
  });

  it.each([false, true])("refuses once the file is at Credit decision (confirm %s)", (confirm) => {
    expect(handOver(assessed, { confirm })).toStrictEqual({
      ok: false,
      reason: "wrong-stage",
      message: "The file is at Credit decision now, so I can read it but can't change it.",
    });
  });

  it("hands over the re-check on the second visit under that visit's ids", () => {
    const record = recordOf(handOver(answered, { confirm: true }));
    expect(record.at(0)?.id).toBe("app-mia-dan-credit-assessment-visit-2-mcp-handover");
    expect(summaries(record).at(-1)).toMatch(/^Recommendation: approve\./u);
    expect(currentStage(withEvents(answered, record))).toBe("credit-decision");
  });
});
