import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { checkDocuments } from "./checks";
import { creditAssessmentEvents, RECOMMENDATION_PREFIX } from "./credit-assessment-bot";
import { INDICATIVE } from "./serviceability";

export interface AssessorNotes {
  readonly label: typeof INDICATIVE;
  readonly findings: readonly string[];
  readonly recommendation: string;
  readonly recorded: false;
}

export function draftAssessorNotes(application: Application): AssessorNotes {
  const summaries = creditAssessmentEvents(application).flatMap((event) =>
    event.kind === "bot-output" ? [event.summary] : [],
  );
  const recommendation = summaries.find((summary) => summary.startsWith(RECOMMENDATION_PREFIX));
  if (recommendation === undefined) {
    throw new Error("The Credit Assessment bot always makes a recommendation.");
  }
  return {
    label: INDICATIVE,
    findings: summaries.filter((summary) => summary !== recommendation),
    recommendation,
    recorded: false,
  };
}

export const HOW_IT_IS_SENT =
  "Nothing is sent from here. Priya's 'Ask for more info' decision sends the 'more information needed' text.";

export interface CustomerRequest {
  readonly to: string;
  readonly text: string;
  readonly sent: false;
  readonly howItIsSent: typeof HOW_IT_IS_SENT;
}

export type CustomerRequestDraft =
  | { readonly ok: true; readonly draft: CustomerRequest }
  | { readonly ok: false; readonly reason: "no-gaps"; readonly message: string };

export function draftCustomerRequest(application: Application): CustomerRequestDraft {
  if (checkDocuments(application).gaps.length === 0) {
    return {
      ok: false,
      reason: "no-gaps",
      message: "Nothing is missing on this visit, so there's no request to draft.",
    };
  }
  const to = viewFor("credit-assessment", application)
    .identity.filter((applicant) => applicant.role === "primary")
    .map((applicant) => applicant.firstName)
    .join(" and ");
  return {
    ok: true,
    draft: {
      to,
      text: `Hi ${to}, it's the home loan team about your application ${application.reference}. Your bank statements show an Afterpay account that wasn't mentioned on the call. Could you tell us what it's for, or send us the closure letter if you close it?`,
      sent: false,
      howItIsSent: HOW_IT_IS_SENT,
    },
  };
}
