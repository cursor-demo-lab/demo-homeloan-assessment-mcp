import { describe, expect, it } from "vitest";
import { checkDocuments } from "./checks";
import { answered, landed } from "./journey.fixture";

describe("checkDocuments", () => {
  it("finds the Afterpay account the call didn't mention on the first visit, and one gap", () => {
    const { visit, checks, gaps } = checkDocuments(landed);
    expect(visit).toBe(1);
    expect(checks.map(({ checkId, result }) => [checkId, result])).toStrictEqual([
      ["income-mia", "matches"],
      ["income-dan", "matches"],
      ["identity-dan", "shown-on-documents"],
      ["consent-dan", "shown-on-documents"],
      ["living-expenses", "shown-on-documents"],
      ["debts-and-commitments", "not-on-call"],
      ["deposit-savings", "matches"],
    ]);
    expect(checks.find((check) => check.checkId === "debts-and-commitments")).toStrictEqual({
      checkId: "debts-and-commitments",
      label: "All debts and commitments",
      stated: "Credit card (A$8,000 limit)",
      onDocuments:
        "Credit card (A$8,000 limit), and an Afterpay account with repayments on the bank statements",
      evidence: ["doc-bank-statements", "doc-credit-report"],
      result: "not-on-call",
    });
    expect(gaps).toStrictEqual([
      "The bank statements and credit report show an Afterpay account that wasn't mentioned on the call.",
    ]);
  });

  it("puts no amount on the Afterpay account: every figure is one the call stated", () => {
    const figures = JSON.stringify(checkDocuments(landed)).match(/A\$[\d,]+/gu);
    expect(new Set(figures)).toStrictEqual(
      new Set(["A$112,000", "A$98,000", "A$8,000", "A$160,000"]),
    );
  });

  it("shows the account closed on the second visit, with the closure letter, and no gaps", () => {
    const { visit, checks, gaps } = checkDocuments(answered);
    expect(visit).toBe(2);
    expect(checks.find((check) => check.checkId === "debts-and-commitments")).toMatchObject({
      evidence: ["doc-bank-statements", "doc-credit-report", "doc-afterpay-closure"],
      result: "closed",
    });
    expect(checks.filter((check) => check.result === "not-on-call")).toStrictEqual([]);
    expect(gaps).toStrictEqual([]);
  });

  it("covers every item stage 2 has to check, in the file's order", () => {
    expect(checkDocuments(landed).checks.map((check) => check.checkId)).toStrictEqual(
      landed.toCheck.map((item) => item.id),
    );
  });
});
