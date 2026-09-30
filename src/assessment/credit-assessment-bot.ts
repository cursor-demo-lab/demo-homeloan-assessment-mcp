import { viewFor } from "@/domain/access";
import type { Application, AuditEvent } from "@/domain/application";
import { eventId } from "@/domain/application";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { formatAud } from "@/domain/money";
import { storyTimeAfter } from "@/domain/story-clock";
import { visitsTo } from "@/domain/visits";

/** The bot's last finding on each visit starts with this. */
export const RECOMMENDATION_PREFIX = "Recommendation: ";

const about = (figure: keyof typeof SCRIPT_FIGURES) =>
  formatAud(SCRIPT_FIGURES[figure].amount, { approx: true });

/** The first check finds the Afterpay account. */
function firstCheck(names: string): readonly string[] {
  return [
    `Checked ${names}'s documents against what the call recorded. Found an Afterpay account that wasn't mentioned on the call.`,
    `Indicative borrowing is ${about("borrowingBeforeAfterpay")} before the Afterpay commitment and ${about("borrowingAfterAfterpay")} with it. ${names} need ${about("amountNeeded")}.`,
    `${RECOMMENDATION_PREFIX}ask for more information. The Afterpay commitment wasn't disclosed on the call, and with it the indicative borrowing is below what ${names} need. Ask them to explain the account or close it.`,
  ];
}

/** A later check, once the couple have answered. The script gives no re-checked figure, so it quotes none. */
function recheck(names: string): readonly string[] {
  return [
    `Re-checked ${names}'s documents after the request for more information. The Afterpay account is closed, and nothing else has changed.`,
    `Without the Afterpay commitment, the indicative borrowing no longer falls short of what ${names} need (${about("amountNeeded")}).`,
    `${RECOMMENDATION_PREFIX}approve. The re-check passes: the undisclosed account is closed, and the borrowing covers what ${names} need.`,
  ];
}

/**
 * The Credit Assessment bot, scripted: what it finds in the couple's documents, its
 * recommendation, and the move to Credit Decision. It reads only stage 2's view. Its ids
 * carry the visit number, so a second visit after "more info" gets its own.
 */
export function creditAssessmentEvents(application: Application): readonly AuditEvent[] {
  const view = viewFor("credit-assessment", application);
  const visit = visitsTo(application, "credit-assessment");
  const names = view.identity.map((applicant) => applicant.firstName).join(" and ");
  const summaries = visit > 1 ? recheck(names) : firstCheck(names);
  const idOf = (step: number) =>
    eventId(`${view.id}-credit-assessment-visit-${visit}-${String(step + 1).padStart(2, "0")}`);
  const at = (step: number) => storyTimeAfter(application, 2 * (step + 1));

  return [
    ...summaries.map(
      (summary, step): AuditEvent => ({
        id: idOf(step),
        applicationId: view.id,
        at: at(step),
        kind: "bot-output",
        stage: "credit-assessment",
        summary,
      }),
    ),
    {
      id: idOf(summaries.length),
      applicationId: view.id,
      at: at(summaries.length - 1),
      kind: "stage-entered",
      stage: "credit-decision",
    },
  ];
}
