import { viewFor } from "@/domain/access";
import type { Application, AuditEvent } from "@/domain/application";
import { currentStage, decisionReason, eventId } from "@/domain/application";
import { STAFF } from "@/domain/people";
import { storyTimeAfter, storyWorkingTimeAfter } from "@/domain/story-clock";
import { visitsTo } from "@/domain/visits";
import { creditAssessmentEvents } from "./credit-assessment-bot";

export const withEvents = (
  application: Application,
  events: readonly AuditEvent[],
): Application => ({
  ...application,
  audit: [...application.audit, ...events],
});

/** Priya's 'Ask for more info' on the file's first visit to Credit Decision, as the app records it. */
export function sendBack(application: Application): Application {
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

/** The customer's answer to the 'more information needed' text, in the app's words. */
export function customerReply(application: Application): string {
  const [customer, ...others] = viewFor("voice-intake", application).identity.map(
    (applicant) => applicant.firstName,
  );
  const together = others.length > 0 ? `She and ${others.join(" and ")} have` : "She has";
  return `${customer} replied to the 'more information needed' text. ${together} closed the Afterpay account, and she sent the closure letter.`;
}

/**
 * The demo's scripted reply, as the app's "Mia closes the Afterpay account" records it: the
 * Afterpay account closed, and the file back at Credit Assessment.
 */
export function closeAfterpay(application: Application): Application {
  const id = `${application.id}-voice-intake-visit-${visitsTo(application, "voice-intake")}`;
  const base = { applicationId: application.id };
  return withEvents(application, [
    {
      ...base,
      id: eventId(`${id}-01`),
      at: storyTimeAfter(application, 60),
      kind: "bot-output",
      stage: "voice-intake",
      summary: customerReply(application),
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

/** Whether the file is as the call lands it: on its first visit to Credit Assessment. */
export function asTheCallLandsIt(application: Application): boolean {
  return (
    currentStage(application) === "credit-assessment" &&
    visitsTo(application, "credit-assessment") === 1
  );
}

/**
 * The file as the call lands it, taken through the demo's loop the way the app records it: the
 * handover, Priya's 'Ask for more info', then the customer's reply, which brings it back to
 * Credit Assessment for its second visit.
 */
export function afterTheReply(application: Application): Application {
  return closeAfterpay(sendBack(withEvents(application, creditAssessmentEvents(application))));
}
