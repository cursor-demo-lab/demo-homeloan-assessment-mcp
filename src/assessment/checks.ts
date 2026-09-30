import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { formatAud } from "@/domain/money";
import { visitsTo } from "@/domain/visits";
import { afterpayClosed, documentsOnFile, peopleOn, statedDebts } from "./documents";

export type CheckResult = "matches" | "shown-on-documents" | "not-on-call" | "closed";

export interface DocumentCheck {
  readonly checkId: string;
  readonly label: string;
  readonly stated: string | null;
  readonly onDocuments: string;
  readonly evidence: readonly string[];
  readonly result: CheckResult;
}

export interface DocumentChecks {
  readonly visit: number;
  readonly checks: readonly DocumentCheck[];
  readonly gaps: readonly string[];
}

type Finding = Pick<DocumentCheck, "stated" | "onDocuments" | "result">;

const AFTERPAY_GAP =
  "The bank statements and credit report show an Afterpay account that wasn't mentioned on the call.";

export function checkDocuments(application: Application): DocumentChecks {
  const view = viewFor("credit-assessment", application);
  const visit = visitsTo(application, "credit-assessment");
  const closed = afterpayClosed(application);
  const documents = documentsOnFile(application);
  const debts = statedDebts(view);
  const deposit = formatAud(view["property-goal"].deposit.value);

  const findings = new Map<string, Finding>([
    ...peopleOn(view).flatMap(({ firstName, slug, income }): [string, Finding][] => [
      [
        `income-${slug}`,
        {
          stated: `${formatAud(income.annualIncome.value)} a year`,
          onDocuments: `About ${formatAud(income.annualIncome.value)} a year on ${firstName}'s payslips`,
          result: "matches",
        },
      ],
      [
        `identity-${slug}`,
        {
          stated: null,
          onDocuments: `${firstName}'s photo ID, uploaded with ${firstName}'s documents`,
          result: "shown-on-documents",
        },
      ],
      [
        `consent-${slug}`,
        {
          stated: null,
          onDocuments: `${firstName}'s signed consent to a credit check, uploaded with the ID`,
          result: "shown-on-documents",
        },
      ],
    ]),
    [
      "living-expenses",
      {
        stated: null,
        onDocuments: "Day-to-day spending on three months of joint bank statements",
        result: "shown-on-documents",
      },
    ],
    [
      "debts-and-commitments",
      closed
        ? {
            stated: debts,
            onDocuments: `${debts}. The Afterpay account is closed, and the closure letter is on file`,
            result: "closed",
          }
        : {
            stated: debts,
            onDocuments: `${debts}, and an Afterpay account with repayments on the bank statements`,
            result: "not-on-call",
          },
    ],
    [
      "deposit-savings",
      {
        stated: deposit,
        onDocuments: `Savings of ${deposit} on the savings statement`,
        result: "matches",
      },
    ],
  ]);

  const checks = application.toCheck
    .filter((item) => item.checkedAt === "credit-assessment")
    .map(({ id, label }): DocumentCheck => {
      const finding = findings.get(id);
      if (!finding) {
        throw new Error(`The fictional documents don't cover the check "${id}".`);
      }
      return {
        checkId: id,
        label,
        stated: finding.stated,
        onDocuments: finding.onDocuments,
        evidence: documents.filter((doc) => doc.verifies.includes(id)).map((doc) => doc.id),
        result: finding.result,
      };
    });

  return { visit, checks, gaps: closed ? [] : [AFTERPAY_GAP] };
}
