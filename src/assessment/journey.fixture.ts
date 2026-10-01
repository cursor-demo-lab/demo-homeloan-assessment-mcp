import type { Application, AuditEvent } from "@/domain/application";
import { decisionReason, eventId } from "@/domain/application";
import { MIA_AND_DAN_AFTER_CALL } from "@/domain/fixtures/mia-and-dan";
import { STAFF } from "@/domain/people";
import { storyTimeAfter, storyWorkingTimeAfter } from "@/domain/story-clock";
import { creditAssessmentEvents } from "./credit-assessment-bot";

/** Mia and Dan through the demo's loop: more info, the Afterpay account closed, then the re-check. */
export const withEvents = (
  application: Application,
  events: readonly AuditEvent[],
): Application => ({
  ...application,
  audit: [...application.audit, ...events],
});

function sendBack(application: Application): Application {
  const id = `${application.id}-credit-decision-visit-1`;
  const base = { applicationId: application.id };
  const at = (minutes: number) => storyWorkingTimeAfter(application, minutes);
  return withEvents(application, [
    {
      ...base,
      id: eventId(id),
      at: at(2),
      kind: "human-decision",
      stage: "credit-decision",
      outcome: "more-info",
      by: STAFF.assessor.id,
      reason: decisionReason("Explain the Afterpay account."),
    },
    {
      ...base,
      id: eventId(`${id}-moved`),
      at: at(3),
      kind: "stage-entered",
      stage: "voice-intake",
    },
    {
      ...base,
      id: eventId(`${id}-notified`),
      at: at(4),
      kind: "customer-notified",
      channel: "sms",
      template: "more-info-requested",
    },
  ]);
}

function closeAfterpay(application: Application): Application {
  const id = `${application.id}-voice-intake-visit-2`;
  const base = { applicationId: application.id };
  return withEvents(application, [
    {
      ...base,
      id: eventId(`${id}-01`),
      at: storyTimeAfter(application, 60),
      kind: "bot-output",
      stage: "voice-intake",
      summary:
        "Mia replied to the 'more information needed' text. She and Dan have closed the Afterpay account, and she sent the closure letter.",
    },
    {
      ...base,
      id: eventId(`${id}-02`),
      at: storyTimeAfter(application, 61),
      kind: "stage-entered",
      stage: "credit-assessment",
    },
  ]);
}

export const landed = MIA_AND_DAN_AFTER_CALL;
export const assessed = withEvents(landed, creditAssessmentEvents(landed));
export const answered = closeAfterpay(sendBack(assessed));
export const reassessed = withEvents(answered, creditAssessmentEvents(answered));
