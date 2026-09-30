import { describe, expect, it } from "vitest";
import type { Application } from "@/domain/application";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { DAN, MIA } from "@/domain/fixtures/mia-and-dan";
import { aud } from "@/domain/money";
import { documentsOnFile } from "./documents";
import { answered, landed } from "./journey.fixture";

function amountsIn(value: unknown): number[] {
  return (JSON.stringify(value).match(/A\$[\d,]+/gu) ?? []).map((text) =>
    Number(text.replaceAll(/\D/gu, "")),
  );
}

function statedAmounts({ applicants, commitments, goal }: Application): Set<number> {
  return new Set([
    ...applicants.map((applicant) => applicant.annualIncome.value),
    ...commitments.value.flatMap((debt) => [debt.limitOrBalance, debt.monthlyRepayment]),
    goal.purchasePrice.value,
    goal.deposit.value,
    goal.loanAmountSought,
    ...Object.values(SCRIPT_FIGURES).map((figure) => figure.amount),
  ]);
}

describe("documentsOnFile", () => {
  it("lists what Mia and Dan uploaded, with the Afterpay account open on the first visit", () => {
    expect(documentsOnFile(landed)).toStrictEqual([
      {
        id: "doc-payslips-mia",
        title: "Mia's payslips, Merri Creek Physiotherapy",
        shows: "Income of about A$112,000 a year, as stated on the call",
        verifies: ["income-mia"],
      },
      {
        id: "doc-payslips-dan",
        title: "Dan's payslips, Coburg Hills College",
        shows: "Income of about A$98,000 a year, as stated on the call",
        verifies: ["income-dan"],
      },
      {
        id: "doc-id-consent-dan",
        title: "Dan's ID and credit-check consent, uploaded",
        shows: "Photo ID and a signed consent to a credit check, uploaded by Dan",
        verifies: ["identity-dan", "consent-dan"],
      },
      {
        id: "doc-bank-statements",
        title: "Three months of joint bank statements",
        shows: "Day-to-day spending, credit card repayments and Afterpay repayments",
        verifies: ["living-expenses", "debts-and-commitments"],
      },
      {
        id: "doc-savings-statement",
        title: "Savings statement",
        shows: "Savings of A$160,000, the deposit stated on the call",
        verifies: ["deposit-savings"],
      },
      {
        id: "doc-credit-report",
        title: "Credit report",
        shows: "Credit card (A$8,000 limit), and an Afterpay account, open",
        verifies: ["debts-and-commitments"],
      },
    ]);
  });

  it("adds the closure letter on the second visit, and the credit report shows the account closed", () => {
    const visit2 = documentsOnFile(answered);
    expect(visit2.map((doc) => doc.id)).toStrictEqual([
      "doc-payslips-mia",
      "doc-payslips-dan",
      "doc-id-consent-dan",
      "doc-bank-statements",
      "doc-savings-statement",
      "doc-credit-report",
      "doc-afterpay-closure",
    ]);
    expect(visit2.slice(-2)).toStrictEqual([
      {
        id: "doc-credit-report",
        title: "Credit report",
        shows: "Credit card (A$8,000 limit), and an Afterpay account, closed",
        verifies: ["debts-and-commitments"],
      },
      {
        id: "doc-afterpay-closure",
        title: "Afterpay closure letter",
        shows: "The Afterpay account is closed",
        verifies: ["debts-and-commitments"],
      },
    ]);
  });

  it.each([
    ["first", landed],
    ["second", answered],
  ])("adds no amount the file doesn't already state on the %s visit", (_visit, application) => {
    const stated = statedAmounts(application);
    const amounts = amountsIn(documentsOnFile(application));
    expect(amounts.length).toBeGreaterThan(0);
    expect(amounts.filter((amount) => !stated.has(amount))).toStrictEqual([]);
  });

  it("takes its figures from the file, so a copy with other values gets matching documents", () => {
    const copy: Application = {
      ...landed,
      applicants: [
        { ...MIA, annualIncome: { ...MIA.annualIncome, value: aud(118_000) } },
        {
          ...DAN,
          employment: {
            ...DAN.employment,
            value: { ...DAN.employment.value, employer: "Brunswick Secondary College" },
          },
        },
      ],
    };
    expect(documentsOnFile(copy).slice(0, 2)).toMatchObject([
      { shows: "Income of about A$118,000 a year, as stated on the call" },
      { title: "Dan's payslips, Brunswick Secondary College" },
    ]);
  });
});
