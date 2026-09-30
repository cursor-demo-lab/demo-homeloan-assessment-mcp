import { describe, expect, it } from "vitest";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { answered, landed } from "./journey.fixture";
import { indicativeServiceability } from "./serviceability";

describe("indicativeServiceability", () => {
  it("quotes the script's figures on the first visit", () => {
    expect(indicativeServiceability(landed)).toStrictEqual({
      label: "Indicative, not lender policy",
      basis: "The demo script's figures. Nothing is calculated.",
      amountNeeded: SCRIPT_FIGURES.amountNeeded.amount,
      beforeAfterpay: SCRIPT_FIGURES.borrowingBeforeAfterpay.amount,
      withAfterpay: SCRIPT_FIGURES.borrowingAfterAfterpay.amount,
      fallsShort: true,
      summary:
        "Indicative borrowing is about A$810,000 before the Afterpay commitment and about A$760,000 with it, which falls short of what Mia and Dan need (about A$790,000). Indicative, not lender policy.",
    });
  });

  it("invents no borrowing figure for the re-check, which the script doesn't give", () => {
    const recheck = indicativeServiceability(answered);
    expect(recheck).toMatchObject({
      amountNeeded: 790_000,
      beforeAfterpay: null,
      withAfterpay: null,
      fallsShort: false,
      summary:
        "Without the Afterpay commitment, the indicative borrowing no longer falls short of what Mia and Dan need (about A$790,000). Indicative, not lender policy.",
    });
    expect(JSON.stringify(recheck)).not.toMatch(/810|760/u);
  });

  it.each([
    ["first", landed],
    ["second", answered],
  ])("labels the figures on the %s visit", (_visit, application) => {
    const { label, summary } = indicativeServiceability(application);
    expect(label).toBe("Indicative, not lender policy");
    expect(summary).toMatch(/ Indicative, not lender policy\.$/u);
  });
});
