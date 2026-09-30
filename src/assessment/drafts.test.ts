import { describe, expect, it } from "vitest";
import { DAN, MIA } from "@/domain/fixtures/mia-and-dan";
import { creditAssessmentEvents } from "./credit-assessment-bot";
import { draftAssessorNotes, draftCustomerRequest } from "./drafts";
import { answered, landed } from "./journey.fixture";

describe("draftAssessorNotes", () => {
  it.each([
    ["first", landed],
    ["second", answered],
  ])("says word for word what the handover records on the %s visit", (_visit, application) => {
    const { findings, recommendation, recorded } = draftAssessorNotes(application);
    const button = creditAssessmentEvents(application).flatMap((event) =>
      event.kind === "bot-output" ? [event.summary] : [],
    );
    expect([...findings, recommendation]).toStrictEqual(button);
    expect(recommendation).toMatch(/^Recommendation: /u);
    expect(recorded).toBe(false);
  });

  it.each([
    ["first", landed],
    ["second", answered],
  ])("labels the script's figures on the %s visit", (_visit, application) => {
    const { label, findings } = draftAssessorNotes(application);
    expect(findings.join(" ")).toContain("about A$790,000");
    expect(label).toBe("Indicative, not lender policy");
  });
});

describe("draftCustomerRequest", () => {
  it("drafts a text to Mia about the Afterpay account, and sends nothing", () => {
    expect(draftCustomerRequest(landed)).toStrictEqual({
      ok: true,
      draft: {
        to: "Mia",
        text: "Hi Mia, it's the home loan team about your application HL-26-104471. Your bank statements show an Afterpay account that wasn't mentioned on the call. Could you tell us what it's for, or send us the closure letter if you close it?",
        sent: false,
        howItIsSent:
          "Nothing is sent from here. Priya's 'Ask for more info' decision sends the 'more information needed' text.",
      },
    });
  });

  it("promises nothing and carries no contact details", () => {
    const draft = JSON.stringify(draftCustomerRequest(landed));
    expect(draft).not.toMatch(/approv|guarantee|will lend/iu);
    for (const contact of [MIA.mobile, MIA.email, DAN.mobile, DAN.email]) {
      expect(draft).not.toContain(contact);
    }
  });

  it("refuses on the second visit, when nothing is missing", () => {
    expect(draftCustomerRequest(answered)).toStrictEqual({
      ok: false,
      reason: "no-gaps",
      message: "Nothing is missing on this visit, so there's no request to draft.",
    });
  });
});
