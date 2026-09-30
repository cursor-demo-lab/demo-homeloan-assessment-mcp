import { viewFor } from "@/domain/access";
import type { Application, AuditEvent } from "@/domain/application";
import { currentStage, eventId } from "@/domain/application";
import { STAFF } from "@/domain/people";
import { STAGE_BY_ID } from "@/domain/stages";
import { storyTimeAfter } from "@/domain/story-clock";
import { visitsTo } from "@/domain/visits";
import { creditAssessmentEvents } from "./credit-assessment-bot";
import { INDICATIVE } from "./serviceability";

export type Handover =
  | {
      readonly ok: true;
      readonly status: "needs-confirmation";
      readonly findings: readonly string[];
      readonly message: string;
    }
  | {
      readonly ok: true;
      readonly status: "ready-to-hand-over";
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
    summary: `On ${ASSESSOR}'s instruction, the Grok Bot prepared its checks for the handover of ${names}'s file to Credit Decision. ${ASSESSOR} hands it over in the app and decides. ${INDICATIVE}.`,
  };
  const events = [
    instruction,
    ...creditAssessmentEvents({ ...application, audit: [...application.audit, instruction] }),
  ] as const;
  const findings = events.flatMap((event) => (event.kind === "bot-output" ? [event.summary] : []));

  return confirm
    ? {
        ok: true,
        status: "ready-to-hand-over",
        findings,
        events,
        message: `${names}'s file is ready to hand over to Credit Decision with these findings. It stays at Credit Assessment until ${ASSESSOR} hands it over in the app. Nothing is stored here.`,
      }
    : {
        ok: true,
        status: "needs-confirmation",
        findings,
        message: `Not ready to hand over until ${ASSESSOR} confirms. These are the findings the handover of ${names}'s file to Credit Decision will carry.`,
      };
}
