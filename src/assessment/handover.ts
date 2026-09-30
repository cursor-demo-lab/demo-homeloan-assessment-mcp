import { viewFor } from "@/domain/access";
import type { Application, AuditEvent } from "@/domain/application";
import { currentStage, eventId } from "@/domain/application";
import { STAFF } from "@/domain/people";
import { STAGE_BY_ID } from "@/domain/stages";
import { storyTimeAfter } from "@/domain/story-clock";
import { visitsTo } from "@/domain/visits";
import { creditAssessmentEvents } from "./credit-assessment-bot";

export type Handover =
  | {
      readonly ok: true;
      readonly status: "needs-confirmation";
      readonly findings: readonly string[];
      readonly message: string;
    }
  | {
      readonly ok: true;
      readonly status: "handed-over";
      readonly findings: readonly string[];
      readonly events: readonly [AuditEvent, ...AuditEvent[]];
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: "wrong-stage"; readonly message: string };

const ASSESSOR = STAFF.assessor.name;

export function handOver(application: Application, { confirm }: { confirm: boolean }): Handover {
  const stage = currentStage(application);
  if (stage !== "credit-assessment") {
    return {
      ok: false,
      reason: "wrong-stage",
      message: `The file is at ${STAGE_BY_ID[stage].name} now, so I can read it but can't change it.`,
    };
  }
  const view = viewFor("credit-assessment", application);
  const visit = visitsTo(application, "credit-assessment");
  const names = view.identity.map((applicant) => applicant.firstName).join(" and ");

  const instruction: AuditEvent = {
    id: eventId(`${view.id}-credit-assessment-visit-${visit}-mcp-handover`),
    applicationId: view.id,
    at: storyTimeAfter(application, 1),
    kind: "bot-output",
    stage: "credit-assessment",
    summary: `On ${ASSESSOR}'s instruction, the Grok Bot recorded its checks and handed ${names}'s file to Credit Decision. Figures are indicative, not lender policy.`,
  };
  const events = [
    instruction,
    ...creditAssessmentEvents({ ...application, audit: [...application.audit, instruction] }),
  ] as const;
  const findings = events.flatMap((event) => (event.kind === "bot-output" ? [event.summary] : []));

  return confirm
    ? {
        ok: true,
        status: "handed-over",
        findings,
        events,
        message: `Recorded the findings and handed ${names}'s file to Credit Decision. ${ASSESSOR} decides from here.`,
      }
    : {
        ok: true,
        status: "needs-confirmation",
        findings,
        message: `Nothing is handed over until ${ASSESSOR} confirms. Then I'll record these findings and hand ${names}'s file to Credit Decision.`,
      };
}
