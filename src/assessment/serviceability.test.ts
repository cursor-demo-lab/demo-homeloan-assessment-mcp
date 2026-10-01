import { describe, expect, it } from "vitest";
import type { Application } from "@/domain/application";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { VARIED_ANSWERS } from "@/intake/answers.fixture";
import { applyIntake } from "@/intake/apply";
import type { IntakeInput } from "@/intake/fields";
import { intakeFields } from "@/intake/fields";
import { answered, landed } from "./journey.fixture";
import { indicativeBorrowing, indicativeServiceability } from "./serviceability";

const withAnswers = (application: Application, fields: IntakeInput) =>
  applyIntake(application, intakeFields.parse(fields));

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

  it("says the figures were worked out from the call when its answers changed them", () => {
    expect(indicativeServiceability(landed, { figuresChanged: true }).basis).toBe(
      "Worked out from the call's answers, with the demo script's values for anything the call didn't capture.",
    );
  });

  it("says the borrowing covers what they need on visit 1 when it does", () => {
    const covered = withAnswers(landed, VARIED_ANSWERS);
    expect(indicativeServiceability(covered)).toMatchObject({
      amountNeeded: 900_000,
      beforeAfterpay: 970_000,
      withAfterpay: 920_000,
      fallsShort: false,
      summary:
        "Indicative borrowing is about A$970,000 before the Afterpay commitment and about A$920,000 with it, which covers what Sofia and Tom need (about A$900,000). Indicative, not lender policy.",
    });
  });

  it("says the borrowing still falls short on visit 2 when it does, quoting no borrowing figure", () => {
    const short = withAnswers(answered, { applicant_2_income: "A$60,000 a year" });
    const recheck = indicativeServiceability(short);
    expect(recheck).toMatchObject({
      beforeAfterpay: null,
      withAfterpay: null,
      fallsShort: true,
      summary:
        "Even without the Afterpay commitment, the indicative borrowing falls short of what Mia and Dan need (about A$790,000). Indicative, not lender policy.",
    });
    expect(JSON.stringify(recheck)).not.toMatch(/660|610/u);
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

const borrowing = (fields: IntakeInput) => indicativeBorrowing(withAnswers(landed, fields));

describe("indicativeBorrowing", () => {
  it("is 4 × yearly income less 125 × monthly repayments, then A$50,000 less with the Afterpay", () => {
    expect(indicativeBorrowing(landed)).toStrictEqual({
      beforeAfterpay: 810_000,
      withAfterpay: 760_000,
      amountNeeded: 790_000,
    });
    expect(borrowing(VARIED_ANSWERS)).toStrictEqual({
      beforeAfterpay: 970_000,
      withAfterpay: 920_000,
      amountNeeded: 900_000,
    });
  });

  it.each([
    ["A$1,249 a month", "A$1,249", 810_000 - 125 * 1009],
    ["A$1,280 a month", "A$1,280", 810_000 - 125 * 1040],
  ])("rounds to the nearest ten thousand dollars (%s)", (_label, repayment, raw) => {
    const { beforeAfterpay } = borrowing({
      declared_debts: `Credit card, A$8,000 limit, ${repayment} a month`,
    });
    expect(beforeAfterpay).toBe(Math.round(raw / 10_000) * 10_000);
    expect(beforeAfterpay % 10_000).toBe(0);
  });

  it("rounds a half up", () => {
    expect(borrowing({ applicant_2_income: "A$99,250 a year" }).beforeAfterpay).toBe(820_000);
  });

  it("never goes below 0", () => {
    expect(
      borrowing({
        applicant_1_income: "A$0 a year",
        applicant_2_income: "A$0 a year",
        declared_debts: "Credit card, A$8,000 limit, A$240 a month",
      }),
    ).toMatchObject({ beforeAfterpay: 0, withAfterpay: 0 });
    expect(
      borrowing({
        applicant_1_income: "A$10,000 a year",
        applicant_2_income: "A$0 a year",
        declared_debts: "None",
      }),
    ).toMatchObject({ beforeAfterpay: 40_000, withAfterpay: 0 });
  });

  it("needs the price less the deposit", () => {
    expect(borrowing({ purchase_price: "A$600,000", deposit: "A$600,000" }).amountNeeded).toBe(0);
    expect(borrowing({ deposit: "A$50,000" }).amountNeeded).toBe(900_000);
  });
});
