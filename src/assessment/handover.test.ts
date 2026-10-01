import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/domain/application";
import { currentStage } from "@/domain/application";
import { creditAssessmentEvents } from "./credit-assessment-bot";
import type { Handover } from "./handover";
import { handOver } from "./handover";
import { answered, assessed, landed } from "./journey.fixture";
import { withEvents } from "./reply";

function recordOf(handover: Handover): readonly AuditEvent[] {
  if (!handover.ok || handover.status !== "ready-to-hand-over") {
    throw new Error(`Expected a handover, got ${JSON.stringify(handover)}`);
  }
  return handover.events;
}

const summaries = (events: readonly AuditEvent[]) =>
  events.flatMap((event) => (event.kind === "bot-output" ? [event.summary] : []));

const timesOf = (events: readonly AuditEvent[]) => events.map((event) => event.at);

const INSTRUCTION =
  "On Priya Raman's instruction, the Grok Bot prepared its checks for the handover of Mia and Dan's file to Credit Decision. Priya Raman hands it over in the app and decides. Indicative, not lender policy.";

describe("handOver", () => {
  it("asks first, and the preview carries no record", () => {
    const preview = handOver(landed, { confirm: false });
    expect(preview).toStrictEqual({
      ok: true,
      status: "needs-confirmation",
      findings: summaries(recordOf(handOver(landed, { confirm: true }))),
      message:
        "Not ready to hand over until Priya Raman confirms. These are the findings the handover of Mia and Dan's file to Credit Decision will carry.",
    });
  });

  it("says on confirm that the file is ready to hand over, and stays put until Priya hands it over in the app", () => {
    expect(handOver(landed, { confirm: true })).toMatchObject({
      status: "ready-to-hand-over",
      message:
        "Mia and Dan's file is ready to hand over to Credit Decision with these findings. It stays at Credit Assessment until Priya Raman hands it over in the app. Nothing is stored here.",
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

  it("stamps the findings and the move at the app's times, after the instruction line", () => {
    const record = recordOf(handOver(landed, { confirm: true }));
    expect(timesOf(record)).toStrictEqual([
      "2026-10-12T19:48:00+11:00",
      "2026-10-12T19:49:00+11:00",
      "2026-10-12T19:51:00+11:00",
      "2026-10-12T19:53:00+11:00",
      "2026-10-12T19:53:00+11:00",
    ]);
    expect(record.slice(1)).toStrictEqual(creditAssessmentEvents(landed));
  });

  it("stamps the second visit at the app's times, after Priya's decision the next working morning", () => {
    expect(timesOf(answered.audit.slice(assessed.audit.length))).toStrictEqual([
      "2026-10-13T09:02:00+11:00",
      "2026-10-13T09:03:00+11:00",
      "2026-10-13T09:04:00+11:00",
      "2026-10-13T10:04:00+11:00",
      "2026-10-13T10:05:00+11:00",
    ]);
    expect(timesOf(recordOf(handOver(answered, { confirm: true })))).toStrictEqual([
      "2026-10-13T10:06:00+11:00",
      "2026-10-13T10:07:00+11:00",
      "2026-10-13T10:09:00+11:00",
      "2026-10-13T10:11:00+11:00",
      "2026-10-13T10:11:00+11:00",
    ]);
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
